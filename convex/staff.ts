import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";

// Who delivers the appointment. Replaces the free-text appointments.staffName:
// the week view groups its columns on that value, so a trailing space made a
// second stylist, and renaming somebody meant editing every appointment they
// had. See the schema comment for why calcomHostId is present but unused.

const staffRow = v.object({
  _id: v.id("staff"),
  name: v.string(),
  active: v.boolean(),
  order: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(staffRow),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((row) => ({
        _id: row._id,
        name: row.name,
        active: row.active,
        order: row.order,
      }));
  },
});

export const add = mutation({
  args: { name: v.string() },
  returns: v.union(v.null(), v.id("staff")),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const name = args.name.trim();
    if (!name) return null;
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    // Case-insensitive: the whole point of this table is that one person is one
    // row, and "hülya" typed twice must not become two lanes on the calendar.
    const duplicate = existing.find(
      (row) => row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
    );
    if (duplicate) return duplicate._id;
    return await ctx.db.insert("staff", {
      orgId,
      name,
      active: true,
      order: existing.length,
    });
  },
});

export const rename = mutation({
  args: { staffId: v.id("staff"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.staffId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    const name = args.name.trim();
    // Renaming is now one write instead of a scan over every appointment —
    // which is the reason this table exists.
    if (name) await ctx.db.patch(args.staffId, { name });
    return null;
  },
});

export const setActive = mutation({
  args: { staffId: v.id("staff"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.staffId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    // Deactivate rather than delete: somebody who left still did the work on
    // last month's appointments, and those rows must keep pointing at a name.
    await ctx.db.patch(args.staffId, { active: args.active });
    return null;
  },
});

// The counterpart to that rule, and not a contradiction of it. What
// deactivating protects is HISTORY — a name an old appointment still points
// at. Somebody who has never appeared on one has no history to protect, and a
// misspelt duplicate you can only ever hide is its own kind of wrong: the
// roster grows a row nobody can explain and nobody can remove.
//
// So the guard is the actual question, asked directly: is this person on any
// appointment. If they are, deactivating remains the answer and the error says
// so. Removing the row also drops its login LINK, never the login itself —
// that is a membership, and it keeps its own row in the list.
export const remove = mutation({
  args: { staffId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.staffId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    const booked = await ctx.db
      .query("appointments")
      .withIndex("by_org_staff", (q) =>
        q.eq("orgId", orgId).eq("staffId", args.staffId),
      )
      .first();
    if (booked) throw new Error("staff-has-appointments");
    await ctx.db.delete(args.staffId);
    return null;
  },
});
