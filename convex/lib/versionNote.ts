// The note that rides a published agent version: what changed, in words.
// Ported from Nudge's lib/versionNote.ts, P7 of the Nudge port.
//
// The provider carries `version_title` and `version_description` on
// publish-agent-version and reads both back from list-agent-versions, so once
// they are sent the agent is its own changelog: the version history on the
// agent page reads them, and "which edit made calls worse" has an answer.
//
// A LEAF: imports nothing but convex/values.

import { v } from "convex/values";

export const versionNoteValidator = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
});

export type VersionNote = { title?: string; description?: string };

// Ours, not the provider's (it documents no limit). Clamping here means a
// pasted essay can never be what fails a publish, which would fail it AFTER
// the draft was written.
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 500;

// The body for publish-agent-version. Empty strings are dropped rather than
// sent: a stored "" would show a titled version with no title.
export function publishVersionBody(
  version: number,
  note?: VersionNote,
): Record<string, unknown> {
  const title = note?.title?.trim().slice(0, TITLE_MAX);
  const description = note?.description?.trim().slice(0, DESCRIPTION_MAX);
  return {
    version,
    ...(title ? { version_title: title } : {}),
    ...(description ? { version_description: description } : {}),
  };
}
