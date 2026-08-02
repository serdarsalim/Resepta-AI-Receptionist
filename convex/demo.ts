// The showroom org.
//
// A prospect should be able to see a working salon — a full calendar, real
// conversations, reminders that went out — before they have a WhatsApp Business
// account or even a business name. That is the single highest-leverage thing a
// self-serve product can show, and a signup form showing an empty week is the
// opposite of it.
//
// ── HOW THIS DIFFERS FROM NUDGE'S DEMO, AND WHY IT MATTERS ──────────────────
//
// Nudge's demo tenant is its own Convex deployment carrying NO provider
// credentials, so an empty env is the safety boundary: even a bug cannot send
// a real message, because there is nothing to send with.
//
// Randevu is one deployment serving every salon. That boundary does not exist
// here, and pretending otherwise would be the dangerous move. What holds
// instead:
//
//   1. Every query is org-scoped through requireOrg. A demo visitor holds a
//      membership for the demo org and no other, so the ordinary tenancy
//      invariant is what keeps them away from real salons' customers. This is
//      the same guarantee the product already bets everything on.
//   2. The demo org has no waAccounts row, so there are no credentials to
//      misuse even within it.
//   3. Every send path checks demoMode BEFORE it reaches a provider, and the
//      simulated path never constructs a request at all.
//
// Walk-in access is deliberately OFF unless DEMO_ORG_ID is set (see auth.ts).
// Anonymous sign-in on a deployment holding real customer records is a
// decision an operator should make on purpose, not one that arrives with a
// deploy.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { seedDefaultRules } from "./messageRules";

// Roughly how often a simulated outbound draws a reply. Not 100%: a demo where
// every customer answers reads as a toy. Not 0: the inbox is half the product.
const REPLY_CHANCE = 0.4;

// Deterministic per message id rather than Math.random, so the same row always
// behaves the same way — a demo that shows a different story on every reload
// is one nobody can walk a prospect through twice.
function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function isDemo(org: { demoMode?: boolean } | null | undefined): boolean {
  return org?.demoMode === true;
}

// Whether the sign-in screen should offer a look around. Public and
// unauthenticated by necessity — it is read by someone who has not signed in —
// and it reveals only whether a demo exists, which is the least interesting
// fact on the deployment.
export const walkInEnabled = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const raw = process.env.DEMO_ORG_ID?.trim();
    if (!raw) return false;
    // Confirmed against the row, not just the env: a misconfigured id should
    // hide the button rather than offer a door that errors on click.
    const org = await ctx.db.get(raw as Id<"orgs">).catch(() => null);
    return isDemo(org);
  },
});

// Lands an outbound demo message as delivered, without a provider ever being
// called, and sometimes draws a reply a beat later so the inbox fills the way
// it would in a real salon.
//
// Goes through the SAME terminal mutation a real send does, so every count,
// badge and thread in the app is reading genuine rows — the demo is the real
// product with the network unplugged, not a mock of it.
export const landSimulated = internalMutation({
  args: {
    messageId: v.id("messages"),
    orgId: v.id("orgs"),
    customerId: v.optional(v.id("customers")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    // Belt and braces. If this is ever reached for a real org it must do
    // nothing rather than silently mark an unsent message as delivered.
    if (!isDemo(org)) return null;

    await ctx.db.patch(args.messageId, {
      status: "sent",
      wamid: `demo-${args.messageId}`,
      sendingAt: undefined,
      nextAttemptAt: undefined,
      attempts: 1,
    });

    if (!args.customerId) return null;
    if (hashUnit(args.messageId) >= REPLY_CHANCE) return null;
    await ctx.scheduler.runAfter(
      // 20–90 seconds. Long enough to look like a person, short enough that a
      // prospect watching the screen sees it happen.
      20_000 + Math.floor(hashUnit(`${args.messageId}delay`) * 70_000),
      internal.demo.landReply,
      {
        orgId: args.orgId,
        customerId: args.customerId,
        messageId: args.messageId,
      },
    );
    return null;
  },
});

const REPLIES = [
  "Tamam, geliyorum 👍",
  "Teşekkürler!",
  "Saat 15:00 olur mu acaba?",
  "Görüşmek üzere",
  "Maalesef gelemeyeceğim, sonra ararım",
];

export const landReply = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    messageId: v.id("messages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    // Re-checked here, not just at scheduling time: a nightly reset between
    // the two would otherwise land a reply into a rebuilt dataset.
    if (!isDemo(org)) return null;
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== args.orgId) return null;

    const body = REPLIES[Math.floor(hashUnit(`${args.messageId}body`) * REPLIES.length)];
    await ctx.db.insert("messages", {
      orgId: args.orgId,
      customerId: args.customerId,
      direction: "in",
      kind: "reply",
      body,
      status: "received",
    });
    // Opens the 24h window, exactly as a real inbound would — so the composer
    // in the demo is live rather than greyed out, which is the part a prospect
    // most wants to try.
    await ctx.db.patch(args.customerId, { lastInboundAt: Date.now() });
    return null;
  },
});

// Creates the showroom org and fills it. Run once, from the CLI, then put the
// id it prints into DEMO_ORG_ID:
//
//   npx convex run demo:provision
//   npx convex env set DEMO_ORG_ID "<the id it printed>"
//
// Internal and CLI-only on purpose. Nothing in the app creates a demo org,
// because "this org is exempt from talking to providers" is not a property any
// signed-in user should be able to give a business.
export const provision = internalMutation({
  args: { name: v.optional(v.string()) },
  returns: v.id("orgs"),
  handler: async (ctx, args) => {
    const orgId = await ctx.db.insert("orgs", {
      // The fiction: a salon in Kadıköy. Specific enough to read as a real
      // business rather than "Demo Salon", which reads as nothing.
      name: args.name ?? "Moda Kuaför",
      timezone: "Europe/Istanbul",
      language: "tr",
      demoMode: true,
      sendBookingConfirmation: true,
      // Reminders and the winback both run, because watching one arrive is
      // the single most convincing thing the demo does.
      reminderOffsetsHours: [24, 2],
      winbackEnabled: true,
      winbackDaysAfter: 14,
    });
    // The demo gets the full spread as rules — the default two, plus the 2h
    // reminder and the winback the legacy fields above describe. The fields
    // stay only as documentation of what the demo shows; the rows send.
    await seedDefaultRules(ctx.db, orgId);
    await ctx.db.insert("messageRules", {
      orgId,
      trigger: "before_start",
      offsetHours: 2,
      channel: "both",
    });
    await ctx.db.insert("messageRules", {
      orgId,
      trigger: "no_show",
      offsetHours: 14 * 24,
      channel: "both",
    });
    await ctx.scheduler.runAfter(0, internal.devSeed.seed, { orgId, force: true });
    return orgId;
  },
});

// ── Nightly reset ───────────────────────────────────────────────────────────
//
// The demo is a shared surface: whatever the last visitor did is what the next
// one sees. So it is rebuilt from a fixed dataset every night rather than
// asking anyone to be careful with it.
//
// Only tables belonging to demo orgs are touched, and the org row itself
// survives — deleting it would orphan the memberships that let visitors in.
export const nightlyReset = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").take(500);
    for (const org of orgs) {
      if (!isDemo(org)) continue;
      // Notes and activity are not part of the seed's own force-wipe, so they
      // are cleared here; everything else devSeed already replaces wholesale.
      await clearExtras(ctx, org._id);
      await ctx.scheduler.runAfter(0, internal.devSeed.seed, {
        orgId: org._id,
        force: true,
      });
    }
    return null;
  },
});

// Deliberately NOT a loop over table names: Convex types each index per table,
// so a loop loses the type and would accept a table that has no by_org at all.
// devSeed.seed carries the same warning above its own wipe.
async function clearExtras(ctx: MutationCtx, orgId: Id<"orgs">): Promise<void> {
  const notes = await ctx.db
    .query("notes")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(500);
  const activity = await ctx.db
    .query("activityLog")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(500);
  for (const row of [...notes, ...activity]) await ctx.db.delete(row._id);
}
