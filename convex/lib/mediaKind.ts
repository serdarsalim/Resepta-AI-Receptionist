// What KIND of file is this attachment?
//
// Asked in three places for three reasons — the Cloud API send path needs the
// typed object Meta requires (image/video/audio/document), a bubble needs to
// know whether to paint it, play it, or offer it, and a collapsed list row
// needs a WORD to stand in for it — so it is answered once, here.
//
// Imported by both the backend (convex/wa.ts, convex/messages.ts) and the UI
// (src/components/MessageMedia.tsx), the same arrangement
// convex/lib/voiceAgentTemplate.ts already has with the admin screens. A
// hand-rolled second copy on the client is exactly what drifts: the send would
// keep calling something a document while the bubble kept painting it.

export type MediaKind = "image" | "video" | "audio" | "document";

// The MIME type wins whenever we have one, and inbound we always do — Meta
// declares it on the media lookup. Extensions are the fallback for the case
// with no mime at all, because a Convex storage URL is extensionless and a
// stored filename is document-only; guessing from the URL ALONE typed every
// uploaded photo as a document.
export function mediaKindOf(
  url: string,
  fileName?: string,
  contentType?: string,
): MediaKind {
  const mime = contentType?.toLowerCase().trim();
  if (mime) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "document";
  }
  const path = (fileName || url.split("?")[0]).toLowerCase();
  if (/\.(jpe?g|png|webp|gif)$/.test(path)) return "image";
  if (/\.(mp4|3gp|mov)$/.test(path)) return "video";
  if (/\.(mp3|m4a|ogg|aac|amr|opus|wav)$/.test(path)) return "audio";
  return "document";
}

// Will a browser paint this inline?
//
// The default deliberately differs from mediaKindOf's. A SEND has to commit to
// a type, so "no idea" falls to document. A RENDER that guesses wrong only
// shows the wrong widget — and every row written before attachments carried a
// content type was an image, sitting behind the <img> onError safety net. So
// here "no idea" keeps meaning "try the image", and only a positive signal
// that it is not one gets the file chip.
const NON_IMAGE_EXT =
  /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|zip|rar|7z|mp[34]|m4a|ogg|opus|wav|mov|avi|mkv|webm|3gp)$/;

export function isRenderableImage(
  contentType?: string,
  fileName?: string,
  url?: string,
): boolean {
  const mime = contentType?.toLowerCase().trim();
  if (mime) return mime.startsWith("image/");
  const path = (fileName || url?.split("?")[0] || "").toLowerCase();
  return !NON_IMAGE_EXT.test(path);
}

// A short badge for the chip. "PDF" beats "application/pdf" on a bubble the
// width of a thumb.
export function mediaTypeLabel(contentType?: string, fileName?: string): string {
  const mime = contentType?.toLowerCase().trim() ?? "";
  // Named here because a video has no filename to fall through to: the
  // library tile and the attach card would otherwise label it with nothing.
  if (mime.startsWith("video/")) return "Video";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "Excel";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "PPT";
  if (mime.includes("word") || mime.includes("officedocument.wordprocessing")) return "Word";
  if (mime.includes("zip")) return "ZIP";
  const ext = fileName?.includes(".") ? fileName.split(".").pop() : undefined;
  if (ext && ext.length <= 4) return ext.toUpperCase();
  return "";
}

// Is this a voice note rather than an audio FILE?
//
// The inference is safe because the two genuinely differ at the source: a
// recording carries no filename (Meta sends none — nobody named it), while an
// audio file somebody picked out of their phone's storage arrives with its
// name attached. Worth separating because "Sesli mesaj" is what WhatsApp
// itself calls the thing, and it is what a salon owner scanning an inbox for
// what arrived needs to read.
export function isVoiceNote(
  contentType?: string,
  fileName?: string,
  url?: string,
): boolean {
  return (
    !fileName && mediaKindOf(url ?? "", fileName, contentType) === "audio"
  );
}
