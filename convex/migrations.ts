import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// One-shot (2026-07-25): backfill memberships for users created before the
// workspace model. Run: npx convex run migrations:backfillMemberships
export const backfillMemberships = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let created = 0;
    for (const user of users) {
      if (!user.orgId) continue;
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", user._id).eq("orgId", user.orgId!),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("memberships", {
        userId: user._id,
        orgId: user.orgId,
        role: user.role ?? "owner",
      });
      created++;
    }
    return created;
  },
});

// One-shot (2026-07-26): appointments.staffName was free text and the week view
// grouped its columns on it, so "Hülya" and "Hülya " were two stylists. Creates
// one staff row per distinct trimmed name per org (case/accent-insensitive) and
// points every appointment at it. Idempotent: reuses a matching row if the
// migration is run twice, and leaves staffName in place so a rollback still
// renders. Run: npx convex run migrations:backfillStaff
export const backfillStaff = internalMutation({
  args: {},
  returns: v.object({ staffCreated: v.number(), appointmentsLinked: v.number() }),
  handler: async (ctx) => {
    const appointments = await ctx.db.query("appointments").collect();
    let staffCreated = 0;
    let appointmentsLinked = 0;
    // orgId -> normalised name -> staff id, built as we go so two appointments
    // with the same stylist share one row.
    const byOrg = new Map<string, Map<string, Id<"staff">>>();

    for (const appointment of appointments) {
      if (appointment.staffId) continue;
      const name = appointment.staffName?.trim();
      if (!name) continue;
      const orgKey = appointment.orgId as string;
      let cache = byOrg.get(orgKey);
      if (!cache) {
        cache = new Map();
        const existing = await ctx.db
          .query("staff")
          .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
          .collect();
        for (const row of existing) cache.set(normalise(row.name), row._id);
        byOrg.set(orgKey, cache);
      }
      const key = normalise(name);
      let staffId = cache.get(key);
      if (!staffId) {
        staffId = await ctx.db.insert("staff", {
          orgId: appointment.orgId,
          name,
          active: true,
          order: cache.size,
        });
        cache.set(key, staffId);
        staffCreated += 1;
      }
      await ctx.db.patch(appointment._id, { staffId });
      appointmentsLinked += 1;
    }
    return { staffCreated, appointmentsLinked };
  },
});

// Trailing space, casing and Turkish dotted-I all collapse to one person.
function normalise(name: string): string {
  return name.trim().toLocaleLowerCase("tr");
}

// One-shot (2026-07-26): appointments held ONE serviceId; they now hold `items`,
// a list of snapshotted lines, so a haircut plus a beard trim is one visit
// rather than two bookings. Copies each row's service into a single line,
// snapshotting the name, the duration and today's list price.
//
// Today's list price is the honest best guess for a booking made before prices
// existed — there is no record of what was actually charged, and leaving it
// unpriced would be indistinguishable from a visit somebody chose not to
// price. Anyone who cares can correct the line.
//
// Idempotent: rows that already carry items are skipped.
// Run: npx convex run migrations:backfillItems
export const backfillItems = internalMutation({
  args: {},
  returns: v.object({ migrated: v.number(), skipped: v.number() }),
  handler: async (ctx) => {
    const appointments = await ctx.db.query("appointments").collect();
    let migrated = 0;
    let skipped = 0;
    for (const appointment of appointments) {
      if (appointment.items !== undefined) {
        skipped++;
        continue;
      }
      if (!appointment.serviceId) {
        // An appointment with no service at all becomes an empty line set, not
        // a missing one — "we looked and there was nothing" is a finished
        // migration, and it keeps the reader off the legacy column.
        await ctx.db.patch(appointment._id, { items: [] });
        migrated++;
        continue;
      }
      const service = await ctx.db.get(appointment.serviceId);
      await ctx.db.patch(appointment._id, {
        items: service
          ? [
              {
                serviceId: service._id,
                name: service.name,
                ...(service.price !== undefined ? { price: service.price } : {}),
                durationMinutes: service.durationMinutes,
              },
            ]
          : [],
      });
      migrated++;
    }
    return { migrated, skipped };
  },
});
