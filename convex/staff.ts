import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { isStaffColorKey, loadStaffColors } from "./lib/staffColors";

// Who delivers the appointment. Replaces the free-text appointments.staffName:
// the week view groups its columns on that value, so a trailing space made a
// second stylist, and renaming somebody meant editing every appointment they
// had. See the schema comment for why calcomHostId is present but unused.

const staffRow = v.object({
  _id: v.id("staff"),
  name: v.string(),
  active: v.boolean(),
  order: v.number(),
  // The RESOLVED colour key (lib/staffColors.ts), never absent: what the
  // calendar draws this person's bookings in, chosen or not.
  color: v.string(),
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
    const colors = await loadStaffColors(ctx, orgId);
    return rows
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((row) => ({
        _id: row._id,
        name: row.name,
        active: row.active,
        order: row.order,
        color: colors.get(row._id) ?? "lavender",
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

// Writes every unset colour as it resolves RIGHT NOW, before a change that
// would move it. Resolution hands out "the first colour nobody has", so a
// choice frees the chooser's old colour and a deletion frees the deleted
// person's, and the next unset person in line would take it: one owner
// picking a colour for Ayşe would repaint Mehmet. Freezing first makes a
// choice or a deletion touch exactly the one person it names. Adding someone
// needs no freeze: the newest row takes what is left and moves nobody.
async function freezeStaffColors(ctx: MutationCtx, orgId: Id<"orgs">) {
  const colors = await loadStaffColors(ctx, orgId);
  const rows = await ctx.db
    .query("staff")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(500);
  for (const row of rows) {
    const key = colors.get(row._id);
    if (row.color === undefined && key) await ctx.db.patch(row._id, { color: key });
  }
}

// A person's calendar colour, from the dot before their name on the Team card
// or the calendar's side panel. Owner-only, like every other edit to a person.
// A colour an ACTIVE colleague in this business holds, chosen or resolved, is
// refused: telling two people's bookings apart is the colour's only job, and
// the picker already greys those out, so this is the backstop for a stale
// screen. A deactivated person's colour may be taken (lib/staffColors.ts says
// why). A refusal is returned, not thrown, so the picker can say which.
export const setColor = mutation({
  args: { staffId: v.id("staff"), color: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), code: v.union(v.literal("bad-color"), v.literal("color-taken")) }),
  ),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.staffId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    if (!isStaffColorKey(args.color)) return { ok: false as const, code: "bad-color" as const };
    const colors = await loadStaffColors(ctx, orgId);
    for (const [other, key] of colors) {
      if (other === args.staffId || key !== args.color) continue;
      const holder = await ctx.db.get(other as Id<"staff">);
      if (holder?.active) return { ok: false as const, code: "color-taken" as const };
    }
    await freezeStaffColors(ctx, orgId);
    await ctx.db.patch(args.staffId, { color: args.color });
    return { ok: true as const };
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
    // Back on the team with a CHOSEN colour that an active colleague picked
    // while they were away: theirs is dropped and resolves afresh, so two
    // people at work never share a colour.
    if (args.active && !row.active && row.color) {
      const colors = await loadStaffColors(ctx, orgId);
      for (const [other, key] of colors) {
        if (other === args.staffId || key !== row.color) continue;
        const holder = await ctx.db.get(other as Id<"staff">);
        if (holder?.active) {
          await ctx.db.patch(args.staffId, { color: undefined });
          break;
        }
      }
    }
    return null;
  },
});

// Deleting is the second step of a two-step move, and deactivating is the
// first. That ordering is the whole safety model here: switching Bookable off
// is instant, reversible and stops any further damage, so by the time anybody
// reaches this the person is already out of the booking flow and the decision
// has been made twice.
//
// Appointment history does NOT block it. It was tried that way and it was
// wrong: a name is not worth making a row permanent, and the salon that wants
// a duplicate gone knows better than this function whether the old bookings
// still matter. What history costs is stated in the confirmation instead —
// `roster` reports hasAppointments so the warning can name the consequence
// before it happens rather than refusing after.
//
// Removing the row drops its login LINK, never the login itself: that is a
// membership, and it keeps its own row in the list.
// Same shape as contactFields.reorder, and it moves the same thing twice: this
// list's row order IS the calendar's column order, so dragging somebody up
// here moves their column in the week view too. That is the point — the order
// people are listed in should be the order they stand in.
export const reorder = mutation({
  args: { orderedIds: v.array(v.id("staff")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    for (const [index, id] of args.orderedIds.entries()) {
      const row = await ctx.db.get(id);
      if (!row || row.orgId !== orgId) throw new Error("not-found");
      await ctx.db.patch(id, { order: index });
    }
    return null;
  },
});

export const remove = mutation({
  args: { staffId: v.id("staff") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.staffId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    if (row.active) throw new Error("staff-still-active");
    // Before the row goes, so its colour is not handed down the line.
    await freezeStaffColors(ctx, orgId);
    await ctx.db.delete(args.staffId);
    return null;
  },
});
