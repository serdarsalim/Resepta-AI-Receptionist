// What a new phone agent is born saying, for the operator console and for the
// one path that provisions an agent.
//
// Resolution lives in lib/voicePromptStore; this is the Convex surface around
// it, matching how industryPresets.ts wraps lib/industryPresetStore.
//
// ⚠️ There is deliberately NO function here that a live agent's update path
// could call. `forProvisioning` is internal and named for its one caller, and
// nothing in retellAgent's sync, model or end-call paths sends prompt text at
// all. Editing a row changes the NEXT agent to be created and nothing else.

import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requirePlatformAdmin } from "./lib/platformAuth";
import { codePrompt, type VoiceAgentLanguage } from "./lib/voiceAgentTemplate";
import { resolvePrompt, resolvePrompts } from "./lib/voicePromptStore";

const language = v.union(
  v.literal("tr-TR"),
  v.literal("en-US"),
  v.literal("de-DE"),
);

const promptText = {
  general: v.string(),
  beginMessage: v.string(),
  beginMessageNamed: v.string(),
};

// Read by provisionAgent (retellAgent.ts) and by nothing else. Internal
// because a public version would be an invitation to resolve an override
// somewhere it must not reach.
export const forProvisioning = internalQuery({
  args: { language },
  returns: v.object(promptText),
  handler: async (ctx, args) => {
    const prompt = await resolvePrompt(ctx, args.language);
    return {
      general: prompt.general,
      beginMessage: prompt.beginMessage,
      beginMessageNamed: prompt.beginMessageNamed,
    };
  },
});

export const all = query({
  args: {},
  returns: v.array(
    v.object({
      language,
      ...promptText,
      edited: v.boolean(),
      // What the code module says, so the console can show the diff's size
      // without a second round trip and the editor can offer "revert" as a
      // preview rather than a leap.
      code: v.object(promptText),
      updatedAt: v.union(v.number(), v.null()),
      updatedBy: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const prompts = await resolvePrompts(ctx);
    return await Promise.all(
      prompts.map(async (prompt) => {
        const editor = prompt.updatedBy ? await ctx.db.get(prompt.updatedBy) : null;
        return {
          language: prompt.language,
          general: prompt.general,
          beginMessage: prompt.beginMessage,
          beginMessageNamed: prompt.beginMessageNamed,
          edited: prompt.edited,
          code: codePrompt(prompt.language),
          updatedAt: prompt.updatedAt ?? null,
          updatedBy: editor ? (editor.name ?? editor.email ?? "unknown") : null,
        };
      }),
    );
  },
});

export const save = mutation({
  args: { language, ...promptText },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requirePlatformAdmin(ctx);
    if (!args.general.trim()) throw new Error("prompt-empty");
    if (!args.beginMessage.trim()) throw new Error("greeting-empty");
    if (!args.beginMessageNamed.trim()) throw new Error("greeting-empty");
    // The named greeting without its placeholder is the bug this catches: it
    // would ship every agent the literal sentence, persona name and all, and
    // the fault would only show on a call. The unnamed greeting must NOT carry
    // one — there is no name to put there.
    if (!args.beginMessageNamed.includes("{name}")) throw new Error("missing-name-token");
    if (args.beginMessage.includes("{name}")) throw new Error("stray-name-token");

    const existing = await ctx.db
      .query("voicePrompts")
      .withIndex("by_language", (q) => q.eq("language", args.language))
      .first();
    const row = {
      general: args.general,
      beginMessage: args.beginMessage,
      beginMessageNamed: args.beginMessageNamed,
      updatedAt: Date.now(),
      updatedBy: user._id,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("voicePrompts", { language: args.language, ...row });
    return null;
  },
});

// Back to the code module. Agents provisioned while the override stood keep
// the prompt they were born with — that is what being born with it means, and
// it is the same one-way door as a catalogue commit.
export const reset = mutation({
  args: { language },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const existing = await ctx.db
      .query("voicePrompts")
      .withIndex("by_language", (q) => q.eq("language", args.language))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

export type { VoiceAgentLanguage };
