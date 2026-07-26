// When an appointment next owes the customer a message.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The reminder cron used to answer "what is due?" by reading every appointment
// starting in the next 168 hours, across every org, and capping the read at
// 1000 rows. That is work proportional to how many salons are on the
// deployment rather than to how many reminders are actually due, and the cap
// made it worse than slow: `.take()` truncates in silence, so past roughly
// fifteen orgs the salons sorting last simply stopped getting reminders and
// nothing anywhere said so. The winback sweep had the same shape.
//
// So the due time is computed once, on write, and stored on the appointment.
// The cron then reads an index range and gets back exactly the rows it has to
// act on. Adding the thousandth org costs the tick nothing.
//
// Reminders and winbacks share ONE field. The cron's question is the same for
// both — who is due? — and the status already on the row says which kind is
// owed, so a second field and a second index would buy nothing but a second
// thing to keep in sync.
//
// ── THE RULE FOR CALL SITES ─────────────────────────────────────────────────
//
// Any mutation that changes startAt, status, reminderSentOffsets or
// winbackSentAt must call syncAppointmentSchedule(ctx, appointmentId) AFTER
// its patch lands.
//
// It re-derives the field from scratch rather than adjusting it, so it is
// idempotent — calling it twice, or calling it when nothing changed, is free
// and correct. That matters because the failure mode of forgetting a call site
// is a message that silently never sends, which is the exact bug this file was
// written to kill. Two things defend against it: the recompute is cheap enough
// to call defensively, and reminders.reconcile repairs rows the write paths
// missed.

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { DEFAULT_REMINDER_OFFSETS, DEFAULT_WINBACK_DAYS } from "../orgs";

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

type DueKind = "reminder" | "winback";

// Statuses that still expect a reminder. A cancelled booking obviously wants
// none; a completed one happened and is finished with.
function wantsReminders(status: Doc<"appointments">["status"]): boolean {
  return status === "scheduled" || status === "confirmed";
}

// The earliest offset this appointment has not yet been reminded at, as an
// absolute timestamp.
//
// A due time already in the past is returned as-is rather than dropped: an
// appointment booked two hours before it starts, on an org that reminds at
// 24h, has a 24h reminder that came due before the booking existed. The cron
// treats "due in the past" as "due now" and sends once, which is what the
// salon means by a reminder — the old scan behaved the same way.
function nextReminder(
  appointment: Doc<"appointments">,
  org: Doc<"orgs">,
): { at: number; offsetHours: number } | undefined {
  // Nothing to remind anyone about once the appointment has started. The
  // sender checks this too; clearing the field here keeps started bookings out
  // of the cron's read entirely rather than having it fetch and discard them.
  if (appointment.startAt <= Date.now()) return undefined;
  const offsets = org.reminderOffsetsHours ?? DEFAULT_REMINDER_OFFSETS;
  const sent = appointment.reminderSentOffsets ?? [];
  let earliest: { at: number; offsetHours: number } | undefined;
  for (const offsetHours of offsets) {
    if (sent.includes(offsetHours)) continue;
    const at = appointment.startAt - offsetHours * HOUR_MS;
    if (earliest === undefined || at < earliest.at) earliest = { at, offsetHours };
  }
  return earliest;
}

// A no_show earns one winback, N days later, if the org asked for them.
function winbackDueAt(
  appointment: Doc<"appointments">,
  org: Doc<"orgs">,
): number | undefined {
  if (appointment.status !== "no_show") return undefined;
  if (!(org.winbackEnabled ?? false)) return undefined;
  if (appointment.winbackSentAt !== undefined) return undefined;
  return appointment.startAt + (org.winbackDaysAfter ?? DEFAULT_WINBACK_DAYS) * DAY_MS;
}

// What this appointment owes and when, or undefined for "nothing". The cron
// reads `kind` to pick a send and `offsetHours` to stamp the right marker, so
// nothing downstream has to re-derive which reminder came due.
//
// Zero is a legal timestamp in principle and an impossible one here, but the
// cron's index range starts above zero to skip unset rows — so a due time of
// exactly 0 would read as "nothing owed". Nudged to 1 rather than left as a
// value that means one thing to this file and another to the query.
export function computeNextMessage(
  appointment: Doc<"appointments">,
  org: Doc<"orgs"> | null,
): { at: number; kind: DueKind; offsetHours?: number } | undefined {
  if (!org) return undefined;
  if (wantsReminders(appointment.status)) {
    const next = nextReminder(appointment, org);
    if (!next) return undefined;
    return {
      at: next.at === 0 ? 1 : next.at,
      kind: "reminder",
      offsetHours: next.offsetHours,
    };
  }
  const at = winbackDueAt(appointment, org);
  return at === undefined ? undefined : { at: at === 0 ? 1 : at, kind: "winback" };
}

// Recompute and persist. Returns the value it settled on, mostly so callers
// that want to assert in tests can.
export async function syncAppointmentSchedule(
  ctx: MutationCtx,
  appointmentId: Id<"appointments">,
): Promise<number | undefined> {
  const appointment = await ctx.db.get(appointmentId);
  if (!appointment) return undefined;
  const org = await ctx.db.get(appointment.orgId);
  const next = computeNextMessage(appointment, org)?.at;
  if (appointment.nextMessageAt !== next) {
    await ctx.db.patch(appointmentId, { nextMessageAt: next });
  }
  return next;
}
