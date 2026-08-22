// Resolving an onboarding vertical: the code module (lib/industryPresets) with
// the operator's overrides (the industryPresets table) laid over it.
//
// Same split as lib/platformConfig — the pure module stays pure so the browser
// can keep importing its types, and everything that needs a database lives
// here. The DIRECTION of the fallback is the opposite of that file's, and
// deliberately so. platformConfig's row wins over its env var because the env
// var is a deploy artifact nobody can see. Here the code is the artifact people
// CAN see: reviewed, diffed, revertible. So a row wins only where an operator
// explicitly put one, and deleting that row is a complete undo rather than a
// restore from somewhere.
//
// The practical consequence, which is the whole point: a catalogue improvement
// shipped in a commit reaches every vertical nobody has edited, and the console
// can say which verticals it did not reach.

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  INDUSTRY_KEYS,
  INDUSTRY_PRESETS,
  isIndustryKey,
  type IndustryPreset,
  type PresetField,
  type PresetService,
} from "./industryPresets";

type Ctx = QueryCtx | MutationCtx;

// One vertical as the product sees it, plus where it came from. Only the admin
// console reads the provenance; onboarding wants the content and nothing else.
export type ResolvedPreset = IndustryPreset & {
  key: string;
  // Off keeps the vertical resolvable but out of the onboarding picker.
  active: boolean;
  // Present in the code module. False means an operator coined this vertical
  // and it lives only in the database until somebody ports it into the file.
  inCode: boolean;
  // A row exists AND its content differs from the code module's. A row that
  // carries nothing but an `active: false` flag is not edited — reporting it as
  // drift would show a diff that does not exist.
  edited: boolean;
  updatedAt?: number;
  updatedBy?: Id<"users">;
};

// Localised objects are compared and re-emitted through these two so property
// order can never decide the answer. Convex hands a stored object back without
// promising the key order the validator was written in, and `canonical` below
// is a string compare.
const loc = (value: { tr: string; en: string; de: string }) => ({
  tr: value.tr,
  en: value.en,
  de: value.de,
});
const locList = (value: { tr: string[]; en: string[]; de: string[] }) => ({
  tr: [...value.tr],
  en: [...value.en],
  de: [...value.de],
});

// A stored row read as a preset. `source` is not stored (see the schema): every
// preset field is voice-sourced by definition, so it is a constant here.
function rowPreset(row: Doc<"industryPresets">): IndustryPreset {
  return {
    name: loc(row.name),
    services: row.services.map(
      (service): PresetService => ({
        name: loc(service.name),
        durationMinutes: service.durationMinutes,
      }),
    ),
    fields: row.fields.map(
      (field): PresetField => ({
        key: field.key,
        label: loc(field.label),
        type: field.type,
        options: field.options ? locList(field.options) : undefined,
        source: "voice",
      }),
    ),
  };
}

// Content only — never `active`, never the audit columns. Two presets that seed
// the same rows are the same preset.
function canonical(preset: IndustryPreset): string {
  return JSON.stringify({
    name: loc(preset.name),
    services: preset.services.map((service) => ({
      name: loc(service.name),
      durationMinutes: service.durationMinutes,
    })),
    fields: preset.fields.map((field) => ({
      key: field.key,
      label: loc(field.label),
      type: field.type,
      options: field.options ? locList(field.options) : null,
    })),
  });
}

export function presetsDiffer(a: IndustryPreset, b: IndustryPreset): boolean {
  return canonical(a) !== canonical(b);
}

function merge(key: string, row: Doc<"industryPresets"> | undefined): ResolvedPreset {
  const inCode = isIndustryKey(key);
  const code = inCode ? INDUSTRY_PRESETS[key] : null;
  const stored = row ? rowPreset(row) : null;
  const content = stored ?? code;
  // Unreachable: callers only ever pass a key that is in code, in the table, or
  // both. Typed defensively because the alternative is a crash in onboarding.
  if (!content) throw new Error("unknown-industry");
  return {
    ...content,
    key,
    active: row?.active ?? true,
    inCode,
    edited: Boolean(stored && code && presetsDiffer(stored, code)),
    updatedAt: row?.updatedAt,
    updatedBy: row?.updatedBy,
  };
}

// Every vertical the deployment knows about, in the order the picker shows
// them: the code module's own order first, then whatever an operator coined,
// then "other" — which stays last because it is the escape hatch, not a
// vertical, and a list that ends in "Other" is the list people expect.
export async function resolvePresets(ctx: Ctx): Promise<ResolvedPreset[]> {
  const rows = await ctx.db.query("industryPresets").collect();
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const coded = INDUSTRY_KEYS.filter((key) => key !== "other").map((key) =>
    merge(key, byKey.get(key)),
  );
  const coined = rows
    .filter((row) => !isIndustryKey(row.key))
    .map((row) => merge(row.key, row))
    .sort((a, b) => a.name.en.localeCompare(b.name.en));

  return [...coded, ...coined, merge("other", byKey.get("other"))];
}

// One vertical, by the index rather than a full scan — the onboarding path
// resolves exactly one and runs on every wizard finish.
export async function resolvePreset(
  ctx: Ctx,
  key: string,
): Promise<ResolvedPreset | null> {
  const row = await ctx.db
    .query("industryPresets")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (!row && !isIndustryKey(key)) return null;
  return merge(key, row ?? undefined);
}
