import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { DEFAULT_REMINDER_OFFSETS } from "./orgs";
import type { Doc, Id } from "./_generated/dataModel";

// Offsets are capped at 168h in orgs.update, so everything that could be due
// starts within the next week.
const HORIZON_MS = 168 * 3600_000;

// Cron tick (5 min): find appointments whose reminder moment has arrived and
// dispatch. The offset is stamped into reminderSentOffsets BEFORE the send is
// scheduled — that ordering is the double-send guard across overlapping ticks
// (same idea as markNumberSent-at-claim-time in Nudge).
//
// Scan bound: one indexed range read over ALL orgs' next-week appointments,
// capped at 1000/tick. Fine for hundreds of salons; if the fleet outgrows it,
// shard by startAt window before reaching for anything fancier.
export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const upcoming = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) => q.gt("startAt", now).lt("startAt", now + HORIZON_MS))
      .take(1000);

    const orgCache = new Map<Id<"orgs">, Doc<"orgs"> | null>();
    for (const appointment of upcoming) {
      if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
        continue;
      }
      let org = orgCache.get(appointment.orgId);
      if (org === undefined) {
        org = await ctx.db.get(appointment.orgId);
        orgCache.set(appointment.orgId, org);
      }
      if (!org) continue;
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
    return null;
  },
});
