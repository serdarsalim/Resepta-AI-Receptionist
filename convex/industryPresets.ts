// The onboarding verticals as the operator console and the wizard see them.
//
// Resolution — code module underneath, table on top — lives in
// lib/industryPresetStore; this file is the Convex surface around it, exactly
// the way platformConfig.ts wraps lib/platformConfig.
//
// Writes are platform-admin only and there is no per-org anything here: a
// preset is deployment-wide seed data. What a BUSINESS does with a preset
// (applying it, resetting to it) stays in onboarding.ts behind requireOwner.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePlatformAdmin } from "./lib/platformAuth";
import { RESERVED_CONTACT_KEYS, keyFromLabel } from "./lib/keys";
import { resolvePresets } from "./lib/industryPresetStore";

const localised = v.object({ tr: v.string(), en: v.string(), de: v.string() });
const localisedList = v.object({
  tr: v.array(v.string()),
  en: v.array(v.string()),
  de: v.array(v.string()),
});

const fieldType = v.union(
  v.literal("text"),
  v.literal("select"),
  v.literal("number"),
  v.literal("date"),
);

const presetService = v.object({
  name: localised,
  durationMinutes: v.number(),
});

const presetField = v.object({
  key: v.string(),
  label: localised,
  type: fieldType,
  options: v.optional(localisedList),
});

// What the console shows for one vertical: the content, plus where it came
// from. `source` is dropped on the way out — it is the constant "voice" for
// every preset field and the editor has nothing to do with it.
const adminPreset = v.object({
  key: v.string(),
  name: localised,
  services: v.array(presetService),
  fields: v.array(presetField),
  active: v.boolean(),
  inCode: v.boolean(),
  edited: v.boolean(),
  updatedAt: v.union(v.number(), v.null()),
  updatedBy: v.union(v.string(), v.null()),
});

// ---- Read ----

// The onboarding wizard's picker. NO auth check, on purpose: this is the same
// data the browser downloads today as part of the JS bundle — lib/industryPresets
// is imported straight into OnboardingWizard — so serving it as a query is not
// a new disclosure, it is the same disclosure with an editable source. It also
// has to answer for a user whose org is still unnamed, which is every user this
// query exists for.
//
// Inactive verticals are filtered out here rather than in the client, so a
// retired vertical cannot come back by way of a stale bundle.
export const catalogue = query({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      name: localised,
      services: v.array(presetService),
      fields: v.array(presetField),
    }),
  ),
  handler: async (ctx) => {
    const presets = await resolvePresets(ctx);
    return presets
      .filter((preset) => preset.active)
      .map((preset) => ({
        key: preset.key,
        name: preset.name,
        services: preset.services.map((service) => ({
          name: service.name,
          durationMinutes: service.durationMinutes,
        })),
        fields: preset.fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          options: field.options,
        })),
      }));
  },
});

// The console's list and editor, in one query: eight verticals with their
// services and fields is a few kilobytes, and splitting it would mean a second
// round trip every time the operator opens a row.
export const all = query({
  args: {},
  returns: v.array(adminPreset),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const presets = await resolvePresets(ctx);
    // Editor names, looked up once for the handful of rows that carry one.
    const editorIds = [
      ...new Set(presets.map((preset) => preset.updatedBy).filter(Boolean)),
    ];
    const editors = new Map(
      await Promise.all(
        editorIds.map(async (id) => {
          const user = await ctx.db.get(id!);
          return [id, user?.name ?? user?.email ?? "unknown"] as const;
        }),
      ),
    );
    return presets.map((preset) => ({
      key: preset.key,
      name: preset.name,
      services: preset.services.map((service) => ({
        name: service.name,
        durationMinutes: service.durationMinutes,
      })),
      fields: preset.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options,
      })),
      active: preset.active,
      inCode: preset.inCode,
      edited: preset.edited,
      updatedAt: preset.updatedAt ?? null,
      updatedBy: preset.updatedBy ? (editors.get(preset.updatedBy) ?? null) : null,
    }));
  },
});

// ---- Write ----

// Refusals, not silent repairs. The seeder skips a service it cannot key and a
// field key that is reserved, which is right at onboarding time — a salon must
// not be blocked by a catalogue mistake — and wrong here, where the operator is
// looking at the thing and can fix it in a second. A preset that would seed
// nothing should say so before it is saved, not at the next salon's onboarding.
function validate(args: {
  key: string;
  name: { tr: string; en: string; de: string };
  services: { name: { tr: string; en: string; de: string }; durationMinutes: number }[];
  fields: {
    key: string;
    label: { tr: string; en: string; de: string };
    type: string;
    options?: { tr: string[]; en: string[]; de: string[] };
  }[];
}) {
  if (!/^[a-z][a-z0-9_]*$/.test(args.key)) throw new Error("bad-key");
  for (const lang of ["tr", "en", "de"] as const) {
    if (!args.name[lang].trim()) throw new Error("name-incomplete");
  }

  const seen = new Set<string>();
  for (const service of args.services) {
    for (const lang of ["tr", "en", "de"] as const) {
      if (!service.name[lang].trim()) throw new Error("service-name-incomplete");
    }
    // The seeder keys a service off its name in the org's language, and a name
    // that folds to nothing is a service that never lands. Checked per language
    // because "///" keys to nothing in every one of them.
    for (const lang of ["tr", "en", "de"] as const) {
      if (!keyFromLabel(service.name[lang])) throw new Error("service-name-unkeyable");
    }
    // Duplicate names collide on the key and the second one silently vanishes.
    const key = keyFromLabel(service.name.en);
    if (seen.has(key)) throw new Error("service-duplicate");
    seen.add(key);
    if (!Number.isInteger(service.durationMinutes)) throw new Error("bad-duration");
    // The floor matches the seeder's own clamp, so what is saved is what seeds.
    // The ceiling is a day: a preset is a guess the owner corrects, and a guess
    // longer than the business is open is not one.
    if (service.durationMinutes < 5 || service.durationMinutes > 1440) {
      throw new Error("bad-duration");
    }
  }

  const fieldKeys = new Set<string>();
  for (const field of args.fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field.key)) throw new Error("bad-field-key");
    // A reserved key is one the customer record already owns (name, phone).
    // Seeding one is refused downstream, so a preset carrying one is a field
    // that will never exist.
    if (RESERVED_CONTACT_KEYS.has(field.key)) throw new Error("reserved-field-key");
    if (fieldKeys.has(field.key)) throw new Error("field-duplicate");
    fieldKeys.add(field.key);
    for (const lang of ["tr", "en", "de"] as const) {
      if (!field.label[lang].trim()) throw new Error("field-label-incomplete");
    }
    if (field.type === "select") {
      if (!field.options) throw new Error("select-needs-options");
      for (const lang of ["tr", "en", "de"] as const) {
        const options = field.options[lang].map((o) => o.trim()).filter(Boolean);
        if (options.length === 0) throw new Error("select-needs-options");
      }
    }
  }
}

// Upsert the whole vertical. Whole, not per-service: the editor holds a draft
// of the entire preset and one save is one atomic swap, which also means a
// half-applied preset cannot exist for the next org to onboard into.
export const save = mutation({
  args: {
    key: v.string(),
    name: localised,
    services: v.array(presetService),
    fields: v.array(presetField),
    active: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requirePlatformAdmin(ctx);
    validate(args);
    const trimmed = {
      name: args.name,
      services: args.services.map((service) => ({
        name: service.name,
        durationMinutes: service.durationMinutes,
      })),
      fields: args.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        // A non-select carrying leftover options would compare as drift against
        // a code preset that has none, so the type decides what is stored.
        options: field.type === "select" ? field.options : undefined,
      })),
      active: args.active,
      updatedAt: Date.now(),
      updatedBy: user._id,
    };
    const existing = await ctx.db
      .query("industryPresets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) await ctx.db.patch(existing._id, trimmed);
    else await ctx.db.insert("industryPresets", { key: args.key, ...trimmed });
    return null;
  },
});

// Drop the override row. For a vertical that exists in code this is "revert to
// code" and the catalogue keeps serving it; for an operator-coined one it is
// the delete. One operation either way — the console picks the honest label —
// because both are the same fact: the database stops having an opinion.
//
// Orgs already ON this industry are untouched. Their services and contact
// fields were copied at onboarding and have been theirs ever since; the only
// thing that changes for them is what a future "reset to industry defaults"
// would seed, which is the intended effect of editing a preset at all.
export const reset = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const existing = await ctx.db
      .query("industryPresets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

// The picker toggle on its own, so turning a vertical off does not require
// opening the editor and re-saving content that has not changed. Toggling a
// code-backed vertical off writes a row holding a copy of the code content —
// which is why `edited` compares CONTENT (lib/industryPresetStore): the row
// exists, but nothing about the preset has drifted.
export const setActive = mutation({
  args: { key: v.string(), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requirePlatformAdmin(ctx);
    const presets = await resolvePresets(ctx);
    const preset = presets.find((entry) => entry.key === args.key);
    if (!preset) throw new Error("unknown-industry");
    const existing = await ctx.db
      .query("industryPresets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      // A code-backed vertical switched back on with no edits of its own has no
      // reason to keep a row: dropping it puts the vertical back under the code
      // module, where the next catalogue commit can reach it again.
      if (args.active && preset.inCode && !preset.edited) {
        await ctx.db.delete(existing._id);
      } else {
        await ctx.db.patch(existing._id, {
          active: args.active,
          updatedAt: Date.now(),
          updatedBy: user._id,
        });
      }
      return null;
    }
    await ctx.db.insert("industryPresets", {
      key: args.key,
      name: preset.name,
      services: preset.services.map((service) => ({
        name: service.name,
        durationMinutes: service.durationMinutes,
      })),
      fields: preset.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options,
      })),
      active: args.active,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    return null;
  },
});
