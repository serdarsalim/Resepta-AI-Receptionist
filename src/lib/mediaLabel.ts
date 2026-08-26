// Which word stands in for an attachment, as a dictionary key.
//
// Two surfaces need it and neither can share the other's code: the bubble
// (MessageMedia) says it when a download failed, and the inbox row says it
// because a one-line preview can never show the thing itself. Both have to
// pick the SAME word, and both have to pick it in the reader's language — so
// the mapping lives here and the translation stays in src/lib/i18n.ts.

import { mediaKindOf, isVoiceNote } from "../../convex/lib/mediaKind";
import type { TranslationKey } from "./i18n";

export function mediaKindKey(
  contentType?: string,
  fileName?: string,
  url?: string,
): TranslationKey {
  const kind = mediaKindOf(url ?? "", fileName, contentType);
  if (kind === "image") return "media.kind.image";
  if (kind === "video") return "media.kind.video";
  if (kind === "audio") {
    return isVoiceNote(contentType, fileName, url)
      ? "media.kind.voice"
      : "media.kind.audio";
  }
  return "media.kind.document";
}
