// Resolving what a new phone agent is born saying: the code module
// (lib/voiceAgentTemplate) with the operator's overrides (the voicePrompts
// table) laid over it.
//
// The industryPresetStore argument, applied to prose: the code is the artifact
// people can see, diff and revert, so a row wins only where an operator put
// one and deleting it is a complete undo.
//
// ⚠️ Read only by the PROVISIONING path. Nothing that touches an existing
// agent resolves an override, and nothing should start — see the schema note
// on voicePrompts and the header of lib/voiceAgentTemplate.

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  codePrompt,
  type VoiceAgentLanguage,
  type VoiceAgentPrompt,
} from "./voiceAgentTemplate";

type Ctx = QueryCtx | MutationCtx;

export const VOICE_PROMPT_LANGUAGES: VoiceAgentLanguage[] = [
  "tr-TR",
  "en-US",
  "de-DE",
];

export type ResolvedPrompt = VoiceAgentPrompt & {
  language: VoiceAgentLanguage;
  // A row exists AND its text differs from the code module's.
  edited: boolean;
  updatedAt?: number;
  updatedBy?: Id<"users">;
};

function differs(a: VoiceAgentPrompt, b: VoiceAgentPrompt): boolean {
  return (
    a.general !== b.general ||
    a.beginMessage !== b.beginMessage ||
    a.beginMessageNamed !== b.beginMessageNamed
  );
}

export async function resolvePrompt(
  ctx: Ctx,
  language: VoiceAgentLanguage,
): Promise<ResolvedPrompt> {
  const row = await ctx.db
    .query("voicePrompts")
    .withIndex("by_language", (q) => q.eq("language", language))
    .first();
  const code = codePrompt(language);
  if (!row) return { ...code, language, edited: false };
  const stored: VoiceAgentPrompt = {
    general: row.general,
    beginMessage: row.beginMessage,
    beginMessageNamed: row.beginMessageNamed,
  };
  return {
    ...stored,
    language,
    edited: differs(stored, code),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export async function resolvePrompts(ctx: Ctx): Promise<ResolvedPrompt[]> {
  return await Promise.all(
    VOICE_PROMPT_LANGUAGES.map((language) => resolvePrompt(ctx, language)),
  );
}
