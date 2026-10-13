// The business's minimum notice: how soon after the moment of booking an
// appointment may start (2026-10-13, P6 of the Nudge port; Nudge d76a2ad8).
//
// A LEAF with no Convex imports. The booking page, the manage page, both
// assistants (bookings and moves), the staff calendar's verdict and the
// Business card that sets it all read it, so every door measures the same
// window; the browser reads it too, which is why it imports nothing.
//
// Stored as whole hours (orgs.minNoticeHours), with the unit it is SHOWN in
// beside it (orgs.minNoticeUnit, unset = hours): a day is 24 clock hours, and
// the business's own opening hours still decide where the first free time
// lands. Unset is one hour, the floor the booking page had fixed in code
// before the setting existed (booking.ts MIN_NOTICE_MS, which this replaced).
// Zero means none: only the past is refused.
//
// Who it binds: the booking page, the customer's own manage page, the phone
// agent and the WhatsApp assistant. Never the team in the calendar: a person
// at the desk may book anything, and the calendar's verdict tells them when a
// time is inside the window (schedule.slotVerdict).

export const DEFAULT_MIN_NOTICE_HOURS = 1;
// A month, Nudge's cap since it took days.
export const MAX_MIN_NOTICE_HOURS = 30 * 24;

export type NoticeUnit = "hours" | "days";

// A slot offered a moment before the boundary crossed it is still taken:
// refusing a booking the page showed seconds ago reads as the product
// breaking. The booking page's minute of slack, now everyone's.
export const NOTICE_SLACK_MS = 60_000;

export function clampNoticeHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_MIN_NOTICE_HOURS;
  return Math.max(0, Math.min(MAX_MIN_NOTICE_HOURS, Math.round(hours)));
}

export function minNoticeHoursOf(org: { minNoticeHours?: number }): number {
  return org.minNoticeHours === undefined
    ? DEFAULT_MIN_NOTICE_HOURS
    : clampNoticeHours(org.minNoticeHours);
}

export function minNoticeMs(org: { minNoticeHours?: number }): number {
  return minNoticeHoursOf(org) * 60 * 60_000;
}

// The unit the owner set it in. "days" only while the hours are whole days,
// so a stored 36 can never be shown as one and a half days.
export function noticeUnitOf(org: {
  minNoticeHours?: number;
  minNoticeUnit?: NoticeUnit;
}): NoticeUnit {
  const hours = minNoticeHoursOf(org);
  return org.minNoticeUnit === "days" && hours % 24 === 0 ? "days" : "hours";
}

// Is `startAt` sooner than the notice allows, judged at `now`? A notice of
// zero never is: the past is its own question, with its own grace.
export function insideNotice(startAt: number, now: number, noticeMs: number): boolean {
  return noticeMs > 0 && startAt < now + noticeMs - NOTICE_SLACK_MS;
}

// The notice as the assistants' tool answers say it: English, because those
// go to a model that answers in the customer's language. Whole days read as
// days, the way the owner set them (Nudge's noticePhrase).
export function noticePhrase(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "1 day's" : `${days} days'`;
  }
  return hours === 1 ? "1 hour's" : `${hours} hours'`;
}
