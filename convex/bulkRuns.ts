// One action, fired at a hand-picked set of customers from the Customers
// table's selection.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
//
// It is not campaigns. campaigns.ts targets a PREDICATE (not seen for N days,
// never booked, had this service) and keeps its per-recipient state entirely
// on the messages rows found through messages.by_campaign. Both of those
// break on the call channel: a call produces no message row, and produces no
// calls row either until Retell's webhook lands minutes later, so there is no
// row on which "queued", "ringing" or "we could not dial this" can exist.
// Once calls need item rows, so do the other two, and the thing that made a
// campaign a campaign is gone. See the schema comment on bulkRuns.
//
// The CODE is borrowed heavily from campaigns even so — the per-customer
// render, the OCC claim, the paged fan-out — because all of that was already
// right. Only the table is separate.
//
// ── NOTHING HERE SENDS ANYTHING ─────────────────────────────────────────────
//
// Email and WhatsApp items write a queued `messages` row and stop. delivery.ts
// carries it from there, which is what buys this feature retries, backoff,
// dead-lettering, the stuck-send reaper, per-message metering, the prepaid
// wallet drawdown, the template counters, and self-pacing when Meta starts
// rate-limiting a large run. A bulk action that POSTed a provider directly
// would opt out of all seven at once and there is no second chokepoint that
// would notice. Do not add one.
//
// The call channel is the exception and has to be, because there is no queue
// for calls. It gets its own, and its rule is one at a time — see dialNext.
//
// ── CONSENT ─────────────────────────────────────────────────────────────────
//
// Every recipient needs consentAt, on all three channels including voice.
// campaigns enforces this twice for messages; voice had no consent gate at
// all before this file (retellAgent.testCall is a deliberate one-off with a
// human reading the number out). Auto-dialling people who never agreed to be
// contacted is the highest-regret thing this product can do, and KVKK does
// not grade on whether the button was small. Do not add a bypass.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { isDemo } from "./demo";
import { customerSender, emailBodyHtml, emailLaneConfigured } from "./lib/email";
import { emailConfig, resolveWaAccount } from "./lib/platformConfig";
import { renderTokens } from "./lib/renderTokens";
import { resolvePublicPhone } from "./lib/publicPhone";
import { recordActivity } from "./lib/activity";

// A run is capped, for campaigns' reason word for word: a salon with more
// customers than this wants a filter, not a bigger blast, and a send nobody
// meant is not one anybody can take back. Lower than campaigns' 2000 because
// this list is hand-ticked — past a few hundred rows nobody is reading what
// they selected.
export const MAX_RECIPIENTS = 500;
// WhatsApp is capped harder, and the reason is Meta's, not ours. A WABA that
// has not been through business verification sits on the 250-unique-recipients
// -per-24h tier; a 500-person run burns through it and the tail simply fails.
// The number is mirrored in the composer as a disabled button with a hint,
// never as a thrown error — the house rule for a limit the person can see
// coming.
export const MAX_WA_RECIPIENTS = 200;
// Items written per mutation while a run fans out, campaigns' figure. Well
// inside Convex's per-execution write limits, and the action pages the tail.
const FANOUT_BATCH = 100;
// A call that has been "dialing" for longer than this had its webhook lost.
// Far tighter than delivery's two-hour ceiling for messages, because a stalled
// call queue is not a delayed message — it is a run that has silently stopped
// with the owner watching a progress bar that will never move again.
const CALL_STUCK_MS = 20 * 60_000;

export type BulkChannel = "email" | "whatsapp" | "call";

const channelValidator = v.union(
  v.literal("email"),
  v.literal("whatsapp"),
  v.literal("call"),
);

// ── Eligibility ─────────────────────────────────────────────────────────────
//
// Answered in one place so the launch pre-flight, the fan-out and the run
// detail all agree about why somebody was left out. Returns null when the
// customer can be contacted on this channel, or the reason string that goes
// on the skipped item and shows in the run detail verbatim.
//
// The order matters: consent first, always, before anything else is even
// looked at. It is the only one of these that is a legal fact rather than a
// missing detail.
export function skipReason(
  customer: Doc<"customers">,
  channel: BulkChannel,
): string | null {
  if (customer.consentAt === undefined) return "no-consent";
  if (channel === "email") return customer.email ? null : "no-email";
  // Both phone channels want a dialable/messageable number. customers.phone is
  // E.164-gated on write (orgAuth.assertE164), so this only catches rows that
  // predate that gate — but a run that dials a malformed string is a run that
  // throws in the middle of itself, and the check costs one regex.
  return /^\+[1-9]\d{6,14}$/.test(customer.phone) ? null : "bad-phone";
}

// ── Launch ──────────────────────────────────────────────────────────────────

// Everything launch() needs to decide whether a run may start, loaded in one
// query so the action makes one round trip.
//
// The owner gate lives HERE rather than in the action, campaigns.loadForSend's
// rule: an action has no ctx.db so it cannot check membership itself, and a
// guard beside the data load is one the next caller cannot forget. Owner-only
// because a run reaches hundreds of people and cannot be recalled, so it is
// not a decision for whoever happens to be on shift.
export const loadForLaunch = internalQuery({
  args: { channel: channelValidator, customerIds: v.array(v.id("customers")) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return null;

    const [config, waAccount, templates] = await Promise.all([
      emailConfig(ctx),
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique()
        .then((row) => resolveWaAccount(ctx, row)),
      ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);

    // Exact language match, no cross-language fallback — the rule every other
    // template send in this app follows, because the wrong-language message is
    // worse than no message.
    const template = templates.find(
      (row) =>
        row.kind === "campaign" &&
        row.status === "approved" &&
        row.language === org.language,
    );

    // Only the ids that are really this org's. A caller holding another
    // salon's customer id must not get them into a run, and dropping them
    // here means the count the confirm dialog showed is the count that fans
    // out.
    const customers: Doc<"customers">[] = [];
    for (const id of args.customerIds.slice(0, MAX_RECIPIENTS)) {
      const customer = await ctx.db.get(id);
      if (customer && customer.orgId === orgId) customers.push(customer);
    }

    return {
      org,
      customers,
      hasWa: waAccount !== null,
      templateName: template?.metaName,
      emailReady:
        emailLaneConfigured(config) && Boolean(customerSender(org, config)),
      // Reported so the composer and the refusal ladder can say WHY rather
      // than just no.
      eligible: customers.filter((c) => skipReason(c, args.channel) === null).length,
    };
  },
});

// Creates the run row. Its own mutation rather than part of the fan-out
// because the action needs the id before it can page.
export const createRun = internalMutation({
  args: {
    orgId: v.id("orgs"),
    channel: channelValidator,
    label: v.string(),
    totalCount: v.number(),
    body: v.optional(v.string()),
    emailSubject: v.optional(v.string()),
    emailHtml: v.optional(v.string()),
    templateName: v.optional(v.string()),
    retellAgentId: v.optional(v.string()),
    fromNumber: v.optional(v.string()),
  },
  returns: v.id("bulkRuns"),
  handler: async (ctx, args) => {
    const { user } = await requireOwner(ctx);
    return await ctx.db.insert("bulkRuns", {
      ...args,
      status: "running",
      doneCount: 0,
      failedCount: 0,
      skippedCount: 0,
      startedAt: Date.now(),
      createdBy: user._id,
    });
  },
});

// One page of recipients: an item row each, and for the message channels the
// queued messages row that delivery.ts will carry.
//
// Idempotent on (runId, customerId). The action loops this mutation and no
// transaction spans the pages, so an action that dies mid-loop and is retried
// would otherwise double every recipient it had already written. The claim on
// the run is not enough for that; only this is.
export const fanOut = internalMutation({
  args: {
    runId: v.id("bulkRuns"),
    customerIds: v.array(v.id("customers")),
    startPosition: v.number(),
  },
  returns: v.object({ created: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return { created: 0, skipped: 0 };
    const org = await ctx.db.get(run.orgId);
    if (!org) return { created: 0, skipped: 0 };

    // All resolved once for the page rather than per recipient: each depends
    // only on the org. campaigns.fanOut's rule.
    const config = await emailConfig(ctx);
    const sender = customerSender(org, config);
    const publicPhone = await resolvePublicPhone(ctx, org);
    const contactFields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", run.orgId))
      .collect();

    let created = 0;
    let skipped = 0;
    let position = args.startPosition;

    for (const customerId of args.customerIds) {
      position += 1;
      const existing = await ctx.db
        .query("bulkRunItems")
        .withIndex("by_run_customer", (q) =>
          q.eq("runId", args.runId).eq("customerId", customerId),
        )
        .unique();
      if (existing) continue;

      const customer = await ctx.db.get(customerId);
      if (!customer || customer.orgId !== run.orgId) continue;

      // Second eligibility check, at the moment of writing the row. The
      // pre-flight already filtered, but a fan-out can span minutes and
      // consent can be withdrawn inside them. campaigns checks twice for
      // exactly this reason.
      const reason = skipReason(customer, run.channel);
      if (reason) {
        await ctx.db.insert("bulkRunItems", {
          runId: args.runId,
          orgId: run.orgId,
          customerId,
          position,
          status: "skipped",
          reason,
        });
        skipped += 1;
        continue;
      }

      // A call item IS the queue row: nothing is written anywhere else until
      // dialNext claims it.
      if (run.channel === "call") {
        await ctx.db.insert("bulkRunItems", {
          runId: args.runId,
          orgId: run.orgId,
          customerId,
          position,
          status: "pending",
        });
        created += 1;
        continue;
      }

      const customValues: Record<string, string> = {};
      for (const field of contactFields) {
        customValues[field.key] = customer.custom?.[field.key] ?? "";
      }
      const tokenValues = {
        firstName: customer.firstName,
        lastName: customer.lastName,
        businessName: org.name,
        phone: publicPhone,
        email: customer.email,
        bookingLink: org.bookingUrl,
        custom: customValues,
      };
      const line = renderTokens(run.body ?? "", tokenValues);
      // A body that renders to nothing for THIS customer is a message they
      // should not receive: better nothing than a bare greeting. campaigns'
      // rule, and here it earns a visible skip rather than a silent `continue`
      // so the run detail can say what happened.
      if (!line) {
        await ctx.db.insert("bulkRunItems", {
          runId: args.runId,
          orgId: run.orgId,
          customerId,
          position,
          status: "skipped",
          reason: "empty-body",
        });
        skipped += 1;
        continue;
      }

      let messageId: Id<"messages">;
      if (run.channel === "whatsapp") {
        messageId = await ctx.db.insert("messages", {
          orgId: run.orgId,
          customerId,
          bulkRunId: args.runId,
          direction: "out",
          // No lane prefix, which IS the marker: messages.channelOfMessage
          // reads "email_" and "form_" as the two prefixed lanes and treats
          // everything else as WhatsApp. Exactly parallel to campaigns'
          // "campaign" / "email_campaign" pair below.
          kind: "bulk",
          status: "queued",
          templateName: run.templateName,
          // {{3}} carries the whole authored line, which is what lets one
          // approved template serve every run. The flattening is not cosmetic:
          // Meta refuses a body parameter containing a newline (132000) and
          // does it PER RECIPIENT, so a body written with line breaks fails
          // the entire run one row at a time. The composer keeps WhatsApp to a
          // single line; this is the second belt.
          templateParams: [
            customer.firstName,
            org.name ?? "",
            line.replace(/\s+/g, " ").trim(),
          ],
          body: line,
          nextAttemptAt: Date.now(),
        });
      } else {
        const subject = renderTokens(run.emailSubject ?? "", tokenValues);
        messageId = await ctx.db.insert("messages", {
          orgId: run.orgId,
          customerId,
          bulkRunId: args.runId,
          direction: "out",
          kind: "email_bulk",
          status: "queued",
          body: line,
          // The WYSIWYG's markup when there was any, otherwise the plain line
          // wrapped the way every other customer mail is. Tokens render inside
          // the HTML too, so [first_name] works in a styled body.
          emailHtml: run.emailHtml
            ? renderTokens(run.emailHtml, tokenValues)
            : emailBodyHtml(line),
          // A subject that renders to nothing for this customer falls back to
          // the business name rather than sending a blank line.
          emailSubject: subject || org.name || "",
          emailFrom: sender,
          // Minted at fan-out; delivery injects the pixel. Bulk mail is one of
          // the two places an open RATE means anything.
          trackingToken: crypto.randomUUID(),
          nextAttemptAt: Date.now(),
        });
      }

      await ctx.db.insert("bulkRunItems", {
        runId: args.runId,
        orgId: run.orgId,
        customerId,
        position,
        status: "queued",
        messageId,
      });
      created += 1;
    }

    if (skipped > 0) {
      await ctx.db.patch(args.runId, {
        skippedCount: run.skippedCount + skipped,
      });
    }
    return { created, skipped };
  },
});

// The one entry point. An action rather than a mutation because a large run
// has to page, and paging inside a single mutation blows Convex's
// per-execution limits well before the cap.
export const launch = action({
  args: {
    channel: channelValidator,
    customerIds: v.array(v.id("customers")),
    body: v.optional(v.string()),
    emailSubject: v.optional(v.string()),
    emailHtml: v.optional(v.string()),
    retellAgentId: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    runId: v.optional(v.id("bulkRuns")),
    queued: v.optional(v.number()),
    skipped: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    reason?: string;
    runId?: Id<"bulkRuns">;
    queued?: number;
    skipped?: number;
  }> => {
    const context = await ctx.runQuery(internal.bulkRuns.loadForLaunch, {
      channel: args.channel,
      customerIds: args.customerIds,
    });
    if (!context) return { ok: false, reason: "not-found" };
    const { org, customers, hasWa, templateName, emailReady, eligible } = context;

    // ── The refusal ladder ──────────────────────────────────────────────
    //
    // Every one of these refuses the run WHOLE rather than fanning out rows
    // destined to fail. campaigns' rule, and the reason is honesty: queueing
    // four hundred rows so they can each be refused one at a time is not an
    // answer to "send this".
    if (customers.length === 0) return { ok: false, reason: "no-recipients" };
    if (eligible === 0) return { ok: false, reason: "none-eligible" };
    if ((org.status ?? "active") === "suspended") {
      return { ok: false, reason: "org-suspended" };
    }
    if (isDemo(org)) return { ok: false, reason: "demo-org" };

    // Prepaid enforcement. There is no balance check anywhere on the messaging
    // lane today — delivery.claimForRetry gates suspension and demo only, and
    // applyWalletDebit has no floor — so a prepaid org at zero could fan out
    // hundreds of billable template sends and drive the balance arbitrarily
    // negative. Bulk sending is what turns that from theoretical into routine,
    // so the gate lands here, at the largest outbound the product has. The
    // voice lane already has its twin at ring time (retell.beforeCallContext).
    if (org.billingMode === "prepaid" && (org.walletBalanceMicroUsd ?? 0) <= 0) {
      return { ok: false, reason: "wallet-empty" };
    }

    let fromNumber: string | undefined;
    let agentName: string | undefined;

    if (args.channel === "email") {
      if (!emailReady) return { ok: false, reason: "email-not-configured" };
      if (!args.emailSubject?.trim()) return { ok: false, reason: "no-subject" };
      if (!args.body?.trim()) return { ok: false, reason: "no-body" };
    } else if (args.channel === "whatsapp") {
      if (!hasWa) return { ok: false, reason: "wa-not-configured" };
      if (!templateName) return { ok: false, reason: "no-campaign-template" };
      if (!args.body?.trim()) return { ok: false, reason: "no-body" };
      if (eligible > MAX_WA_RECIPIENTS) return { ok: false, reason: "wa-too-many" };
    } else {
      if (!args.retellAgentId) return { ok: false, reason: "no-agent" };
      // Resolved ONCE, here, and frozen on the run. Every tenant shares one
      // Retell account, so re-resolving per call risks the run changing which
      // salon's line it is calling from halfway through. lineUsable is the
      // multi-tenant guard: a caller id is as much theirs-or-not-theirs on the
      // way out as the line that rings them.
      const line = await ctx.runQuery(internal.bulkRuns.callLineFor, {
        retellAgentId: args.retellAgentId,
      });
      if (!line.ok) return { ok: false, reason: line.reason };
      fromNumber = line.fromNumber;
      agentName = line.agentName;
    }

    // The run's name in the history list, derived rather than typed. A run is
    // picked out of a list by what it said and when, and a title field is one
    // nobody fills in honestly.
    const label = (
      args.channel === "email"
        ? args.emailSubject
        : args.channel === "whatsapp"
          ? args.body
          : agentName
    )?.trim();

    const runId = await ctx.runMutation(internal.bulkRuns.createRun, {
      orgId: org._id,
      channel: args.channel,
      label: (label || "—").slice(0, 80),
      totalCount: customers.length,
      body: args.body,
      emailSubject: args.emailSubject,
      emailHtml: args.emailHtml,
      templateName: args.channel === "whatsapp" ? templateName : undefined,
      retellAgentId: args.retellAgentId,
      fromNumber,
    });

    let queued = 0;
    let skipped = 0;
    const ids = customers.map((c: Doc<"customers">) => c._id);
    for (let i = 0; i < ids.length; i += FANOUT_BATCH) {
      const page = await ctx.runMutation(internal.bulkRuns.fanOut, {
        runId,
        customerIds: ids.slice(i, i + FANOUT_BATCH),
        startPosition: i,
      });
      queued += page.created;
      skipped += page.skipped;
    }

    if (args.channel === "call") {
      // The chain starts here and thereafter drives itself off the webhook.
      await ctx.scheduler.runAfter(0, internal.bulkRuns.dialNext, { runId });
    } else {
      // Message runs have handed everything to delivery.ts. They stay
      // "running" until the last row reports back through applySendResult, so
      // that pause and cancel still mean something while rows sit in the
      // queue — a run marked done the moment it was enqueued would have a
      // stop button that stops nothing.
      await ctx.runMutation(internal.bulkRuns.settleIfComplete, { runId });
    }

    return { ok: true, runId, queued, skipped };
  },
});

// ── Run control ─────────────────────────────────────────────────────────────

// Pause, resume and stop, and the only mutation that moves a run by hand.
//
// Pause does NOT recall anything already in flight, on either channel: the
// call currently ringing finishes, and a message already claimed by a delivery
// action lands. You cannot un-ring a phone, and the alternative is a stop
// button that lies about what it did.
export const setStatus = mutation({
  args: {
    runId: v.id("bulkRuns"),
    status: v.union(
      v.literal("running"),
      v.literal("paused"),
      v.literal("cancelled"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== orgId) return null;
    // A finished run has nothing to pause and nothing to cancel. Reopening one
    // would restart a chain whose items are all terminal.
    if (run.status === "done" || run.status === "cancelled") return null;

    await ctx.db.patch(args.runId, {
      status: args.status,
      ...(args.status === "cancelled" ? { finishedAt: Date.now() } : {}),
    });

    if (args.status === "cancelled") {
      // Sweep what has not started. An item already dialled is never touched
      // — that is the dedup, and it is also the truth: that call happened.
      const pending = await ctx.db
        .query("bulkRunItems")
        .withIndex("by_run_status", (q) =>
          q.eq("runId", args.runId).eq("status", "pending"),
        )
        .take(MAX_RECIPIENTS);
      for (const item of pending) {
        await ctx.db.patch(item._id, { status: "cancelled" });
      }
    }

    // ── Why the queued MESSAGE rows have to be touched too ─────────────────
    //
    // delivery.dueRetries reads the fifty oldest rows owed an attempt across
    // the WHOLE deployment, ordered by nextAttemptAt. A run's rows all fan out
    // within a second of each other, so five hundred of them sit at the front
    // of that queue together.
    //
    // Refusing them at claim time is therefore not enough on its own. A
    // refusal that leaves the row queued and still due — which is exactly what
    // pausing wants — means every tick hands the batch the same fifty rows,
    // refuses all fifty, and gets nowhere. Nothing else on the deployment
    // sends while that lasts: not another salon's reminders, not an
    // appointment confirmation. Pressing pause on one salon's run would stop
    // outbound mail and WhatsApp for every tenant, indefinitely, with no error
    // anywhere.
    //
    // So a pause PARKS the rows by clearing nextAttemptAt, which is precisely
    // what that field already means (schema: "set only while a row is waiting
    // to retry" — a row belonging to a paused run is not). Resume puts them
    // back in the queue, and cancel resolves them outright rather than letting
    // five hundred refusals grind through the fleet's batch ten minutes deep.
    //
    // Bounded by the run cap, so this is at most MAX_RECIPIENTS small patches
    // in one transaction. The claim-time gate stays as the belt for anything
    // already in flight when the button was pressed.
    if (run.channel !== "call") {
      const queued = await ctx.db
        .query("bulkRunItems")
        .withIndex("by_run_status", (q) =>
          q.eq("runId", args.runId).eq("status", "queued"),
        )
        .take(MAX_RECIPIENTS);
      for (const item of queued) {
        if (!item.messageId) continue;
        const message = await ctx.db.get(item.messageId);
        if (!message || message.status !== "queued") continue;
        if (args.status === "paused") {
          await ctx.db.patch(item.messageId, { nextAttemptAt: undefined });
        } else if (args.status === "running") {
          await ctx.db.patch(item.messageId, { nextAttemptAt: Date.now() });
        } else {
          // Cancelled. The same terminal state the claim-time refusal would
          // have produced, reached directly — and the item with it, so the run
          // can settle instead of waiting on rows that will never be sent.
          await ctx.db.patch(item.messageId, {
            status: "failed",
            error: "bulk-cancelled",
            nextAttemptAt: undefined,
            sendingAt: undefined,
          });
          await ctx.db.patch(item._id, { status: "cancelled" });
        }
      }
    }

    // Resume restarts the chain immediately rather than waiting for the
    // reaper's next sweep. A resume that visibly does nothing for five minutes
    // reads as broken.
    if (args.status === "running" && run.channel === "call") {
      await ctx.scheduler.runAfter(0, internal.bulkRuns.dialNext, {
        runId: args.runId,
      });
    }
    return null;
  },
});

// Marks a run finished once nothing is outstanding. Called at every point an
// item reaches a terminal state, and cheap enough to be: one indexed read per
// non-terminal status.
export const settleIfComplete = internalMutation({
  args: { runId: v.id("bulkRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await settleRun(ctx, args.runId);
    return null;
  },
});

async function settleRun(ctx: MutationCtx, runId: Id<"bulkRuns">): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== "running") return;
  for (const status of ["pending", "queued", "dialing"] as const) {
    const outstanding = await ctx.db
      .query("bulkRunItems")
      .withIndex("by_run_status", (q) => q.eq("runId", runId).eq("status", status))
      .first();
    if (outstanding) return;
  }
  await ctx.db.patch(runId, { status: "done", finishedAt: Date.now() });
  await recordActivity(ctx, {
    orgId: run.orgId,
    kind: "settings_changed",
    detail: `bulk ${run.channel}: ${run.label}`,
  });
}

// ── Message-channel outcomes ────────────────────────────────────────────────

// Called from messages.applySendResult at its two TERMINAL points, so a row
// still owed a retry does not count as finished. Exported as a plain function
// rather than a mutation for the applyWalletDebit reason: it has to run in the
// same transaction as the patch it is reporting on, or a crash between them
// leaves the run's counters describing a world that never existed.
export async function noteBulkItemResult(
  ctx: MutationCtx,
  message: Doc<"messages">,
  ok: boolean,
): Promise<void> {
  if (!message.bulkRunId || !message.customerId) return;
  const item = await ctx.db
    .query("bulkRunItems")
    .withIndex("by_run_customer", (q) =>
      q.eq("runId", message.bulkRunId!).eq("customerId", message.customerId!),
    )
    .unique();
  // Only a row still in flight may move. A retry that eventually lands after
  // the reaper or a cancel already resolved the item must not un-resolve it.
  if (!item || item.status !== "queued") return;

  // A row the delivery queue refused BECAUSE the run was stopped is not a
  // failure of the send, and counting it as one would report a clean cancel
  // as dozens of errors. It reads as cancelled and counts against nothing.
  const cancelled = !ok && message.error === "bulk-cancelled";
  await ctx.db.patch(item._id, {
    status: cancelled ? "cancelled" : ok ? "done" : "failed",
    reason: ok || cancelled ? undefined : (message.error ?? "send-failed"),
  });
  const run = await ctx.db.get(message.bulkRunId);
  if (run && !cancelled) {
    await ctx.db.patch(run._id, {
      doneCount: run.doneCount + (ok ? 1 : 0),
      failedCount: run.failedCount + (ok ? 0 : 1),
    });
  }
  await settleRun(ctx, message.bulkRunId);
}

// Whether delivery may put this row on the wire. Read at CLAIM time, not at
// enqueue time: by the time a run is paused its rows are already queued, so a
// flag checked only on the way in would be decorative.
//
// Paused leaves the row queued and due — the run is meant to continue when it
// resumes, and failing the row would turn a pause into a cancel.
export async function bulkRunGate(
  ctx: MutationCtx,
  message: Doc<"messages">,
): Promise<"paused" | "cancelled" | null> {
  if (!message.bulkRunId) return null;
  const run = await ctx.db.get(message.bulkRunId);
  if (!run) return null;
  if (run.status === "paused") return "paused";
  if (run.status === "cancelled") return "cancelled";
  return null;
}

// ── The call queue ──────────────────────────────────────────────────────────
//
// Strictly one call at a time. Never two, never "two is probably fine": a
// salon's customers hearing the same agent ring them simultaneously is the
// failure everybody notices, and Retell bills every leg.
//
// The whole concurrency control is claimNextCall below, and it is about
// twenty lines. There is no lock table, no leader election and no heartbeat —
// only Convex's transaction semantics plus one convention: an item in status
// "dialing" IS the in-flight token. It is NOT marked done when the POST
// succeeds, only when the call ends. Marking it at placement is the obvious
// thing and it silently breaks serialisation, because the next claim would
// then find nothing in flight and dial straight over the live call.
//
// Three independent paths release the token, and all three are required:
//
//   1. the call_ended webhook            → finishByCallId   (the normal one)
//   2. a placement that failed outright  → inside dialNext  (bad number)
//   3. the reaper, for a lost webhook    → reapStuckCalls   (the safety net)
//
// Drop any one and a single bad call strands the run forever, silently.

// The agent's line, resolved and checked before a run is allowed to start.
export const callLineFor = internalQuery({
  args: { retellAgentId: v.string() },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    fromNumber: v.optional(v.string()),
    agentName: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    // by_agent, not by_org plus a filter: a filter scans, and the agent id is
    // already a globally unique key at the provider. The org comparison after
    // it is the tenancy check a shared Retell account makes mandatory.
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || agent.orgId !== orgId) return { ok: false, reason: "agent-not-found" };
    if (!agent.enabled) return { ok: false, reason: "agent-disabled" };

    // The agent's own outbound line first, its inbound number as the fallback
    // — retellAgent.testCall's ladder exactly. Deliberately never "the first
    // number on the account": every tenant shares one Retell account, so that
    // reading places calls from another business's line, with their number in
    // the callee's phone.
    const lines = await ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const fromNumber =
      lines.find((line) => line.outboundAgentId === args.retellAgentId)?.number ??
      agent.inboundNumber;
    if (!fromNumber) return { ok: false, reason: "no-outbound-line" };

    return { ok: true, fromNumber, agentName: agent.name };
  },
});

// The entire concurrency control.
//
// One transaction: is the run still running, is anything already in flight,
// and if not take the next pending item. Convex serialises the conflicting
// read/write on by_run_status, so two overlapping dialNext actions cannot both
// slip a call out — the loser's transaction retries, sees the winner's
// "dialing" row and answers in-flight.
export const claimNextCall = internalMutation({
  args: { runId: v.id("bulkRuns") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return { state: "stopped" as const };

    const inFlight = await ctx.db
      .query("bulkRunItems")
      .withIndex("by_run_status", (q) =>
        q.eq("runId", args.runId).eq("status", "dialing"),
      )
      .first();
    if (inFlight) return { state: "in-flight" as const };

    // Oldest pending first. Convex appends _creationTime to every index, and
    // fan-out inserts in position order, so ascending IS the dial order.
    const next = await ctx.db
      .query("bulkRunItems")
      .withIndex("by_run_status", (q) =>
        q.eq("runId", args.runId).eq("status", "pending"),
      )
      .first();
    if (!next) {
      await settleRun(ctx, args.runId);
      return { state: "empty" as const };
    }

    const customer = await ctx.db.get(next.customerId);
    // Consent can be withdrawn between fan-out and this customer's turn, which
    // on a long run is minutes to hours. Third check, and the last one before
    // a phone actually rings.
    const reason = customer ? skipReason(customer, "call") : "missing-customer";
    if (reason) {
      await ctx.db.patch(next._id, { status: "skipped", reason });
      await ctx.db.patch(args.runId, { skippedCount: run.skippedCount + 1 });
      return { state: "skipped" as const };
    }

    // A call run without an agent or a line cannot dial anything, and every
    // remaining item would fail identically. launch() resolves both before it
    // writes the run, so reaching this means the row was written by something
    // that skipped that path — stop rather than burn the queue down one item
    // at a time.
    if (!run.retellAgentId || !run.fromNumber) {
      await ctx.db.patch(next._id, { status: "pending" });
      await ctx.db.patch(args.runId, { status: "paused" });
      return { state: "stopped" as const };
    }

    await ctx.db.patch(next._id, {
      status: "dialing",
      dialedAt: Date.now(),
      attempts: (next.attempts ?? 0) + 1,
    });
    return {
      state: "claimed" as const,
      itemId: next._id,
      orgId: run.orgId,
      toNumber: customer!.phone,
      retellAgentId: run.retellAgentId,
      fromNumber: run.fromNumber,
    };
  },
});

export const stampCallId = internalMutation({
  args: { itemId: v.id("bulkRunItems"), retellCallId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, { retellCallId: args.retellCallId });
    return null;
  },
});

// Releases the token when a call could not be placed at all, and counts it.
export const failItem = internalMutation({
  args: { itemId: v.id("bulkRunItems"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "dialing") return null;
    await ctx.db.patch(args.itemId, { status: "failed", reason: args.reason });
    const run = await ctx.db.get(item.runId);
    if (run) await ctx.db.patch(run._id, { failedCount: run.failedCount + 1 });
    return null;
  },
});

// Puts a claimed item back and stops the run. Used when the refusal is about
// the ORG rather than this customer — a suspension, an emptied wallet, a
// disabled agent — because those will refuse the next four hundred too, and
// burning through them one failed item at a time is not a useful answer.
export const abortRun = internalMutation({
  args: { itemId: v.id("bulkRunItems"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    if (item.status === "dialing") {
      await ctx.db.patch(args.itemId, { status: "pending", reason: args.reason });
    }
    const run = await ctx.db.get(item.runId);
    if (run && run.status === "running") {
      await ctx.db.patch(run._id, { status: "paused" });
    }
    return null;
  },
});

// Places one call, then gets out of the way. The chain is driven by the
// call_ended webhook, not by this action waiting — an action that awaited each
// call would blow Convex's execution limit around call three.
export const dialNext = internalAction({
  args: { runId: v.id("bulkRuns") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(internal.bulkRuns.claimNextCall, {
      runId: args.runId,
    });

    // A skipped item never rang anything, so the chain has to step over it
    // itself — nothing else will.
    if (claim.state === "skipped") {
      await ctx.scheduler.runAfter(0, internal.bulkRuns.dialNext, { runId: args.runId });
      return null;
    }
    if (claim.state !== "claimed") return null;

    // The org-level gate: disabled agent, suspended org, or a prepaid wallet
    // that has run dry. beforeCallContext already answers all three with null,
    // and it is also where the call's dynamic variables come from, so one
    // query does both jobs. testCall ignores a null and dials anyway, which is
    // defensible for one call a human is watching and is not defensible for
    // four hundred.
    const before = await ctx.runQuery(internal.retell.beforeCallContext, {
      retellAgentId: claim.retellAgentId,
      phone: claim.toNumber,
    });
    if (!before) {
      await ctx.runMutation(internal.bulkRuns.abortRun, {
        itemId: claim.itemId,
        reason: "org-gate",
      });
      return null;
    }

    try {
      const callId = await ctx.runAction(internal.retellAgent.placeCall, {
        orgId: claim.orgId,
        retellAgentId: claim.retellAgentId,
        fromNumber: claim.fromNumber,
        toNumber: claim.toNumber,
        dynamicVariables: before.dynamicVariables,
      });
      await ctx.runMutation(internal.bulkRuns.stampCallId, {
        itemId: claim.itemId,
        retellCallId: callId,
      });
      // Deliberately no scheduling here. The item stays "dialing" and the
      // chain resumes from finishByCallId when the call_ended webhook lands.
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.bulkRuns.failItem, {
        itemId: claim.itemId,
        reason: message.slice(0, 200),
      });
      // Release path 2. A number Retell refuses must not stall the queue, so
      // the chain steps forward inside the same action that failed.
      await ctx.scheduler.runAfter(0, internal.bulkRuns.dialNext, { runId: args.runId });
    }
    return null;
  },
});

// Release path 1, the normal one. Called from voiceEvents.process on
// call_ended, after the event is marked complete.
//
// Idempotent three times over: voiceEvents dedupes on (call, eventType)
// before this is ever reached, process holds a claim lease, and the
// dialing-only guard below means a second arrival changes nothing.
export const finishByCallId = internalMutation({
  args: { retellCallId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("bulkRunItems")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", args.retellCallId))
      .unique();
    if (!item || item.status !== "dialing") return null;

    // retell.recordCall wrote the calls row earlier in this same event pass,
    // so the outcome is already there to copy. Copied rather than joined
    // because the run detail reads hundreds of items at once and a lookup per
    // row is the thing that makes a history page slow.
    const call = await ctx.db
      .query("calls")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", args.retellCallId))
      .unique();

    await ctx.db.patch(item._id, {
      status: "done",
      durationSec: call?.durationSec,
      disconnectionReason: call?.disconnectionReason,
    });
    const run = await ctx.db.get(item.runId);
    if (!run) return null;
    await ctx.db.patch(run._id, { doneCount: run.doneCount + 1 });

    if (run.status === "running") {
      await ctx.scheduler.runAfter(0, internal.bulkRuns.dialNext, { runId: item.runId });
    } else {
      // Paused or cancelled while this one was ringing. The call finished
      // normally and is counted; the chain simply stops here.
      await settleRun(ctx, item.runId);
    }
    return null;
  },
});

// Release path 3. Without it a single lost webhook strands a run forever, with
// the owner watching a progress bar that will never move again.
//
// It also handles the plainer break: a run that is running, has nothing in
// flight and still has pending items. That happens when a deploy kills the one
// scheduled action mid-chain, and nothing else would ever restart it.
export const reapStuckCalls = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Fleet-wide by status, the messages.by_status_creation trick: a cron has
    // no org to scope to, and running runs are a handful at any moment while
    // finished ones accumulate forever. This reads what is LIVE rather than
    // what exists.
    const runs = await ctx.db
      .query("bulkRuns")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .take(50);

    for (const run of runs) {
      if (run.channel !== "call") continue;

      const stuck = await ctx.db
        .query("bulkRunItems")
        .withIndex("by_run_status", (q) =>
          q.eq("runId", run._id).eq("status", "dialing"),
        )
        .first();

      if (stuck) {
        if (Date.now() - (stuck.dialedAt ?? 0) < CALL_STUCK_MS) continue;
        await ctx.db.patch(stuck._id, { status: "failed", reason: "dial-timeout" });
        await ctx.db.patch(run._id, { failedCount: run.failedCount + 1 });
      }

      // Either we just cleared a stuck call, or the chain broke with nothing
      // in flight. Both want the same thing.
      await ctx.scheduler.runAfter(0, internal.bulkRuns.dialNext, { runId: run._id });
    }
    return null;
  },
});

// ── Reading ─────────────────────────────────────────────────────────────────

// The history list. Reads counters off the run row and NEVER collects items:
// this is a reactive query over every run an org has fired, and counting by
// collecting each run's items turns one open tab into a scan of the whole item
// table on every change anywhere in it. That is the scaling smell in nudge's
// equivalent, and the reason bulkRuns carries denormalised counters at all.
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("bulkRuns"),
      channel: channelValidator,
      status: v.union(
        v.literal("running"),
        v.literal("paused"),
        v.literal("cancelled"),
        v.literal("done"),
      ),
      label: v.string(),
      totalCount: v.number(),
      doneCount: v.number(),
      failedCount: v.number(),
      skippedCount: v.number(),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const runs = await ctx.db
      .query("bulkRuns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(100);
    return runs.map((run) => ({
      _id: run._id,
      channel: run.channel,
      status: run.status,
      label: run.label,
      totalCount: run.totalCount,
      doneCount: run.doneCount,
      failedCount: run.failedCount,
      skippedCount: run.skippedCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    }));
  },
});

// One run, opened. Here the item scan is the point, and it is bounded by the
// run's own cap rather than by the table.
//
// The message channels read their outcome THROUGH the message row rather than
// from the item, because delivery keeps retrying for hours after the item was
// written and the item is only patched at the terminal transition. Reading the
// live row means a run detail left open shows "sent" the moment it lands,
// with nothing having to patch anything.
export const detail = query({
  args: { runId: v.id("bulkRuns") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== orgId) return null;

    const items = await ctx.db
      .query("bulkRunItems")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(MAX_RECIPIENTS);

    const rows = [];
    for (const item of items) {
      const customer = await ctx.db.get(item.customerId);
      const message = item.messageId ? await ctx.db.get(item.messageId) : null;
      rows.push({
        _id: item._id,
        customerId: item.customerId,
        name: customer
          ? `${customer.firstName} ${customer.lastName ?? ""}`.trim()
          : "—",
        position: item.position,
        status: item.status,
        reason: item.reason,
        durationSec: item.durationSec,
        disconnectionReason: item.disconnectionReason,
        // Live message state, so a retry that lands an hour from now shows up
        // here without anything patching this row.
        messageStatus: message?.status,
        messageError: message?.error,
        // The two facts worth more than "sent" on a bulk mail. openedAt is
        // shown as a RATE across the run and never as "this person read it":
        // relay prefetch opens pixels no human saw, and a per-person badge
        // would launder that guess into a fact.
        openedAt: message?.openedAt,
        repliedAt: message?.repliedAt,
      });
    }
    rows.sort((a, b) => a.position - b.position);

    return { run, items: rows };
  },
});

// What the composer needs to know before it offers anything: which lanes are
// live, which agents can dial, and the two caps. Everything the UI uses to
// disable a button with a hint rather than let the action throw.
export const launchOptions = query({
  args: {},
  returns: v.object({
    isOwner: v.boolean(),
    emailReady: v.boolean(),
    waReady: v.boolean(),
    // Split from waReady on purpose: "no WhatsApp number" and "no approved
    // campaign template yet" are different problems with different fixes, and
    // a single disabled button that means either is a support ticket.
    waTemplateReady: v.boolean(),
    walletEmpty: v.boolean(),
    maxRecipients: v.number(),
    maxWaRecipients: v.number(),
    agents: v.array(
      v.object({
        retellAgentId: v.string(),
        name: v.optional(v.string()),
        canDial: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { orgId, role } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    const [config, waAccount, templates, agents, lines] = await Promise.all([
      emailConfig(ctx),
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique()
        .then((row) => resolveWaAccount(ctx, row)),
      ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("retellAgents")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("agentLines")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);

    const outbound = new Set(
      lines.map((line) => line.outboundAgentId).filter(Boolean) as string[],
    );

    return {
      isOwner: role !== "staff",
      emailReady:
        Boolean(org) &&
        emailLaneConfigured(config) &&
        Boolean(customerSender(org!, config)),
      waReady: waAccount !== null,
      waTemplateReady: templates.some(
        (row) =>
          row.kind === "campaign" &&
          row.status === "approved" &&
          row.language === org?.language,
      ),
      walletEmpty:
        org?.billingMode === "prepaid" && (org.walletBalanceMicroUsd ?? 0) <= 0,
      maxRecipients: MAX_RECIPIENTS,
      maxWaRecipients: MAX_WA_RECIPIENTS,
      agents: agents
        .filter((agent) => agent.enabled)
        .map((agent) => ({
          retellAgentId: agent.retellAgentId,
          name: agent.name,
          // A line it can dial from, resolved the same way callLineFor will
          // when the run actually starts, so the picker offers exactly the
          // agents the launch would accept.
          canDial:
            outbound.has(agent.retellAgentId) || Boolean(agent.inboundNumber),
        })),
    };
  },
});
