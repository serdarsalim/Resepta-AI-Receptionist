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
import {
  action,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { connectionField } from "./lib/connections";
import {
  isPlatformAdmin,
  platformAdminEmails,
  requirePlatformAdmin,
} from "./lib/platformAuth";
import { enrichActivity } from "./activity";
import { applyWalletCredit } from "./wallet";
import { monthKey } from "./lib/usage";
import { maskSecret } from "./lib/connections";
import { resolveChatLlm } from "./lib/chatLlm";
import { resolveInboundAddress } from "./lib/inboundAddress";
import { customerSender, emailLaneConfigured } from "./lib/email";
import { emailConfig, platformValue, type EmailConfig } from "./lib/platformConfig";
import { recordActivity } from "./lib/activity";
import { DEFAULT_MONTHLY_BUDGET_MICRO_USD } from "./lib/llm";
import { isVoiceModel, resolvePlatformVoiceModel } from "./lib/voiceModels";
import { applyAgentModel } from "./retellAgent";

const DAY_MS = 24 * 3600_000;

// Per-org read cap, still used by the per-org detail queries further down.
// Health is a signal, not an audit: "more than 200 failures in a day" and
// "exactly 4,812 failures in a day" lead to the same action, and only one of
// them is worth reading five thousand rows for. Counts at the cap are reported
// as capped so the UI can say "200+" rather than quietly lying.
const SCAN_CAP = 200;

// FLEET-wide cap for the one query that spans every org. Deliberately generous
// and deliberately ONE budget rather than 200 of them: this is what turns the
// fleet page's cost from "700 documents times however many customers we have"
// into a flat ceiling it cannot cross. 2,000 covers a fleet-wide day of
// failures, every org's queue, and a few thousand upcoming bookings with room
// to spare, and sits an order of magnitude under Convex's 32,000-document
// transaction limit.
const FLEET_CAP = 2000;

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
    // Read ONCE and passed down. emailConfig is deployment-global and was the
    // first statement of healthFor, so it ran a full platformConfig collect per
    // org — 200 redundant scans per invocation of this query.
    const mailConfig = await emailConfig(ctx);

    // ── Everything below is read ONCE for the whole fleet and bucketed by org,
    // which is the pattern `stuck` above has always used and the rest of this
    // page did not.
    //
    // healthFor used to do three 200-row takes plus two 50-row takes PER ORG:
    // ~700 documents each, so ~140,000 at the 200-org cap against Convex's
    // 32,000-per-transaction limit. The page did not get slow past roughly
    // 25-45 active businesses, it threw — and it is a subscribed query, so it
    // re-ran on any write to messages or appointments for any org.
    //
    // The insight is that these reads are proportional to the wrong thing. A
    // fleet-wide read of the FAILURES costs what is broken rather than what
    // exists, and failures are rare; memberships and templates are single
    // digits per org. Only `upcoming` is genuinely large, and it is a liveness
    // count rather than a number anyone acts on, so it takes a fleet-wide cap
    // and says when it hit one.
    const bucket = <T extends { orgId: Id<"orgs"> }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const key = row.orgId as string;
        const list = map.get(key);
        if (list) list.push(row);
        else map.set(key, [row]);
      }
      return map;
    };

    // Bounded by _creationTime, not by count: the window is the question being
    // asked, so the cap is a safety net rather than the mechanism.
    const failedRows = await ctx.db
      .query("messages")
      .withIndex("by_status_creation", (q) =>
        q.eq("status", "failed").gte("_creationTime", since),
      )
      .take(FLEET_CAP);
    const queuedRows = await ctx.db
      .query("messages")
      .withIndex("by_status_creation", (q) => q.eq("status", "queued"))
      .order("desc")
      .take(FLEET_CAP);
    const upcomingRows = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) => q.gte("startAt", now))
      .take(FLEET_CAP);
    const membershipRows = await ctx.db.query("memberships").take(FLEET_CAP);
    const templateRows = await ctx.db.query("waTemplates").take(FLEET_CAP);
    const waAccountRows = await ctx.db.query("waAccounts").take(FLEET_CAP);

    const fleet: FleetReads = {
      failed: bucket(failedRows),
      queued: bucket(queuedRows),
      upcoming: bucket(upcomingRows),
      memberships: bucket(membershipRows),
      templates: bucket(templateRows),
      waAccounts: new Set(waAccountRows.map((row) => row.orgId as string)),
      // Said out loud rather than silently truncated: a capped count reads as
      // "this is the number" and the operator would act on it.
      cappedUpcoming: upcomingRows.length === FLEET_CAP,
      cappedQueued: queuedRows.length === FLEET_CAP,
      cappedFailed: failedRows.length === FLEET_CAP,
    };
    // Concurrent, not sequential. Each healthFor is ~700 documents (three
    // 200-row message/appointment takes plus memberships and templates), so at
    // the 200-org ceiling this query reads ~140k documents against Convex's
    // 32,000-per-transaction limit — the fleet page starts throwing somewhere
    // around 25-45 active orgs and never recovers, because it is a subscribed
    // query that re-runs on any write to messages, appointments, memberships or
    // usageMonthly for ANY org. Promise.all does not lower the read count, so
    // the ceiling is still there; it does stop the latency being the sum of 200
    // Each healthFor is now two point reads (its newest message, its usage row)
    // against the pre-bucketed fleet data, so this is ~400 documents plus the
    // fleet reads above rather than 700 per org.
    const out = await Promise.all(
      orgs.map((org) =>
        healthFor(ctx, org, now, stuckByOrg.get(org._id) ?? 0, mailConfig, fleet),
      ),
    );
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

// One fleet-wide read per table, bucketed by org. See the comment at the call
// site for why this replaced per-org scans.
type FleetReads = {
  failed: Map<string, Doc<"messages">[]>;
  queued: Map<string, Doc<"messages">[]>;
  upcoming: Map<string, Doc<"appointments">[]>;
  memberships: Map<string, Doc<"memberships">[]>;
  templates: Map<string, Doc<"waTemplates">[]>;
  waAccounts: Set<string>;
  cappedUpcoming: boolean;
  cappedQueued: boolean;
  cappedFailed: boolean;
};

async function healthFor(
  ctx: QueryCtx,
  org: Doc<"orgs">,
  now: number,
  stuck: number,
  // Passed in rather than read here: it is deployment-global, and reading it per
  // org meant a full platformConfig scan for every row on the page.
  mailConfig: EmailConfig,
  fleet: FleetReads,
) {
  const key = org._id as string;
  const memberships = fleet.memberships.get(key) ?? [];
  const templates = fleet.templates.get(key) ?? [];
  // Already inside the 24h window — the fleet read bounded it by _creationTime
  // rather than by row count, so there is nothing left to filter here.
  const recentFailed = fleet.failed.get(key) ?? [];
  const queuedRows = fleet.queued.get(key) ?? [];
  const upcoming = fleet.upcoming.get(key) ?? [];

  // The one genuinely per-org read left, and it is a single document: the
  // newest message, for the "is this org alive" timestamp. A fleet-wide
  // equivalent would have to read every org's whole tail to find each one's
  // first row, which costs more than 200 point reads, not less.
  const lastMessage = await ctx.db
    .query("messages")
    .withIndex("by_org", (q) => q.eq("orgId", org._id))
    .order("desc")
    .first();

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
    waConnected: fleet.waAccounts.has(key),
    approvedTemplates: templates.filter((t) => t.status === "approved").length,
    calcomConnected: Boolean(org.calcomApiKey && org.calcomEventTypeId),
    emailReady: emailLaneConfigured(mailConfig) && Boolean(customerSender(org, mailConfig)),
    failed24h: recentFailed.length,
    deadLettered24h: recentFailed.filter((row) => row.deadLetteredAt !== undefined).length,
    // Now a FLEET-wide cap rather than a per-org one, so it means "this number
    // may be low across the whole page", which is the honest reading.
    capped: fleet.cappedFailed || fleet.cappedQueued || fleet.cappedUpcoming,
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
      // The fleet default voice model (validated against the catalogue),
      // null when unset — the per-agent picker's "Platform default" label
      // reads this so the two screens cannot disagree about what default
      // means.
      platformVoiceModel: v.union(v.string(), v.null()),
      calcomWebhookToken: v.union(v.string(), v.null()),
      evolutionInstance: v.union(v.string(), v.null()),
      evolutionWebhookToken: v.union(v.string(), v.null()),
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
          // The provider's display name, from the cache retellAgents.name —
          // an operator recognises "Bella Randevu Asistanı", not agent_bfc9….
          name: v.union(v.string(), v.null()),
          inboundNumber: v.union(v.string(), v.null()),
          transferNumber: v.union(v.string(), v.null()),
          enabled: v.boolean(),
          // The operator's model override, null when the agent runs the
          // platform default. Display + the picker's current value.
          llmModel: v.union(v.string(), v.null()),
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
      platformVoiceModel: resolvePlatformVoiceModel(
        await platformValue(ctx, "voiceModel"),
      ),
      calcomWebhookToken: org.calcomWebhookToken ?? null,
      evolutionInstance: org.evolutionInstance ?? null,
      evolutionWebhookToken: org.evolutionWebhookToken ?? null,
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
          name: a.name ?? null,
          inboundNumber: a.inboundNumber ?? null,
          transferNumber: a.transferNumber ?? null,
          enabled: a.enabled,
          llmModel: a.llmModel ?? null,
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
    // Nothing in the app wrote this before, so it was set by hand in the Convex
    // dashboard. It is a label now rather than the Evolution lane's credential
    // (see rotateEvolutionWebhookToken), but the webhook still checks the
    // payload against it, so the operator needs somewhere to type it.
    evolutionInstance: v.optional(v.string()),
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
      // Two orgs on one instance name would make the payload check ambiguous,
      // and the by_evolution_instance lookup a .unique() throw — the same shape
      // setWaAccount refuses below for phone_number_id, and worth refusing here
      // while one operator is looking at the mistake.
      evolutionInstance: await (async () => {
        const next = applied(args.evolutionInstance, org.evolutionInstance);
        if (next === undefined || next === org.evolutionInstance) return next;
        const clash = await ctx.db
          .query("orgs")
          .withIndex("by_evolution_instance", (q) =>
            q.eq("evolutionInstance", next),
          )
          .unique();
        if (clash && clash._id !== args.orgId) {
          throw new Error("instance-already-connected");
        }
        return next;
      })(),
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
      // No token is a valid account now: the row rides the platform token
      // (lib/platformConfig resolveWaAccount) — the Tech Provider shape,
      // where per-org setup is just the routing facts.
      await ctx.db.insert("waAccounts", {
        orgId: args.orgId,
        phoneNumberId,
        wabaId: args.wabaId?.trim() || undefined,
        accessToken: args.accessToken?.trim() || undefined,
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
      // The prepaid wallet, resolved rather than raw: unset mode reads as
      // "invoice" so the panel never renders a third state that only means
      // "older org".
      billingMode: v.union(v.literal("invoice"), v.literal("prepaid")),
      // The lines this tenant may use, inbound and outbound. Empty means not
      // restricted yet — see setAllowedPhoneNumbers for why that is the default
      // rather than a lockout.
      allowedPhoneNumbers: v.array(v.string()),
      walletBalanceMicroUsd: v.number(),
      topups: v.array(
        v.object({
          at: v.number(),
          amountMicroUsd: v.number(),
          source: v.union(v.literal("stripe"), v.literal("manual"), v.literal("trial")),
        }),
      ),
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
    const topups = await ctx.db
      .query("walletTopups")
      .withIndex("by_org_at", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(12);
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
      billingMode: org.billingMode ?? "invoice",
      allowedPhoneNumbers: org.allowedPhoneNumbers ?? [],
      walletBalanceMicroUsd: org.walletBalanceMicroUsd ?? 0,
      topups: topups.map((t) => ({
        at: t.at,
        amountMicroUsd: t.amountMicroUsd,
        source: t.source,
      })),
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

// Which settlement model this org lives under (schema: orgs.billingMode).
// Switching to prepaid starts enforcing the wallet on the NEXT ring — an org
// switched with a zero balance stops taking calls until money lands, which
// is the operator's own answer to "when does enforcement start".
export const setBillingMode = mutation({
  args: {
    orgId: v.id("orgs"),
    mode: v.union(v.literal("invoice"), v.literal("prepaid")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(args.orgId, { billingMode: args.mode });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail: `billing mode → ${args.mode}`,
    });
    return null;
  },
});

// Operator money: goodwill credit, a correction, or (negative) clawing back
// a mistaken one. Same code path as the Stripe webhook, so the balance and
// the trail move together here too.
export const addWalletCredit = mutation({
  args: { orgId: v.id("orgs"), amountMicroUsd: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const amount = Math.round(args.amountMicroUsd);
    if (amount === 0) return null;
    await applyWalletCredit(ctx, {
      orgId: args.orgId,
      amountMicroUsd: amount,
      source: "manual",
      by: admin._id,
    });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail: `wallet credit ${amount > 0 ? "+" : "−"}$${Math.abs(amount / 1_000_000).toFixed(2)} (manual)`,
    });
    return null;
  },
});

// Mints the Evolution inbound webhook's token, which is that endpoint's whole
// credential — Evolution offers no HMAC and no shared secret of its own, so the
// org used to be resolved from the instance NAME in the payload and the route
// was unauthenticated in practice.
//
// Operator-side rather than owner-side because /admin is where Evolution gets
// configured (nothing in the app writes evolutionInstance either), and because
// the operator is the one who needs a fresh token the moment a webhook URL
// leaks. Returns it so the console can show the URL to paste.
export const rotateEvolutionWebhookToken = mutation({
  args: { orgId: v.id("orgs") },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const token = crypto.randomUUID().replace(/-/g, "");
    await ctx.db.patch(args.orgId, { evolutionWebhookToken: token });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail: "evolution webhook token rotated",
    });
    return token;
  },
});

// Which phone lines this tenant may use, for inbound routing and as an
// outbound caller id. Operator-only, because the numbers live in a Retell
// account the tenants share and deciding who gets which is not a decision a
// tenant can be trusted to make about themselves.
//
// An empty list means "not restricted", not "no numbers": that is the state
// every org is in the day this ships, and turning it into a lockout would take
// the phones down fleet-wide. The cross-org claim check in retell.lineUsable
// runs regardless, so an org with no list still cannot take a line somebody
// else is holding.
// What the provisioning checklist below needs in one authorized read: the
// org's key, its current allowlist, and who already holds every number —
// through other orgs' allowlists and through live agent bindings both.
export const provisionableContext = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    apiKey: v.union(v.string(), v.null()),
    allowed: v.array(v.string()),
    heldBy: v.array(v.object({ number: v.string(), org: v.string() })),
    // Every connected agent across the fleet, so the action can resolve a
    // PROVIDER-side binding (a number's inbound/outbound agents at Retell)
    // to the business that owns the agent — or to nobody, which is how a
    // number claimed by a non-Resepta agent on the shared account surfaces.
    agentOrgs: v.array(
      v.object({ retellAgentId: v.string(), orgId: v.string(), org: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const heldBy = new Map<string, string>();
    // Allowlists first — provisioning intent counts as held even before a
    // line is bound to an agent — then live bindings for anything unlisted.
    const orgs = await ctx.db.query("orgs").collect();
    const names = new Map(orgs.map((o) => [o._id, o.name]));
    for (const other of orgs) {
      if (other._id === args.orgId) continue;
      for (const number of other.allowedPhoneNumbers ?? []) {
        if (!heldBy.has(number)) heldBy.set(number, other.name);
      }
    }
    const lines = await ctx.db.query("agentLines").collect();
    for (const line of lines) {
      if (line.orgId === args.orgId || heldBy.has(line.number)) continue;
      heldBy.set(line.number, names.get(line.orgId) ?? "another business");
    }
    const agents = await ctx.db.query("retellAgents").collect();
    return {
      apiKey: await connectionField(ctx, args.orgId, "retell", "apiKey"),
      allowed: org.allowedPhoneNumbers ?? [],
      heldBy: [...heldBy].map(([number, orgName]) => ({ number, org: orgName })),
      agentOrgs: agents.map((agent) => ({
        retellAgentId: agent.retellAgentId,
        orgId: String(agent.orgId),
        org: names.get(agent.orgId) ?? "another business",
      })),
    };
  },
});

// The admin gate for actions in this file. Actions hold no ctx.db, so they
// cannot call requirePlatformAdmin themselves; the identity propagates into
// runQuery, and this is the one line they need answered. Returns nothing on
// purpose — it either passes or throws.
export const assertOperator = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return null;
  },
});

// The operator's per-agent model override, from /admin. An action because the
// model lives in the provider's response engine: applyAgentModel clones a
// draft, patches the engine, publishes, and only then stamps the row — so
// the database never claims a model the agent is not running. Null clears
// the override back to the platform default. The dropdown in the console is
// built from lib/voiceModels, and the id is re-checked here because a
// validator cannot: the catalogue is data, not a type.
export const setAgentModel = action({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    model: v.union(v.string(), v.null()),
  },
  returns: v.object({ ok: v.boolean(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; version: number | null }> => {
    await ctx.runQuery(internal.platform.assertOperator, {});
    if (args.model !== null && !isVoiceModel(args.model)) {
      throw new Error(`Unknown model: ${args.model}`);
    }
    return await applyAgentModel(ctx, {
      agentId: args.retellAgentId,
      orgId: args.orgId,
      model: args.model,
    });
  },
});

// The provisioning picker's options: the Retell account's REAL numbers, so
// the operator ticks lines instead of retyping E.164 into a text field — the
// same free-text-drifts lesson the tenant pickers already learned. A number
// this org's allowlist names that the account no longer lists still renders,
// flagged, so unticking it is how the stale entry gets cleaned up.
export const listProvisionableNumbers = action({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      number: v.string(),
      nickname: v.union(v.string(), v.null()),
      heldBy: v.union(v.string(), v.null()),
      missing: v.boolean(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ number: string; nickname: string | null; heldBy: string | null; missing: boolean }>
  > => {
    const context = (await ctx.runQuery(internal.platform.provisionableContext, {
      orgId: args.orgId,
    })) as {
      apiKey: string | null;
      allowed: string[];
      heldBy: Array<{ number: string; org: string }>;
      agentOrgs: Array<{ retellAgentId: string; orgId: string; org: string }>;
    };
    if (!context.apiKey) return [];
    const res = await fetch("https://api.retellai.com/v2/list-phone-numbers", {
      headers: { authorization: `Bearer ${context.apiKey}` },
    });
    if (!res.ok) throw new Error(`list-numbers-http-${res.status}`);
    const data: unknown = await res.json();
    const items = (
      Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? []
    ) as Array<{
      phone_number?: string;
      nickname?: string;
      inbound_agent_id?: string;
      outbound_agent_id?: string;
      inbound_agents?: Array<{ agent_id?: string }>;
      outbound_agents?: Array<{ agent_id?: string }>;
    }>;
    const heldBy = new Map(context.heldBy.map((h) => [h.number, h.org]));
    const agentOrg = new Map(context.agentOrgs.map((a) => [a.retellAgentId, a]));
    // Holders we can only identify as a provider agent id. Resolved to the
    // agent's display NAME in one list-agents call after the scan — the
    // operator recognises "Lingua Akademi Asistanı", not agent_8bdd…
    // (Serdar, 2026-08-20) — and only when at least one row needs it.
    const unnamedHolders = new Map<string, string>();
    const rows = items
      .filter((n) => n.phone_number)
      .map((n) => {
        // The provider's own bindings are the third holder source, after
        // allowlists and our bindings table: a number routed to another
        // business's agent — or to an agent Resepta doesn't know at all,
        // which the shared account carries — must not tick as free. This is
        // exactly how "austrian number" looked free while its outbound
        // belonged to a Lingua Akademi agent (18 Aug 2026).
        let held = heldBy.get(n.phone_number!) ?? null;
        if (!held) {
          const boundAgents = [
            n.inbound_agent_id,
            n.outbound_agent_id,
            ...(n.inbound_agents ?? []).map((a) => a.agent_id),
            ...(n.outbound_agents ?? []).map((a) => a.agent_id),
          ].filter((id): id is string => Boolean(id));
          for (const id of boundAgents) {
            const owner = agentOrg.get(id);
            if (owner && owner.orgId === String(args.orgId)) continue;
            // A binding we can resolve names the business. One we cannot is
            // an agent NO business has connected — usually a dashboard-made
            // agent awaiting connection — held as its display name below.
            if (owner) {
              held = owner.org;
            } else {
              held = id;
              unnamedHolders.set(n.phone_number!, id);
            }
            break;
          }
        }
        return {
          number: n.phone_number!,
          nickname: n.nickname?.trim() || null,
          heldBy: held,
          missing: false,
        };
      });
    if (unnamedHolders.size > 0) {
      const names = new Map<string, string>();
      try {
        const agentsRes = await fetch("https://api.retellai.com/v2/list-agents", {
          headers: { authorization: `Bearer ${context.apiKey}` },
        });
        if (agentsRes.ok) {
          const agentsData = (await agentsRes.json()) as Array<{
            agent_id?: string;
            agent_name?: string;
          }>;
          for (const agent of agentsData ?? []) {
            if (agent.agent_id && agent.agent_name?.trim()) {
              names.set(agent.agent_id, agent.agent_name.trim());
            }
          }
        }
      } catch {
        // Name lookup is cosmetic; the generic label below still holds.
      }
      for (const row of rows) {
        const id = unnamedHolders.get(row.number);
        if (!id) continue;
        const name = names.get(id);
        // "agent" stays in the label so a nameless or org-named agent cannot
        // be mistaken for a connected business.
        row.heldBy = name ? `agent “${name}”` : "an unconnected agent";
      }
    }
    const listed = new Set(rows.map((r) => r.number));
    for (const number of context.allowed) {
      if (listed.has(number)) continue;
      rows.push({ number, nickname: null, heldBy: null, missing: true });
    }
    return rows;
  },
});

export const setAllowedPhoneNumbers = mutation({
  args: { orgId: v.id("orgs"), numbers: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    // E.164 or it does not exist, same rule as every other number in the
    // product — and here it is load-bearing twice over, because a list entry
    // that does not match the provider's own formatting silently allows
    // nothing.
    const numbers = [
      ...new Set(
        args.numbers
          .map((raw) => raw.replace(/[\s().\-/]/g, ""))
          .filter((raw) => raw.length > 0),
      ),
    ];
    const bad = numbers.find((n) => !/^\+[1-9]\d{6,14}$/.test(n));
    if (bad) throw new Error(`not-e164: ${bad}`);
    await ctx.db.patch(args.orgId, {
      allowedPhoneNumbers: numbers.length > 0 ? numbers : undefined,
    });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail:
        numbers.length > 0
          ? `phone lines set to ${numbers.join(", ")}`
          : "phone line restriction removed",
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

// ── Number provisioning ─────────────────────────────────────────────────────
//
// The operator's half of numberRequests.ts: read one org's request with a
// download URL for the registration document, and decide it. The decision is
// the operator's own cue to go provision the number at the provider — the
// app never buys numbers (retellAgent doctrine); assigning the line stays
// the existing Phone lines flow on the same admin tab.

export const orgNumberRequests = query({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      requestId: v.id("numberRequests"),
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("denied"),
      ),
      fileName: v.string(),
      contentType: v.string(),
      size: v.number(),
      note: v.union(v.string(), v.null()),
      createdAt: v.number(),
      decidedAt: v.union(v.number(), v.null()),
      // Convex storage URLs are long-lived and unguessable; handing one to
      // the operator console is how the document gets read.
      url: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db
      .query("numberRequests")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(10);
    return await Promise.all(
      rows.map(async (row) => ({
        requestId: row._id,
        status: row.status,
        fileName: row.fileName,
        contentType: row.contentType,
        size: row.size,
        note: row.note ?? null,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt ?? null,
        url: await ctx.storage.getUrl(row.storageId),
      })),
    );
  },
});

export const decideNumberRequest = mutation({
  args: {
    requestId: v.id("numberRequests"),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    // Salon-visible. A denial without a reason is a dead end, so the console
    // should insist on one there; an approval note is optional colour.
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const userId = await getAuthUserId(ctx);
    const row = await ctx.db.get(args.requestId);
    if (!row) throw new Error("not-found");
    await ctx.db.patch(args.requestId, {
      status: args.decision,
      note: args.note?.trim() || undefined,
      decidedAt: Date.now(),
      decidedBy: userId ?? undefined,
    });
    await recordActivity(ctx, {
      orgId: row.orgId,
      kind: "settings_changed",
      detail:
        args.decision === "approved"
          ? "number provisioning approved"
          : "number provisioning denied",
    });
    return null;
  },
});
