import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { keyFromLabel, normaliseKey, uniqueKey } from "./lib/keys";

const serviceDoc = v.object({
  _id: v.id("services"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  name: v.string(),
  // Never optional on the way OUT, even though the column is: a caller has to
  // be able to render and paste it without knowing which rows predate keys.
  key: v.string(),
  // Unset = this is a good (no duration, no calendar footprint). See schema.
  durationMinutes: v.optional(v.number()),
  leadMinutes: v.optional(v.number()),
  active: v.boolean(),
  // List price in minor units (40000 = 400,00 in the org's currency). Optional
  // because "not priced" and "free" are different facts, and a salon that
  // doesn't track money should never meet a form it can't submit.
  price: v.optional(v.number()),
});

// Minor units are whole by definition — there is no half-kuruş — and negative
// money is not a price. Clamped here rather than trusted from the client so a
// stray keystroke can't poison a sum.
function normalizePrice(value: number): number {
  return Math.max(0, Math.round(value));
}

// What a row's key IS, stored or not. The fallback keeps pre-key services
// addressable by the agent instead of unbookable, and it is the same string
// they will be given permanently the first time somebody edits them.
export function serviceKey(service: Doc<"services">): string {
  return service.key ?? keyFromLabel(service.name) ?? "";
}

async function keysTakenBy(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  except?: Id<"services">,
): Promise<Set<string>> {
  const rows = await ctx.db
    .query("services")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return new Set(
    rows.filter((row) => row._id !== except).map((row) => serviceKey(row)),
  );
}

export const list = query({
  args: {},
  returns: v.array(serviceDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.map((row) => ({ ...row, key: serviceKey(row) }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    // Omit to create a good — a service that is a thing, not time.
    durationMinutes: v.optional(v.number()),
    leadMinutes: v.optional(v.number()),
    price: v.optional(v.number()),
  },
  returns: v.id("services"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("name-required");
    // A name of pure punctuation folds to nothing; fall back to a positional
    // key rather than inserting a service the agent cannot address.
    const taken = await keysTakenBy(ctx, orgId);
    const base = keyFromLabel(name) || `service_${taken.size + 1}`;
    return await ctx.db.insert("services", {
      orgId,
      name,
      key: uniqueKey(base, taken),
      ...(args.durationMinutes !== undefined
        ? { durationMinutes: Math.max(5, Math.round(args.durationMinutes)) }
        : {}),
      ...(args.leadMinutes !== undefined
        ? { leadMinutes: Math.max(0, Math.round(args.leadMinutes)) }
        : {}),
      active: true,
      ...(args.price !== undefined ? { price: normalizePrice(args.price) } : {}),
    });
  },
});

export const update = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.optional(v.string()),
    // Editable, where a contact field's key is frozen the moment an agent
    // references it. The difference is real, not an inconsistency: nothing
    // stores a pointer to a service key. The agent is handed the current list
    // on every call (get_call_context), so a key it "learned" last month was
    // never remembered in the first place. What the key still buys is that a
    // RENAME does not silently move the address — which is why it is derived
    // once and then only ever moves when somebody says so.
    key: v.optional(v.string()),
    // Null clears the duration, turning the service into a good; a number
    // sets it. Same shape as price below, for the same reason: without the
    // null case there is no way back once someone types a figure.
    durationMinutes: v.optional(v.union(v.number(), v.null())),
    leadMinutes: v.optional(v.union(v.number(), v.null())),
    active: v.optional(v.boolean()),
    // Null clears the price; a number sets it. Without the null case there is
    // no way back to "not priced" once someone types a figure by mistake.
    price: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.orgId !== orgId) throw new Error("not-found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim();
    // Freeze the key on first edit. A pre-key row has been answering to its
    // folded name all along, so storing exactly that changes nothing today and
    // makes every rename after this one safe. Rows that already have a key are
    // never re-derived — that is the whole point of having one.
    if (args.key !== undefined) {
      const next = normaliseKey(args.key);
      if (!next) throw new Error("key-required");
      // Refused, not suffixed. A key the owner TYPED getting a silent _2 is
      // how you end up addressing sac_kesimi_2 forever; creation auto-suffixes
      // because there nobody chose the word.
      if ((await keysTakenBy(ctx, orgId, args.serviceId)).has(next)) {
        throw new Error("key-exists");
      }
      patch.key = next;
    } else if (service.key === undefined) {
      patch.key = uniqueKey(
        serviceKey(service) || `service_${Date.now()}`,
        await keysTakenBy(ctx, orgId, args.serviceId),
      );
    }
    if (args.durationMinutes !== undefined) {
      patch.durationMinutes =
        args.durationMinutes === null
          ? undefined
          : Math.max(5, Math.round(args.durationMinutes));
    }
    if (args.leadMinutes !== undefined) {
      patch.leadMinutes =
        args.leadMinutes === null
          ? undefined
          : Math.max(0, Math.round(args.leadMinutes));
    }
    if (args.active !== undefined) patch.active = args.active;
    if (args.price !== undefined) {
      patch.price = args.price === null ? undefined : normalizePrice(args.price);
    }
    await ctx.db.patch(args.serviceId, patch);
    return null;
  },
});

// Hard delete. Past appointments keep their own record and simply stop
// resolving a service name, which is the honest outcome: the salon stopped
// offering it. Deactivating instead is the softer path (`update`).
export const remove = mutation({
  args: { serviceId: v.id("services") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.orgId !== orgId) throw new Error("not-found");
    await ctx.db.delete(args.serviceId);
    return null;
  },
});
