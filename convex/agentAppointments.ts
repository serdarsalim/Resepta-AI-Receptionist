// The assistants' hands on a customer's EXISTING appointment: find the next
// one, move it, cancel it. Shared by the phone agent (/retell/functions in
// http.ts) and the WhatsApp assistant (chatAgent.ts) so the two lanes cannot
// disagree about whose appointment they may touch or what a move has to clear
// (2026-10-13, ported from Nudge's meetingTools.ts).
//
// Three rules live here and nowhere else.
//
// 1. WHOSE. Every function takes the org and the customer the CHANNEL
//    resolved: the call leg on the phone, the conversation on WhatsApp. Never
//    anything the model said. The only appointment reachable is that
//    customer's own NEXT open one in that org, and the write re-reads it: it
//    must still belong to them, still be open, still be their next one and
//    still start when the agent said (`from`). Otherwise the answer is
//    "appointment-changed" and the agent looks again, rather than moving
//    whatever happens to be next by the time the write lands.
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
//    makes for this customer (lib/agentChange.ts). A move or a cancel past it
//    is refused; a booking is counted (retell.voiceBook) and never refused.
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
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { cancelBooking, rescheduleBooking } from "./lib/calcomApi";
import {
  CHANGES_PER_DAY,
  changesToday,
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
} from "./lib/businessHours";
import { loadClosures } from "./lib/closureRows";
import { customerConflict } from "./lib/overlap";

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
  // Changes an assistant made for this customer in the trailing day.
  changesToday: v.number(),
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
      return { next: null, later: 0, changesToday: 0, customerName: "" };
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
      changesToday: changesToday(customer.agentChangesAt, now),
      customerName:
        [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
        customer.phone,
    };
  },
});

type Target =
  | { ok: true; customer: Doc<"customers">; appointment: Doc<"appointments"> }
  | { ok: false; reason: ChangeRefusal };

// Rule 1 and rule 3. `strict` is everything but a provider-confirmed write,
// whose caller already ran these checks before cal.com acted.
async function ownTarget(
  ctx: ReadCtx,
  args: {
    orgId: Id<"orgs">;
    customerId: Id<"customers">;
    appointmentId: Id<"appointments">;
    from: number;
  },
  now: number,
  strict: boolean,
): Promise<Target> {
  const customer = await customerIn(ctx, args.orgId, args.customerId);
  if (!customer) return { ok: false, reason: "not-found" };
  const appointment = await ctx.db.get(args.appointmentId);
  if (
    !appointment ||
    appointment.orgId !== args.orgId ||
    appointment.customerId !== customer._id
  ) {
    return { ok: false, reason: "not-found" };
  }
  if (!strict) return { ok: true, customer, appointment };
  const next = (await upcomingOf(ctx, customer, now))[0];
  if (!next || next._id !== appointment._id || appointment.startAt !== args.from) {
    return { ok: false, reason: "appointment-changed" };
  }
  if (changesToday(customer.agentChangesAt, now) >= CHANGES_PER_DAY) {
    return { ok: false, reason: "too-many-changes" };
  }
  return { ok: true, customer, appointment };
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

const targetArgs = {
  orgId: v.id("orgs"),
  customerId: v.id("customers"),
  appointmentId: v.id("appointments"),
  // When the agent was told this appointment starts. A mismatch means it
  // moved since, and the agent is talking about a time that is not booked.
  from: v.number(),
};

const changeResult = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), reason: v.string() }),
);

// Everything a move would have to clear, writing nothing. For a dry run (a
// suggested chat reply records the move instead of making it) and for the
// cal.com lane, which must know a move is allowed BEFORE telling cal.com.
// For a provider-owned booking the capacity half is cal.com's to answer.
export const checkMove = internalQuery({
  args: { ...targetArgs, to: v.number() },
  returns: changeResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const target = await ownTarget(ctx, args, now, true);
    if (!target.ok) return target;
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
    return refusal ? { ok: false as const, reason: refusal } : { ok: true as const };
  },
});

// The move, judged and written in ONE transaction, so nothing can take the
// slot between the check and the write.
export const moveOwn = internalMutation({
  args: {
    ...targetArgs,
    to: v.number(),
    // cal.com's new uid: its reschedule mints a fresh booking.
    externalUid: v.optional(v.string()),
    // cal.com already moved it; see the header.
    providerConfirmed: v.optional(v.boolean()),
  },
  returns: changeResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const confirmed = args.providerConfirmed === true;
    const target = await ownTarget(ctx, args, now, !confirmed);
    if (!target.ok) return target;
    const { customer, appointment } = target;
    // A cancelled row is never brought back by a move, cal.com or not:
    // rescheduleAppointment writes status "scheduled".
    if (!OPEN.includes(appointment.status)) {
      return { ok: false as const, reason: "appointment-changed" };
    }
    if (!confirmed) {
      const org = await ctx.db.get(args.orgId);
      if (!org) return { ok: false as const, reason: "not-found" };
      // A cal.com booking moved without telling cal.com is the fork this
      // module exists to prevent. The lanes never do it; this makes sure.
      if (providerOwned(appointment, org)) {
        return { ok: false as const, reason: "calendar-error" };
      }
      const refusal = await moveRefusal(ctx, org, appointment, args.to, now, false);
      if (refusal) return { ok: false as const, reason: refusal };
    }
    await rescheduleAppointment(ctx, appointment, {
      startAt: args.to,
      externalUid: args.externalUid,
    });
    await ctx.db.patch(customer._id, {
      agentChangesAt: withChange(customer.agentChangesAt, now),
    });
    return { ok: true as const };
  },
});

export const cancelOwn = internalMutation({
  args: { ...targetArgs, providerConfirmed: v.optional(v.boolean()) },
  returns: changeResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const confirmed = args.providerConfirmed === true;
    const target = await ownTarget(ctx, args, now, !confirmed);
    if (!target.ok) return target;
    const { customer, appointment } = target;
    if (!confirmed) {
      const org = await ctx.db.get(args.orgId);
      if (!org) return { ok: false as const, reason: "not-found" };
      if (providerOwned(appointment, org)) {
        return { ok: false as const, reason: "calendar-error" };
      }
    }
    // No actor: the customer cancelled, through their assistant. That is
    // exactly the cancellation the team's booking-cancelled alert is for.
    await cancelAppointment(ctx, appointment);
    await ctx.db.patch(customer._id, {
      agentChangesAt: withChange(customer.agentChangesAt, now),
    });
    return { ok: true as const };
  },
});

// The write half of a move or a cancel, from an action: cal.com first when it
// holds the booking (checkMove before a move, so cal.com is never told about
// a move we would refuse), then the transaction that re-checks everything.
// Shared by the phone agent, the chat agent's live tools and the approval of
// a drafted change, so the order of those steps exists once.
//
// `externalUid` is the booking's, from ownNext; the caller passes the org's
// cal.com key only when cal.com is connected.
type ChangeOutcome = { ok: true } | { ok: false; reason: string; providerError?: string };

export async function writeOwnChange(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  a: {
    target: {
      orgId: Id<"orgs">;
      customerId: Id<"customers">;
      appointmentId: Id<"appointments">;
      from: number;
    };
    externalUid: string | undefined;
    calcomApiKey: string | undefined;
    change: { kind: "cancel" } | { kind: "move"; to: number };
    // Who asked, for cal.com's own record of the change.
    via: "phone" | "chat";
  },
): Promise<ChangeOutcome> {
  // A booking cal.com holds, on a calendar no longer connected: saying so
  // beats changing our row and letting the two drift apart.
  if (a.externalUid && !a.calcomApiKey) return { ok: false, reason: "calendar-error" };
  const apiKey = a.calcomApiKey;
  const uid = a.externalUid && apiKey ? a.externalUid : undefined;
  if (a.change.kind === "cancel") {
    if (uid && apiKey) {
      const told = await cancelBooking({
        apiKey,
        uid,
        reason: a.via === "phone" ? "Cancelled by phone" : "Cancelled by chat",
      });
      if (!told.ok) return { ok: false, reason: "calendar-error", providerError: told.reason };
    }
    const done: { ok: true } | { ok: false; reason: string } = await ctx.runMutation(
      internal.agentAppointments.cancelOwn,
      { ...a.target, ...(uid ? { providerConfirmed: true } : {}) },
    );
    return done;
  }
  const to = a.change.to;
  let newUid: string | undefined;
  if (uid && apiKey) {
    const check: { ok: true } | { ok: false; reason: string } = await ctx.runQuery(
      internal.agentAppointments.checkMove,
      { ...a.target, to },
    );
    if (!check.ok) return check;
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
  const done: { ok: true } | { ok: false; reason: string } = await ctx.runMutation(
    internal.agentAppointments.moveOwn,
    {
      ...a.target,
      to,
      ...(newUid ? { externalUid: newUid } : {}),
      ...(uid ? { providerConfirmed: true } : {}),
    },
  );
  return done;
}
