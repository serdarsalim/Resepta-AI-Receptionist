"use client";

import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useToast } from "@/lib/ToastProvider";
import { dismissNotice, notify, updateNotice } from "@/lib/notices";
import { appendSignature, signatureText, swapSignature } from "@/lib/signature";
import { iconButtonClass } from "./Control";
import { ComposeDock } from "./ComposeDock";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { HoverTip } from "./HoverTip";
import { SendSplitButton } from "./SendSplitButton";
import { SignatureMenu } from "./SignatureMenu";

// The email to one customer, in Gmail's compose window (P28, Nudge
// 0af64cfe..525197d8, a1f2e400, f762edab, d2f22780, cc709ea8). It replaced the
// box that opened inside the email tab: that one held the tab hostage while
// you wrote and lost the words if you clicked another tab.
//
// From, To and Subject are flat lines with a hairline under each; the text
// fills the window; the formatting tools sit under it and ONE bar at the
// bottom holds Send (split, with Schedule send), the signature menu, "Draft
// saved" and the bin. Once you start writing, To folds away and only From
// stays, since the title already names who it is to; clicking From opens it
// again, as in Gmail.
//
// Send closes the window and a bottom-left "Sending… Undo" note counts down
// the ten-second hold (email.sendToCustomer `hold`). The window is only
// HIDDEN for the hold, never unmounted, so Undo brings it back with
// everything in it; it really closes when the hold lapses. The note lives in
// the app-wide notice store, so it keeps counting if the page behind closes
// this window early, and Undo then still cancels, it just has no draft left to
// reopen.

// Drafts live in THIS browser, per signed-in person, business and customer (a
// reply keeps its own, by subject). Serdar's pick in Nudge (2026-10-17):
// offered browser or account, he chose browser. A convenience, not a record,
// so a blocked or cleared storage just means no draft. Sending clears it once
// the hold has passed; the bin discards it.
type Draft = { subject: string; body: string };

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      subject: typeof parsed.subject === "string" ? parsed.subject : "",
      body: typeof parsed.body === "string" ? parsed.body : "",
    };
  } catch {
    return null;
  }
}

function forgetDraft(key: string | null) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage blocked: there was nothing to forget.
  }
}

export function EmailComposeWindow({
  customerId,
  customerName,
  firstName,
  customerEmail,
  initialSubject,
  errorText,
  onClose,
}: {
  customerId: Id<"customers">;
  customerName: string;
  firstName: string;
  // Undefined while the record loads; empty when they have no address.
  customerEmail: string | undefined;
  // Reply: the subject it opens with ("Re: …").
  initialSubject?: string;
  // The thread's own words for a refused send, so a refusal reads the same
  // here as on a failed card.
  errorText: (reason: string) => string;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const toast = useToast();
  const convex = useConvex();
  const settings = useQuery(api.orgs.current, {});
  const sender = useQuery(api.email.composeSender, {});
  const sigs = useQuery(api.emailSignatures.available, {});
  const sendEmail = useAction(api.email.sendToCustomer);
  const cancelScheduled = useMutation(api.wa.cancelScheduled);

  const [hidden, setHidden] = useState(false);
  const alive = useRef(true);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  const draftKey =
    settings?.me.email && settings.org._id
      ? `resepta.emailDraft.${settings.me.email}.${settings.org._id}.${customerId}${
          initialSubject ? `.re:${initialSubject}` : ""
        }`
      : null;

  // Every signature that could be at the tail: the swap candidates.
  const candidates = useMemo(
    () => [
      ...(sigs?.mine ?? []).map((sig) => sig.html),
      ...(sigs?.shared ?? []).map((row) => row.signature.html),
    ],
    [sigs],
  );
  const defaultSignature = useMemo(() => {
    const id = sigs?.defaultId;
    if (!id) return undefined;
    return (
      sigs.mine.find((sig) => sig._id === id)?.html ??
      sigs.shared.find((row) => row.signature._id === id)?.signature.html
    );
  }, [sigs]);

  // What the window opens with, once, when the person and the signatures have
  // both landed: a draft left on this customer wins (it is exactly where you
  // were), else an empty body under your default signature.
  const [resolved, setResolved] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    if (resolved || settings === undefined || sigs === undefined) return;
    setResolved(true);
    const draft = draftKey ? readDraft(draftKey) : null;
    if (draft) {
      setSubject(draft.subject);
      setBody(draft.body);
      setHasDraft(true);
      return;
    }
    setBody(appendSignature("", defaultSignature));
  }, [resolved, settings, sigs, draftKey, defaultSignature]);

  // Written on every change once the window has settled. Empty is no draft:
  // no subject and no words beyond the signature.
  useEffect(() => {
    if (!resolved || !draftKey) return;
    const words = signatureText(body);
    const empty =
      !subject.trim() &&
      (!words || candidates.some((html) => signatureText(html) === words));
    try {
      if (empty) {
        localStorage.removeItem(draftKey);
        setHasDraft(false);
      } else {
        localStorage.setItem(draftKey, JSON.stringify({ subject, body }));
        setHasDraft(true);
      }
    } catch {
      // Storage blocked or full: the window still works, it just won't remember.
    }
  }, [resolved, draftKey, subject, body, candidates]);

  const hasEmail = !!customerEmail;
  const hasText = body.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() !== "";
  const canSend = !sending && hasEmail && hasText && sender !== null;

  const fmtWhen = useCallback(
    (ms: number) =>
      new Date(ms).toLocaleString(language, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [language],
  );

  // After the server parked the row: hide, count down, and settle exactly
  // once, by Undo or by the clock, whichever gets there first.
  const afterParked = (messageId: Id<"messages">, sendAt: number, scheduled: number | undefined) => {
    setHidden(true);
    const doneNote = {
      text: scheduled ? t("compose.scheduledFor", { when: fmtWhen(sendAt) }) : t("compose.sent"),
      durationMs: 5000,
    };
    const holdMs = scheduled ? 10_000 : Math.max(0, sendAt - Date.now());
    const key = draftKey;
    let settled = false;
    const id = notify({
      text: scheduled ? doneNote.text : t("compose.sending"),
      actions: [
        {
          label: t("compose.undo"),
          onClick: () => {
            if (settled) return;
            settled = true;
            updateNotice(id, { text: t("compose.undoing") });
            void cancelScheduled({ messageId })
              .then((cancelled) => {
                if (!cancelled) throw new Error("gone");
                if (alive.current) {
                  dismissNotice(id);
                  setHidden(false);
                } else {
                  updateNotice(id, { text: t("compose.cancelled"), durationMs: 5000 });
                }
              })
              .catch(() => {
                // The hold ran out between the click and the cancel: it went.
                forgetDraft(key);
                updateNotice(id, doneNote);
                if (alive.current) onCloseRef.current();
              });
          },
        },
      ],
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      forgetDraft(key);
      updateNotice(id, doneNote);
      if (alive.current) onCloseRef.current();
    }, holdMs);
  };

  const handleSend = async (whenMs?: number) => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendEmail({
        customerId,
        subject,
        // The action flattens the markup itself and stores both, so the feed
        // index reads words and the thread renders what was actually sent.
        body: "",
        html: body,
        ...(whenMs ? { scheduledFor: whenMs } : { hold: true }),
      });
      if (!result.ok) {
        setError(errorText(result.reason ?? "error"));
        return;
      }
      if (result.messageId && result.sendAt) {
        afterParked(result.messageId, result.sendAt, whenMs);
      } else {
        forgetDraft(draftKey);
        notify({ text: t("compose.sent"), durationMs: 5000 });
        onClose();
      }
    } catch {
      setError(errorText("error"));
    } finally {
      setSending(false);
    }
  };

  const discard = () => {
    forgetDraft(draftKey);
    onClose();
  };

  const folded = writing && hasEmail;
  const title = initialSubject
    ? t("compose.replyTo", { name: firstName || customerName })
    : t("compose.emailTo", { name: firstName || customerName });

  return (
    <ComposeDock
      hidden={hidden}
      title={title}
      // Gmail's window, about 36rem by 40rem: a composer, not a page.
      width="w-[36rem]"
      height="h-[min(88dvh,40rem)]"
      expandable
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">
        <EnvelopeLine label={t("compose.from")} onClick={folded ? () => setWriting(false) : undefined}>
          <span className="min-w-0 truncate">
            {sender === undefined ? "" : sender ?? (
              <span className="text-red-600 dark:text-red-400">{t("error.email-not-configured")}</span>
            )}
          </span>
        </EnvelopeLine>
        {!folded && (
          <EnvelopeLine label={t("compose.to")}>
            <p className="min-w-0 truncate">
              {customerEmail === undefined ? null : hasEmail ? (
                <>
                  <span className="font-medium">{customerName}</span>{" "}
                  <span className="text-[var(--muted-strong)]">&lt;{customerEmail}&gt;</span>
                </>
              ) : (
                <span className="text-[var(--muted)]">{t("compose.noEmail", { name: customerName })}</span>
              )}
            </p>
          </EnvelopeLine>
        )}
        <div className="flex min-h-0 flex-1 flex-col" onFocus={() => setWriting(true)}>
          <EnvelopeLine>
            <input
              value={subject}
              disabled={sending || !hasEmail}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t("email.subject")}
              aria-label={t("email.subject")}
              className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-none placeholder:text-[var(--muted)] focus:outline-none disabled:opacity-50"
            />
          </EnvelopeLine>
          {resolved ? (
            <EmailBodyEditor
              dock
              compact
              showVariables={false}
              insertPhoto
              // A one-off mail to this customer: a picked variable becomes
              // their value now, since nothing renders this body at send.
              resolveToken={(token) =>
                convex.query(api.email.renderTokenForCustomer, { customerId, token })
              }
              onTokenEmpty={(label) => toast(t("email.variableEmpty", { name: label }))}
              value={body}
              onSave={setBody}
              onLiveChange={setBody}
              disabled={sending || !hasEmail}
              // No placeholder, as in Gmail: an empty sheet is the prompt.
              placeholder=""
            />
          ) : (
            <div className="min-h-0 flex-1" />
          )}
        </div>
        {error && <p className="pt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex shrink-0 items-center gap-1 pt-2">
          <SendSplitButton
            label={sending ? t("compose.sending") : t("contact.send")}
            disabled={!canSend}
            onSend={() => void handleSend()}
            onSchedule={(ms) => void handleSend(ms)}
          />
          <div className="ml-1 flex items-center">
            <SignatureMenu onApply={(html) => setBody((current) => swapSignature(current, candidates, html))} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            {hasDraft && (
              <span className="shrink-0 text-xs text-[var(--muted)]">{t("compose.draftSaved")}</span>
            )}
            <HoverTip text={t("compose.discard")} side="top">
              <button
                type="button"
                aria-label={t("compose.discard")}
                onClick={discard}
                className={iconButtonClass("quiet", "sm")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            </HoverTip>
          </div>
        </div>
      </div>
    </ComposeDock>
  );
}

// One envelope line: the label, then whatever the line holds, a hairline
// under it. Gmail's From / To / Subject, with nothing boxed. The rule is about
// half the app's border: a full --border read as a ruled form.
function EnvelopeLine({
  label,
  children,
  onClick,
}: {
  label?: string;
  children: ReactNode;
  // A folded envelope line opens the envelope again.
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-[color-mix(in_srgb,var(--border)_55%,transparent)] text-sm ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      {label && <span className="shrink-0 text-[var(--muted-strong)]">{label}</span>}
      {children}
    </div>
  );
}
