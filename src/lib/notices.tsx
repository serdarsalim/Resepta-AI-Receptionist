"use client";

import { useSyncExternalStore } from "react";
import { useLanguage } from "./LanguageProvider";

// Notices: the bottom-left note with actions, Gmail's (P28, Nudge a1f2e400).
//
// Not the toast (ToastProvider): a toast confirms and leaves on its own, a
// notice OUTLIVES the component that raised it, which is the point. The email
// window closes the moment you press Send and its "Sending… Undo" has to keep
// counting after the window is gone, so the notes live in a module store and
// one NoticeHost (inside ToastProvider) draws them. `notify` returns an id
// the caller moves through its states with `updateNotice` (Sending… → Email
// sent) and ends with `dismissNotice`. A duration ends a note by itself; none
// keeps it until the caller says.

export type NoticeAction = { label: string; onClick: () => void };
type Notice = { id: number; text: string; actions: NoticeAction[] };
type NoticeInput = { text: string; actions?: NoticeAction[]; durationMs?: number };

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const emit = () => listeners.forEach((listener) => listener());

function arm(id: number, durationMs?: number) {
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  timers.delete(id);
  if (durationMs !== undefined) timers.set(id, setTimeout(() => dismissNotice(id), durationMs));
}

export function notify(input: NoticeInput): number {
  const id = nextId++;
  notices = [...notices, { id, text: input.text, actions: input.actions ?? [] }];
  arm(id, input.durationMs);
  emit();
  return id;
}

// Replaces the text and actions; a duration re-arms the clock. A note already
// gone (closed by hand) stays gone.
export function updateNotice(id: number, input: NoticeInput) {
  if (!notices.some((n) => n.id === id)) return;
  notices = notices.map((n) =>
    n.id === id ? { id, text: input.text, actions: input.actions ?? [] } : n,
  );
  arm(id, input.durationMs);
  emit();
}

export function dismissNotice(id: number) {
  arm(id, undefined);
  if (!notices.some((n) => n.id === id)) return;
  notices = notices.filter((n) => n.id !== id);
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const EMPTY: Notice[] = [];

// Bottom-LEFT, like Gmail's, so it never sits on the compose tray (bottom
// right). Above the docks (z-40), under the sheets and dialogs (z-50). The
// tooltip's inverted ink in both modes, with the action in a lighter or darker
// accent so it reads as the thing to press on either. Above the phone tab bar
// below sm, where the bar owns the bottom edge.
export function NoticeHost() {
  const list = useSyncExternalStore(subscribe, () => notices, () => EMPTY);
  const { t } = useLanguage();
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-6 z-[45] flex flex-col gap-2 max-sm:bottom-20 max-sm:left-4 max-sm:right-4">
      {list.map((notice) => (
        <div
          key={notice.id}
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex min-h-12 animate-[toast-in_150ms_ease-out] items-center gap-4 rounded-lg bg-[var(--foreground)] py-2 pl-4 pr-2 text-sm text-[var(--background)] shadow-2xl"
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          {notice.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="shrink-0 rounded-md px-2 py-1 font-semibold text-[color-mix(in_srgb,var(--accent)_65%,var(--background))] hover:bg-[color-mix(in_srgb,var(--background)_12%,transparent)]"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => dismissNotice(notice.id)}
            aria-label={t("common.close")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-70 hover:bg-[color-mix(in_srgb,var(--background)_12%,transparent)] hover:opacity-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
