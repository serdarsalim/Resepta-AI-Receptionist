import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { RESERVED_CONTACT_KEYS, keyFromLabel, normaliseKey } from "./lib/keys";
import { requireOrg, requireOwner } from "./lib/orgAuth";

const fieldType = v.union(
  v.literal("text"),
  v.literal("select"),
  v.literal("number"),
  v.literal("date"),
);

// Where a field's value comes from. Unset reads as "manual" everywhere, so
// every row written before this existed keeps behaving the way it did.
const fieldSource = v.union(v.literal("manual"), v.literal("voice"));

const fieldDoc = v.object({
  _id: v.id("contactFields"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  // `key` is the write address: it is what the voice agent sends to
  // update_contact and what customers.custom is keyed by. The UI shows the
  // label, never this.
  key: v.string(),
  label: v.string(),
  type: fieldType,
  options: v.optional(v.array(v.string())),
  order: v.number(),
  source: v.optional(fieldSource),
  voiceDescription: v.optional(v.string()),
  voiceConfirm: v.optional(v.boolean()),
  voiceVisible: v.optional(v.boolean()),
});

export const list = query({
  args: {},
  returns: v.array(fieldDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const fields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return fields.sort((a, b) => a.order - b.order);
  },
});

// Which identity columns the voice agent may not write. Its own query rather
// than a field on list: list's return is the fields array everywhere, and
// callers that do not render the identity rows should not learn org settings.
export const identityLocks = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    return org?.voiceLockedIdentity ?? [];
  },
});

// The identity rows' half of the same toggle updateField gives custom rows.
export const setIdentityLock = mutation({
  args: {
    key: v.union(v.literal("firstname"), v.literal("lastname"), v.literal("email")),
    locked: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { key, locked }) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const current = new Set(org.voiceLockedIdentity ?? []);
    if (locked) current.add(key);
    else current.delete(key);
    await ctx.db.patch(orgId, { voiceLockedIdentity: [...current] });
    return null;
  },
});

// The identity rows' description half, the same job update's voiceDescription
// arg does for org fields — on the org, because identity has no field row.
export const setIdentityDescription = mutation({
  args: {
    key: v.union(v.literal("firstname"), v.literal("lastname"), v.literal("email")),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { key, text }) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const current = { ...(org.voiceIdentityDescriptions ?? {}) };
    if (text.trim()) current[key] = text.trim();
    else delete current[key];
    await ctx.db.patch(orgId, { voiceIdentityDescriptions: current });
    return null;
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    type: fieldType,
    options: v.optional(v.array(v.string())),
    source: v.optional(fieldSource),
    // The owner may declare the key instead of taking the derived one; it is
    // normalised but not stop-word-stripped — their words, their key.
    key: v.optional(v.string()),
  },
  // Returns the new row's id so a caller wiring the field somewhere else
  // (e.g. a voice variable destination) doesn't have to re-derive the key
  // and search for it.
  returns: v.id("contactFields"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const label = args.label.trim();
    if (!label) throw new Error("label-required");
    // Key derives from the label once (the one rule lives in lib/keys.ts)
    // unless the owner declared one; after creation it only moves through
    // update's unused-only path.
    const key = args.key?.trim() ? normaliseKey(args.key) : keyFromLabel(label);
    if (!key) throw new Error("label-required");
    if (RESERVED_CONTACT_KEYS.has(key)) throw new Error("key-reserved");
    const existing = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (existing.some((field) => field.key === key)) throw new Error("field-exists");
    // A select with no choices is unfillable by hand, unwritable by the agent,
    // and — worst — unpublishable: retellAgent resolves a voice variable's
    // choices from field.options and throws "needs at least one option", so one
    // blank field means the phone agent can never be published again. Deduped
    // too, matching `update`. Both siblings already refused this
    // (agentTools.createContactField and `remove`'s neighbour), and the
    // seedForOrg header claims `create` does; now it does.
    const options =
      args.type === "select"
        ? [...new Set((args.options ?? []).map((o) => o.trim()).filter(Boolean))]
        : undefined;
    if (args.type === "select" && (!options || options.length === 0)) {
      throw new Error("select-needs-options");
    }
    return await ctx.db.insert("contactFields", {
      orgId,
      key,
      label,
      type: args.type,
      options,
      order: existing.length,
      // Left unset for the default so the stored row stays as small as the
      // meaning: a field nobody marked is a field staff fill in.
      source: args.source === "voice" ? "voice" : undefined,
    });
  },
});

// Rename is label-only, and that is the whole reason renaming is safe: the
// key stays the address that stored values and published agents were written
// against, so a new label ripples into every surface that renders the field
// without republishing anything.
export const update = mutation({
  args: {
    fieldId: v.id("contactFields"),
    label: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
    source: v.optional(fieldSource),
    key: v.optional(v.string()),
    // Voice capture metadata (see schema). Empty string clears the
    // description; false clears confirm — optional columns stay unset rather
    // than holding a default nobody chose.
    voiceDescription: v.optional(v.string()),
    voiceConfirm: v.optional(v.boolean()),
    voiceVisible: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const field = await ctx.db.get(args.fieldId);
    if (!field || field.orgId !== orgId) throw new Error("not-found");
    const usedByAgents = async () => {
      const variables = await ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      return variables.some(
        (row) => row.contactFieldId === args.fieldId || row.beforeFieldId === args.fieldId,
      );
    };
    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) throw new Error("label-required");
      patch.label = label;
    }
    if (args.options !== undefined) {
      if (field.type !== "select") throw new Error("not-a-select");
      patch.options = [...new Set(args.options.map((o) => o.trim()).filter(Boolean))];
    }
    // The key may move only while nothing addresses it: no agent references
    // the field, and stored values under the old key simply stay behind (the
    // same outcome delete-and-recreate already allows).
    if (args.key !== undefined) {
      const key = normaliseKey(args.key);
      if (!key) throw new Error("key-required");
      if (key !== field.key) {
        if (await usedByAgents()) throw new Error("field-in-use");
        if (RESERVED_CONTACT_KEYS.has(key)) throw new Error("key-reserved");
        const existing = await ctx.db
          .query("contactFields")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();
        if (existing.some((other) => other.key === key && other._id !== args.fieldId)) {
          throw new Error("field-exists");
        }
        patch.key = key;
      }
    }
    if (args.source !== undefined && args.source !== (field.source ?? "manual")) {
      // Flipping to manual IS the unlink now. Capture rows are DERIVED from
      // voice-enabled fields at publish time (retellAgent.deriveCaptureRows,
      // 2026-08-25), so there is no per-agent row whose publish this breaks:
      // the next publish simply stops deriving the field. The field-in-use
      // guard that lived here belonged to the era when agents held their own
      // capture registry; it survives above for KEY moves, where stored
      // values and stale rows genuinely would be orphaned.
      patch.source = args.source === "voice" ? "voice" : undefined;
    }
    if (args.voiceDescription !== undefined) {
      patch.voiceDescription = args.voiceDescription.trim() || undefined;
    }
    if (args.voiceConfirm !== undefined) {
      patch.voiceConfirm = args.voiceConfirm || undefined;
    }
    if (args.voiceVisible !== undefined) {
      patch.voiceVisible = args.voiceVisible || undefined;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.fieldId, patch);
    return null;
  },
});

// Persists a drag-reorder: the client sends the full order, every row gets
// its index. Ported from Nudge's fields admin.
export const reorder = mutation({
  args: { orderedIds: v.array(v.id("contactFields")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    for (const [index, id] of args.orderedIds.entries()) {
      const field = await ctx.db.get(id);
      if (!field || field.orgId !== orgId) throw new Error("not-found");
      await ctx.db.patch(id, { order: index });
    }
    return null;
  },
});

export const remove = mutation({
  args: { fieldId: v.id("contactFields") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const field = await ctx.db.get(args.fieldId);
    if (!field || field.orgId !== orgId) throw new Error("not-found");
    // A field an agent still references must not go: the variable registry
    // keeps the dangling id and that agent's next publish dies on
    // "needs a voice-filled customer field". Unlink it on the agent first.
    const variables = await ctx.db
      .query("voiceAgentVariables")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const inUse = variables.some(
      (row) => row.contactFieldId === args.fieldId || row.beforeFieldId === args.fieldId,
    );
    if (inUse) throw new Error("field-in-use");
    // Stored values keep their key harmlessly; re-adding the same label
    // resurfaces them.
    await ctx.db.delete(args.fieldId);
    return null;
  },
});

// Standing a tenant's whole field set up in one shot, from outside the app: an
// onboarding, a migration, a support request. The app has no bulk path and
// should not grow one — an owner adding fields one at a time is the right pace
// for an owner. A CLI run is a different job, and this is its door:
//
//   npx convex run contactFields:seedForOrg --prod '{"orgId":"...","fields":[...]}'
//
// It skips the session because a CLI run has none, and NOTHING else. Key
// derivation, the reserved-key refusal, the empty-select refusal and the
// in-use guard are the same rules `create` and `remove` apply, reached the
// same way. A seeding path that quietly accepted what the UI rejects would
// produce rows the app can then neither render nor delete.
export const seedForOrg = internalMutation({
  args: {
    orgId: v.id("orgs"),
    fields: v.array(
      v.object({
        label: v.string(),
        type: fieldType,
        options: v.optional(v.array(v.string())),
        source: v.optional(fieldSource),
        key: v.optional(v.string()),
      }),
    ),
    // Clear the org's existing fields first. Off by default: the destructive
    // reading of "seed" should never be the one you get by forgetting a flag.
    replaceExisting: v.optional(v.boolean()),
  },
  returns: v.object({
    removed: v.array(v.string()),
    created: v.array(v.object({ key: v.string(), label: v.string() })),
    skipped: v.array(v.object({ label: v.string(), reason: v.string() })),
  }),
  handler: async (ctx, args) => {
    const removed: string[] = [];
    const created: { key: string; label: string }[] = [];
    const skipped: { label: string; reason: string }[] = [];

    let existing = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    if (args.replaceExisting) {
      const variables = await ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect();
      for (const field of existing) {
        // Same refusal as `remove`, and it throws rather than skipping: a
        // half-replaced field set is worse than an untouched one, because the
        // caller asked for a known end state and would be told they got it.
        const inUse = variables.some(
          (row) => row.contactFieldId === field._id || row.beforeFieldId === field._id,
        );
        if (inUse) {
          throw new Error(
            `field-in-use: "${field.label}" is referenced by a phone agent. Unlink it on the agent first.`,
          );
        }
        await ctx.db.delete(field._id);
        removed.push(field.key);
      }
      existing = [];
    }

    const takenKeys = new Set(existing.map((row) => row.key));
    let order = existing.length;

    for (const spec of args.fields) {
      const label = spec.label.trim();
      if (!label) {
        skipped.push({ label: spec.label, reason: "label-required" });
        continue;
      }
      const key = spec.key?.trim() ? normaliseKey(spec.key) : keyFromLabel(label);
      if (!key) {
        skipped.push({ label, reason: "label-required" });
        continue;
      }
      if (RESERVED_CONTACT_KEYS.has(key)) {
        skipped.push({ label, reason: `key-reserved (${key})` });
        continue;
      }
      // Against keys claimed EARLIER IN THIS RUN as well as already stored
      // ones, or two labels folding to one key would collide silently and the
      // second would overwrite nothing while reporting success.
      if (takenKeys.has(key)) {
        skipped.push({ label, reason: `field-exists (${key})` });
        continue;
      }
      const options =
        spec.type === "select"
          ? (spec.options ?? []).map((o) => o.trim()).filter(Boolean)
          : undefined;
      if (spec.type === "select" && (!options || options.length === 0)) {
        skipped.push({ label, reason: "select-needs-options" });
        continue;
      }
      await ctx.db.insert("contactFields", {
        orgId: args.orgId,
        key,
        label,
        type: spec.type,
        options,
        order: order++,
        source: spec.source === "voice" ? "voice" : undefined,
      });
      takenKeys.add(key);
      created.push({ key, label });
    }

    return { removed, created, skipped };
  },
});
