"use client";

// One uploader for the attachment library (P14, Nudge's useMediaUploader cut
// to what Resepta's one composer needs). Every way a file arrives (the
// library's + tile, a paste into the message box, a drop onto the
// conversation) goes through this, so each lands in the library to reuse and
// each says the same thing when it cannot.

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useT } from "./LanguageProvider";
import { libraryNameFor, prepareForLibrary, uploadWithProgress } from "./mediaFiles";

export type LibraryAsset = FunctionReturnType<typeof api.media.list>[number];

export function useLibraryUpload() {
  const t = useT();
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const register = useMutation(api.media.register);
  // 0..1 while a file travels, null at rest.
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The same bytes were already in the library and that asset came back
  // instead of a copy. Said once, so a second paste of one screenshot does
  // not look like it silently did nothing.
  const [deduped, setDeduped] = useState(false);

  const upload = useCallback(
    async (original: File): Promise<LibraryAsset | null> => {
      setError(null);
      setDeduped(false);
      setProgress(0);
      try {
        const { file, kind } = await prepareForLibrary(original);
        const url = await generateUploadUrl();
        const storageId = await uploadWithProgress(url, file, setProgress);
        // The backend re-checks type and size against what actually landed;
        // the upload URL accepts anything, so this is where the limits are
        // real. Its error slug is what the reader sees, translated.
        const result = await register({
          storageId: storageId as Id<"_storage">,
          name: libraryNameFor(file, kind, t("media.pastedName")),
        });
        setDeduped(result.deduped);
        return result.asset;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "";
        setError(
          reason.includes("too-large")
            ? t("media.tooLarge")
            : reason.includes("unsupported-type")
              ? t("media.unsupported")
              : t("message.failed"),
        );
        return null;
      } finally {
        setProgress(null);
      }
    },
    [generateUploadUrl, register, t],
  );

  const clear = useCallback(() => {
    setError(null);
    setDeduped(false);
  }, []);

  return { upload, progress, error, deduped, clear };
}
