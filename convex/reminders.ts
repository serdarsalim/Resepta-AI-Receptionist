import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { DEFAULT_QUIET_HOURS, DEFAULT_REMINDER_OFFSETS } from "./orgs";
import type { Doc, Id } from "./_generated/dataModel";

// Offsets are capped at 168h in orgs.update, so everything that could be due
// starts within the next week.
const HORIZON_MS = 168 * 3600_000;
const DAY_MS = 24 * 3600_000;
// Winback looks back at most this far for no_shows still worth chasing.
const WINBACK_LOOKBACK_MS = 45 * DAY_MS;

// Local hour (0–23) in the org's timezone; on a bad zone fall back to UTC.
function hourInZone(now: number, timezone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date(now)),
    );
  } catch {
    return new Date(now).getUTCHours();
  }
}

function insideSendWindow(org: Doc<"orgs">, now: number): boolean {
  const start = org.quietHoursStart ?? DEFAULT_QUIET_HOURS[0];
  const end = org.quietHoursEnd ?? DEFAULT_QUIET_HOURS[1];
  const hour = hourInZone(now, org.timezone);
  return hour >= start && hour < end;
}

// Cron tick (5 min): reminders due now + winbacks due today. Both stamp the
// sent marker BEFORE scheduling the send — that ordering is the double-send
// guard across overlapping ticks (same idea as markNumberSent-at-claim-time
// in Nudge). Reminders held by the send window simply stay unstamped; the
// first tick inside the window dispatches them.
//
// Scan bound: two indexed range reads capped at 1000/200 per tick. Fine for
// hundreds of salons; shard by startAt window before anything fancier.
export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orgCache = new Map<Id<"orgs">, Doc<"orgs"> | null>();
    const orgOf = async (orgId: Id<"orgs">) => {
      let org = orgCache.get(orgId);
      if (org === undefined) {
        org = await ctx.db.get(orgId);
        orgCache.set(orgId, org);
      }
      return org;
    };

    // ---- Reminders ----
    const upcoming = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) => q.gt("startAt", now).lt("startAt", now + HORIZON_MS))
      .take(1000);
    for (const appointment of upcoming) {
      if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
        continue;
      }
      const org = await orgOf(appointment.orgId);
      if (!org || !insideSendWindow(org, now)) continue;
      const offsets = org.reminderOffsetsHours ?? DEFAULT_REMINDER_OFFSETS;
      const sent = appointment.reminderSentOffsets ?? [];
      for (const offset of offsets) {
        if (sent.includes(offset)) continue;
        if (appointment.startAt - offset * 3600_000 > now) continue;
        await ctx.db.patch(appointment._id, {
          reminderSentOffsets: [...sent, offset],
        });
        await ctx.scheduler.runAfter(0, internal.wa.sendAppointmentMessage, {
          appointmentId: appointment._id,
          kind: "reminder",
          offsetHours: offset,
        });
        break; // one reminder per appointment per tick; the next offset waits
      }
    }

    // ---- No-show winback ----
    const past = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) =>
        q.gt("startAt", now - WINBACK_LOOKBACK_MS).lt("startAt", now),
      )
      .take(200);
    for (const appointment of past) {
      if (appointment.status !== "no_show" || appointment.winbackSentAt) continue;
      const org = await orgOf(appointment.orgId);
      if (!org || !(org.winbackEnabled ?? false)) continue;
      if (!insideSendWindow(org, now)) continue;
      const dueAt = appointment.startAt + (org.winbackDaysAfter ?? 14) * DAY_MS;
      if (dueAt > now) continue;
      await ctx.db.patch(appointment._id, { winbackSentAt: now });
      await ctx.scheduler.runAfter(0, internal.wa.sendAppointmentMessage, {
        appointmentId: appointment._id,
        kind: "winback",
      });
    }
    return null;
  },
});
