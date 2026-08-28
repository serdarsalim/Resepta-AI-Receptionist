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
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { connectionField } from "./lib/connections";
import {
  isPlatformAdmin,
  platformAdminEmails,
  requirePlatformAdmin,
} from "./lib/platformAuth";
import { enrichActivity } from "./activity";
import { applyWalletCredit } from "./wallet";
import { maskSecret } from "./lib/connections";
import { foundOrg } from "./lib/foundOrg";
import { resolvePreset } from "./lib/industryPresetStore";
import { seedPreset } from "./onboarding";
import { resolvePublicSlug } from "./lib/publicSlug";
import { fileRegistrationDocument } from "./lib/numberDocument";
import { assignInboundAddress } from "./lib/inboundAddress";
import { resolveChatLlm } from "./lib/chatLlm";
import { resolveInboundAddress } from "./lib/inboundAddress";
import { customerSender, emailLaneConfigured } from "./lib/email";
import { emailConfig, platformValue, type EmailConfig } from "./lib/platformConfig";
import { OPERATOR_ACTOR_NAME, recordActivity } from "./lib/activity";
import {
  addMemberByEmail,
  revokeInviteRow,
  revokeMembership,
  setMemberRole,
} from "./lib/members";
import { DEFAULT_MONTHLY_BUDGET_MICRO_USD, isPricedModel } from "./lib/llm";
import {
  isVoiceModel,
  resolvePlatformHighPriority,
  resolvePlatformVoiceModel,
} from "./lib/voiceModels";
import {
  applyAgentEngine,
  applyAgentHighPriority,
  applyAgentModel,
} from "./retellAgent";

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
  // ALL-TIME totals, summed across every month on the ledger. Month-to-date
  // was the first cut and it answered the wrong question: on the 3rd it says
  // nothing about who adopted this, and this table is where you go to find out
  // who did. The month-by-month breakdown lives on the org's own page
  // (orgVoiceUsage), which is where a billing question belongs anyway.
  //
  // Sends are counted where a send is confirmed (messages.applySendResult),
  // never by scanning an org's message history — that is what would put this
  // page back on a cost proportional to its busiest tenant.
  emailSentTotal: v.number(),
  waSentTotal: v.number(),
  // Billed is what they owe us, cost is what Retell charged us, both
  // micro-USD, shown together so the table answers "who is burning money"
  // without opening every org.
  voiceCallsTotal: v.number(),
  voiceSecondsTotal: v.number(),
  voiceBilledMicroUsdTotal: v.number(),
  voiceCostMicroUsdTotal: v.number(),
  // The WhatsApp lane's money, same billed/cost split — what they owe us for
  // Cloud template sends against what Meta charges for them. Zero for orgs
  // whose sends predate the price book or ride the free lanes.
  waBilledMicroUsdTotal: v.number(),
  waCostMicroUsdTotal: v.number(),
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

    // A business being purged leaves the list the moment it is confirmed. Its
    // rows are disappearing underneath every health figure on this page, so
    // the honest thing is not to draw it rather than to draw a salon whose
    // numbers fall every time the screen refreshes.
    //
    // The demo workspace goes with them, for a related reason: it is the
    // showroom anyone can walk into (convex/demo.ts), not a customer. Its
    // numbers move when a stranger clicks around, and a fleet list is read as
    // "who is using this", so a row nobody is paying for sitting between two
    // salons is a row that has to be mentally subtracted every time. The
    // drafts list at the foot of this file has always skipped it.
    const orgs = (await ctx.db.query("orgs").take(200)).filter(
      (org) => org.deletingAt === undefined && org.demoMode !== true,
    );
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
    // The WHOLE ledger, not just this month. These columns are all-time totals
    // now — a month-to-date number on the 3rd says nothing about who adopted
    // this, which is the question the table exists to answer. It is one row
    // per org per month, so a dozen businesses and a year of history is ~150
    // documents, and it REPLACES the per-org point read healthFor used to do
    // for the current month.
    const usageRows = await ctx.db.query("usageMonthly").take(FLEET_CAP);
    // Not silently truncated. This is one row per org per month, so the cap is
    // years away from mattering — but a usage column that has quietly stopped
    // counting reads as a tenant who stopped using the product, which is the
    // worst way for this to fail. It goes in the logs rather than on the page
    // because there is nowhere honest to put a per-ROW marker for a read that
    // capped across the whole FLEET.
    if (usageRows.length === FLEET_CAP) {
      console.warn(
        `platform.fleet: usageMonthly hit the ${FLEET_CAP}-row cap. Every usage total on this page is LOW. Raise FLEET_CAP or start rolling old months up.`,
      );
    }
    const templateRows = await ctx.db.query("waTemplates").take(FLEET_CAP);
    const waAccountRows = await ctx.db.query("waAccounts").take(FLEET_CAP);

    const fleet: FleetReads = {
      failed: bucket(failedRows),
      queued: bucket(queuedRows),
      upcoming: bucket(upcomingRows),
      memberships: bucket(membershipRows),
      usage: bucket(usageRows),
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
  usage: Map<string, Doc<"usageMonthly">[]>;
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

  // Every month this org has, summed. Off the bucketed fleet read, so this is
  // arithmetic rather than a query — the point read it replaced was the second
  // of the two per-org reads this function had left.
  const ledger = fleet.usage.get(key) ?? [];
  const total = (pick: (row: Doc<"usageMonthly">) => number | undefined) =>
    ledger.reduce((sum, row) => sum + (pick(row) ?? 0), 0);

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
    emailSentTotal: total((row) => row.emailSent),
    waSentTotal: total((row) => row.waSent),
    voiceCallsTotal: total((row) => row.voiceCalls),
    voiceSecondsTotal: total((row) => row.voiceSeconds),
    voiceBilledMicroUsdTotal: total((row) => row.voiceBilledMicroUsd),
    voiceCostMicroUsdTotal: total((row) => row.voiceCostMicroUsd),
    waBilledMicroUsdTotal: total((row) => row.waBilledMicroUsd),
    waCostMicroUsdTotal: total((row) => row.waCostMicroUsd),
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
      // The fleet fast-tier default, tri-state: null is "unset", which the
      // per-agent picker renders as the template's own constant. Read here
      // for the same reason as the model above — so the business page and
      // /admin cannot disagree about what "platform default" means.
      platformHighPriority: v.union(v.boolean(), v.null()),
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
          llmHighPriority: v.union(v.boolean(), v.null()),
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
          // The id every write on this tab needs. Returned rather than acted
          // on by email: an address is what a person typed once, an id is who
          // they are, and the role picker must not depend on the two agreeing.
          userId: v.id("users"),
          name: v.union(v.string(), v.null()),
          email: v.union(v.string(), v.null()),
          role: v.string(),
          // Unset means somebody else added them and they have not signed in
          // to see it yet — the difference between a real user and a seat.
          seenAt: v.union(v.number(), v.null()),
          // A walk-in to the showroom (auth.ts mints one per anonymous
          // arrival). Marked rather than filtered out here: they ARE members
          // and the count should say so, but the card collapses them into one
          // line instead of printing an identical row per visitor.
          walkIn: v.boolean(),
        }),
      ),
      // Addresses with an open invite and no account yet. They are not members
      // and must not be drawn as one — nobody holds this seat until the mailed
      // token is used — but leaving them out entirely is how an operator adds
      // the same person twice and then wonders why nothing arrived.
      pendingInvites: v.array(
        v.object({
          _id: v.id("invites"),
          email: v.string(),
          role: v.string(),
          invitedAt: v.number(),
          expiresAt: v.union(v.number(), v.null()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    const [wa, agents, voiceEvents, voiceProvisioning, memberships, invites] =
      await Promise.all([
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
      ctx.db
        .query("invites")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect(),
    ]);
    const members = (
      await Promise.all(
        memberships.map(async (membership) => {
          const user = await ctx.db.get(membership.userId);
          return {
            userId: membership.userId,
            name: user?.name ?? null,
            email: user?.email ?? null,
            role: membership.role,
            seenAt: membership.seenAt ?? null,
            walkIn: user?.isAnonymous === true,
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
    // Open invites only. An accepted row is a member now and already appears
    // above; an expired one is dead and drawing it as "pending" would send an
    // operator waiting on a mail that can no longer be used.
    const now = Date.now();
    const pendingInvites = invites
      .filter(
        (row) =>
          row.acceptedAt === undefined &&
          row.token !== undefined &&
          (row.expiresAt ?? Infinity) > now,
      )
      .map((row) => ({
        _id: row._id,
        email: row.email,
        role: row.role,
        invitedAt: row._creationTime,
        expiresAt: row.expiresAt ?? null,
      }))
      .sort((a, b) => b.invitedAt - a.invitedAt);
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
      platformHighPriority: resolvePlatformHighPriority(
        await platformValue(ctx, "voiceHighPriority"),
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
          llmHighPriority: a.llmHighPriority ?? null,
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
      pendingInvites,
    };
  },
});

// A failed inbox row is still the durable source payload, so an operator can
// safely retry it without asking the provider to send the event again.
// ── Members, from the operator's side ────────────────────────────────────────
//
// The same four writes the salon's own Team card makes, behind a different
// gate. Clients ask for this over WhatsApp — "add my new receptionist" — and
// the answer until now was that somebody signed into their workspace and did
// it by hand, which is both slower and worse: an operator standing inside a
// tenant is exactly the state lib/activity works to keep out of a client's
// feed.
//
// Every write goes through lib/members, which owns the rules (last owner,
// staff rows keeping their appointments, seenAt left unset so the person is
// told, an account-less address getting a token rather than a seat). Nothing
// here re-implements any of them; the only thing this file adds is the
// allowlist check and an orgId argument.

const memberRole = v.union(v.literal("owner"), v.literal("staff"));

// How many accounts to look through when the operator is picking somebody who
// already has a login. Bounded because it is a scan — users has an exact-email
// index and nothing else, and a substring match cannot use it.
const CANDIDATE_SCAN = 500;
const CANDIDATE_RESULTS = 20;

// The existing-account pool: people with a login who are NOT already in this
// business. Adding one of them is a membership, not an invite — there is
// nothing to accept — so the picker exists to make that the easy path rather
// than having the operator retype an address they could get wrong.
export const orgMemberCandidates = query({
  args: { orgId: v.id("orgs"), query: v.string() },
  returns: v.object({
    people: v.array(
      v.object({
        userId: v.id("users"),
        name: v.union(v.string(), v.null()),
        email: v.string(),
        // Which businesses they are already in, by name. An operator reading a
        // bare address cannot tell a client's staff from a stranger, and this
        // is the fact that answers it.
        alreadyIn: v.array(v.string()),
      }),
    ),
    // Said out loud rather than silently truncated, same rule the fleet
    // counters follow: a capped list reads as "this is everyone".
    capped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const here = new Set(
      (
        await ctx.db
          .query("memberships")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .collect()
      ).map((row) => row.userId as string),
    );
    const rows = await ctx.db.query("users").take(CANDIDATE_SCAN);
    const needle = args.query.trim().toLowerCase();
    const matches = rows.filter((user) => {
      // No address is an anonymous demo walk-in, never a colleague — and there
      // would be nothing to mail them anyway.
      if (!user.email) return false;
      if (here.has(user._id as string)) return false;
      if (!needle) return true;
      return (
        user.email.toLowerCase().includes(needle) ||
        (user.name ?? "").toLowerCase().includes(needle)
      );
    });
    const people = await Promise.all(
      matches.slice(0, CANDIDATE_RESULTS).map(async (user) => {
        const memberships = await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();
        const names: string[] = [];
        for (const row of memberships) {
          const org = await ctx.db.get(row.orgId);
          if (org?.name) names.push(org.name);
        }
        return {
          userId: user._id,
          name: user.name ?? null,
          email: user.email!,
          alreadyIn: names.sort((a, b) => a.localeCompare(b)),
        };
      }),
    );
    return {
      people: people.sort((a, b) =>
        (a.name ?? a.email).localeCompare(b.name ?? b.email),
      ),
      // Either way the list is incomplete: more matched than fit, or the scan
      // itself stopped short of the whole table. An AND here would call a
      // truncated list complete whenever the deployment happens to be small.
      capped: rows.length === CANDIDATE_SCAN || matches.length > CANDIDATE_RESULTS,
    };
  },
});

// One control, two outcomes — the same shape team.invite has always had. An
// address with an account joins immediately; one without gets a mailed token
// and shows up as pending until it is used. The caller is told which happened,
// because "invited" means somebody has to go and read their mail and "joined"
// means they can sign in right now.
export const addOrgMember = mutation({
  args: { orgId: v.id("orgs"), email: v.string(), role: memberRole },
  returns: v.union(v.literal("joined"), v.literal("invited")),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const operator = await getAuthUserId(ctx);
    if (!operator) throw new Error("not-signed-in");
    return await addMemberByEmail(ctx, {
      orgId: args.orgId,
      email: args.email,
      role: args.role,
      invitedBy: operator,
      // A BRAND, never the operator's own name. This string reaches a client's
      // inbox as "X added you to Y" — the client bought a service and did not
      // ask who was at the keyboard. Same rule lib/activity applies to the
      // feed.
      invitedByName: OPERATOR_ACTOR_NAME,
    });
  },
});

export const setOrgMemberRole = mutation({
  args: { orgId: v.id("orgs"), userId: v.id("users"), role: memberRole },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    await setMemberRole(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      role: args.role,
    });
    return null;
  },
});

// Revokes ACCESS, not existence: the staff row and every appointment on it
// stay. Refuses to strip the last admin here exactly as it does inside the
// app — an operator can undo that one, but the client cannot, and a workspace
// nobody can administer is not a state to leave a paying business in.
export const removeOrgMember = mutation({
  args: { orgId: v.id("orgs"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    await revokeMembership(ctx, { orgId: args.orgId, userId: args.userId });
    return null;
  },
});

export const revokeOrgInvite = mutation({
  args: { orgId: v.id("orgs"), inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    await revokeInviteRow(ctx, { orgId: args.orgId, inviteId: args.inviteId });
    return null;
  },
});

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
    // A string stores the org's own token; NULL removes it so the row rides
    // the platform token; absent (and blank, below) leaves it alone. Three
    // intents, and the middle one cannot be spelled with an optional string —
    // blank already means "keep" for a secret the operator cannot read back.
    accessToken: v.optional(v.union(v.string(), v.null())),
    displayNumber: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const phoneNumberId = args.phoneNumberId.trim();
    if (!phoneNumberId) throw new Error("phone-number-id-required");
    // Clearing hands authentication to the platform token, so refuse while
    // there is none: the row would resolve to no token at all and every send
    // on this number would degrade to "Cloud is off" — silently, hours after
    // the operator stopped looking at this page.
    if (args.accessToken === null) {
      const platformToken = await platformValue(ctx, "whatsappAccessToken");
      if (!platformToken) throw new Error("no-platform-token");
    }
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
      const wabaId = args.wabaId?.trim() || undefined;
      await ctx.db.insert("waAccounts", {
        orgId: args.orgId,
        phoneNumberId,
        wabaId,
        accessToken:
          typeof args.accessToken === "string"
            ? args.accessToken.trim() || undefined
            : undefined,
        displayNumber: args.displayNumber?.trim() || undefined,
      });
      // Wiring a WABA IS registering the standard template set (see the
      // machinery note in waTemplates): the same six messages serve every
      // client, so no human clicks per client — the statuses land on this
      // page's own Templates section.
      if (wabaId) {
        await ctx.scheduler.runAfter(0, internal.waTemplates.registerStandardSetForOrg, {
          orgId: args.orgId,
        });
      }
      return null;
    }
    const nextWabaId = applied(args.wabaId, existing.wabaId);
    await ctx.db.patch(existing._id, {
      phoneNumberId,
      wabaId: nextWabaId,
      // Blank means "keep the token", not "clear it": the operator editing a
      // display number should not have to re-paste a credential they cannot
      // read back off the screen. Only the explicit null — the "use platform
      // token" control — takes the token off the row.
      accessToken:
        args.accessToken === null
          ? undefined
          : args.accessToken?.trim() || existing.accessToken,
      displayNumber: applied(args.displayNumber, existing.displayNumber),
    });
    // Only a WABA that just ARRIVED or CHANGED triggers registration — an
    // operator fixing a display number must not resubmit six templates into
    // Meta review as a side effect.
    if (nextWabaId && nextWabaId !== existing.wabaId) {
      await ctx.scheduler.runAfter(0, internal.waTemplates.registerStandardSetForOrg, {
        orgId: args.orgId,
      });
    }
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
      // What the OWNER has the agent set to, inside the mode above. Read-only
      // here: the operator owns whether they have an agent, the owner owns
      // what it does, and a panel showing only the operator's half would read
      // "live" over a business that has it drafting.
      behavior: v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
      stopOnHandover: v.boolean(),
      budgetMicroUsd: v.union(v.number(), v.null()),
      defaultBudgetMicroUsd: v.number(),
      killSwitch: v.boolean(),
      llmKeyConfigured: v.boolean(),
      llmProvider: v.union(v.literal("anthropic"), v.literal("openai")),
      llmModel: v.string(),
      // False when the resolved model has no row in the price table, which is
      // the state where every turn meters at zero and the monthly budget stops
      // capping anything. The panel has to say it — a confident $0.00 reads as
      // "cheap", not "unmeasured".
      llmModelPriced: v.boolean(),
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
      // How many drafts this org has DECIDED, and how many of those it sent.
      // The trust ramp's only real number: an org sending most of what its
      // assistant writes is ready to answer live, and one discarding most of
      // them is telling you what its brief is missing. Over decided drafts
      // only — a draft still sitting in a thread is not a verdict. Null until
      // there is one to report, because "0%" and "nobody has looked yet" are
      // different facts.
      //
      // Nothing trains on this. It is a reading, not a feedback loop.
      acceptance: v.union(
        v.null(),
        v.object({ decided: v.number(), sent: v.number() }),
      ),
      turns: v.array(
        v.object({
          at: v.number(),
          customerName: v.string(),
          status: v.string(),
          suggestionOutcome: v.optional(v.string()),
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
    // Over the same 25 the log shows, deliberately: a rate computed over the
    // org's whole history would be answering a question about last spring
    // while the panel underneath shows this week. What the operator wants to
    // know is whether the drafts are landing NOW.
    const decidedDrafts = turns.filter(
      (t) => t.status === "suggested" && t.suggestionOutcome !== undefined,
    );
    const acceptance = decidedDrafts.length
      ? {
          decided: decidedDrafts.length,
          sent: decidedDrafts.filter((t) => t.suggestionOutcome === "sent").length,
        }
      : null;
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
      behavior: org.chatAgentBehavior ?? "live",
      stopOnHandover: org.chatAgentStopOnHandover ?? false,
      budgetMicroUsd: org.chatAgentMonthlyBudgetMicroUsd ?? null,
      defaultBudgetMicroUsd: DEFAULT_MONTHLY_BUDGET_MICRO_USD,
      killSwitch: (await platformValue(ctx, "chatAgentDisabled")) === "true",
      llmKeyConfigured: Boolean(llm.apiKey),
      llmProvider: llm.provider,
      llmModel: llm.model,
      llmModelPriced: isPricedModel(llm.model),
      month,
      usage: usage
        ? {
            llmTurns: usage.llmTurns,
            llmInputTokens: usage.llmInputTokens,
            llmOutputTokens: usage.llmOutputTokens,
            llmCostMicroUsd: usage.llmCostMicroUsd,
          }
        : null,
      acceptance,
      turns: turns.map((t) => ({
        at: t.at,
        customerName: names.get(t.customerId) ?? "—",
        status: t.status,
        suggestionOutcome: t.suggestionOutcome,
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
    // Bringing an org live for the FIRST time sets its behaviour to drafts.
    // Unset behaviour reads as "live" — it has to, so the orgs that predate
    // the field keep answering — which would mean every newly-enabled org
    // started auto-replying to customers before its owner had made a single
    // choice. Stamping here puts the trust ramp where it belongs, at the
    // start, and only ever writes over an absence: an owner who has since
    // chosen keeps their choice through any number of mode flips.
    const behavior =
      args.mode === "live" && org.chatAgentBehavior === undefined
        ? { chatAgentBehavior: "suggest" as const }
        : {};
    await ctx.db.patch(args.orgId, { chatAgentMode: args.mode, ...behavior });
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
      // The other two per-tenant prices, override beside default like the
      // voice rate above: the chat lane's per-reply rate and the WhatsApp
      // markup percent on top of Meta's card.
      chatRateMicroUsdPerTurn: v.union(v.number(), v.null()),
      defaultChatRateMicroUsdPerTurn: v.union(v.number(), v.null()),
      waMarkupPercent: v.union(v.number(), v.null()),
      defaultWaMarkupPercent: v.union(v.number(), v.null()),
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
      chatRateMicroUsdPerTurn: org.chatRateMicroUsdPerTurn ?? null,
      defaultChatRateMicroUsdPerTurn:
        Number(await platformValue(ctx, "chatRateMicroUsdPerTurn")) || null,
      waMarkupPercent: org.waMarkupPercent ?? null,
      defaultWaMarkupPercent:
        Number(await platformValue(ctx, "waMarkupPercent")) || null,
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

// The chat lane's setVoiceRate: what THIS org pays per sent AI reply.
// null clears the override back to the platform default.
export const setChatRate = mutation({
  args: {
    orgId: v.id("orgs"),
    rateMicroUsdPerTurn: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(args.orgId, {
      chatRateMicroUsdPerTurn:
        args.rateMicroUsdPerTurn === null
          ? undefined
          : Math.max(0, Math.round(args.rateMicroUsdPerTurn)),
    });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail:
        args.rateMicroUsdPerTurn === null
          ? "chat rate cleared"
          : `chat rate → $${(args.rateMicroUsdPerTurn / 1_000_000).toFixed(3)}/reply`,
    });
    return null;
  },
});

// What THIS org pays on top of Meta's per-message rate, percent. null clears
// to the platform default; an explicit 0 means pass-through for this org.
export const setWaMarkup = mutation({
  args: {
    orgId: v.id("orgs"),
    markupPercent: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    await ctx.db.patch(args.orgId, {
      waMarkupPercent:
        args.markupPercent === null
          ? undefined
          : Math.max(0, args.markupPercent),
    });
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail:
        args.markupPercent === null
          ? "WhatsApp markup cleared"
          : `WhatsApp markup → ${args.markupPercent}%`,
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

// The operator's per-agent fast-tier override, from /admin. An action for the
// same reason setAgentModel is one: the tier lives in the provider's response
// engine, so applyAgentHighPriority clones a draft, patches the engine,
// publishes, and only then stamps the row. Null clears the override back to
// the fleet default.
//
// Unlike the model there is no catalogue to re-check against — a boolean is
// its own validator. What the console owes the operator instead is the price
// (lib/voiceModels fastTierPriceFor), because this is the one agent setting
// that changes the bill without changing anything the caller hears.
export const setAgentHighPriority = action({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    highPriority: v.union(v.boolean(), v.null()),
  },
  returns: v.object({ ok: v.boolean(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; version: number | null }> => {
    await ctx.runQuery(internal.platform.assertOperator, {});
    return await applyAgentHighPriority(ctx, {
      agentId: args.retellAgentId,
      orgId: args.orgId,
      highPriority: args.highPriority,
    });
  },
});

// The console's per-agent engine picker: model and tier as one decision, one
// publish, one version at the provider. setAgentModel and setAgentHighPriority
// above are still the single-knob doors — the CLI and any operator script that
// wants to move a fleet's tier without touching which model it runs — but the
// UI sends this, because a picker that wrote two settings through two actions
// would leave an agent on the new model at the old tier whenever the second
// call failed.
//
// Both null clears both overrides back to the fleet default. The model id is
// re-checked here for the same reason setAgentModel checks it: the catalogue
// is data, and a validator cannot read it.
export const setAgentEngine = action({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    model: v.union(v.string(), v.null()),
    highPriority: v.union(v.boolean(), v.null()),
  },
  returns: v.object({ ok: v.boolean(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; version: number | null }> => {
    await ctx.runQuery(internal.platform.assertOperator, {});
    if (args.model !== null && !isVoiceModel(args.model)) {
      throw new Error(`Unknown model: ${args.model}`);
    }
    return await applyAgentEngine(ctx, {
      agentId: args.retellAgentId,
      orgId: args.orgId,
      model: args.model,
      highPriority: args.highPriority,
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
    // What this edit actually TAKES AWAY, before the patch overwrites it.
    //
    // Only meaningful while the list stays non-empty: an empty list means
    // "not restricted" (see the field's comment), so clearing it widens the
    // tenant's access rather than revoking a line, and detaching everything
    // there would be the opposite of what the operator asked for.
    const previous = org.allowedPhoneNumbers ?? [];
    const dropped =
      numbers.length > 0 ? previous.filter((n) => !numbers.includes(n)) : [];
    await ctx.db.patch(args.orgId, {
      allowedPhoneNumbers: numbers.length > 0 ? numbers : undefined,
    });
    // Revoking at the provider too, or the tenant keeps taking calls on a line
    // this console says they no longer have (retellAgent.releaseOrgLines).
    // Scheduled because releasing is an HTTP round trip per agent and this is
    // a mutation; the allowlist itself is already correct either way.
    if (dropped.length > 0) {
      await ctx.scheduler.runAfter(0, internal.retellAgent.releaseOrgLines, {
        orgId: args.orgId,
        numbers: dropped,
      });
    }
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail:
        numbers.length > 0
          ? `phone lines set to ${numbers.join(", ")}${
              dropped.length > 0 ? ` (released ${dropped.join(", ")})` : ""
            }`
          : "phone line restriction removed",
    });
    return null;
  },
});

// Take a line off whoever holds it and give it to this business, in one act.
//
// One number, one business is the invariant the checklist enforces by refusing
// to tick a line another org holds. That refusal was correct and the remedy
// was not: the operator had to open the OTHER business, untick the number
// there, come back, and tick it here — a four-step trip through a page they
// did not want to visit, with the line half-assigned in between. The invariant
// never needed the operator to be the transaction.
//
// This is exactly what the two manual edits did, done together. The release at
// the provider is the same scheduled releaseOrgLines that setAllowedPhoneNumbers
// already runs when a number leaves a list — without it the loser's agent keeps
// answering on a line this console has given away, which is the failure mode
// that makes a half-done handover worse than none.
//
// Both businesses get an activity row. The one LOSING the line is the reason:
// a number vanishing from a tenant with no record of who took it is the kind of
// thing that gets discovered during a support call about missed calls.
export const claimPhoneNumber = mutation({
  args: { orgId: v.id("orgs"), number: v.string() },
  returns: v.object({ takenFrom: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const number = args.number.replace(/[\s().\-/]/g, "");
    if (!/^\+[1-9]\d{6,14}$/.test(number)) throw new Error(`not-e164: ${number}`);

    // Whoever lists it, minus us. Allowlists are the same source the checklist
    // reads for "held by", so the two can never disagree about who has it.
    const orgs = await ctx.db.query("orgs").collect();
    const holders = orgs.filter(
      (other) =>
        other._id !== args.orgId &&
        (other.allowedPhoneNumbers ?? []).includes(number),
    );

    for (const holder of holders) {
      const kept = (holder.allowedPhoneNumbers ?? []).filter((n) => n !== number);
      // undefined when the list empties, exactly as setAllowedPhoneNumbers
      // writes it. [] and undefined are the SAME to every reader of this
      // field — retell.orgNumberPolicy and retell.lineUsable both do
      // `allowedPhoneNumbers ?? []` and then test .length — so the two forms
      // must not both exist in the table pretending to differ.
      //
      // Empty does NOT hand the loser the whole shared account, which is the
      // thing worth checking before taking a business's last line: lineUsable
      // refuses every number to an empty-list org unless it is on its OWN
      // Retell account ("account" source), where the numbers are its own
      // property anyway.
      await ctx.db.patch(holder._id, {
        allowedPhoneNumbers: kept.length > 0 ? kept : undefined,
      });
      await ctx.scheduler.runAfter(0, internal.retellAgent.releaseOrgLines, {
        orgId: holder._id,
        numbers: [number],
      });
      await recordActivity(ctx, {
        orgId: holder._id,
        kind: "settings_changed",
        detail: `phone line ${number} reassigned to ${org.name}`,
      });
    }

    const mine = org.allowedPhoneNumbers ?? [];
    if (!mine.includes(number)) {
      await ctx.db.patch(args.orgId, {
        allowedPhoneNumbers: [...mine, number],
      });
    }
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail:
        holders.length > 0
          ? `phone line ${number} claimed from ${holders.map((h) => h.name).join(", ")}`
          : `phone line ${number} added`,
    });
    return { takenFrom: holders.length > 0 ? holders.map((h) => h.name).join(", ") : null };
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

// ── Deleting a business ─────────────────────────────────────────────────────
//
// Suspension above is the reversible answer and the one to reach for; this is
// the other one. It exists because the fleet accumulates the businesses that
// never were — a test account, a duplicate somebody founded twice, a trial
// that ended — and a list you cannot take rows out of stops being a list you
// read.
//
// Three properties it has to have, and they shape everything below:
//
//   NOTHING IS LEFT AT THE PROVIDER. A Retell agent outliving its business is
//   an unattributable row in a paid account, still answering a number that
//   webhooks into a workspace that no longer exists. The provider teardown
//   runs FIRST, in front of the operator, and a failure stops the delete
//   rather than being swallowed (retellAgent.teardownForOrg).
//
//   IT WORKS ON A BUSY ORG. A salon with a year of messages has more rows
//   than one Convex transaction may touch, so the purge is a scheduled job
//   that takes a bounded bite and reschedules itself until there is nothing
//   left. The org row goes last, because every leftover is found through it.
//
//   IT CANNOT HAPPEN BY MISCLICK. The operator types the business name, and
//   the demo org refuses outright.
const PURGE_BUDGET = 400;

// Every table that carries an orgId, each read through the index that starts
// with one. Hand-maintained, like the search index on the Business page — add
// a line when you add a table, and the cost of forgetting is rows that outlive
// their business.
//
// Written as one arrow per table rather than a loop over table names, because
// the literal is what gives each row its REAL type: `storageId` narrows, and
// the day a table gains a blob the compiler is the thing that notices. A
// generic version needs a cast, and a cast here is a silent leak of files
// nobody can see any more.
type OrgRowReader = (
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  limit: number,
) => Promise<Doc<TableNames>[]>;

const ORG_TABLES: { table: string; read: OrgRowReader }[] = [
  { table: "messages", read: (ctx, orgId, n) => ctx.db.query("messages").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "calls", read: (ctx, orgId, n) => ctx.db.query("calls").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "voiceEvents", read: (ctx, orgId, n) => ctx.db.query("voiceEvents").withIndex("by_org_event_key", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "chatAgentTurns", read: (ctx, orgId, n) => ctx.db.query("chatAgentTurns").withIndex("by_org_at", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "activityLog", read: (ctx, orgId, n) => ctx.db.query("activityLog").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "agentActions", read: (ctx, orgId, n) => ctx.db.query("agentActions").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "appointments", read: (ctx, orgId, n) => ctx.db.query("appointments").withIndex("by_org_start", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "customers", read: (ctx, orgId, n) => ctx.db.query("customers").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "notes", read: (ctx, orgId, n) => ctx.db.query("notes").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "inboxReads", read: (ctx, orgId, n) => ctx.db.query("inboxReads").withIndex("by_org_user_customer", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "inboxPins", read: (ctx, orgId, n) => ctx.db.query("inboxPins").withIndex("by_org_user", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "inboxVisits", read: (ctx, orgId, n) => ctx.db.query("inboxVisits").withIndex("by_org_user", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "campaigns", read: (ctx, orgId, n) => ctx.db.query("campaigns").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "mediaAssets", read: (ctx, orgId, n) => ctx.db.query("mediaAssets").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "numberRequests", read: (ctx, orgId, n) => ctx.db.query("numberRequests").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "knowledge", read: (ctx, orgId, n) => ctx.db.query("knowledge").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "services", read: (ctx, orgId, n) => ctx.db.query("services").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "contactFields", read: (ctx, orgId, n) => ctx.db.query("contactFields").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "staff", read: (ctx, orgId, n) => ctx.db.query("staff").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "messageRules", read: (ctx, orgId, n) => ctx.db.query("messageRules").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "waTemplates", read: (ctx, orgId, n) => ctx.db.query("waTemplates").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "waAccounts", read: (ctx, orgId, n) => ctx.db.query("waAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "retellAgents", read: (ctx, orgId, n) => ctx.db.query("retellAgents").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "agentLines", read: (ctx, orgId, n) => ctx.db.query("agentLines").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "voiceAgentVariables", read: (ctx, orgId, n) => ctx.db.query("voiceAgentVariables").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "voiceAgentProvisioning", read: (ctx, orgId, n) => ctx.db.query("voiceAgentProvisioning").withIndex("by_org_updated", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "mcpConnections", read: (ctx, orgId, n) => ctx.db.query("mcpConnections").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "connections", read: (ctx, orgId, n) => ctx.db.query("connections").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "walletTopups", read: (ctx, orgId, n) => ctx.db.query("walletTopups").withIndex("by_org_at", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "usageMonthly", read: (ctx, orgId, n) => ctx.db.query("usageMonthly").withIndex("by_org_month", (q) => q.eq("orgId", orgId)).take(n) },
  { table: "invites", read: (ctx, orgId, n) => ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
  // LAST of the org-scoped tables. While a membership survives, the people who
  // worked here still resolve into this org (lib/orgAuth), so the app keeps
  // rendering a business whose data is being carried out of the room.
  { table: "memberships", read: (ctx, orgId, n) => ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(n) },
];

// What the operator is about to destroy, and the refusals, in one read. A
// query rather than the first half of the mutation: the provider teardown runs
// between this and the write, and it is allowed to stop the whole thing.
export const orgDeletePreview = internalQuery({
  args: { orgId: v.id("orgs"), confirmName: v.string() },
  returns: v.object({ name: v.string() }),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    // The demo is a public surface, not a customer. Deleting it takes the
    // "look around" door off the sign-in screen and there is no way back
    // except reseeding it by hand.
    if (org.demoMode) throw new Error("demo-org");
    // An unnamed draft confirms with an empty string, which is exactly what
    // its row shows the operator.
    if (args.confirmName.trim() !== org.name.trim()) throw new Error("name-mismatch");
    return { name: org.name };
  },
});

// Marks the row and starts the job. Separate from the action so the write is
// one transaction and the browser cannot leave a business half-deleted by
// navigating away.
export const beginOrgPurge = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org || org.demoMode) throw new Error("no-such-org");
    // Suspended as well as marked: suspension is the switch every send path
    // already respects, so nothing new has to learn what deletingAt means to
    // stop spending money on a business that is going away.
    await ctx.db.patch(args.orgId, { status: "suspended", deletingAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.platform.purgeOrgStep, {
      orgId: args.orgId,
    });
    return null;
  },
});

// One bite. Reschedules itself while anything is left, and deletes the org row
// on the pass that finds nothing.
export const purgeOrgStep = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    // Refuses to run on a row that was never marked. The only way in is
    // beginOrgPurge, and this is what stops a stray scheduled call — or a
    // future caller that skipped the confirmation — from eating a live salon.
    if (org.deletingAt === undefined) return null;

    let budget = PURGE_BUDGET;
    for (const entry of ORG_TABLES) {
      if (budget <= 0) break;
      const rows = await entry.read(ctx, args.orgId, budget);
      for (const row of rows) {
        // The blob columns, narrowed by the union rather than looked up by
        // name: a file left in storage is invisible from every screen and
        // still counts against the deployment.
        if ("storageId" in row) {
          await ctx.storage.delete(row.storageId).catch(() => {});
        }
        if ("mediaStorageId" in row && row.mediaStorageId) {
          await ctx.storage.delete(row.mediaStorageId).catch(() => {});
        }
        await ctx.db.delete(row._id);
      }
      budget -= rows.length;
    }

    if (budget < PURGE_BUDGET) {
      // Something was deleted, so there may be more. Straight back in — the
      // job is the only writer left on these tables.
      await ctx.scheduler.runAfter(0, internal.platform.purgeOrgStep, {
        orgId: args.orgId,
      });
      return null;
    }

    // Nothing left anywhere. The logo is the org's own blob, and this row is
    // the last thing that knows about it.
    if (org.logoStorageId) await ctx.storage.delete(org.logoStorageId).catch(() => {});
    await ctx.db.delete(args.orgId);
    // Deliberately no activity row and no stamp anywhere else: every table
    // that could hold one is org-scoped, and the whole point of this pass is
    // that none of them still has a row for this business. The record the
    // operator keeps is the confirmation they typed and the summary the action
    // handed back.
    return null;
  },
});

// The operator's door. An ACTION because the provider teardown is HTTP and has
// to happen before anything is destroyed here: the id of the agent to delete
// lives in the rows the purge is about to remove.
//
// Returns what it did at Retell so the operator sees it at the moment they act
// — there is no activity feed left to read it in afterwards.
export const deleteOrg = action({
  args: {
    orgId: v.id("orgs"),
    // The business name, typed. Compared server-side, so a UI that forgets the
    // confirmation still cannot delete anything by accident.
    confirmName: v.string(),
    // Proceed even though the provider teardown reported failures. The default
    // is to refuse, because the whole reason this runs first is that an orphan
    // agent is exactly what nobody notices.
    force: v.optional(v.boolean()),
  },
  returns: v.object({
    name: v.string(),
    agentsDeleted: v.array(v.string()),
    numbersFreed: v.array(v.string()),
    failures: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const { name } = (await ctx.runQuery(internal.platform.orgDeletePreview, {
      orgId: args.orgId,
      confirmName: args.confirmName,
    })) as { name: string };
    const teardown = (await ctx.runAction(internal.retellAgent.teardownForOrg, {
      orgId: args.orgId,
    })) as { deleted: string[]; freedNumbers: string[]; failures: string[] };
    if (teardown.failures.length > 0 && args.force !== true) {
      throw new Error(`retell-teardown-failed: ${teardown.failures.join("; ")}`);
    }
    await ctx.runMutation(internal.platform.beginOrgPurge, { orgId: args.orgId });
    return {
      name,
      agentsDeleted: teardown.deleted,
      numbersFreed: teardown.freedNumbers,
      failures: teardown.failures,
    };
  },
});

// The fleet's ghost rows: orgs that were founded and never named.
//
// They are the residue of the Add-business bug (users.foundWorkspace, fixed
// 2026-08-24): every click while an operator was acting inside a tenant minted
// a real org that the app then refused to show the wizard for, so the fleet
// filled with "(unnamed) · 1 member · never". Founding now reuses and sweeps
// drafts, but that only heals the account doing the founding — the ones
// already on the deployment need a broom.
//
// INTERNAL, and run from the CLI (`npx convex run platform:purgeUnnamedDrafts
// --prod`), because it is an operator's chore rather than a screen: there is
// nothing to look at, and a button that deletes many businesses at once is a
// worse idea than a command somebody has to type.
//
// It refuses anything that is not provably empty. A draft cannot normally hold
// a customer or an agent — naming the org is what runs provisioning — so a row
// that does hold one is not the residue this is for, and it goes through the
// operator's own delete, which tears down the provider side in front of them.
export const purgeUnnamedDrafts = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    marked: v.number(),
    skipped: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const orgs = await ctx.db.query("orgs").take(500);
    const skipped: string[] = [];
    let marked = 0;
    for (const org of orgs) {
      if (marked >= (args.limit ?? 25)) break;
      if (org.name.trim() !== "" || org.demoMode) continue;
      if (org.deletingAt !== undefined) continue;
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .first();
      const message = await ctx.db
        .query("messages")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .first();
      const call = await ctx.db
        .query("calls")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .first();
      if (customer || message || call) {
        skipped.push(`${org._id}: has history`);
        continue;
      }
      // An agent means somebody has a resource at the provider, and tearing
      // that down is an HTTP call this mutation cannot make. Racing the purge
      // against a teardown action is worse than leaving one row for a human.
      const agent = await ctx.db
        .query("retellAgents")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .first();
      const job = (
        await ctx.db
          .query("voiceAgentProvisioning")
          .withIndex("by_org_updated", (q) => q.eq("orgId", org._id))
          .collect()
      ).find((row) => row.retellAgentId);
      if (agent || job) {
        skipped.push(`${org._id}: has a Retell agent — delete it from /admin`);
        continue;
      }
      await ctx.db.patch(org._id, { status: "suspended", deletingAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.platform.purgeOrgStep, {
        orgId: org._id,
      });
      marked += 1;
    }
    return { marked, skipped };
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
      // Who put this document here. The console labels the operator-filed
      // ones, because "we accepted a document the business sent us" and "we
      // accepted a document we typed in for them" are different claims to be
      // making months later.
      viaOperator: v.boolean(),
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
        viaOperator: row.viaOperator === true,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt ?? null,
        url: await ctx.storage.getUrl(row.storageId),
      })),
    );
  },
});

// The operator's own upload door. The self-serve flow assumes the business
// logs in and uploads its registration; in practice the document arrives by
// email, on WhatsApp, or across a table during a sales visit, and the request
// row that is supposed to make the 24-hour promise inspectable never exists.
// Telling the client to go log in and re-send a document they already sent is
// friction that buys nothing.
//
// Separate from numberRequests.generateUploadUrl rather than loosening it:
// that one is owner-only on purpose (a registration document is the
// business's legal identity), and an operator is not an owner of this org.
export const numberDocumentUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Files a document against an org the operator names. Shares its whole body
// with the business's own upload (lib/numberDocument), so the row is
// identical except for viaOperator, and lands PENDING: filing a document and
// accepting it are two acts, and the accept is the one the business is told
// about. The Accept button sits under the upload, so vouching for a document
// already read is one more click.
export const fileNumberRequest = mutation({
  args: {
    orgId: v.id("orgs"),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("not-found");
    await fileRegistrationDocument(ctx, {
      orgId: args.orgId,
      storageId: args.storageId,
      fileName: args.fileName,
      viaOperator: true,
    });
    // "filed", not "uploaded": the wording is the whole difference between
    // this row and the one numberRequests.submit writes. recordActivity
    // derives viaOperator from acting-as state rather than taking it, and the
    // console is not acting-as, so the verb is what carries it in the feed.
    // The durable version of the same fact is numberRequests.viaOperator.
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "settings_changed",
      detail: "number provisioning document filed",
    });
    return null;
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

// Seed a finished workspace for a login, from the CLI:
//
//   npx convex run --prod platform:seedWorkspace \
//     '{"email":"owner@example.com","name":"Mery Spor","industry":"other"}'
//
// The operator's counterpart to the wizard, for walking into a sales visit
// with the prospect's business already standing. It does exactly what
// founding plus finishing onboarding would have done — foundOrg, preset,
// slug, inbound address, voice-agent auto-provisioning — so a seeded org is
// indistinguishable from one the owner built by hand. internalMutation, so
// no client can reach it; the admin key behind `npx convex run` is the gate,
// which is also why this does not take the requirePlatformAdmin path — there
// is no session here to check.
//
// seenAt is left unset on the membership ON PURPOSE: the operator put the
// person here, so the app should announce it (see schema.memberships).
// Trial credit is the operator's call per seed — these orgs skip the
// founding sign-in that normally grants it, and a demo business whose calls
// decline at ring time (prepaid, zero wallet) defeats the visit.
export const seedWorkspace = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    industry: v.optional(v.string()),
    language: v.optional(v.string()),
    withTrialCredit: v.optional(v.boolean()),
  },
  returns: v.object({
    orgId: v.id("orgs"),
    slug: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) throw new Error(`no user signed in as ${email}`);
    const name = args.name.trim();
    if (!name) throw new Error("name is required");
    const language = args.language?.trim() || "tr";
    const preset = args.industry
      ? await resolvePreset(ctx, args.industry)
      : null;
    if (args.industry && !preset) {
      throw new Error(`unknown industry: ${args.industry}`);
    }

    const orgId = await foundOrg(ctx, {
      grantTrialCredit: args.withTrialCredit ?? false,
    });
    await ctx.db.insert("memberships", {
      userId: user._id,
      orgId,
      role: "owner",
    });
    // Naming is the commit, same as the wizard's final save: slug first so a
    // taken name throws before anything is half-done.
    const slug = await resolvePublicSlug(ctx, orgId, name);
    await ctx.db.patch(orgId, {
      name,
      language,
      ...(args.industry ? { industry: args.industry } : {}),
      ...(slug ? { publicSlug: slug } : {}),
    });
    const inbound = await assignInboundAddress(ctx, orgId, name);
    if (inbound) await ctx.db.patch(orgId, { inboundAddress: inbound });
    if (preset) await seedPreset(ctx, orgId, preset, language);
    await ctx.scheduler.runAfter(0, internal.retellAgent.autoProvision, {
      orgId,
    });
    return { orgId, slug: slug ?? null };
  },
});

// seedWorkspace's sibling for an org that already exists: stamp a vertical
// and seed its preset, from the CLI. `reset: true` mirrors the settings
// page's reset-to-preset — services are wiped, contact fields are wiped
// except ones a voice-agent variable references — for when a seeded demo org
// was born on the wrong vertical. Additive (no reset) otherwise, exactly
// like the wizard: seedPreset skips keys the org already has.
export const applySeedPreset = internalMutation({
  args: {
    orgId: v.id("orgs"),
    industry: v.string(),
    reset: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, industry, reset }) => {
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no such org");
    const preset = await resolvePreset(ctx, industry);
    if (!preset) throw new Error(`unknown industry: ${industry}`);
    if (reset) {
      const services = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      for (const row of services) await ctx.db.delete(row._id);
      const variables = await ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      const referenced = new Set(
        variables.flatMap((row) =>
          [row.contactFieldId, row.beforeFieldId].filter(Boolean),
        ),
      );
      const fields = await ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      for (const row of fields) {
        if (!referenced.has(row._id)) await ctx.db.delete(row._id);
      }
    }
    await ctx.db.patch(orgId, { industry });
    await seedPreset(ctx, orgId, preset, org.language);
    return null;
  },
});

// Price a seeded org's services by name, from the CLI — the last step of
// prepping a demo business, because presets deliberately carry no prices
// (lib/industryPresets: a seeded price is a claim about the business) and a
// booking page of blank prices reads as unfinished in a sales visit. Prices
// are MINOR units of the org's currency (150000 = 1.500,00). Matching is by
// case-folded exact name; anything unmatched is returned rather than
// guessed at.
export const setServicePrices = internalMutation({
  args: {
    orgId: v.id("orgs"),
    prices: v.array(v.object({ name: v.string(), price: v.number() })),
  },
  returns: v.object({ updated: v.number(), missed: v.array(v.string()) }),
  handler: async (ctx, { orgId, prices }) => {
    const rows = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let updated = 0;
    const missed: string[] = [];
    for (const entry of prices) {
      const row = rows.find(
        (r) => r.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
      );
      if (!row) {
        missed.push(entry.name);
        continue;
      }
      await ctx.db.patch(row._id, { price: Math.max(0, Math.round(entry.price)) });
      updated += 1;
    }
    return { updated, missed };
  },
});
