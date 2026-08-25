"use client";

// Shared pieces of the operator console. Split out because the fleet list and
// a tenant's own page both need them and neither owns them.
//
// English-only on purpose, like the rest of /admin: lib/i18n exists so SALON
// staff read the product in their own language, and this surface has exactly
// one reader.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { InfoTip } from "@/components/InfoTip";
import type { Search } from "@/lib/useTableState";

// The console's plane, and the reason /admin now looks like the product it
// administers. The salon app gets its wash from AppShell's content pane
// (bg-[image:var(--content-bg)]); this route has no shell at all, so the same
// token goes on the page root instead. Cards are paper on it, exactly as they
// are one click away in the salon's own screens.
//
// bg-fixed is load-bearing, not decoration. A gradient restarts inside
// whatever box draws it, so on a document that scrolls the wash would slide
// under the cards; anchored to the viewport it stays one plane however far
// down the page you are.
//
// page-stack is the house rule for the bottom edge: 6rem below the last card,
// so the page reads as having ENDED rather than having been cut off.
export function Plane({
  narrow,
  className = "",
  children,
}: {
  // The fleet table wants every column it can get; a tenant's settings are
  // rows of label + control and read badly at full width.
  narrow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[image:var(--content-bg)] bg-fixed">
      <main
        className={`page-stack mx-auto px-4 pt-6 sm:px-6 ${
          narrow ? "max-w-4xl" : "max-w-6xl"
        } ${className}`}
      >
        {children}
      </main>
    </div>
  );
}

export function ago(at: number | undefined): string {
  if (!at) return "never";
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// A count worth reading, or nothing at all. Walls of "0" are noise the eye has
// to filter before it can find the one number that isn't zero.
export function Count({
  value,
  tone,
  capped,
}: {
  value: number;
  tone: "bad" | "warn" | "plain";
  capped?: boolean;
}) {
  if (value === 0) return <span className="text-[var(--muted)]">—</span>;
  const color =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "";
  return (
    <span className={`font-medium tabular-nums ${color}`}>
      {value}
      {capped ? "+" : ""}
    </span>
  );
}

// An id or an address you came here to paste somewhere else. Shared rather
// than living on one page: the tenant detail and the Members card both draw
// it, and a second copy is a second set of paddings to keep in step.
export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy"
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--muted-bg)] px-1.5 py-0.5 font-mono text-[11px] hover:opacity-80"
    >
      <span className="truncate">{value}</span>
      <span className="w-8 shrink-0 text-left text-[var(--muted)]">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}


// Delivery outcome as a dot and a word. Failed is the loud one; queued is a
// normal in-flight state, not an alarm.
function StatusPill({ status, deadLettered }: { status: string; deadLettered: boolean }) {
  const tone =
    status === "failed"
      ? "bg-red-500"
      : status === "queued"
        ? "bg-amber-400"
        : status === "received"
          ? "bg-sky-500"
          : "bg-emerald-500";
  const text =
    status === "failed" ? "text-red-600 dark:text-red-400" : "text-[var(--muted)]";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
      {status}
      {deadLettered ? " · gave up" : ""}
    </span>
  );
}

const MESSAGE_STATUSES = [
  "failed",
  "queued",
  "sent",
  "delivered",
  "read",
  "received",
] as const;
type MessageStatus = (typeof MESSAGE_STATUSES)[number];

type ActivityRow = {
  _id: string;
  at: number;
  kind: string;
  direction: "out" | "in";
  status: string;
  error?: string;
  attempts?: number;
  deadLettered: boolean;
};


// Plain English, matching the rest of /admin. The tenant app translates these
// same kinds through i18n; this surface has one reader and it is an operator.
// Explicit map rather than a template lookup so a kind written by a newer
// deploy than this bundle falls through to its raw value instead of blanking
// the row.
const USER_ACTIVITY_LABELS: Record<string, string> = {
  appointment_created: "Appointment created",
  appointment_status: "Appointment status changed",
  appointment_moved: "Appointment moved",
  appointment_deleted: "Appointment deleted",
  customer_created: "Customer created",
  customer_deleted: "Customer deleted",
  settings_changed: "Settings changed",
  member_invited: "Member invited",
  member_removed: "Member removed",
  whatsapp_connected: "WhatsApp connected",
  booking_dropped: "Booking dropped",
};

type UserActivityRow = {
  _id: string;
  at: number;
  kind: string;
  detail?: string;
  actor?: string;
  customerName?: string;
};

// Who did what INSIDE the app, as opposed to <Activity> below it, which is the
// message feed. Both were called "activity" and answer different questions, so
// they sit one above the other and each says which it is.
//
// Operator names are real here, not masked behind the brand: the reader is the
// operator, and "which of us changed this" is the question the page exists for.
export function UserActivity({ orgId }: { orgId: Id<"orgs"> }) {
  const rows = useQuery(api.platform.orgUserActivity, { orgId }) as
    | UserActivityRow[]
    | undefined;
  const when = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (rows === undefined) {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted)]">Nothing yet.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--border)]">
      {rows.map((row) => (
        <li key={row._id} className="flex items-baseline gap-3 py-1.5 text-sm">
          <span className="w-28 shrink-0 text-xs tabular-nums text-[var(--muted)]">
            {when.format(row.at)}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {USER_ACTIVITY_LABELS[row.kind] ?? row.kind}
            {row.customerName && (
              <span className="text-[var(--muted)]"> · {row.customerName}</span>
            )}
            {row.detail && (
              <span className="text-[var(--muted)]"> · {row.detail}</span>
            )}
          </span>
          <span className="shrink-0 text-xs text-[var(--muted)]">
            {row.actor ?? "system"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Activity({ orgId }: { orgId: Id<"orgs"> }) {
  const [filter, setFilter] = useState<MessageStatus | "">("");
  const { results, status: loadStatus, loadMore } = usePaginatedQuery(
    api.platform.orgActivity,
    { orgId, status: filter || undefined },
    { initialNumItems: 25 },
  );
  const rows = results as ActivityRow[];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as MessageStatus | "")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
        >
          <option value="">All statuses</option>
          {MESSAGE_STATUSES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </div>
      {loadStatus !== "LoadingFirstPage" && rows.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--muted)]">
          {filter ? `No ${filter} messages.` : "No messages yet."}
        </div>
      ) : (
        <ActivityTable rows={rows} />
      )}
      {loadStatus === "CanLoadMore" && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadMore(50)}
            className="rounded-lg px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => (
            // --table-divider, not --border: the card edge token is tuned to
            // be found, and a row rule drawn at that weight turns a feed into
            // a spreadsheet.
            <tr key={row._id} className="border-t border-[var(--table-divider)]">
              <td className="whitespace-nowrap px-3 py-1.5 text-[var(--muted-strong)] tabular-nums">
                {ago(row.at)} ago
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                {row.kind}
                <span className="ml-1.5 text-[var(--muted)]">
                  {row.direction === "in" ? "in" : "out"}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <StatusPill status={row.status} deadLettered={row.deadLettered} />
              </td>
              <td className="px-3 py-1.5 font-mono text-[11px]">
                {row.status === "failed" ? row.error ?? "—" : ""}
                {row.status === "failed" && row.attempts ? (
                  <span className="text-[var(--muted)]"> · {row.attempts} tries</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ---- Settings primitives, shared by the fleet page and a tenant's page ----

// Settings search. Both admin pages are long lists of labelled rows inside
// titled cards, which is exactly what a search box is for — "where do I set
// the voice rate" should not be a scroll. The salon app answers this with a
// hand-maintained index of translation keys (BusinessView's SEARCH_INDEX); the
// console cannot, because its labels are plain English literals scattered
// through two files with no dictionary to enumerate. So the rows report
// themselves instead: a Row knows its own label, hides when it does not match,
// and tells its Section whether it matched so an empty card can hide too. No
// index to keep in sync, and a row added later is searchable for free.
const AdminSearchContext = createContext<Search | null>(null);

type SectionReport = {
  // A section whose TITLE matches keeps all its rows: you searched for the
  // card, so you want what is in it.
  titleMatched: boolean;
  report: (label: string, hit: boolean) => void;
};
const SectionContext = createContext<SectionReport | null>(null);

export function AdminSearchProvider({
  search,
  children,
}: {
  search: Search;
  children: React.ReactNode;
}) {
  return (
    <AdminSearchContext.Provider value={search}>
      {children}
    </AdminSearchContext.Provider>
  );
}

// Rows outside a provider (there are none today, but a new admin surface
// should not have to opt in to render) behave as if nothing is being searched.
function useAdminSearch(): Search | null {
  return useContext(AdminSearchContext);
}

// Shared by Row and SecretRow: am I hidden right now, and does my section know
// whether I matched? Returns null when there is nothing to hide from.
function useRowSearch(label: string): { hidden: boolean } {
  const search = useAdminSearch();
  const section = useContext(SectionContext);
  const hit = search ? search.matches(label) : true;
  const { report } = section ?? {};
  useEffect(() => {
    report?.(label, hit);
  }, [report, label, hit]);
  if (!search?.active) return { hidden: false };
  return { hidden: !hit && !section?.titleMatched };
}

// The app's underline tabs, same measurements VoiceView documents (ported
// from Vercel): active is DARKER PLUS AN UNDERLINE, never bolder — weight
// stays 400 so nothing reflows on switch — and the hairline belongs to the
// strip, each tab overlapping it with -mb-px so the active underline replaces
// that segment of the rule. The admin console wore accent pills before, which
// made its tabs read as a different control from the same control one click
// away in the salon app.
export function TabStrip<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)]">
      {tabs.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry.id)}
          aria-current={active === entry.id ? "page" : undefined}
          className={`-mb-px border-b-2 px-0.5 py-2.5 text-sm transition-colors ${
            active === entry.id
              ? "border-[var(--foreground)] text-[var(--foreground)]"
              : "border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]"
          }`}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

export function Row({
  label,
  hint,
  current,
  placeholder,
  onSave,
}: {
  label: string;
  hint?: string;
  current?: string | null;
  placeholder?: string;
  onSave: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { hidden } = useRowSearch(label);
  if (hidden) return null;
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      {/* The hint rides an (i) beside the label, same affordance as Section's
          description. Rendered inline, every row's paragraph stacked into a
          wall of prose and the labels drowned in it — the reader who needs
          the explanation hovers for it, the reader who knows scans labels. */}
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{label}</div>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="min-w-0">
        <input
          value={draft ?? current ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === null || draft === (current ?? "")) return;
            void onSave(draft);
            setDraft(null);
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}

// A Row whose value is a model name, with a picker fed live from the
// provider's own model list the first time the field is focused (the nudge
// listOpenAiModels pattern: names churn, and a scoped key only reaches what
// it was granted, so a checked-in list would offer models that 403). Free
// text stays the contract — a picker that could not load must not stop the
// operator typing a model name — which is why a failed fetch becomes one
// muted line under the input rather than an error state.
export function ModelRow({
  label,
  hint,
  current,
  placeholder,
  loadOptions,
  onSave,
}: {
  label: string;
  hint?: string;
  current?: string | null;
  placeholder?: string;
  loadOptions: () => Promise<{ models: string[]; reason: string | null }>;
  onSave: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // null = never fetched; [] = fetched and empty, with reason saying why.
  const [options, setOptions] = useState<string[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const { hidden } = useRowSearch(label);
  if (hidden) return null;
  const filter = (draft ?? "").trim().toLowerCase();
  const matches = (options ?? []).filter((o) => o.toLowerCase().includes(filter));
  const fetchOnce = () => {
    if (options !== null) return;
    setOptions([]);
    void loadOptions()
      .then((r) => {
        setOptions(r.models);
        setReason(r.reason);
      })
      .catch(() => setReason("fetch-failed"));
  };
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{label}</div>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="relative min-w-0">
        <input
          value={draft ?? current ?? ""}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            fetchOnce();
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            if (draft === null || draft === (current ?? "")) return;
            void onSave(draft);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(null);
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
        />
        {open && matches.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
            {matches.map((o) => (
              <button
                key={o}
                type="button"
                // mousedown, ahead of the input's blur-commit, or the click
                // would save the half-typed draft instead of the pick.
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDraft(o);
                  setOpen(false);
                  if (o !== (current ?? "")) void onSave(o);
                }}
                className="block w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-[var(--muted-bg)]"
              >
                {o}
              </button>
            ))}
          </div>
        )}
        {options !== null && options.length === 0 && reason && (
          <div className="mt-0.5 text-xs text-[var(--muted)]">
            couldn&apos;t list models ({reason}) — type a name instead
          </div>
        )}
      </div>
    </div>
  );
}

// One LLM provider on one line: the key on the left half of the control
// column, the model beside it (Serdar, 2026-08-19). They are one decision —
// "what does this provider run as" — and stacked as four rows the page read
// as four unrelated settings. The key half follows SecretRow's contract
// (tail as placeholder, typing replaces, blank keeps); the model half is
// ModelRow's picker, fed on first focus. The model placeholder is the REAL
// default that applies when blank, same truthfulness rule as everywhere.
export function KeyModelRow({
  label,
  hint,
  masked,
  onSaveKey,
  model,
  modelPlaceholder,
  loadOptions,
  onSaveModel,
}: {
  label: string;
  hint?: string;
  masked?: string | null;
  onSaveKey: (value: string) => unknown;
  model?: string | null;
  modelPlaceholder?: string;
  loadOptions: () => Promise<{ models: string[]; reason: string | null }>;
  onSaveModel: (value: string) => unknown;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const { hidden } = useRowSearch(label);
  if (hidden) return null;
  const filter = (modelDraft ?? "").trim().toLowerCase();
  const matches = (options ?? []).filter((o) => o.toLowerCase().includes(filter));
  const fetchOnce = () => {
    if (options !== null) return;
    setOptions([]);
    void loadOptions()
      .then((r) => {
        setOptions(r.models);
        setReason(r.reason);
      })
      .catch(() => setReason("fetch-failed"));
  };
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{label}</div>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="flex min-w-0 gap-2">
        <input
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          onBlur={() => {
            const value = keyDraft.trim();
            if (!value) return;
            void onSaveKey(value);
            setKeyDraft("");
          }}
          placeholder={masked ?? undefined}
          aria-label={`${label} API key`}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
        />
        <div className="relative min-w-0 flex-1">
          <input
            value={modelDraft ?? model ?? ""}
            onChange={(e) => {
              setModelDraft(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              fetchOnce();
              setOpen(true);
            }}
            onBlur={() => {
              setOpen(false);
              if (modelDraft === null || modelDraft === (model ?? "")) return;
              void onSaveModel(modelDraft);
              setModelDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setModelDraft(null);
                setOpen(false);
              }
            }}
            placeholder={modelPlaceholder}
            autoComplete="off"
            aria-label={`${label} model`}
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
          />
          {open && matches.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
              {matches.map((o) => (
                <button
                  key={o}
                  type="button"
                  // mousedown, ahead of the input's blur-commit, or the click
                  // would save the half-typed draft instead of the pick.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setModelDraft(o);
                    setOpen(false);
                    if (o !== (model ?? "")) void onSaveModel(o);
                  }}
                  className="block w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-[var(--muted-bg)]"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          {options !== null && options.length === 0 && reason && (
            <div className="mt-0.5 text-xs text-[var(--muted)]">
              couldn&apos;t list models ({reason}) — type a name instead
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A secret already installed shows its tail as the input's own placeholder.
// Typing replaces it; leaving the box blank keeps what is there. The tail is
// a PLACEHOLDER, never the input's value: a value would submit the mask as
// the new key the first time somebody tabbed through the field.
//
// It used to sit under the label instead, which read as two facts in two
// places (Serdar, 2026-08-19). Now the field itself answers both questions:
// grey tail = this key is installed, empty = nothing is. That contract only
// holds if no field in the console wears an example placeholder — grey text
// in an input is a statement about what is stored or what applies, never
// decoration.
export function SecretRow({
  label,
  hint,
  masked,
  onSave,
}: {
  label: string;
  hint?: string;
  masked?: string | null;
  onSave: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState("");
  const { hidden } = useRowSearch(label);
  if (hidden) return null;
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{label}</div>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="min-w-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const value = draft.trim();
            if (!value) return;
            void onSave(value);
            setDraft("");
          }}
          placeholder={masked ?? undefined}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
        />
      </div>
    </div>
  );
}

// A titled card with an optional one-line description, the pattern every
// business settings surface (Vercel, Stripe) uses: the reader should know
// what a section governs without reading its rows.
// A native <select> stops being usable somewhere around twenty options — the
// model picker proved it. This is CountryCodeSelect's shape re-cut for the
// console: same portal-to-body fixed panel (every admin card is a clipping
// scroller), same flip-above rule, same outside-mousedown / Escape /
// capture-scroll close, same preventScroll focus on the search box. English
// only, like everything else on this surface, so no COPY table.
const SELECT_PANEL_W = 320;
const SELECT_PANEL_MAX_H = 300;
const SELECT_MIN_PANEL_H = 180;
const SELECT_GAP = 6;
const SELECT_EDGE = 8;

export type SearchSelectOption = {
  value: string;
  label: string;
  // Right-aligned, muted — the price column in the model picker.
  hint?: string;
};

export function SearchSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className,
}: {
  value: string;
  options: SearchSelectOption[];
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - SELECT_GAP - SELECT_EDGE;
    const above = r.top - SELECT_GAP - SELECT_EDGE;
    const flip = below < SELECT_MIN_PANEL_H && above > below;
    const maxH = Math.max(
      SELECT_MIN_PANEL_H,
      Math.min(SELECT_PANEL_MAX_H, flip ? above : below),
    );
    setPos({
      top: flip ? r.top - SELECT_GAP - maxH : r.bottom + SELECT_GAP,
      left: Math.min(
        Math.max(SELECT_EDGE, r.left),
        window.innerWidth - SELECT_PANEL_W - SELECT_EDGE,
      ),
      maxH,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Close when the PAGE scrolls (a fixed panel cannot follow its trigger) —
    // but not when the options list inside the panel scrolls, which the
    // capture listener also hears. Without the guard, scrolling to the
    // bottom of a long list closed the picker mid-scroll.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (open) {
      setQuery("");
      place();
      requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    } else {
      setPos(null);
    }
  }, [open, place]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(q),
    );
  }, [query, options]);

  return (
    <div ref={containerRef} className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={placeholder}
      >
        <span className={`truncate ${selected ? "" : "text-[var(--muted)]"}`}>
          {selected?.label ?? placeholder}
        </span>
        <span
          aria-hidden
          className={`text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left, width: SELECT_PANEL_W }}
            className="fixed z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
            role="listbox"
            id={listId}
          >
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="block w-full rounded-none border-0 border-b border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none"
            />
            <div
              className="thin-scroll overflow-y-auto p-1"
              style={{ maxHeight: pos.maxH - 40 }}
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-[var(--muted)]">No matches</div>
              ) : (
                filtered.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      key={option.value || "__default__"}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--muted-bg)] ${
                        isSelected ? "bg-[var(--muted-bg)] font-medium" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      {option.hint && (
                        <span className="shrink-0 tabular-nums text-xs text-[var(--muted)]">
                          {option.hint}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  // The card's own creating action, top right — inside the card it acts on,
  // never floating on the page above it. Optional because most sections on
  // this page are read-and-edit-in-place and have nothing to create.
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const search = useAdminSearch();
  const titleMatched = search ? search.matches(title) : true;
  // Which of my rows matched. Keyed by label so a row re-reporting the same
  // answer is a no-op rather than a render loop.
  const [hits, setHits] = useState<Record<string, boolean>>({});
  const report = useCallback((label: string, hit: boolean) => {
    setHits((prev) => (prev[label] === hit ? prev : { ...prev, [label]: hit }));
  }, []);
  const value = { titleMatched, report };
  // A card with nothing left in it is noise, so it goes — including a card
  // whose contents are not Rows at all (a table, a lone toggle). Those are
  // reachable by their title and nothing else while a search is running, which
  // is the usual bargain in a settings search and costs only a cleared query.
  if (search?.active && !titleMatched && !Object.values(hits).some(Boolean)) {
    return (
      <SectionContext.Provider value={value}>
        <div className="hidden">{children}</div>
      </SectionContext.Provider>
    );
  }
  return (
    <SectionContext.Provider value={value}>
    {/* Lifted, not outlined — the same card the salon app's Settings uses, and
        for the same reason: the page under it is a plane with a wash, so paper
        on it separates by shadow. The radius comes down with the border. A
        rounded-xl card behind a shadow and no line reads as a pill. */}
    <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
      {/* The description is a sentence explaining what the section governs,
          and a sentence per card is what made this page a wall of prose. It
          moves behind the (i) the rest of the app already uses — same
          affordance, same place, and the row labels are what the eye lands on.
          No divider between rows either: every control in here already draws
          its own border, so the lines were a second grid over the first. */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <InfoTip text={description} />}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
    </SectionContext.Provider>
  );
}

