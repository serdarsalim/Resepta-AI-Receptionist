"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";
import { Card } from "./Card";

// One upload flow, two surfaces: the onboarding wizard's number step and
// this card share it, so the validation and the error wording can never
// drift apart. Client-side checks mirror numberRequests.submit — the server
// remains the only place the limits are real.
export function useNumberDocumentUpload() {
  const { t } = useLanguage();
  const generateUploadUrl = useMutation(api.numberRequests.generateUploadUrl);
  const submitDocument = useMutation(api.numberRequests.submit);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    if (!allowed.includes(file.type)) {
      setError(t("onboarding.uploadFailedType"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t("onboarding.uploadFailedSize"));
      return;
    }
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as {
        storageId: Id<"_storage">;
      };
      await submitDocument({ storageId, fileName: file.name });
    } catch (err) {
      setError(
        String(err).includes("too-large")
          ? t("onboarding.uploadFailedSize")
          : t("onboarding.uploadFailedType"),
      );
    } finally {
      setUploading(false);
    }
  };

  return { uploading, error, upload };
}

// Where the org's number request stands, on the Voice tab under the agents —
// the follow-through on the wizard's 24-hour promise, and the door for a
// skipped upload or a denied document's correction. Owners only: the query
// resolves null for staff and the card simply never renders.
export function NumberRequestCard() {
  const { t, language } = useLanguage();
  const request = useQuery(api.numberRequests.mine, {});
  const { uploading, error, upload } = useNumberDocumentUpload();
  const fileInput = useRef<HTMLInputElement>(null);

  if (request === undefined) return null;

  return (
    <Card>
      <p className="text-sm font-medium">{t("onboarding.numberTitle")}</p>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {request === null ? (
        <>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {t("onboarding.numberPromise")}
          </p>
          <div className="mt-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
            >
              {uploading ? t("common.loading") : t("onboarding.uploadDoc")}
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {t("onboarding.uploadHint")}
          </p>
        </>
      ) : (
        <>
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
              request.status === "denied"
                ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
            }`}
          >
            {request.status === "pending" && t("numberReq.pending")}
            {request.status === "approved" && t("numberReq.approved")}
            {request.status === "denied" && t("numberReq.denied")}
            {request.note && (
              <span className="mt-1 block text-xs opacity-80">
                {request.note}
              </span>
            )}
          </div>
          {/* The filename is the link, not a separate "Download" beside it:
              the thing on screen IS the document, and a second control would
              be a button whose label repeats the noun next to it.

              New tab, because this card is a request in flight — a PDF that
              replaced the page would make the reader navigate back to the
              state they were checking. Falls back to plain text if the URL
              is null, which happens only if the blob went missing under a row
              that outlived it. */}
          <p className="mt-2 text-xs text-[var(--muted)]">
            {request.url ? (
              <a
                href={request.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] transition-colors hover:underline"
              >
                {request.fileName}
              </a>
            ) : (
              request.fileName
            )}{" "}
            · {formatDateTime(request.createdAt, language)}
          </p>
          {request.status !== "approved" && (
            <div className="mt-3">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
                className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
              >
                {uploading
                  ? t("common.loading")
                  : t("onboarding.uploadReplace")}
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </Card>
  );
}
