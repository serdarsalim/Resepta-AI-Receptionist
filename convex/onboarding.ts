// The onboarding wizard's server side, and the one place an industry preset
// is applied (lib/industryPresets, with the operator's overrides laid over it
// by lib/industryPresetStore).
//
// A preset only ever writes the same rows the owner could add by hand —
// services and contact fields — so applying one is convenience, not a mode.
// After application the rows are the org's own; refining them never touches
// the preset, and re-applying is an explicit, destructive act behind a
// confirmation in Business settings (resetToIndustryDefaults below).

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./lib/orgAuth";
import { slugify } from "./lib/publicSlug";
import { recordActivity } from "./lib/activity";
import { keyFromLabel, uniqueKey, RESERVED_CONTACT_KEYS } from "./lib/keys";
import { presetLanguage, type IndustryPreset } from "./lib/industryPresets";
import { resolvePreset } from "./lib/industryPresetStore";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Seed the preset's services and fields, skipping anything the org already
// has under the same address. Dedupe is by KEY, not display name: the key is
// what agents and stored values bind to, and it is language-stable where the
// label is not.
// Takes the RESOLVED preset rather than a key: resolving reads the database
// (an operator override may be laid over the code module), and doing that here
// would mean every caller resolving once to validate and again to seed.
async function seedPreset(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  preset: IndustryPreset,
  language: string,
): Promise<{ services: number; fields: number }> {
  const lang = presetLanguage(language);

  const existingServices = await ctx.db
    .query("services")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const takenServiceKeys = new Set(
    existingServices.map((row) => row.key ?? keyFromLabel(row.name) ?? ""),
  );
  let services = 0;
  for (const service of preset.services) {
    const name = service.name[lang];
    const base = keyFromLabel(name);
    if (!base || takenServiceKeys.has(base)) continue;
    await ctx.db.insert("services", {
      orgId,
      name,
      key: uniqueKey(base, takenServiceKeys),
      durationMinutes: Math.max(5, Math.round(service.durationMinutes)),
      active: true,
      // No price, deliberately (see lib/industryPresets): an invented price
      // is a claim about the business. The price list shows the gap.
    });
    takenServiceKeys.add(base);
    services += 1;
  }

  const existingFields = await ctx.db
    .query("contactFields")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const takenFieldKeys = new Set(existingFields.map((row) => row.key));
  let order = existingFields.length;
  let fields = 0;
  for (const field of preset.fields) {
    if (takenFieldKeys.has(field.key)) continue;
    if (RESERVED_CONTACT_KEYS.has(field.key)) continue;
    await ctx.db.insert("contactFields", {
      orgId,
      key: field.key,
      label: field.label[lang],
      type: field.type,
      options: field.options ? field.options[lang] : undefined,
      order: order++,
      source: "voice",
    });
    takenFieldKeys.add(field.key);
    fields += 1;
  }
  return { services, fields };
}

// The wizard's name step asks before it commits: the business name is unique
// across the fleet (it derives the booking page's address), and the name is
// SAVED last — a taken name discovered only at Finish would bounce the owner
// three steps back. This is the same cross-org lookup resolvePublicSlug
// makes on every orgs.update({name}); it answers one bit (free or taken),
// which is exactly what the name-taken error already discloses, so it is not
// a new read surface in the platform.ts sense. The definitive check still
// happens at save.
export const nameAvailable = query({
  args: { name: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const slug = slugify(args.name.trim());
    if (!slug) return true;
    const taken = await ctx.db
      .query("orgs")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .first();
    return !taken || taken._id === orgId;
  },
});

// The wizard's industry step. Records the answer always; seeds only when the
// owner chose to start prefilled. Safe to repeat — seeding skips existing
// keys — so a wizard step revisited does not double the price list.
export const applyIndustryPreset = mutation({
  args: {
    industry: v.string(),
    prefill: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const preset = await resolvePreset(ctx, args.industry);
    if (!preset) throw new Error("unknown-industry");
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("not-found");
    await ctx.db.patch(orgId, { industry: args.industry });
    // Emptiness decides, not the key. "other" seeds nothing because it holds
    // nothing, and so does a vertical an operator has drafted but not filled in
    // — both should record the answer and leave the catalog alone rather than
    // claim a preset was applied.
    const seeds = preset.services.length > 0 || preset.fields.length > 0;
    if (args.prefill && seeds) {
      await seedPreset(ctx, orgId, preset, org.language);
      await recordActivity(ctx, {
        orgId,
        kind: "settings_changed",
        detail: `industry preset applied: ${args.industry}`,
      });
    }
    return null;
  },
});

// Business settings' "reset to industry defaults", behind a confirmation
// dialog that names exactly what this does: every service goes (safe — an
// appointment snapshots name, price and duration onto its own lines), every
// contact field goes except ones a voice agent still references (deleting
// those would wedge the agent's next publish; they survive the reset and the
// dialog says so), then the preset is seeded fresh. Knowledge, customers,
// appointments and message wording are untouched — this resets the CATALOG,
// not the business.
export const resetToIndustryDefaults = mutation({
  args: {
    // Optional re-answer: the owner may reset INTO a different industry.
    industry: v.optional(v.string()),
  },
  returns: v.object({ keptFields: v.number() }),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("not-found");
    const industry = args.industry ?? org.industry ?? "";
    // Resolved without regard to `active`: a business already on a vertical the
    // operator has since retired must keep working, and this is the mutation
    // that would break first if it did not.
    const preset = await resolvePreset(ctx, industry);
    if (!preset) throw new Error("unknown-industry");

    const services = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const service of services) await ctx.db.delete(service._id);

    const variables = await ctx.db
      .query("voiceAgentVariables")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const referenced = new Set(
      variables.flatMap((row) =>
        [row.contactFieldId, row.beforeFieldId].filter(Boolean),
      ),
    );
    const fields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let keptFields = 0;
    for (const field of fields) {
      if (referenced.has(field._id)) {
        keptFields += 1;
        continue;
      }
      await ctx.db.delete(field._id);
    }

    await ctx.db.patch(orgId, { industry });
    await seedPreset(ctx, orgId, preset, org.language);
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `catalog reset to industry defaults: ${industry}`,
    });
    return { keptFields };
  },
});
