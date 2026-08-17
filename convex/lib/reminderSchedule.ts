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
// Every scheduled rule shares ONE field. The cron's question is the same for
// all of them — who is due? — and re-deriving from the row says which rule is
// owed, so a field per trigger would buy nothing but more things to sync.
//
// ── TWO SOURCES OF TRUTH, ONE AT A TIME ─────────────────────────────────────
//
// An org with rulesMigratedAt set is driven by its messageRules rows; an org
// without it still runs on the legacy trio (reminderOffsetsHours +
// pausedReminderHours, winbackEnabled, removedRules). Both paths live here so
// nothing anywhere else has to know the rollout is in progress; the legacy
// half dies with the legacy fields once every org carries the marker.
//
// ── THE RULE FOR CALL SITES ─────────────────────────────────────────────────
//
// Any mutation that changes startAt, durationMinutes, status, sentRuleIds,
// reminderSentOffsets or winbackSentAt must call
// syncAppointmentSchedule(ctx, appointmentId) AFTER its patch lands.
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

const HOUR_MS = 3600_000;

type DueKind = "reminder" | "winback" | "followup";

// What the cron needs to dispatch a due send without re-deriving anything:
// the kind names the template bucket and the log row, ruleId (rules path
// only) carries the channel and the per-rule wording, offsetHours keys the
// LEGACY double-send stamp. A legacy due has no ruleId; that absence is how
// the tick knows which guard to stamp.
export type NextMessage = {
  at: number;
  kind: DueKind;
  ruleId?: Id<"messageRules">;
  offsetHours?: number;
};

// Statuses that still expect a reminder. A cancelled booking obviously wants
// none; a completed one happened and is finished with.
function wantsReminders(status: Doc<"appointments">["status"]): boolean {
  return status === "scheduled" || status === "confirmed";
}

// ── The rules path ──────────────────────────────────────────────────────────
//
// A due time already in the past is returned as-is rather than dropped: an
// appointment booked two hours before it starts, on an org that reminds at
// 24h, has a 24h reminder that came due before the booking existed. The cron
// treats "due in the past" as "due now" and sends once, which is what the
// salon means by a reminder.
function nextFromRules(
  appointment: Doc<"appointments">,
  rules: Doc<"messageRules">[],
): NextMessage | undefined {
  const sentIds = appointment.sentRuleIds ?? [];
  const sentOffsets = appointment.reminderSentOffsets ?? [];
  let earliest: NextMessage | undefined;

  for (const rule of rules) {
    if (rule.paused) continue;
    if (sentIds.includes(rule._id)) continue;

    let at: number | undefined;
    if (rule.trigger === "before_start") {
      if (!wantsReminders(appointment.status)) continue;
      // Nothing to remind anyone about once the appointment has started.
      // The sender checks this too; skipping here keeps started bookings out
      // of the cron's read entirely.
      if (appointment.startAt <= Date.now()) continue;
      // The legacy stamp, keyed by hour: an appointment half-reminded before
      // the migration must not get the same reminder again from the row that
      // replaced its offset.
      if (sentOffsets.includes(rule.offsetHours)) continue;
      at = appointment.startAt - rule.offsetHours * HOUR_MS;
    } else if (rule.trigger === "after_end") {
      // Only a visit that HAPPENED earns a follow-up — never a no-show,
      // never a cancellation.
      if (appointment.status !== "completed") continue;
      at =
        appointment.startAt +
        (appointment.durationMinutes ?? 0) * 60_000 +
        rule.offsetHours * HOUR_MS;
      // A follow-up rule applies forward, never backward: without this, adding
      // one schedules a "thanks for visiting" to every appointment completed
      // in the 90 days the backfill can see, which is a mass send nobody asked
      // for. Winback deliberately lacks this guard — switching it on has
      // always meant "including recent no-shows", and parity with that
      // behaviour is the point.
      if (at < rule._creationTime) continue;
    } else if (rule.trigger === "no_show") {
      if (appointment.status !== "no_show") continue;
      // The legacy one-shot marker, same job as sentOffsets above.
      if (appointment.winbackSentAt !== undefined) continue;
      at = appointment.startAt + rule.offsetHours * HOUR_MS;
    } else {
      // booking / cancellation fire from the mutation that causes them, not
      // from the cron — they have no due time to store.
      continue;
    }

    if (earliest === undefined || at < earliest.at) {
      earliest = {
        at,
        kind:
          rule.trigger === "before_start"
            ? "reminder"
            : rule.trigger === "after_end"
              ? "followup"
              : "winback",
        ruleId: rule._id,
        offsetHours: rule.offsetHours,
      };
    }
  }
  return earliest;
}

// ── The legacy path used to live here ───────────────────────────────────────
//
// nextReminder and winbackDueAt are gone. They read org.reminderOffsetsHours,
// pausedReminderHours, removedRules, winbackEnabled and winbackDaysAfter, and
// appointment.reminderSentOffsets — the pre-messageRules model. Every org is on
// rules now (messageRules:migrateAll, run in prod 2026-08-17) and
// seedDefaultRules stamps new ones at creation, so nothing reached them.
//
// The FIELDS stay in the schema on purpose. Dropping a column is the one part of
// this that cannot be undone by reverting a commit, and they are cheap to leave:
// unread, optional, and the honest record of what those orgs were configured
// with before the migration. Delete them in their own change, once this one has
// lived in prod for a while.

// What this appointment owes and when, or undefined for "nothing".
//
// Zero is a legal timestamp in principle and an impossible one here, but the
// cron's index range starts above zero to skip unset rows — so a due time of
// exactly 0 would read as "nothing owed". Nudged to 1 rather than left as a
// value that means one thing to this file and another to the query.
export function computeNextMessage(
  appointment: Doc<"appointments">,
  org: Doc<"orgs"> | null,
  rules: Doc<"messageRules">[],
): NextMessage | undefined {
  if (!org) return undefined;
  // One engine. This used to fork on org.rulesMigratedAt, with the legacy
  // reminderOffsetsHours / pausedReminderHours / removedRules / winbackEnabled
  // fields driving a second, fully-maintained implementation of the same
  // question — forked again in syncAppointmentSchedule, three times in
  // reminders.ts, once in appointments.ts, and once more as a duplicate card in
  // RemindersView. Any change to when a message fires had to be made twice or
  // the two halves disagreed for whichever orgs sat on the other side, and new
  // orgs could not exercise the legacy path at all because seedDefaultRules
  // stamps them migrated at creation. messageRules:migrateAll has run in prod
  // (Serdar, 2026-08-17), so every org is on rules and the other half is gone.
  const next = nextFromRules(appointment, rules);
  if (!next) return undefined;
  return { ...next, at: next.at === 0 ? 1 : next.at };
}

// The org's rules, for feeding computeNextMessage. Callers that walk many
// appointments of one org should load these once and reuse them.
export async function loadOrgRules(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
): Promise<Doc<"messageRules">[]> {
  return await ctx.db
    .query("messageRules")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
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
  const rules = org ? await loadOrgRules(ctx, appointment.orgId) : [];
  const next = computeNextMessage(appointment, org, rules)?.at;
  if (appointment.nextMessageAt !== next) {
    await ctx.db.patch(appointmentId, { nextMessageAt: next });
  }
  return next;
}
