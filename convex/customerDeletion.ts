// Deleting a customer: everything this business holds on them, in every table,
// and nothing sent to them on the way out. KVKK gives a person the right to
// have a business erase them, and "deleted" has to mean that. Before this the
// app took their appointments and the customer row and left their messages,
// calls, notes, assistant turns, pins, read marks and run items behind.
//
// Two steps, for the reason the org purge gives (platform.purgeOrgStep): a
// customer with years of history has more rows than one transaction may touch.
//
//   1. beginCustomerDeletion, inside the caller's own transaction. Replaces
//      the row with a blank that carries only the mark, so from that commit
//      the person is gone from every list, search and send
//      (lib/customerDeletion isDeleting) and their number no longer resolves
//      to them. It cancels every queued send FIRST, then takes their
//      appointments off the calendar, which is also what stops the
//      reminders, and schedules the sweep.
//   2. sweep, a scheduled mutation. It walks FOOTPRINT from the top on every
//      pass, takes a bounded bite, and reschedules itself while anything is
//      left. The pass that finds every table empty deletes the row in the
//      same transaction, so nothing written in between can be left pointing
//      at a customer that no longer exists.
//
// The sweep never calls a provider and never sends. Copies outside this
// database are not touched: the phone provider keeps its own recording and
// transcript of each call, and the messaging and email providers keep theirs.
// Nudge deletes nothing at its providers either; doing it here would mean a
// provider call per erased call, behind demoMode and the org's own key.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { recordActivity } from "./lib/activity";
import { nearTransactionLimit as spent } from "./lib/txBudget";
import { planToken } from "./lib/planToken";
import { dialCodeForTimezone, normalisePhone } from "./lib/phone";
import {
  ERASED_CALL_EVENT,
  erasedCallKey,
  erasedCallMarker,
  erasedPhone,
  isDeleting,
} from "./lib/customerDeletion";
import { cancelQueuedCallbacks } from "./callbacks";

// ── The footprint ────────────────────────────────────────────────────────────
//
// Every table that holds something of one customer, found by grepping
// schema.ts for customerId and for the customer's phone and email, not by
// memory. ONE list serves the preview's counts and the sweep, so what a
// person is shown before deleting is what goes. When you add a table that
// references a customer, add it here in the same change.
//
// Each entry reads through an index range that holds only this customer's
// rows and says what clearing one means. Most rows are deleted. Two kinds are
// the business's audit trail and stay, emptied of the person: activityLog
// rows lose their link and any free text, and journal rows (agentActions)
// lose the values the tool wrote.
//
// Reached outside this list, and why:
//   customers        the row itself, deleted last by the sweep.
//   voiceEvents      a call's provider events go with the call (eraseCall);
//                    events still queued or failed under the customer's
//                    number, for calls that never got a row, are matched by
//                    that number (clearQueuedCallEvents).
//   _storage         an inbound photo, voice note or document goes with its
//                    message (releaseMedia). Recordings are not ours: a call
//                    stores the provider's URL, never the audio.
//   appointments' manage tokens live on the appointment row and go with it.
// Not reached, on purpose:
//   mediaAssets      the business's own library. An outbound message points
//                    at a library file; deleting the message keeps the file.
//   bulkRuns, campaigns, usageMonthly, waTemplates counters   aggregates with
//                    nothing personal. A run's totals still count the person
//                    who was in it, because they did receive it.
//   demoProspects    the demo's prospects, not any business's customers.

export const FOOTPRINT_KINDS = [
  "appointments",
  "messages",
  "calls",
  "agentTests",
  "callbacks",
  "chatTurns",
  "notes",
  "bulkRunItems",
  "inboxPins",
  "inboxReads",
  "activity",
  "journal",
] as const;
export type FootprintKind = (typeof FOOTPRINT_KINDS)[number];

// What a preview reports per kind. Counted, not estimated, up to a cap: a
// count has to read the rows, and a regular with years of email has more
// bytes behind them than one query may read. A capped kind means "at least".
export const footprintValidator = v.object({
  counts: v.object({
    appointments: v.number(),
    messages: v.number(),
    calls: v.number(),
    agentTests: v.number(),
    callbacks: v.number(),
    chatTurns: v.number(),
    notes: v.number(),
    bulkRunItems: v.number(),
    inboxPins: v.number(),
    inboxReads: v.number(),
    activity: v.number(),
    journal: v.number(),
  }),
  capped: v.array(v.string()),
});
export type Footprint = {
  counts: Record<FootprintKind, number>;
  capped: FootprintKind[];
};

type Budget = { cleared: number };

type Source = {
  kind: FootprintKind;
  count: (ctx: QueryCtx, customer: Doc<"customers">) => Promise<{ n: number; capped: boolean }>;
  clear: (
    ctx: MutationCtx,
    customer: Doc<"customers">,
    budget: Budget,
  ) => Promise<"done" | "more">;
};

// Rows cleared per pass, under the transaction limits lib/txBudget checks.
// Small enough that a pass is quick and rarely collides with live traffic on
// the same customer; the sweep reschedules itself straight away.
const ROWS_PER_PASS = 200;

// One footprint entry. Typed per table by inference from `rows`, so `clear`
// sees the real document; the closures erase the table type for the list.
function source<Row extends { _id: string; orgId: Id<"orgs"> }>(def: {
  kind: FootprintKind;
  // Only this customer's rows, through an index. Never a scan.
  rows: (ctx: QueryCtx, customer: Doc<"customers">) => AsyncIterable<Row>;
  // Whether a row in the range still has anything to clear. Rows that are
  // kept and emptied stay in their range, and this is how the walk knows
  // they are done.
  owed?: (row: Row) => boolean;
  clear: (ctx: MutationCtx, row: Row) => Promise<void>;
  // The preview's count stops here. Lower for tables whose rows run large.
  countCap?: number;
}): Source {
  const owed = def.owed ?? (() => true);
  const cap = def.countCap ?? 500;
  return {
    kind: def.kind,
    count: async (ctx, customer) => {
      let n = 0;
      for await (const row of def.rows(ctx, customer)) {
        if (row.orgId !== customer.orgId || !owed(row)) continue;
        n += 1;
        if (n >= cap || (await spent(ctx, false))) return { n, capped: true };
      }
      return { n, capped: false };
    },
    clear: async (ctx, customer, budget) => {
      for await (const row of def.rows(ctx, customer)) {
        // Every row is checked against the customer's org before anything is
        // done to it. A customer id is unique across the deployment, so a
        // mismatch is corruption; it is left alone and said out loud (no
        // personal data in the log), and the walk carries on past it.
        if (row.orgId !== customer.orgId) {
          console.warn(`customerDeletion: ${def.kind} row in another org left alone`);
          continue;
        }
        if (!owed(row)) continue;
        await def.clear(ctx, row);
        budget.cleared += 1;
        if (budget.cleared >= ROWS_PER_PASS || (await spent(ctx, true))) return "more";
      }
      return "done";
    },
  };
}

// An inbound photo, voice note or document lives in our storage and goes with
// its message. A library file attached to an outbound message is the
// business's, and so is anything another message still shows.
async function releaseMedia(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  messageId: Id<"messages">,
): Promise<void> {
  const asset = await ctx.db
    .query("mediaAssets")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (asset) return;
  const showing = await ctx.db
    .query("messages")
    .withIndex("by_media", (q) => q.eq("mediaStorageId", storageId))
    .take(2);
  if (showing.some((row) => row._id !== messageId)) return;
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // Already gone. Nothing points at it either way.
  }
}

// A call's provider events go with it, and one marker stays in their place so
// a late analysis, a webhook retry or the analysis recovery cannot write the
// call back with a new customer (lib/customerDeletion). Ids only: the marker
// holds nothing of the person.
async function eraseCall(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  retellCallId: string,
  retellAgentId: string,
): Promise<void> {
  const marker = await erasedCallMarker(ctx, orgId, retellCallId);
  for await (const event of ctx.db
    .query("voiceEvents")
    .withIndex("by_org_call", (q) => q.eq("orgId", orgId).eq("retellCallId", retellCallId))) {
    if (event.eventType === ERASED_CALL_EVENT) continue;
    await ctx.db.delete(event._id);
  }
  if (marker) return;
  const now = Date.now();
  await ctx.db.insert("voiceEvents", {
    orgId,
    retellAgentId,
    retellCallId,
    eventType: ERASED_CALL_EVENT,
    eventKey: erasedCallKey(retellCallId),
    payload: null,
    status: "processed",
    attempts: 0,
    receivedAt: now,
    processedAt: now,
  });
}

// The journal (agentActions) is the audit trail of what a connected assistant
// did, so its rows stay. What they carried of the person goes: the values a
// tool wrote, and the arguments it was given. These tools wrote ids and counts
// only and keep their rows whole, which is also what keeps the undo of an
// import working for the other people in it.
const IDS_ONLY_TOOLS = new Set([
  "create_customers",
  "create_appointments",
  "log_activity",
  "delete_customer",
]);
export const REDACTED_JOURNAL = JSON.stringify({ redacted: "customer-deleted" });

function journalOwed(row: Doc<"agentActions">): boolean {
  if (IDS_ONLY_TOOLS.has(row.tool)) return false;
  return !(
    row.args === REDACTED_JOURNAL &&
    row.before === REDACTED_JOURNAL &&
    row.after === REDACTED_JOURNAL
  );
}

async function redactJournal(ctx: MutationCtx, row: Doc<"agentActions">): Promise<void> {
  // Not reversible any more: what it would restore is gone, and so is the
  // customer it would restore it onto.
  await ctx.db.patch(row._id, {
    args: REDACTED_JOURNAL,
    before: REDACTED_JOURNAL,
    after: REDACTED_JOURNAL,
    reversible: false,
  });
}

// Activity kinds whose detail is a fact about the business rather than words
// about the person: a status change ("scheduled → cancelled") and the NAMES of
// the fields an edit touched. Every other detail is free text (a note's
// opening words, a time) and goes.
const STRUCTURAL_DETAIL = new Set<Doc<"activityLog">["kind"]>([
  "appointment_status",
  "customer_updated",
]);

const FOOTPRINT: Source[] = [
  // First, because an appointment is what the reminder cron reads and what
  // the calendar draws. Usually already gone: beginCustomerDeletion takes
  // the first hundred itself.
  source({
    kind: "appointments",
    rows: (ctx, customer) =>
      ctx.db
        .query("appointments")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id)),
    clear: async (ctx, row) => {
      await ctx.db.delete(row._id);
    },
  }),
  // Newest first: anything still queued is among the newest, and goes before
  // the history behind it (beginCustomerDeletion already cancelled them).
  source({
    kind: "messages",
    rows: (ctx, customer) =>
      ctx.db
        .query("messages")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .order("desc"),
    clear: async (ctx, row) => {
      if (row.mediaStorageId) await releaseMedia(ctx, row.mediaStorageId, row._id);
      await ctx.db.delete(row._id);
    },
    countCap: 200,
  }),
  // The team's review of a call (its note and verdict, calls.setReview) lives
  // on the call row and goes with it.
  source({
    kind: "calls",
    rows: (ctx, customer) =>
      ctx.db.query("calls").withIndex("by_customer", (q) => q.eq("customerId", customer._id)),
    clear: async (ctx, row) => {
      if (row.retellCallId) {
        await eraseCall(ctx, row.orgId, row.retellCallId, row.retellAgentId ?? "");
      }
      await ctx.db.delete(row._id);
    },
    countCap: 100,
  }),
  // The assistant's flight recorder: what it was shown and what it wrote,
  // customer text included. Drafts and live countdowns go with it.
  source({
    kind: "chatTurns",
    rows: (ctx, customer) =>
      ctx.db
        .query("chatAgentTurns")
        .withIndex("by_customer_at", (q) => q.eq("customerId", customer._id)),
    clear: async (ctx, row) => {
      await ctx.db.delete(row._id);
    },
    countCap: 200,
  }),
  // A note written by a connected assistant also has a journal row holding
  // its text; that row is emptied before the note goes.
  // A browser test the owner ran AS this customer. Deleted, not unlinked:
  // its summary and answers are what the agent said to and about them.
  source({
    kind: "agentTests",
    rows: (ctx, customer) =>
      ctx.db
        .query("agentTests")
        .withIndex("by_org_customer", (q) =>
          q.eq("orgId", customer.orgId).eq("customerId", customer._id),
        ),
    clear: async (ctx, row) => {
      await ctx.db.delete(row._id);
    },
  }),
  // A callback they asked for (P36): when and on which call. The first
  // transaction has already cancelled any still queued.
  source({
    kind: "callbacks",
    rows: (ctx, customer) =>
      ctx.db
        .query("callbacks")
        .withIndex("by_org_customer_status", (q) =>
          q.eq("orgId", customer.orgId).eq("customerId", customer._id),
        ),
    clear: async (ctx, row) => {
      await ctx.db.delete(row._id);
    },
  }),
  source({
    kind: "notes",
    rows: (ctx, customer) =>
      ctx.db.query("notes").withIndex("by_customer", (q) => q.eq("customerId", customer._id)),
    clear: async (ctx, row) => {
      for await (const action of ctx.db
        .query("agentActions")
        .withIndex("by_target", (q) => q.eq("targetTable", "notes").eq("targetId", row._id))) {
        if (action.orgId === row.orgId && journalOwed(action)) {
          await redactJournal(ctx, action);
        }
      }
      await ctx.db.delete(row._id);
    },
  }),
  source({
    kind: "bulkRunItems",
    rows: (ctx, customer) =>
      ctx.db
        .query("bulkRunItems")
        .withIndex("by_org_customer", (q) =>
          q.eq("orgId", customer.orgId).eq("customerId", customer._id),
        ),
    clear: async (ctx, row) => {
      await ctx.db.delete(row._id);
    },
  }),
  source({
    kind: "inboxPins",
    rows: (ctx, customer) =>
      ctx.db
        .query("inboxPins")
        .withIndex("by_org_customer", (q) =>
          q.eq("orgId", customer.orgId).eq("customerId", customer._id),
        ),
    clear: async (ctx, row) => {
      await ctx.db.delete(row._id);
    },
  }),
  source({
    kind: "inboxReads",
    rows: (ctx, customer) =>
      ctx.db
        .query("inboxReads")
        .withIndex("by_org_customer", (q) =>
          q.eq("orgId", customer.orgId).eq("customerId", customer._id),
        ),
    clear: async (ctx, row) => {
      await ctx.db.delete(row._id);
    },
  }),
  // Kept, emptied: who did what and when stays in the business's audit log;
  // which customer it was about does not. Unlinking takes the row out of this
  // range, which is what tells the walk it is done.
  source({
    kind: "activity",
    rows: (ctx, customer) =>
      ctx.db
        .query("activityLog")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id)),
    clear: async (ctx, row) => {
      await ctx.db.patch(row._id, {
        customerId: undefined,
        appointmentId: undefined,
        ...(STRUCTURAL_DETAIL.has(row.kind) ? {} : { detail: undefined }),
      });
    },
  }),
  // Kept, emptied, and the row stays in range: journalOwed is what makes a
  // redacted row count as done.
  source({
    kind: "journal",
    rows: (ctx, customer) =>
      ctx.db
        .query("agentActions")
        .withIndex("by_target", (q) =>
          q.eq("targetTable", "customers").eq("targetId", customer._id),
        ),
    owed: journalOwed,
    clear: redactJournal,
  }),
];

// What deleting this customer would remove, per kind. The preview the office
// MCP shows before delete_customer, and the signature its confirm token binds
// to: a message that lands between the preview and the delete changes it.
export async function customerFootprint(
  ctx: QueryCtx,
  customer: Doc<"customers">,
): Promise<Footprint> {
  const counts = {} as Record<FootprintKind, number>;
  const capped: FootprintKind[] = [];
  for (const entry of FOOTPRINT) {
    const result = await entry.count(ctx, customer);
    counts[entry.kind] = result.n;
    if (result.capped) capped.push(entry.kind);
  }
  return { counts, capped };
}

export function footprintSignature(footprint: Footprint): string {
  return FOOTPRINT_KINDS.map(
    (kind) => `${kind}:${footprint.counts[kind]}${footprint.capped.includes(kind) ? "+" : ""}`,
  ).join(",");
}

// ── The confirm token (office MCP) ───────────────────────────────────────────
//
// preview_delete_customer hands one out and delete_customer refuses without
// it. The planToken idea (lib/planToken): not a secret, a binding. It names
// the customer, what the preview counted and when it stops being accepted, so
// a delete runs only on what a person was just shown.
export const DELETE_CONFIRM_TTL_MS = 10 * 60_000;

export function deleteConfirmToken(
  customerId: string,
  signature: string,
  expiresAt: number,
): string {
  return `${planToken("delete-customer", `${customerId}|${signature}|${expiresAt}`)}_${expiresAt.toString(36)}`;
}

export function deleteConfirmExpiry(token: string): number | null {
  const tail = token.slice(token.lastIndexOf("_") + 1);
  const expiresAt = parseInt(tail, 36);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

// ── Step one: gone, in the caller's transaction ──────────────────────────────

// Appointments deleted in the first step. Enough for nearly every customer,
// so their bookings leave the calendar in the same commit; a long-standing
// regular's older history goes with the sweep.
const FIRST_STEP_APPOINTMENTS = 100;

export async function beginCustomerDeletion(
  ctx: MutationCtx,
  customer: Doc<"customers">,
  how: {
    // An office-MCP connection acting for someone. Unset: the signed-in
    // person, or the system when `system` says so.
    agent?: {
      actorId: Id<"users">;
      connectionId: Id<"mcpConnections">;
      agentActionId?: Id<"agentActions">;
    };
    system?: boolean;
    // The activity row's detail. Never the customer's name or number: the
    // row is the minimal record that a customer was deleted, and naming
    // them would keep exactly what was asked to go.
    detail?: string;
    // No activity row of its own, for a caller that records the deletion
    // another way (an undone import names its own count).
    quiet?: boolean;
  } = {},
): Promise<void> {
  // Already on its way out. A second request changes nothing.
  if (isDeleting(customer)) return;
  const orgId = customer.orgId;
  const now = Date.now();

  // Replaced, not patched: whatever columns the row has today or gains
  // later, none of them survives this commit. The phone becomes a tombstone,
  // so a message or call from that number finds nobody and starts a new
  // customer instead of landing here; the thread summary goes, which drops
  // them from the inbox and its badge.
  await ctx.db.replace(customer._id, {
    orgId,
    firstName: "",
    phone: erasedPhone(customer._id),
    deletingAt: now,
    ...(customer.phone ? { deletingPhone: customer.phone } : {}),
  });

  // Every send still waiting, cancelled before anything else. Deleting a
  // queued row is how a send is cancelled (wa.cancelScheduled). One already
  // in flight cannot be called back; it finds its row gone and stops there.
  for await (const row of ctx.db
    .query("messages")
    .withIndex("by_customer_status", (q) =>
      q.eq("customerId", customer._id).eq("status", "queued"),
    )) {
    if (row.orgId !== orgId) continue;
    if (row.mediaStorageId) await releaseMedia(ctx, row.mediaStorageId, row._id);
    await ctx.db.delete(row._id);
  }

  // A callback they asked for will not ring (P36). Its claim refuses a
  // deleting customer anyway; cancelling here means no wake-up even looks.
  await cancelQueuedCallbacks(ctx, {
    orgId,
    customerId: customer._id,
    reason: "customer-deleted",
  });

  // Off the calendar now, which is also what ends their reminders: the cron
  // only ever reads appointments. Nothing is sent about them, no
  // cancellation notice and no retracted invite.
  const appointments = await ctx.db
    .query("appointments")
    .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
    .take(FIRST_STEP_APPOINTMENTS);
  for (const appointment of appointments) {
    if (appointment.orgId === orgId) await ctx.db.delete(appointment._id);
  }

  if (!how.quiet) {
    await recordActivity(ctx, {
      orgId,
      kind: "customer_deleted",
      detail: how.detail,
      system: how.system,
      agent: how.agent,
    });
  }

  await ctx.scheduler.runAfter(0, internal.customerDeletion.sweep, {
    orgId,
    customerId: customer._id,
  });
}

// ── Step two: the sweep ──────────────────────────────────────────────────────

// Provider events not yet processed keep the whole webhook body, numbers and
// transcript included (voiceEvents.complete nulls it only on success). One
// whose call never became a row is tied to the customer by nothing but the
// number, so these are scanned for it. Normally empty on a healthy org. The
// scan resumes by creation time across passes rather than restarting, since a
// broken processor can leave hundreds of failed rows to read past.
const PENDING_EVENT_STATUSES = ["queued", "processing", "retrying", "failed"] as const;

const voiceScan = v.union(
  v.literal("done"),
  v.object({ status: v.number(), after: v.number() }),
);
type VoiceScan = "done" | { status: number; after: number };

function eventNumbers(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const call = (
    body.call && typeof body.call === "object" ? body.call : body
  ) as Record<string, unknown>;
  return [call.from_number, call.to_number].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

async function clearQueuedCallEvents(
  ctx: MutationCtx,
  customer: Doc<"customers">,
  scan: VoiceScan,
  budget: Budget,
): Promise<VoiceScan> {
  const phone = customer.deletingPhone;
  if (scan === "done" || !phone) return "done";
  const org = await ctx.db.get(customer.orgId);
  const dialCode = org ? dialCodeForTimezone(org.timezone) : undefined;
  let { status, after } = scan;
  for (; status < PENDING_EVENT_STATUSES.length; status += 1, after = 0) {
    const wanted = PENDING_EVENT_STATUSES[status];
    for await (const event of ctx.db
      .query("voiceEvents")
      .withIndex("by_org_status", (q) =>
        q.eq("orgId", customer.orgId).eq("status", wanted).gt("_creationTime", after),
      )) {
      after = event._creationTime;
      // The number on either leg: recordCall decides which one is the
      // customer by direction, and an event that never got that far has not
      // been decided. The business's own line is never a customer's number.
      const matches = eventNumbers(event.payload).some(
        (raw) => normalisePhone(raw, dialCode) === phone,
      );
      if (matches) {
        await eraseCall(ctx, customer.orgId, event.retellCallId, event.retellAgentId);
        budget.cleared += 1;
      }
      if (budget.cleared >= ROWS_PER_PASS || (await spent(ctx, true))) {
        return { status, after };
      }
    }
  }
  return "done";
}

async function sweepAgain(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  customerId: Id<"customers">,
  voice: VoiceScan | undefined,
): Promise<null> {
  await ctx.scheduler.runAfter(0, internal.customerDeletion.sweep, {
    orgId,
    customerId,
    ...(voice !== undefined ? { voice } : {}),
  });
  return null;
}

export const sweep = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    voice: v.optional(voiceScan),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    // Finished, by this chain or another one.
    if (!customer) return null;
    // Only a row that was marked, in the org that marked it. The mark is set
    // by beginCustomerDeletion alone, and this check is what stops a stray
    // schedule from emptying a live customer (purgeOrgStep's rule).
    if (customer.orgId !== args.orgId || !isDeleting(customer)) return null;

    const budget: Budget = { cleared: 0 };
    for (const entry of FOOTPRINT) {
      if ((await entry.clear(ctx, customer, budget)) === "more") {
        return await sweepAgain(ctx, args.orgId, args.customerId, args.voice);
      }
    }
    const voice = await clearQueuedCallEvents(
      ctx,
      customer,
      args.voice ?? { status: 0, after: 0 },
      budget,
    );
    if (voice !== "done") return await sweepAgain(ctx, args.orgId, args.customerId, voice);

    // Every table came back empty in this transaction. The row is the last
    // thing that knows this customer existed.
    await ctx.db.delete(customer._id);
    return null;
  },
});
