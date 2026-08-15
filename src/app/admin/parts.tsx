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
  useState,
} from "react";
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

// Setup state reads as a word, not a tick: "no WABA" is the actual answer to
// "why is this salon not sending", and a red ✗ makes the reader work it out.
// Whether this salon can reach anybody, which is not the same question as
// whether WhatsApp is connected. An org on email alone is fully working, and
// amber-flagging it as "no WhatsApp" sent the operator chasing a Meta number
// nobody needed. Amber is now reserved for genuinely dark: no channel at all.
export function Setup({
  org,
}: {
  org: { waConnected: boolean; approvedTemplates: number; emailReady: boolean };
}) {
  if (!org.waConnected) {
    return org.emailReady ? (
      <span className="text-[var(--muted)]">email only</span>
    ) : (
      <span className="text-amber-600 dark:text-amber-400">no channel</span>
    );
  }
  if (org.approvedTemplates === 0) {
    return <span className="text-amber-600 dark:text-amber-400">no templates</span>;
  }
  return <span className="text-[var(--muted)]">{org.approvedTemplates} templates</span>;
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

// A secret already installed shows its tail and an empty box. Typing replaces
// it; leaving it blank keeps what is there. An input pre-filled with a masked
// string would submit the mask as the new value the first time somebody
// tabbed through it.
//
// The masked tail sits UNDER THE LABEL rather than beside the input, so the
// control column starts at the same x as every plain row. Three sections each
// indenting their inputs differently is what it looked like otherwise, and the
// eye reads that as three unrelated forms.
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
      {/* The masked tail stays visible — it is data ("which key is in
          there"), not prose. Only the explanation folds behind the (i),
          matching Row. */}
      <div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">{label}</div>
          {hint && <InfoTip text={hint} />}
        </div>
        <div className="font-mono text-xs text-[var(--muted)]">{masked ?? "not set"}</div>
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
          placeholder={masked ? "replace…" : "paste…"}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
        />
      </div>
    </div>
  );
}

// A titled card with an optional one-line description, the pattern every
// business settings surface (Vercel, Stripe) uses: the reader should know
// what a section governs without reading its rows.
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
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
      </div>
      <div className="mt-2">{children}</div>
    </section>
    </SectionContext.Provider>
  );
}

