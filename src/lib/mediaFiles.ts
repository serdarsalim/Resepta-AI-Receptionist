// Browser-side rules for files headed into the attachment library (P14, the
// Nudge port of src/lib/mediaFiles.ts): what counts as an image, a video or a
// document, how a pasted or dropped file is recognised, and how an over-size
// image is made to fit. No React, so the composer and the library share one
// set of answers.
//
// The limits mirror convex/media.ts, which re-checks every upload; these exist
// so a person hears "too big" before the bytes travel, not after.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

// What the file picker offers. Images of any kind are accepted because
// prepareImage redraws whatever WhatsApp would not send as a picture.
export const MEDIA_ACCEPT =
  "image/*,video/mp4,video/3gpp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

const DOC_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i;
const VIDEO_MIME = new Set(["video/mp4", "video/3gpp"]);

export type FileKind = "image" | "video" | "document" | "unsupported";

export function kindOfFile(file: File): FileKind {
  if (file.type.startsWith("image/") || (!file.type && IMAGE_EXT.test(file.name))) {
    return "image";
  }
  if (VIDEO_MIME.has(file.type)) return "video";
  if (DOC_MIME.has(file.type) || DOC_EXT.test(file.name)) return "document";
  return "unsupported";
}

// The files a paste carries, or none when the paste is really text. Copying
// cells from a spreadsheet or a paragraph from a Word document puts a PICTURE
// of them on the clipboard beside the text, and the person meant the text; a
// screenshot or a browser's "Copy image" carries no text at all.
export function pastedFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length === 0) return [];
  if ((data.getData("text/plain") ?? "").trim()) return [];
  return files;
}

// A drag carrying files from the desktop, as opposed to text being moved
// inside the page.
export function isFileDrag(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types ?? []).includes("Files");
}

// What a library asset is called. A clipboard image arrives as "image.png"
// whatever it shows, which would fill the library with identical names, so a
// paste is named for when it happened instead (`pastedLabel`, translated by
// the caller). Images drop their extension; a document keeps it, because it is
// the filename the customer sees.
export function libraryNameFor(
  file: File,
  kind: FileKind,
  pastedLabel: string,
  now: Date = new Date(),
): string {
  if (kind === "document") return file.name;
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  if (base && !/^image$/i.test(base)) return base;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pastedLabel} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Fall through to <img>, which decodes a few formats createImageBitmap
      // refuses.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// An image the library will take: JPEG or PNG, at most MAX_IMAGE_BYTES. One
// already under the cap goes up untouched. Anything else is redrawn: other
// formats (a phone's HEIC, a WebP from a website) because WhatsApp sends only
// JPEG and PNG as a picture, and big ones because a phone photo is routinely
// 4-6 MB and the old answer was an error the person could do nothing with.
//
// A PNG is tried as a PNG first, because a screenshot of a price list stays
// crisp that way and JPEG smears the text. Then JPEG at falling quality, then
// the whole ladder again smaller. Throws "too-large" only when even the last
// rung does not fit.
export async function prepareImage(file: File): Promise<File> {
  const sendable = file.type === "image/jpeg" || file.type === "image/png";
  if (sendable && file.size <= MAX_IMAGE_BYTES) return file;

  const img = await decode(file);
  try {
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    for (const edge of [2560, 2048, 1600, 1280, 1024]) {
      const scale = Math.min(1, edge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d");
      if (!g) break;
      if (file.type === "image/png" || file.type === "image/gif" || file.type === "image/webp") {
        g.drawImage(img.source, 0, 0, w, h);
        const png = await encode(canvas, "image/png");
        if (png && png.size <= MAX_IMAGE_BYTES) {
          return new File([png], `${base}.png`, { type: "image/png" });
        }
      }
      // JPEG has no transparency: a see-through PNG would turn black, so it
      // is laid on white first, which is what it looks like on a phone anyway.
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, w, h);
      g.drawImage(img.source, 0, 0, w, h);
      for (const q of [0.9, 0.82, 0.74]) {
        const jpg = await encode(canvas, "image/jpeg", q);
        if (jpg && jpg.size <= MAX_IMAGE_BYTES) {
          return new File([jpg], `${base}.jpg`, { type: "image/jpeg" });
        }
      }
    }
  } finally {
    img.close();
  }
  throw new Error("too-large");
}

// POST to a Convex upload URL with progress. fetch() cannot report upload
// progress, and a video on a slow connection is long enough to want a bar.
export function uploadWithProgress(
  uploadUrl: string,
  file: Blob,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`upload-failed-${xhr.status}`));
        return;
      }
      try {
        resolve((JSON.parse(xhr.responseText) as { storageId: string }).storageId);
      } catch {
        reject(new Error("upload-failed"));
      }
    };
    xhr.onerror = () => reject(new Error("upload-failed"));
    xhr.send(file);
  });
}

// Takes a file the way a person handed it over and gets it ready for the
// library: an image shrunk or redrawn to fit, a video or document checked
// against its cap. Throws "too-large" or "unsupported-type", the same slugs
// convex/media.ts register throws, so one error mapping serves both.
export async function prepareForLibrary(file: File): Promise<{ file: File; kind: FileKind }> {
  const kind = kindOfFile(file);
  if (kind === "unsupported") throw new Error("unsupported-type");
  if (kind === "image") return { file: await prepareImage(file), kind };
  const cap = kind === "video" ? MAX_VIDEO_BYTES : MAX_DOC_BYTES;
  if (file.size > cap) throw new Error("too-large");
  return { file, kind };
}

// A person's photo (P33, Nudge's PersonPhotoField): centre-cropped to a
// square and shrunk to at most PHOTO_SIDE, as a JPEG. Big enough for the
// largest circle the app draws at 2x, small enough to load in a list of note
// authors; a 12 MB phone photo arrives as tens of KB, well inside the
// server's 1 MB ceiling (convex/lib/memberPhoto). Null when the browser
// cannot read the file as a picture.
const PHOTO_SIDE = 512;

export async function squarePhoto(file: File): Promise<Blob | null> {
  if (kindOfFile(file) !== "image") return null;
  let img: Awaited<ReturnType<typeof decode>>;
  try {
    img = await decode(file);
  } catch {
    return null;
  }
  try {
    const side = Math.min(img.width, img.height);
    const out = Math.min(PHOTO_SIDE, side);
    if (!out) return null;
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const g = canvas.getContext("2d");
    if (!g) return null;
    // A transparent PNG would go black as a JPEG: give it white.
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, out, out);
    g.drawImage(
      img.source,
      (img.width - side) / 2,
      (img.height - side) / 2,
      side,
      side,
      0,
      0,
      out,
      out,
    );
    return await encode(canvas, "image/jpeg", 0.88);
  } finally {
    img.close();
  }
}
