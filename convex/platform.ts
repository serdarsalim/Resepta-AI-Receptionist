// The operator's view of the whole deployment.
//
// Resepta is ONE Convex deployment serving every salon, which is why this can
// be a route in the app rather than the separate control-plane project Nudge
// needs (Nudge runs a backend per tenant, so nothing inside any one of them
// can see the fleet). A second project here would need its own auth and its
// own deploy to end up reading this exact database.
//
// ⚠️ Every function in this file reads ACROSS orgs and is therefore gated by
// requirePlatformAdmin, never requireOrg. That is the opposite of the rule the
// rest of the codebase follows — see lib/platformAuth.ts for why it is safe
// here and why it must not spread. Nothing outside this file may import from
// lib/platformAuth.
//
// The question this answers is "which salon is broken right now, and do they
// know?" — a salon's WABA token expiring is invisible to us otherwise until
// they phone up asking why nobody got reminded.

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  isPlatformAdmin,
  platformAdminEmails,
  requirePlatformAdmin,
} from "./lib/platformAuth";
import { enrichActivity } from "./activity";
import { monthKey } from "./lib/usage";
import { maskSecret } from "./lib/connections";
import { resolveChatLlm } from "./lib/chatLlm";
import { resolveInboundAddress } from "./lib/inboundAddress";
import { customerSender, emailLaneConfigured } from "./lib/email";
import { emailConfig, platformValue } from "./lib/platformConfig";
import { recordActivity } from "./lib/activity";
import { DEFAULT_MONTHLY_BUDGET_MICRO_USD } from "./lib/llm";

const DAY_MS = 24 * 3600_000;

// Per-org read caps. Health is a signal, not an audit: "more than 200 failures
// in a day" and "exactly 4,812 failures in a day" lead to the same action, and
// only one of them is worth reading five thousand rows for. Counts at the cap
// are reported as capped so the UI can say "200+" rather than quietly lying.
const SCAN_CAP = 200;

const orgHealth = v.object({
  orgId: v.id("orgs"),
  name: v.string(),
  createdAt: v.number(),
  timezone: v.string(),
  language: v.string(),
  members: v.number(),
  // Setup state — the three things that must all be true before a salon gets
  // any value at all, and the usual answer to "why is nothing sending".
  waConnected: v.boolean(),
  approvedTemplates: v.number(),
  calcomConnected: v.boolean(),
  // Whether this org can reach anybody by EMAIL — the deployment has a
  // provider key and a From resolves. Almost always the same answer for every
  // row (it turns on the moment RESEND_API_KEY exists), which is the point:
  // "no WhatsApp" used to read as "this salon is dark" when email was the
  // channel it actually sends on.
  emailReady: v.boolean(),
  // Failure surface over the last 24h.
  failed24h: v.number(),
  deadLettered24h: v.number(),
  capped: v.boolean(),
  retrying: v.number(),
  stuck: v.number(),
  // Liveness. An org with no activity for weeks is either churned or never
  // onboarded, and the two look identical from a billing table.
  lastActivityAt: v.optional(v.number()),
  upcomingAppointments: v.number(),
  // Voice meter, month to date (the org's own month, so this always agrees
  // with the org page). Billed is what they owe us, cost is what Retell
  // charged us — both micro-USD, shown together so the fleet table answers
  // "who is burning money" without opening every org.
  voiceSecondsMtd: v.number(),
  voiceBilledMicroUsdMtd: v.number(),
  voiceCostMicroUsdMtd: v.number(),
});

// Deployment-wide facts, the ones that are true for every org at once. Kept
// apart from `fleet` because they belong to the DEPLOYMENT, not to any salon:
// a missing provider key makes every row dark for one reason, and repeating
// that reason per row would read as twelve salons with twelve problems.
export const deploymentHealth = query({
  args: {},
  returns: v.object({
    emailLane: v.boolean(),
    inboundDomain: v.union(v.string(), v.null()),
    // Who can see this page at all. Printed rather than managed: the console
    // has no way to add one and is not getting one (lib/platformAuth.ts).
    platformAdmins: v.array(v.string()),
  }),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const config = await emailConfig(ctx);
    return {
      emailLane: emailLaneConfigured(config),
      inboundDomain: config.domain,
      platformAdmins: platformAdminEmails(),
    };
  },
});

export const fleet = query({
  args: {},
  returns: v.array(orgHealth),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const now = Date.now();
    const since = now - DAY_MS;

    // One read for the whole deployment rather than one per org: stuck rows
    // are rare and global, so scanning them once and bucketing by org is much
    // cheaper than asking each org whether it has any.
    const stuckByOrg = new Map<Id<"orgs">, number>();
    const stuck = await ctx.db
      .query("messages")
      .withIndex("by_sending", (q) => q.gt("sendingAt", 0))
      .take(500);
    for (const row of stuck) {
      stuckByOrg.set(row.orgId, (stuckByOrg.get(row.orgId) ?? 0) + 1);
    }

    const orgs = await ctx.db.query("orgs").take(200);
    const out = [];
    for (const org of orgs) {
      out.push(await healthFor(ctx, org, now, since, stuckByOrg.get(org._id) ?? 0));
    }
    // Loudest first: the operator opens this to find what is broken, not to
    // read an alphabetical list. Dead letters outrank plain failures because
    // they mean the retry queue gave up, which nothing else recovers from.
    out.sort(
      (a, b) =>
        b.deadLettered24h - a.deadLettered24h ||
        b.failed24h - a.failed24h ||
        b.stuck - a.stuck ||
        (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
    );
    return out;
  },
});

async function healthFor(
  ctx: QueryCtx,
  org: Doc<"orgs">,
  now: number,
  since: number,
  stuck: number,
) {
  const mailConfig = await emailConfig(ctx);
  const [memberships, waAccount, templates] = await Promise.all([
    ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(50),
    ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .unique(),
    ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(50),
  ]);

  // Newest first, so the cap drops the OLD rows rather than the ones inside
  // the window we are asking about.
  const failedRows = await ctx.db
    .query("messages")
    .withIndex("by_org_status", (q) => q.eq("orgId", org._id).eq("status", "failed"))
    .order("desc")
    .take(SCAN_CAP);
  const recentFailed = failedRows.filter((row) => row._creationTime >= since);

  // Queued rows carrying a retry time: sends that failed and are waiting for
  // another go. Worth showing separately from failures — a salon with twenty
  // retrying is mid-incident, not broken.
  const queuedRows = await ctx.db
    .query("messages")
    .withIndex("by_org_status", (q) => q.eq("orgId", org._id).eq("status", "queued"))
    .order("desc")
    .take(SCAN_CAP);

  const lastMessage = await ctx.db
    .query("messages")
    .withIndex("by_org", (q) => q.eq("orgId", org._id))
    .order("desc")
    .first();

  const upcoming = await ctx.db
    .query("appointments")
    .withIndex("by_org_start", (q) => q.eq("orgId", org._id).gte("startAt", now))
    .take(SCAN_CAP);

  const monthUsage = await ctx.db
    .query("usageMonthly")
    .withIndex("by_org_month", (q) =>
      q.eq("orgId", org._id).eq("month", monthKey(now, org.timezone)),
    )
    .unique();

  return {
    orgId: org._id,
    // An org that never finished onboarding has an empty name. Say so rather
    // than rendering a blank cell that reads as a bug in this page.
    name: org.name || "(unnamed)",
    createdAt: org._creationTime,
    timezone: org.timezone,
    language: org.language,
    members: memberships.length,
    waConnected: waAccount !== null,
    approvedTemplates: templates.filter((t) => t.status === "approved").length,
    calcomConnected: Boolean(org.calcomApiKey && org.calcomEventTypeId),
    emailReady: emailLaneConfigured(mailConfig) && Boolean(customerSender(org, mailConfig)),
    failed24h: recentFailed.length,
    deadLettered24h: recentFailed.filter((row) => row.deadLetteredAt !== undefined).length,
    capped: failedRows.length === SCAN_CAP,
    retrying: queuedRows.filter((row) => row.nextAttemptAt !== undefined).length,
    stuck,
    lastActivityAt: lastMessage?._creationTime,
    upcomingAppointments: upcoming.length,
    voiceSecondsMtd: monthUsage?.voiceSeconds ?? 0,
    voiceBilledMicroUsdMtd: monthUsage?.voiceBilledMicroUsd ?? 0,
    voiceCostMicroUsdMtd: monthUsage?.voiceCostMicroUsd ?? 0,
  };
}

// The recent failures for one org, so the operator can tell a token problem
// from a template problem without opening the database. Bounded and read-only:
// there is deliberately no mutation in this file, because the fix for every
// one of these lives in the salon's own Settings.
// The operator's answer to "is this org's messaging alive": the latest
// traffic in both directions with its outcome, not only the wrecks. A feed
// that shows failures alone reads as either "all broken" or "no data", and
// the operator cannot tell which. Paginated with an optional status filter —
// this table grows with every reminder ever sent, so the page must not.
const messageStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("received"),
);

// The org's USER-level activity: who changed what inside the app, as opposed to
// orgActivity below, which is the message feed (what was sent, to whom, and
// whether it landed). Two different questions that both got called "activity",
// so the admin page shows them one above the other and names each.
//
// Platform-only by design. This was briefly a sidebar destination in the salon's
// own app and came straight back out (2026-08-12): an audit log is a debugging
// surface, its readers are operators, and a salon owner has no use for a page
// of "settings changed / businessHours".
//
// Actor names are NOT masked here, unlike the tenant read. See enrichActivity.
export const orgUserActivity = query({
  args: { orgId: v.id("orgs"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, limit }) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db
      .query("activityLog")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return await enrichActivity(ctx, rows, { maskOperator: false });
  },
});

export const orgActivity = query({
  args: {
    orgId: v.id("orgs"),
    status: v.optional(messageStatus),
    paginationOpts: paginationOptsValidator,
  },
  // Paginated: the page shape is convex's, the items are ours.
  returns: v.any(),
  handler: async (ctx, { orgId, status, paginationOpts }) => {
    await requirePlatformAdmin(ctx);
    const base = status
      ? ctx.db
          .query("messages")
          .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status))
      : ctx.db.query("messages").withIndex("by_org", (q) => q.eq("orgId", orgId));
    const result = await base.order("desc").paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map((row) => ({
        _id: row._id,
        at: row._creationTime,
        kind: row.kind,
        direction: row.direction,
        status: row.status,
        error: row.error,
        attempts: row.attempts,
        deadLettered: row.deadLetteredAt !== undefined,
      })),
    };
  },
});

// Whether to render the admin link. Every signed-in user calls this, so it
// returns false rather than throwing.
export const amPlatformAdmin = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await isPlatformAdmin(ctx),
});

// ---- One tenant's setup ----
//
// Everything an operator installs during onboarding, in one place, because
// that is the shape of the job: a salon is wired once and then left alone.
// Secrets come back masked for the same reason they do in convex/connections.ts
// — the operator pasted them in and does not need them read back, and a console
// that recites credentials makes one stolen session worth every client's
// accounts at once.

const maskedSecret = v.union(v.string(), v.null());

export const orgDetail = query({
  args: { orgId: v.id("orgs") },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      timezone: v.string(),
      language: v.string(),
      demoMode: v.boolean(),
      emailFrom: v.union(v.string(), v.null()),
      inboundAddress: v.union(v.string(), v.null()),
      calcomApiKey: maskedSecret,
      calcomEventTypeId: v.union(v.string(), v.null()),
      voiceAgentSource: v.union(v.literal("randevu"), v.literal("account")),
      calcomWebhookToken: v.union(v.string(), v.null()),
      wa: v.union(
        v.null(),
        v.object({
          phoneNumberId: v.string(),
          wabaId: v.union(v.string(), v.null()),
          displayNumber: v.union(v.string(), v.null()),
          accessToken: maskedSecret,
        }),
      ),
      agents: v.array(
        v.object({
          retellAgentId: v.string(),
          inboundNumber: v.union(v.string(), v.null()),
          transferNumber: v.union(v.string(), v.null()),
          enabled: v.boolean(),
          runtimeConnectedAt: v.union(v.number(), v.null()),
          lastCallEventAt: v.union(v.number(), v.null()),
          lastAnalyzedEventAt: v.union(v.number(), v.null()),
          pendingEvents: v.number(),
          failedEvents: v.number(),
          latestFailure: v.union(
            v.null(),
            v.object({
              callId: v.string(),
              eventType: v.string(),
              receivedAt: v.number(),
              attempts: v.number(),
              error: v.union(v.string(), v.null()),
            }),
          ),
        }),
      ),
      voiceProvisioning: v.array(
        v.object({
          name: v.string(),
          status: v.string(),
          template: v.string(),
          updatedAt: v.number(),
          retellLlmId: v.union(v.string(), v.null()),
          retellAgentId: v.union(v.string(), v.null()),
          error: v.union(v.string(), v.null()),
        }),
      ),
      // Who can actually sign in. The operator's first question on a support
      // call is which address to expect, and Google-only sign-in means there
      // is no way to look it up from the other side.
      members: v.array(
        v.object({
          name: v.union(v.string(), v.null()),
          email: v.union(v.string(), v.null()),
          role: v.string(),
          // Unset means somebody else added them and they have not signed in
          // to see it yet — the difference between a real user and a seat.
          seenAt: v.union(v.number(), v.null()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    const [wa, agents, voiceEvents, voiceProvisioning, memberships] = await Promise.all([
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .unique(),
      ctx.db
        .query("retellAgents")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect(),
      ctx.db
        .query("voiceEvents")
        .withIndex("by_org_received", (q) => q.eq("orgId", args.orgId))
        .order("desc")
        .take(SCAN_CAP),
      ctx.db
        .query("voiceAgentProvisioning")
        .withIndex("by_org_updated", (q) => q.eq("orgId", args.orgId))
        .order("desc")
        .take(10),
      ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect(),
    ]);
    const members = (
      await Promise.all(
        memberships.map(async (membership) => {
          const user = await ctx.db.get(membership.userId);
          return {
            name: user?.name ?? null,
            email: user?.email ?? null,
            role: membership.role,
            seenAt: membership.seenAt ?? null,
          };
        }),
      )
    ).sort((a, b) =>
      // Owners first, then by whatever name there is to read.
      a.role === b.role
        ? (a.email ?? "").localeCompare(b.email ?? "")
        : a.role === "owner"
          ? -1
          : 1,
    );
    return {
      name: org.name,
      timezone: org.timezone,
      language: org.language,
      demoMode: org.demoMode === true,
      emailFrom: org.emailFrom ?? null,
      inboundAddress: org.inboundAddress ?? null,
      calcomApiKey: org.calcomApiKey ? maskSecret(org.calcomApiKey) : null,
      calcomEventTypeId: org.calcomEventTypeId ?? null,
      voiceAgentSource: org.voiceAgentSource ?? "randevu",
      calcomWebhookToken: org.calcomWebhookToken ?? null,
      wa: wa
        ? {
            phoneNumberId: wa.phoneNumberId,
            wabaId: wa.wabaId ?? null,
            displayNumber: wa.displayNumber ?? null,
            accessToken: wa.accessToken ? maskSecret(wa.accessToken) : null,
          }
        : null,
      agents: agents.map((a) => {
        const ownEvents = voiceEvents.filter(
          (event) => event.retellAgentId === a.retellAgentId,
        );
        const latestFailure = ownEvents.find((event) => event.status === "failed");
        return {
          retellAgentId: a.retellAgentId,
          inboundNumber: a.inboundNumber ?? null,
          transferNumber: a.transferNumber ?? null,
          enabled: a.enabled,
          runtimeConnectedAt: a.runtimeConnectedAt ?? null,
          lastCallEventAt: a.lastCallEventAt ?? null,
          lastAnalyzedEventAt: a.lastAnalyzedEventAt ?? null,
          pendingEvents: ownEvents.filter(
            (event) =>
              event.status === "queued" ||
              event.status === "processing" ||
              event.status === "retrying",
          ).length,
          failedEvents: ownEvents.filter((event) => event.status === "failed").length,
          latestFailure: latestFailure
            ? {
                callId: latestFailure.retellCallId,
                eventType: latestFailure.eventType,
                receivedAt: latestFailure.receivedAt,
                attempts: latestFailure.attempts,
                error: latestFailure.error ?? null,
              }
            : null,
        };
      }),
      voiceProvisioning: voiceProvisioning.map((job) => ({
        name: job.name,
        status: job.status,
        template: `${job.templateKey}@${job.templateVersion}`,
        updatedAt: job.updatedAt,
        retellLlmId: job.retellLlmId ?? null,
        retellAgentId: job.retellAgentId ?? null,
        error: job.error ?? null,
      })),
      members,
    };
  },
});

// A failed inbox row is still the durable source payload, so an operator can
// safely retry it without asking the provider to send the event again.
export const retryVoiceEvents = mutation({
  args: { orgId: v.id("orgs"), retellAgentId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || agent.orgId !== args.orgId) throw new Error("no-such-agent");
    const failed = (
      await ctx.db
        .query("voiceEvents")
        .withIndex("by_org_status", (q) =>
          q.eq("orgId", args.orgId).eq("status", "failed"),
        )
        .order("desc")
        .take(SCAN_CAP)
    )
      .filter((event) => event.retellAgentId === args.retellAgentId)
      .slice(0, 50);
    for (const event of failed) {
      if (event.eventType === "analysis_recovery") {
        await ctx.db.patch(event._id, {
          status: "retrying",
          attempts: 0,
          error: undefined,
          nextAttemptAt: Date.now(),
        });
        await ctx.scheduler.runAfter(0, internal.voiceEvents.recoverAnalysis, {
          orgId: args.orgId,
          retellAgentId: args.retellAgentId,
          retellCallId: event.retellCallId,
          attempt: 0,
        });
      } else {
        await ctx.db.patch(event._id, {
          status: "queued",
          attempts: 0,
          processingAt: undefined,
          error: undefined,
          nextAttemptAt: undefined,
        });
        await ctx.scheduler.runAfter(0, internal.voiceEvents.process, {
          eventId: event._id,
        });
      }
    }
    if (failed.length > 0) {
      await ctx.db.patch(agent._id, {
        lastEventErrorAt: undefined,
        lastEventError: undefined,
      });
    }
    return failed.length;
  },
});

// An absent field is "leave it alone"; an empty string is "clear it". Two
// distinct intents that a single optional string would otherwise collapse into
// one, which is how a form that submits every field wipes the three the
// operator did not touch.
function applied(next: string | undefined, current: string | undefined) {
  if (next === undefined) return current;
  return next.trim() || undefined;
}

export const setOrgConfig = mutation({
  args: {
    orgId: v.id("orgs"),
    emailFrom: v.optional(v.string()),
    inboundAddress: v.optional(v.string()),
    calcomApiKey: v.optional(v.string()),
    calcomEventTypeId: v.optional(v.string()),
    voiceAgentSource: v.optional(
      v.union(v.literal("randevu"), v.literal("account")),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    // The incoming address goes through the same slug + uniqueness rules the
    // owner's own settings page applies. It did not used to: this path trimmed
    // the string and wrote it, so an operator setting a second org to an
    // address already in use — or to the same one in different case — pointed
    // one salon's customer replies into another salon's inbox. `applied`
    // still owns the absent-vs-empty distinction; only a real value is
    // resolved.
    const nextInbound = applied(args.inboundAddress, org.inboundAddress);
    await ctx.db.patch(args.orgId, {
      emailFrom: applied(args.emailFrom, org.emailFrom),
      inboundAddress:
        nextInbound === undefined || nextInbound === org.inboundAddress
          ? nextInbound
          : await resolveInboundAddress(ctx, args.orgId, nextInbound),
      calcomApiKey: applied(args.calcomApiKey, org.calcomApiKey),
      calcomEventTypeId: applied(args.calcomEventTypeId, org.calcomEventTypeId),
      // Absent means "not part of this patch", the same as every field above.
      voiceAgentSource: args.voiceAgentSource ?? org.voiceAgentSource,
    });
    return null;
  },
});

export const setWaAccount = mutation({
  args: {
    orgId: v.id("orgs"),
    phoneNumberId: v.string(),
    wabaId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    displayNumber: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const phoneNumberId = args.phoneNumberId.trim();
    if (!phoneNumberId) throw new Error("phone-number-id-required");
    // Inbound WhatsApp resolves an org by metadata.phone_number_id through a
    // .unique() lookup, so two orgs sharing one id does not degrade gracefully
    // — it throws on every inbound message for BOTH of them. Refuse it here,
    // where one operator is looking at the mistake, rather than at 2am.
    const clash = await ctx.db
      .query("waAccounts")
      .withIndex("by_phone_number_id", (q) => q.eq("phoneNumberId", phoneNumberId))
      .unique();
    if (clash && clash.orgId !== args.orgId) throw new Error("number-already-connected");
    const existing = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
    if (!existing) {
      if (!args.accessToken?.trim()) throw new Error("access-token-required");
      await ctx.db.insert("waAccounts", {
        orgId: args.orgId,
        phoneNumberId,
        wabaId: args.wabaId?.trim() || undefined,
        accessToken: args.accessToken.trim(),
        displayNumber: args.displayNumber?.trim() || undefined,
      });
      return null;
    }
    await ctx.db.patch(existing._id, {
      phoneNumberId,
      wabaId: applied(args.wabaId, existing.wabaId),
      // Blank means "keep the token", not "clear it": the operator editing a
      // display number should not have to re-paste a credential they cannot
      // read back off the screen.
      accessToken: args.accessToken?.trim() || existing.accessToken,
      displayNumber: applied(args.displayNumber, existing.displayNumber),
    });
    return null;
  },
});

// ---- Working inside a tenant ----
//
// Setting users.actingAsOrgId is what lib/orgAuth reads to resolve this caller
// into the tenant. The column is inert on its own — orgAuth honours it only for
// an address on PLATFORM_ADMIN_EMAILS — so this mutation is a convenience, not
// the grant. Removing an address from the env var ends every session it opened,
// with no cleanup and nothing to revoke.

export const actingAs = query({
  args: {},
  returns: v.union(v.null(), v.object({ orgId: v.id("orgs"), name: v.string() })),
  handler: async (ctx) => {
    // Every signed-in user's shell calls this to decide whether to show the
    // banner, so it returns null rather than throwing for a normal salon.
    if (!(await isPlatformAdmin(ctx))) return null;
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user?.actingAsOrgId) return null;
    const org = await ctx.db.get(user.actingAsOrgId);
    if (!org) return null;
    return { orgId: user.actingAsOrgId, name: org.name };
  },
});

export const actAs = mutation({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(admin._id, { actingAsOrgId: args.orgId });
    return null;
  },
});

export const stopActingAs = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const admin = await requirePlatformAdmin(ctx);
    await ctx.db.patch(admin._id, { actingAsOrgId: undefined });
    return null;
  },
});

// ── The chat agent's control plane (docs/chat-agent.md §5, §9) ──────────────
// Everything the operator sees and flips about an org's assistant, in one
// query and three mutations. Every flip writes the org's activity feed —
// "nothing changes agent behaviour except a recorded, reversible action".

export const orgAssistant = query({
  args: { orgId: v.id("orgs") },
  returns: v.union(
    v.null(),
    v.object({
      mode: v.union(v.literal("off"), v.literal("shadow"), v.literal("live")),
      status: v.union(v.literal("active"), v.literal("suspended")),
      budgetMicroUsd: v.union(v.number(), v.null()),
      defaultBudgetMicroUsd: v.number(),
      killSwitch: v.boolean(),
      llmKeyConfigured: v.boolean(),
      llmProvider: v.union(v.literal("anthropic"), v.literal("openai")),
      llmModel: v.string(),
      month: v.string(),
      usage: v.union(
        v.null(),
        v.object({
          llmTurns: v.number(),
          llmInputTokens: v.number(),
          llmOutputTokens: v.number(),
          llmCostMicroUsd: v.number(),
        }),
      ),
      turns: v.array(
        v.object({
          at: v.number(),
          customerName: v.string(),
          status: v.string(),
          reply: v.optional(v.string()),
          toolCalls: v.optional(v.string()),
          model: v.string(),
          templateVersion: v.number(),
          inputTokens: v.number(),
          outputTokens: v.number(),
          costMicroUsd: v.number(),
          latencyMs: v.optional(v.number()),
          error: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    const month = new Date().toISOString().slice(0, 7);
    const usage = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) => q.eq("orgId", args.orgId).eq("month", month))
      .unique();
    const turns = await ctx.db
      .query("chatAgentTurns")
      .withIndex("by_org_at", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(25);
    // One read per distinct customer, not per turn — same shape as the notes
    // author resolution in messages.ts.
    const names = new Map<string, string>();
    for (const customerId of new Set(turns.map((t) => t.customerId))) {
      const customer = await ctx.db.get(customerId);
      names.set(
        customerId,
        customer
          ? `${customer.firstName} ${customer.lastName ?? ""}`.trim() || customer.phone
          : "—",
      );
    }
    const llm = await resolveChatLlm(ctx, args.orgId);
    return {
      mode: org.chatAgentMode ?? "off",
      status: org.status ?? "active",
      budgetMicroUsd: org.chatAgentMonthlyBudgetMicroUsd ?? null,
      defaultBudgetMicroUsd: DEFAULT_MONTHLY_BUDGET_MICRO_USD,
      killSwitch: (await platformValue(ctx, "chatAgentDisabled")) === "true",
      llmKeyConfigured: Boolean(llm.apiKey),
      llmProvider: llm.provider,
      llmModel: llm.model,
      month,
      usage: usage
        ? {
            llmTurns: usage.llmTurns,
            llmInputTokens: usage.llmInputTokens,
            llmOutputTokens: usage.llmOutputTokens,
            llmCostMicroUsd: usage.llmCostMicroUsd,
          }
        : null,
      turns: turns.map((t) => ({
        at: t.at,
        customerName: names.get(t.customerId) ?? "—",
        status: t.status,
        reply: t.reply,
        toolCalls: t.toolCalls,
        model: t.model,
        templateVersion: t.templateVersion,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        costMicroUsd: t.costMicroUsd,
        latencyMs: t.latencyMs,
        error: t.error,
      })),
    };
  },
});

export const setChatAgentMode = mutation({
  args: {
    orgId: v.id("orgs"),
    mode: v.union(v.literal("off"), v.literal("shadow"), v.literal("live")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(args.orgId, { chatAgentMode: args.mode });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail: `chat agent → ${args.mode}`,
    });
    return null;
  },
});

export const setChatAgentBudget = mutation({
  args: {
    orgId: v.id("orgs"),
    // null clears the override back to the code default.
    budgetMicroUsd: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(args.orgId, {
      chatAgentMonthlyBudgetMicroUsd:
        args.budgetMicroUsd === null
          ? undefined
          : Math.max(0, Math.round(args.budgetMicroUsd)),
    });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail: "chat agent budget",
    });
    return null;
  },
});

// ── The voice meter's control plane ─────────────────────────────────────────
// The operator's answer to "what does this org's phone agent cost, and what
// do I bill them". Reads the same usageMonthly ledger the chat lane writes;
// the voice counters land there from retell.recordCall. Rate changes only
// affect calls stamped AFTER the change — history is frozen line items.

export const orgVoiceUsage = query({
  args: { orgId: v.id("orgs") },
  returns: v.union(
    v.null(),
    v.object({
      rateMicroUsdPerMinute: v.union(v.number(), v.null()),
      defaultRateMicroUsdPerMinute: v.union(v.number(), v.null()),
      months: v.array(
        v.object({
          month: v.string(),
          calls: v.number(),
          seconds: v.number(),
          billedMicroUsd: v.number(),
          costMicroUsd: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    // Newest month first. Rows with no voice activity are dropped rather than
    // rendered as a table of zeros — most ledger rows are LLM-only.
    const rows = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(24);
    return {
      rateMicroUsdPerMinute: org.voiceRateMicroUsdPerMinute ?? null,
      defaultRateMicroUsdPerMinute:
        Number(await platformValue(ctx, "voiceRateMicroUsdPerMinute")) || null,
      months: rows
        .filter(
          (r) =>
            (r.voiceCalls ?? 0) > 0 ||
            (r.voiceSeconds ?? 0) > 0 ||
            (r.voiceBilledMicroUsd ?? 0) > 0 ||
            (r.voiceCostMicroUsd ?? 0) > 0,
        )
        .map((r) => ({
          month: r.month,
          calls: r.voiceCalls ?? 0,
          seconds: r.voiceSeconds ?? 0,
          billedMicroUsd: r.voiceBilledMicroUsd ?? 0,
          costMicroUsd: r.voiceCostMicroUsd ?? 0,
        })),
    };
  },
});

export const setVoiceRate = mutation({
  args: {
    orgId: v.id("orgs"),
    // null clears the rate: the org meters at rate zero from the next call.
    rateMicroUsdPerMinute: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(args.orgId, {
      voiceRateMicroUsdPerMinute:
        args.rateMicroUsdPerMinute === null
          ? undefined
          : Math.max(0, Math.round(args.rateMicroUsdPerMinute)),
    });
    // The activity row names the number: this is the record a billing
    // question reads back later, and "settings changed" answers nothing.
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail:
        args.rateMicroUsdPerMinute === null
          ? "voice rate cleared"
          : `voice rate → $${(args.rateMicroUsdPerMinute / 1_000_000).toFixed(2)}/min`,
    });
    return null;
  },
});

// Suspension (docs/chat-agent.md §8): outbound stops at the send chokepoints,
// inbound keeps recording. The activity row is the record a billing dispute
// reads back later, so it names the state, not just "settings changed".
export const setOrgStatus = mutation({
  args: {
    orgId: v.id("orgs"),
    status: v.union(v.literal("active"), v.literal("suspended")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(args.orgId, { status: args.status });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail: args.status === "suspended" ? "account suspended" : "account reactivated",
    });
    return null;
  },
});
