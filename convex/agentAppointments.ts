// The assistants' hands on a customer's EXISTING appointment: find the next
// one, move it, cancel it. Shared by the phone agent (/retell/functions in
// http.ts) and the WhatsApp assistant (chatAgent.ts) so the two lanes cannot
// disagree about whose appointment they may touch or what a move has to clear
// (2026-10-13, ported from Nudge's meetingTools.ts).
//
// Three rules live here and nowhere else.
//
// 1. WHOSE, AND WHICH. Every function takes the org and the customer the
//    CHANNEL resolved: the call leg on the phone, the conversation on
//    WhatsApp. Never anything the model said about identity. WHICH
//    appointment is the one the agent read back: its wall-clock start
//    (`from`) and its services, as find_appointment / my_appointments gave
//    them (two orders can share a minute). The write acts only on this
//    customer's own open appointment at exactly that minute, in this org;
//    there is none, it is "appointment-changed" and nothing moves. When what
//    was named fits more than one, the agent is asked which
//    ("appointment-ambiguous", with the list), never left to the write.
//    It used to act on whatever was NEXT when the write landed, so a repeated
//    cancel (a provider retry, a second "yes") cancelled the appointment
//    after the one meant, and "book Wednesday, then cancel Friday" cancelled
//    the new Wednesday (review, same day). A repeat is now a no-op answer:
//    the appointment at `from` is already cancelled, or already moved to
//    `to`, and the agent is told so.
//
// 2. THE CALENDAR AT THE MOMENT OF THE CHANGE. A move re-runs the booking
//    page's own rules (booking.ts) in the same transaction that writes it:
//    the span fits that day's hours, no closure, capacity with the appointment
//    not blocking itself, no clash with the customer's other bookings, a
//    good's lead time. What check_availability said a minute ago is a hint;
//    this is the answer. It used to check only that the start was not in the
//    past and fell inside opening hours, so a move could land on a full slot.
//
// 3. SIX A DAY. customers.agentChangesAt counts every change an assistant
//    makes for this customer (lib/agentChange.ts). Past it, moves, cancels
//    and (retell.bookingProblem) new bookings are refused and handed over.
//
// A provider-owned booking (an externalUid with cal.com connected) belongs to
// the parked cal.com lane: cal.com is told FIRST and holds the inventory. The
// lanes check ownership, the cap and the opening hours before calling it, and
// then write here with `providerConfirmed`, which skips the capacity half and
// the re-checks that already ran. Refusing locally after cal.com has moved
// the booking would leave the two calendars telling different stories.

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { cancelBooking, rescheduleBooking } from "./lib/calcomApi";
import {
  CHANGES_PER_DAY,
  REPEAT_WINDOW_MS,
  changesToday,
  sameServiceNames,
  withChange,
  type ChangeRefusal,
} from "./lib/agentChange";
import { cancelAppointment, rescheduleAppointment } from "./appointments";
import {
  activeRowsAround,
  fitsOpenHours,
  goodsLeadMs,
  orgCapacity,
  overlapCount,
} from "./booking";
import {
  closureBlocks,
  getLocalPartsSafe,
  hasBusinessHours,
  sameMinute,
} from "./lib/businessHours";
import { loadClosures } from "./lib/closureRows";
import { customerConflict } from "./lib/overlap";
import { recordActivity, statusChange } from "./lib/activity";
import { lifecycleReaches } from "./lib/lifecycleSend";

// The agents' own tolerances, the same two numbers their booking guards use:
// a start a few minutes behind the clock is someone finishing a sentence, and
// nothing a salon books is more than a year out.
const PAST_GRACE_MS = 5 * 60_000;
const MAX_AHEAD_MS = 400 * 24 * 60 * 60_000;

const OPEN: Doc<"appointments">["status"][] = ["scheduled", "confirmed"];

type ReadCtx = Pick<QueryCtx, "db">;

// The visit's length, the formula the manage page uses: the stored duration,
// else its lines, else the legacy half hour. A good is an explicit 0.
export function durationOf(appointment: Doc<"appointments">): number {
  return (
    appointment.durationMinutes ??
    appointment.items?.reduce((sum, item) => sum + item.durationMinutes, 0) ??
    30
  );
}

// Whether cal.com holds this booking. Only the API key matters here: it is
// all the lanes need to move or cancel a booking cal.com already has.
export function providerOwned(
  appointment: Pick<Doc<"appointments">, "externalUid">,
  org: Pick<Doc<"orgs">, "calcomApiKey">,
): boolean {
  return Boolean(appointment.externalUid && org.calcomApiKey);
}

async function customerIn(
  ctx: ReadCtx,
  orgId: Id<"orgs">,
  customerId: Id<"customers">,
): Promise<Doc<"customers"> | null> {
  const customer = await ctx.db.get(customerId);
  return customer && customer.orgId === orgId ? customer : null;
}

// The customer's open appointments still to come, soonest first. The org is
// checked per row as well as through the customer: a customer belongs to one
// org, and this is the read every write below trusts.
async function upcomingOf(
  ctx: ReadCtx,
  customer: Doc<"customers">,
  now: number,
): Promise<Doc<"appointments">[]> {
  const rows = await ctx.db
    .query("appointments")
    .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
    .collect();
  return rows
    .filter(
      (row) =>
        row.orgId === customer.orgId &&
        row.startAt > now &&
        OPEN.includes(row.status),
    )
    .sort((a, b) => a.startAt - b.startAt);
}

const ownNextValidator = v.object({
  next: v.union(
    v.null(),
    v.object({
      appointmentId: v.id("appointments"),
      startAt: v.number(),
      durationMinutes: v.number(),
      services: v.array(v.string()),
      externalUid: v.optional(v.string()),
    }),
  ),
  // Open appointments after the next one: out of the agents' reach, said so
  // to the customer rather than discovered by them.
  later: v.number(),
  // The newest change an assistant made for this customer: an engine
  // published before appointment_start existed (template < 14) can only name
  // "the next one", and is refused straight after a change rather than
  // handed the appointment after it. The daily cap is not read from here:
  // it is judged with the change itself, after a repeat is recognised.
  lastChangeAt: v.union(v.number(), v.null()),
  // For the team's "needs a person" email, so it names who.
  customerName: v.string(),
});

// The customer's own next appointment, for find / my_appointments and as the
// target every move and cancel starts from. Read fresh on every tool call: an
// appointment the agent itself booked a moment ago must be visible to the
// cancel that follows it.
export const ownNext = internalQuery({
  args: { orgId: v.id("orgs"), customerId: v.id("customers") },
  returns: ownNextValidator,
  handler: async (ctx, args) => {
    const customer = await customerIn(ctx, args.orgId, args.customerId);
    if (!customer) {
      return {
        next: null,
        later: 0,
        lastChangeAt: null,
        customerName: "",
      };
    }
    const now = Date.now();
    const rows = await upcomingOf(ctx, customer, now);
    const next = rows[0];
    return {
      next: next
        ? {
            appointmentId: next._id,
            startAt: next.startAt,
            durationMinutes: durationOf(next),
            services: (next.items ?? []).map((item) => item.name),
            ...(next.externalUid ? { externalUid: next.externalUid } : {}),
          }
        : null,
      later: Math.max(0, rows.length - 1),
      lastChangeAt: Math.max(0, ...(customer.agentChangesAt ?? [])) || null,
      customerName:
        [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
        customer.phone,
    };
  },
});

// One of the customer's appointments at the minute named, as the agent is
// shown it when it has to ask which one was meant.
export type Choice = { services: string[]; cancelled?: boolean };
const choiceValidator = v.object({
  services: v.array(v.string()),
  cancelled: v.optional(v.boolean()),
});

type Target =
  | { ok: true; customer: Doc<"customers">; appointment: Doc<"appointments"> }
  | {
      ok: false;
      reason: ChangeRefusal;
      // What sits at `from` and `to` when the target is not there: how a
      // repeated cancel or move is told apart from one that came too late.
      cancelledAtFrom?: boolean;
      openAtTo?: boolean;
      // appointment-ambiguous: what is booked at `from`, to ask from.
      choices?: Choice[];
    };

// The services an appointment holds, by the names the agents read back.
function servicesOf(row: Doc<"appointments">): string[] {
  return (row.items ?? []).map((item) => item.name);
}

// This customer's rows in this org that start in `at`'s minute.
async function rowsAt(
  ctx: ReadCtx,
  customer: Doc<"customers">,
  at: number,
): Promise<Doc<"appointments">[]> {
  const rows = await ctx.db
    .query("appointments")
    .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
    .collect();
  return rows.filter((row) => row.orgId === customer.orgId && sameMinute(row.startAt, at));
}

// Rule 1 and rule 3, in that order: a repeat (nothing open at `from` any
// more) is recognised before the cap is counted, so a provider retry or a
// second "yes" is answered "already done" and never meets the cap. `strict`
// is everything but a provider-confirmed write, whose caller already ran
// these checks (checkChange) before cal.com acted.
//
// WHICH, by the start AND the services the agent read back (2026-10-13). A
// minute does not name one appointment: two orders for 10:00 share it, and
// the write used to act on whichever row came first, so a repeated cancel of
// the cake cancelled the bread. Services that match nothing at that minute
// are read as not given (a model paraphrasing a name), and then the minute
// alone must be unambiguous: one open appointment there, and, straight
// after a change (REPEAT_WINDOW_MS, the drafts' own one-change-per-minute
// rule in time), nothing beside it that the change could have been about.
// Anything else is asked about, never picked.
async function ownTarget(
  ctx: ReadCtx,
  args: {
    orgId: Id<"orgs">;
    customerId: Id<"customers">;
    from: number;
    // The services the agent read back with the start, when it gave them.
    services?: string[];
    // A move's destination, so a repeated move can be recognised.
    to?: number;
  },
  now: number,
  strict: boolean,
): Promise<Target> {
  const customer = await customerIn(ctx, args.orgId, args.customerId);
  if (!customer) return { ok: false, reason: "not-found" };
  const atFrom = await rowsAt(ctx, customer, args.from);
  const services = args.services;
  const named = services
    ? atFrom.filter((row) => sameServiceNames(servicesOf(row), services))
    : [];
  const exact = named.length > 0;
  const pool = exact ? named : atFrom;
  const open = pool.filter(
    (row) => OPEN.includes(row.status) && (!strict || row.startAt > now),
  );
  const openAtTo =
    args.to !== undefined &&
    (await rowsAt(ctx, customer, args.to)).some(
      (row) =>
        OPEN.includes(row.status) &&
        (!exact || sameServiceNames(servicesOf(row), services ?? [])),
    );
  if (open.length === 0) {
    return {
      ok: false,
      reason: "appointment-changed",
      cancelledAtFrom: pool.some((row) => row.status === "cancelled"),
      openAtTo,
    };
  }
  if (exact && open.length > 1) {
    // Identical twins: no words the agent could say tell them apart.
    return { ok: false, reason: "appointment-duplicate" };
  }
  if (!exact) {
    const lastChange = Math.max(0, ...(customer.agentChangesAt ?? []));
    const justChanged = now - lastChange < REPEAT_WINDOW_MS;
    if (
      open.length > 1 ||
      (justChanged && (atFrom.length > 1 || openAtTo))
    ) {
      return {
        ok: false,
        reason: "appointment-ambiguous",
        choices: atFrom
          .filter((row) => OPEN.includes(row.status) || row.status === "cancelled")
          .map((row) => ({
            services: servicesOf(row),
            ...(row.status === "cancelled" ? { cancelled: true } : {}),
          })),
      };
    }
  }
  if (strict && changesToday(customer.agentChangesAt, now) >= CHANGES_PER_DAY) {
    return { ok: false, reason: "too-many-changes" };
  }
  return { ok: true, customer, appointment: open[0] };
}

// Rule 2: could THIS appointment start at `startAt`, judged now. The booking
// page's reschedule (booking.reschedule) asks the same questions in the same
// order, through the same helpers.
//
// One deliberate difference: an org that never set opening hours has no
// window to fit, so only its closures bind. The page refuses outright there
// (it cannot draw a grid), but the agents have always booked such a business
// at any time, and a move must not become impossible where a booking is not.
async function moveRefusal(
  ctx: ReadCtx,
  org: Doc<"orgs">,
  appointment: Doc<"appointments">,
  startAt: number,
  now: number,
  skipCapacity: boolean,
): Promise<ChangeRefusal | null> {
  if (startAt < now - PAST_GRACE_MS) return "past";
  if (startAt > now + MAX_AHEAD_MS) return "too-far";
  const duration = durationOf(appointment);
  const leadMs = await goodsLeadMs(ctx, appointment);
  if (leadMs > 0 && startAt < now + leadMs) return "lead-time";
  const closures = await loadClosures(ctx, org._id);
  if (org.businessHours && hasBusinessHours(org.businessHours)) {
    if (!fitsOpenHours(org, startAt, duration, closures)) return "outside-open-hours";
  } else {
    const at = getLocalPartsSafe(startAt, org.timezone);
    if (closureBlocks(closures, at, at.minutesOfDay, at.minutesOfDay + duration)) {
      return "outside-open-hours";
    }
  }
  if (skipCapacity) return null;
  const rows = await activeRowsAround(
    ctx,
    org._id,
    startAt,
    startAt + duration * 60_000,
  );
  // The appointment being moved must not block its own new slot.
  if (overlapCount(rows, startAt, duration, appointment._id) >= (await orgCapacity(ctx, org._id))) {
    return "slot-taken";
  }
  if (customerConflict(rows, appointment.customerId, startAt, duration, appointment._id)) {
    return "customer-busy";
  }
  return null;
}

// Where a change's message must reach the customer for `notified` to say it
// will (lib/lifecycleSend.lifecycleReaches).
type Reach = "whatsapp" | "any";
const reachValidator = v.union(v.literal("whatsapp"), v.literal("any"));

const targetArgs = {
  orgId: v.id("orgs"),
  customerId: v.id("customers"),
  // The appointment's start as the agent read it back: which one, exactly.
  from: v.number(),
  // Its services as the agent read them back, when it gave them: what tells
  // two appointments at one minute apart.
  services: v.optional(v.array(v.string())),
};

const changeResult = v.union(
  v.object({
    ok: v.literal(true),
    // A message from the business's own rules went to the customer about
    // this change. The chat agent stands down on it, and only on it.
    notified: v.optional(v.boolean()),
    // Nothing to do: a repeat of a change already made (the appointment at
    // `from` is already cancelled, or already moved to `to`).
    noop: v.optional(v.boolean()),
    // checkChange only: the target's cal.com booking, when it has one.
    externalUid: v.optional(v.string()),
  }),
  v.object({
    ok: v.literal(false),
    reason: v.string(),
    // appointment-ambiguous: what is booked at that minute, to ask from.
    choices: v.optional(v.array(choiceValidator)),
  }),
);

export type ChangeResult =
  | { ok: true; notified?: boolean; noop?: boolean; externalUid?: string }
  | { ok: false; reason: string; choices?: Choice[] };

// A target that could not be acted on, as a result: a repeat is "done".
function missed(
  target: Extract<Target, { ok: false }>,
  repeat: boolean | undefined,
): ChangeResult {
  if (repeat) return { ok: true, noop: true };
  return {
    ok: false,
    reason: target.reason,
    ...(target.choices ? { choices: target.choices } : {}),
  };
}

// Everything a change would have to clear, writing nothing: the cal.com
// lane must know a cancel or a move is allowed BEFORE telling cal.com, and a
// repeat is answered as done before the cap is asked (2026-10-13). For a
// provider-owned booking the capacity half of a move is cal.com's to answer.
// `to` absent means a cancel.
export const checkChange = internalQuery({
  args: { ...targetArgs, to: v.optional(v.number()) },
  returns: changeResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const target = await ownTarget(ctx, args, now, true);
    if (!target.ok) {
      return missed(
        target,
        args.to === undefined ? target.cancelledAtFrom : target.openAtTo,
      );
    }
    const uid = target.appointment.externalUid;
    const found = uid ? { externalUid: uid } : {};
    if (args.to === undefined) return { ok: true as const, ...found };
    if (sameMinute(target.appointment.startAt, args.to)) {
      return { ok: true as const, noop: true };
    }
    const org = await ctx.db.get(args.orgId);
    if (!org) return { ok: false as const, reason: "not-found" };
    const refusal = await moveRefusal(
      ctx,
      org,
      target.appointment,
      args.to,
      now,
      providerOwned(target.appointment, org),
    );
    return refusal
      ? { ok: false as const, reason: refusal }
      : { ok: true as const, ...found };
  },
});

// The move, judged and written in ONE transaction, so nothing can take the
// slot between the check and the write. A plain function so a drafted reply's
// changes can run several of these in one transaction (chatAgent); moveOwn
// below is its mutation for the live tools.
export async function moveOwnTx(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    customerId: Id<"customers">;
    from: number;
    services?: string[];
    to: number;
    // cal.com's new uid: its reschedule mints a fresh booking.
    externalUid?: string;
    // cal.com already moved it; see the header.
    providerConfirmed?: boolean;
    // Where `notified` must reach the customer: their WhatsApp conversation
    // for the chat assistant, any channel for the phone agent (default).
    reach?: Reach;
  },
): Promise<ChangeResult> {
  const now = Date.now();
  const confirmed = args.providerConfirmed === true;
  const target = await ownTarget(ctx, args, now, !confirmed);
  // Already where it was asked to go: a repeat, nothing more to do.
  if (!target.ok) return missed(target, target.openAtTo);
  const { customer, appointment } = target;
  if (sameMinute(appointment.startAt, args.to)) return { ok: true, noop: true };
  if (!confirmed) {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { ok: false, reason: "not-found" };
    // A cal.com booking moved without telling cal.com is the fork this
    // module exists to prevent. The lanes never do it; this makes sure.
    if (providerOwned(appointment, org)) return { ok: false, reason: "calendar-error" };
    const refusal = await moveRefusal(ctx, org, appointment, args.to, now, false);
    if (refusal) return { ok: false, reason: refusal };
  }
  const sent = await rescheduleAppointment(ctx, appointment, {
    startAt: args.to,
    externalUid: args.externalUid,
  });
  await ctx.db.patch(customer._id, {
    agentChangesAt: withChange(customer.agentChangesAt, now),
  });
  return {
    ok: true,
    notified:
      sent > 0 &&
      (await lifecycleReaches(ctx, appointment._id, "booking", args.reach ?? "any")),
  };
}

export async function cancelOwnTx(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    customerId: Id<"customers">;
    from: number;
    services?: string[];
    providerConfirmed?: boolean;
    reach?: Reach;
  },
): Promise<ChangeResult> {
  const now = Date.now();
  const confirmed = args.providerConfirmed === true;
  const target = await ownTarget(ctx, args, now, !confirmed);
  // Already cancelled: a repeat, nothing more to do, and never the
  // appointment after it.
  if (!target.ok) return missed(target, target.cancelledAtFrom);
  const { customer, appointment } = target;
  if (!confirmed) {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { ok: false, reason: "not-found" };
    if (providerOwned(appointment, org)) return { ok: false, reason: "calendar-error" };
  }
  // No actor: the customer cancelled, through their assistant. That is
  // exactly the cancellation the team's booking-cancelled alert is for.
  const sent = await cancelAppointment(ctx, appointment);
  // The feed row cancelAppointment writes only for a cancel started inside
  // the salon. An assistant's cancel deserves its own answer to "who
  // cancelled this?", the same row a booking and a move leave.
  await recordActivity(ctx, {
    orgId: appointment.orgId,
    kind: "appointment_status",
    customerId: appointment.customerId,
    appointmentId: appointment._id,
    detail: statusChange(appointment.status, "cancelled"),
  });
  await ctx.db.patch(customer._id, {
    agentChangesAt: withChange(customer.agentChangesAt, now),
  });
  return {
    ok: true,
    notified:
      sent > 0 &&
      (await lifecycleReaches(ctx, appointment._id, "cancellation", args.reach ?? "any")),
  };
}

export const moveOwn = internalMutation({
  args: {
    ...targetArgs,
    to: v.number(),
    externalUid: v.optional(v.string()),
    providerConfirmed: v.optional(v.boolean()),
    reach: v.optional(reachValidator),
  },
  returns: changeResult,
  handler: async (ctx, args) => await moveOwnTx(ctx, args),
});

export const cancelOwn = internalMutation({
  args: {
    ...targetArgs,
    providerConfirmed: v.optional(v.boolean()),
    reach: v.optional(reachValidator),
  },
  returns: changeResult,
  handler: async (ctx, args) => await cancelOwnTx(ctx, args),
});

// The write half of a move or a cancel, from an action: checkChange first
// (which appointment, a repeat answered without asking anyone, the cap, the
// new time), then cal.com when it holds the booking, so it is never told
// about a change we would refuse, then the transaction that re-checks
// everything. Shared by the phone agent's and the chat agent's live tools,
// so the order of those steps exists once. The daily cap is judged in here,
// never before: a lane that counted it first refused a repeat at the cap
// instead of answering "already done".
export async function writeOwnChange(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  a: {
    target: {
      orgId: Id<"orgs">;
      customerId: Id<"customers">;
      from: number;
      services?: string[];
    };
    // The org's cal.com key, only when cal.com is connected.
    calcomApiKey: string | undefined;
    change: { kind: "cancel" } | { kind: "move"; to: number };
    // Who asked, for cal.com's own record of the change.
    via: "phone" | "chat";
  },
): Promise<ChangeResult & { providerError?: string }> {
  // Everything the change must clear, read first: which appointment (and
  // whether this is a repeat), the cap, and for a move its new time. The
  // transaction below asks again; this read is what keeps cal.com from
  // hearing about a change we would refuse.
  const check: ChangeResult = await ctx.runQuery(internal.agentAppointments.checkChange, {
    ...a.target,
    ...(a.change.kind === "move" ? { to: a.change.to } : {}),
  });
  if (!check.ok || check.noop) return check;
  const externalUid = check.externalUid;
  // A booking cal.com holds, on a calendar no longer connected: saying so
  // beats changing our row and letting the two drift apart.
  if (externalUid && !a.calcomApiKey) return { ok: false, reason: "calendar-error" };
  const apiKey = a.calcomApiKey;
  const uid = externalUid && apiKey ? externalUid : undefined;
  // The chat assistant stays quiet only on a message that lands in the
  // customer's WhatsApp conversation; the phone agent may promise any channel.
  const reach: Reach = a.via === "chat" ? "whatsapp" : "any";
  if (a.change.kind === "cancel") {
    if (uid && apiKey) {
      const told = await cancelBooking({
        apiKey,
        uid,
        reason: a.via === "phone" ? "Cancelled by phone" : "Cancelled by chat",
      });
      if (!told.ok) return { ok: false, reason: "calendar-error", providerError: told.reason };
    }
    const done: ChangeResult = await ctx.runMutation(internal.agentAppointments.cancelOwn, {
      ...a.target,
      ...(uid ? { providerConfirmed: true } : {}),
      reach,
    });
    return done;
  }
  const to = a.change.to;
  let newUid: string | undefined;
  if (uid && apiKey) {
    const told = await rescheduleBooking({
      apiKey,
      uid,
      startIso: new Date(to).toISOString(),
      reason: a.via === "phone" ? "Rescheduled by phone" : "Rescheduled by chat",
    });
    if (!told.ok) return { ok: false, reason: "calendar-error", providerError: told.reason };
    // cal.com minted a new booking; carry its uid or the next cancel 404s.
    newUid = told.uid;
  }
  const done: ChangeResult = await ctx.runMutation(internal.agentAppointments.moveOwn, {
    ...a.target,
    to,
    ...(newUid ? { externalUid: newUid } : {}),
    ...(uid ? { providerConfirmed: true } : {}),
    reach,
  });
  return done;
}
