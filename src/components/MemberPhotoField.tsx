"use client";

// Your own photo in this business (P33, Nudge's PersonPhotoField: df492c1c,
// b95b7aaa, 63cac371, 2f11958a). The circle is the control: click it to
// choose a file, drop a picture on it, or paste one anywhere on the Account
// page. It is squared and shrunk here before it goes up (squarePhoto), and
// the server holds the type and size whatever arrives (users.setMyPhoto).
// Remove goes back to the Google picture, then initials.
//
// Always the caller's own: the mutations resolve the membership themselves
// and take no id, so this component has nobody else's photo to touch.

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useToast } from "@/lib/ToastProvider";
import { isFileDrag, kindOfFile, pastedFiles, squarePhoto } from "@/lib/mediaFiles";
import { Avatar } from "./Avatar";
import { buttonClass } from "./Control";

// A paste that belongs to something else: a text field, an editor, or
// anything inside an open dialog or the docked compose window, focused or
// not (Nudge 2f11958a: an image pasted into a field is the field's business).
function pasteBelongsElsewhere(target: EventTarget | null): boolean {
  for (const el of [target, document.activeElement]) {
    if (!(el instanceof HTMLElement)) continue;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      return true;
    }
    if (el.isContentEditable) return true;
    if (el.closest('[role="dialog"], [aria-modal="true"]')) return true;
  }
  return !!document.querySelector('[aria-modal="true"], [role="dialog"]');
}

// Over the circle on hover or keyboard focus: the words are in the label and
// the (i), the mark only says the circle is a control.
function CameraMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.25" />
    </svg>
  );
}

export function MemberPhotoField({
  name,
  email,
  photo,
  uploaded,
  canEdit,
}: {
  name?: string | null;
  email?: string | null;
  photo: string | null;
  uploaded: boolean;
  canEdit: boolean;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const uploadUrl = useMutation(api.users.photoUploadUrl);
  const setPhoto = useMutation(api.users.setMyPhoto);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const square = await squarePhoto(file);
      if (!square) {
        toast(t("account.photoNotImage"));
        return;
      }
      const url = await uploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: square,
      });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const { storageId } = (await res.json()) as { storageId: string };
      const r = await setPhoto({ storageId: storageId as Id<"_storage"> });
      toast(
        r.ok
          ? t("account.photoSaved")
          : r.reason === "too-large"
            ? t("account.photoTooLarge")
            : t("account.photoNotImage"),
      );
    } catch {
      toast(t("account.photoFailed"));
    } finally {
      setBusy(false);
    }
  };
  // The paste listener below holds `take` by ref, so it always reads the
  // latest busy state without re-subscribing on every render.
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  });

  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      if (pasteBelongsElsewhere(e.target)) return;
      const file = pastedFiles(e.clipboardData).find((f) => kindOfFile(f) === "image");
      if (!file) return;
      e.preventDefault();
      void takeRef.current(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canEdit]);

  const remove = async () => {
    setBusy(true);
    try {
      await setPhoto({ storageId: null });
      toast(t("account.photoRemoved"));
    } catch {
      toast(t("account.photoFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return <Avatar size="lg" name={name} email={email} image={photo} />;
  }

  const addOrChange = uploaded ? t("account.photoChange") : t("account.photoAdd");

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          if (!isFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!isFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          setOver(false);
          void take(Array.from(e.dataTransfer.files).find((f) => kindOfFile(f) === "image"));
        }}
        aria-label={addOrChange}
        disabled={busy}
        className={`group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
          busy ? "animate-pulse" : ""
        }`}
      >
        <Avatar size="lg" name={name} email={email} image={photo} />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-white transition-opacity ${
            over ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          }`}
        >
          <CameraMark />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {/* Ghost buttons beside the circle, never under it: the row keeps the
          circle's height whether or not Remove is there. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className={buttonClass("quiet", "xs")}
        >
          {addOrChange}
        </button>
        {uploaded && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className={buttonClass("quiet", "xs")}
          >
            {t("account.photoRemove")}
          </button>
        )}
      </div>
    </div>
  );
}
