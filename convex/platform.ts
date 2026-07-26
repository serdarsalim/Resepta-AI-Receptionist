// The operator's view of the whole deployment.
//
// Randevu is ONE Convex deployment serving every salon, which is why this can
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
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isPlatformAdmin, requirePlatformAdmin } from "./lib/platformAuth";

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
    failed24h: recentFailed.length,
    deadLettered24h: recentFailed.filter((row) => row.deadLetteredAt !== undefined).length,
    capped: failedRows.length === SCAN_CAP,
    retrying: queuedRows.filter((row) => row.nextAttemptAt !== undefined).length,
    stuck,
    lastActivityAt: lastMessage?._creationTime,
    upcomingAppointments: upcoming.length,
  };
}

// The recent failures for one org, so the operator can tell a token problem
// from a template problem without opening the database. Bounded and read-only:
// there is deliberately no mutation in this file, because the fix for every
// one of these lives in the salon's own Settings.
export const orgFailures = query({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      at: v.number(),
      kind: v.string(),
      error: v.optional(v.string()),
      attempts: v.optional(v.number()),
      deadLettered: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_org_status", (q) => q.eq("orgId", args.orgId).eq("status", "failed"))
      .order("desc")
      .take(50);
    return rows.map((row) => ({
      _id: row._id,
      at: row._creationTime,
      kind: row.kind,
      error: row.error,
      attempts: row.attempts,
      deadLettered: row.deadLetteredAt !== undefined,
    }));
  },
});

// Whether to render the admin link. Every signed-in user calls this, so it
// returns false rather than throwing.
export const amPlatformAdmin = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await isPlatformAdmin(ctx),
});
