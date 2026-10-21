"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatAge } from "@/lib/datetime";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { CollectedList, humanizeCallEnd, parseTranscript } from "./CallDetail";
import { CallRecording } from "./CallRecording";
import { buttonClass, iconButtonClass } from "./Control";
import { SegmentedControl } from "./SegmentedControl";
import { AGENT_PANE_CARD, duration } from "./AgentTestsLog";
import { BOX, BOX_TITLE, TranscriptThread, WouldDo } from "./AgentTestResult";

// The agent page's Notes tab (2026-10-21; Nudge's Analysis tab, settled there
// on a working mock with Serdar, docs/agent-analysis-tab.md in Nudge). A work
// queue of this agent's reviewed calls and browser tests. The one question it
// answers: what is still open on this agent, and what did we do about the
// rest?
//
// The list is one line per review. Open items show the FEEDBACK (the note: the
// problem), resolved ones WHAT WE DID (the fix). The whole row opens the
// review in place of the list, with ‹ › through the same list; the title
// bar's breadcrumb is the way back (the agent page publishes it), never an
// arrow of our own.
//
// Miss or pass: the verdict a person set; with none, a review carrying a note
// is a Miss, because notes on real calls are almost always about something
// that went wrong (Nudge). Not here, on purpose: charts, rates and problem
// grouping. Reviewed calls are a hand-picked sample, so a rate over them
// measures how much reviewing happened, not how good the agent is.

type Item = FunctionReturnType<typeof api.agentReviews.list>["items"][number];
type Detail = NonNullable<FunctionReturnType<typeof api.agentReviews.get>>;
type Side = "miss" | "pass" | "resolved";
type Source = "call" | "test";

const SIDES: Side[] = ["miss", "pass", "resolved"];
const SIDE_LABEL = {
  miss: "agentNotes.misses",
  pass: "agentNotes.passes",
  resolved: "agentNotes.resolved",
} as const;

const keyOf = (item: { kind: Source; id: string }) =>
  `${item.kind === "call" ? "c" : "t"}:${item.id}`;
const isMiss = (item: { verdict: "pass" | "miss" | null; note: string | null }) =>
  item.verdict === "miss" || (!item.verdict && !!item.note?.trim());
const sideOf = (item: Item): Side => (item.done ? "resolved" : isMiss(item) ? "miss" : "pass");

// The open review rides the URL beside ?agent= and ?agentTab=, so a reload
// lands on it. replaceState, like the tab: opening a record is not history.
export const REVIEW_PARAM = "review";
function writeReviewParam(key: string | null) {
  const url = new URL(window.location.href);
  if (key) url.searchParams.set(REVIEW_PARAM, key);
  else url.searchParams.delete(REVIEW_PARAM);
  window.history.replaceState(null, "", url);
}

// The shell's main pane scrolls, not the window. Found from here so closing
// a review returns to the same place in the list.
const scroller = () => document.querySelector("main");

export type ReviewTrail = { title: string; close: () => void };

export function AgentNotes({
  agentId,
  active,
  onReviewTrail,
}: {
  agentId: string;
  // The Notes tab is showing. Nothing is read until it first is.
  active: boolean;
  // The open review's name and its close, for the title bar's breadcrumb;
  // null when the list is showing (or the tab is not).
  onReviewTrail: (trail: ReviewTrail | null) => void;
}) {
  const { t } = useLanguage();
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  const data = useQuery(api.agentReviews.list, visited ? { retellAgentId: agentId } : "skip");

  // Two switches, one side of each at a time: real calls first (tests are a
  // rehearsal of them), and Misses first (they are the work). Resolved is
  // every done item of either verdict.
  const [side, setSide] = useState<Side>("miss");
  const [src, setSrc] = useState<Source>("call");

  const [openKey, setOpenKey] = useState<string | null>(null);
  // Read after mount, for the same hydration reason the tab param is.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get(REVIEW_PARAM);
    if (wanted) setOpenKey(wanted);
  }, []);
  // The list as it stood when a review was opened: ‹ › walk THIS, so marking
  // one done does not pull it out from under you. It goes on close.
  const [walk, setWalk] = useState<string[]>([]);
  const scrollRef = useRef(0);

  const items = useMemo(() => data?.items ?? [], [data]);
  const bySrc = items.filter((item) => item.kind === src);
  const shown = bySrc.filter((item) => sideOf(item) === side);
  const order = shown.map(keyOf);

  const open = (key: string) => {
    scrollRef.current = scroller()?.scrollTop ?? 0;
    setWalk(order.includes(key) ? order : [key]);
    setOpenKey(key);
    writeReviewParam(key);
  };
  const step = (key: string) => {
    setOpenKey(key);
    writeReviewParam(key);
  };
  const close = useCallback(() => {
    setOpenKey(null);
    setWalk([]);
    writeReviewParam(null);
    requestAnimationFrame(() => {
      const main = scroller();
      if (main) main.scrollTop = scrollRef.current;
    });
  }, []);

  // The title bar names the open review while this tab shows it.
  const openItem = openKey ? items.find((item) => keyOf(item) === openKey) : undefined;
  const trailTitle = openKey
    ? (openItem && nameOf(openItem, t)) ?? t("agentNotes.review")
    : null;
  useEffect(() => {
    onReviewTrail(active && trailTitle ? { title: trailTitle, close } : null);
  }, [active, trailTitle, close, onReviewTrail]);
  useEffect(() => () => onReviewTrail(null), [onReviewTrail]);

  // Nothing renders until the tab is first shown: an auto-growing field
  // measured inside a hidden tab sizes itself to zero and stays there.
  if (!visited) return null;

  if (openKey) {
    const list = walk.length > 0 ? walk : [openKey];
    const at = list.indexOf(openKey);
    return (
      <ReviewPage
        key={openKey}
        reviewKey={openKey}
        position={at >= 0 && list.length > 1 ? { n: at + 1, total: list.length } : null}
        onPrev={at > 0 ? () => step(list[at - 1]) : undefined}
        onNext={at >= 0 && at < list.length - 1 ? () => step(list[at + 1]) : undefined}
      />
    );
  }

  // A filter says what it is hiding: reviews the switches keep off screen are
  // counted, never passed off as nothing.
  const hidden = items.length - shown.length;
  const count = (n: number) => <span className="ml-1 tabular-nums opacity-70">{n}</span>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel={t("agentNotes.source")}
          value={src}
          onChange={setSrc}
          segments={(["call", "test"] as const).map((kind) => ({
            id: kind,
            label: kind === "call" ? t("agentNotes.calls") : t("agentNotes.tests"),
            mark: count(items.filter((item) => item.kind === kind && sideOf(item) === side).length),
          }))}
        />
        <span className="flex-1" />
        <SegmentedControl
          ariaLabel={t("agentNotes.show")}
          value={side}
          onChange={setSide}
          segments={SIDES.map((id) => ({
            id,
            label: t(SIDE_LABEL[id]),
            mark: count(bySrc.filter((item) => sideOf(item) === id).length),
          }))}
        />
      </div>

      {data === undefined ? null : items.length === 0 ? (
        <div className={`${AGENT_PANE_CARD} text-sm text-[var(--muted)]`}>{t("agentNotes.empty")}</div>
      ) : shown.length === 0 ? (
        <div className={`${AGENT_PANE_CARD} text-sm text-[var(--muted)]`}>
          {t.plural("agentNotes.hiddenByFilter", hidden)}
        </div>
      ) : (
        <ListCard
          title={t(SIDE_LABEL[side])}
          items={shown}
          column={side === "resolved" ? "action" : "feedback"}
          onOpen={open}
        />
      )}
      {data?.capped && <p className="text-xs text-[var(--muted)]">{t("agentNotes.capped")}</p>}
    </div>
  );
}

// Who a review is about: the customer or the number that rang, else, on a
// test run as a stranger, what kind of call it played.
function nameOf(
  item: { name: string | null; kind: Source; direction: "inbound" | "outbound" },
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (item.name) return item.name;
  if (item.kind === "test" && item.direction === "outbound") return t("agentTest.coldCall");
  return t("agentTest.unknownCaller");
}

// Name · Author · Text · When. The text is the one flexible column; the rest
// size to their content. Below sm a row folds: the name with the age at its
// right, then the text, then the author.
const COLS = "sm:grid-cols-[minmax(0,13rem)_minmax(0,8rem)_minmax(0,1fr)_4.5rem]";

function ListCard({
  title,
  items,
  column,
  onOpen,
}: {
  title: string;
  items: Item[];
  column: "feedback" | "action";
  onOpen: (key: string) => void;
}) {
  const { t, language } = useLanguage();
  const full = new Intl.DateTimeFormat(language, { dateStyle: "full", timeStyle: "short" });
  return (
    <section className="card-raised overflow-hidden">
      <div className={`grid grid-cols-1 items-baseline gap-x-4 px-5 pb-1.5 pt-4 ${COLS}`}>
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          {title}
          <span className="ml-1.5 font-normal tabular-nums text-[var(--muted)]">{items.length}</span>
        </h3>
        <span className="hidden text-xs font-medium text-[var(--muted-strong)] sm:block">
          {t("agentNotes.author")}
        </span>
        <span className="hidden text-xs font-medium text-[var(--muted-strong)] sm:block">
          {column === "feedback" ? t("agentNotes.feedback") : t("agentNotes.whatWeDid")}
        </span>
        <span className="hidden text-right text-xs font-medium text-[var(--muted-strong)] sm:block">
          {t("agentNotes.when")}
        </span>
      </div>
      <ul>
        {items.map((item) => {
          const text = column === "feedback" ? item.note : item.action;
          const author = column === "feedback" ? item.noteBy : item.actionBy;
          return (
            <li key={keyOf(item)} className="border-t border-[var(--border)] first:border-t-0">
              <button
                type="button"
                onClick={() => onOpen(keyOf(item))}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-5 py-2.5 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)] ${COLS}`}
              >
                <span className="truncate font-medium text-[var(--foreground)]">
                  {nameOf(item, t)}
                </span>
                <span className="col-span-2 row-start-3 truncate text-xs text-[var(--muted-strong)] sm:col-span-1 sm:row-start-auto sm:text-sm sm:text-[var(--foreground)]">
                  {author ?? ""}
                </span>
                <span
                  className={`col-span-2 truncate sm:col-span-1 ${
                    text ? "text-[var(--foreground)]" : "text-[var(--muted)]"
                  }`}
                >
                  {text ||
                    (column === "feedback" ? t("agentNotes.noNote") : t("agentNotes.nothingYet"))}
                </span>
                <span
                  title={full.format(item.at)}
                  className="col-start-2 row-start-1 whitespace-nowrap text-right tabular-nums text-[var(--muted)] sm:col-start-auto sm:row-start-auto"
                >
                  {formatAge(item.at, language)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The review page: the REVIEW (what was said and done about it) above the
// CALL or TEST it is about. In one card the notes and the call's facts read
// as one run of boxes (Nudge, 2026-10-09).

function ReviewPage({
  reviewKey,
  position,
  onPrev,
  onNext,
}: {
  reviewKey: string;
  position: { n: number; total: number } | null;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { t } = useLanguage();
  const kind: Source = reviewKey.startsWith("t:") ? "test" : "call";
  const d = useQuery(api.agentReviews.get, { kind, id: reviewKey.slice(2) });
  return (
    <div className="space-y-3">
      {/* Stepping through the list it was opened from. The way back is the
          title bar's breadcrumb. */}
      {position && (
        <div className="flex items-center justify-end gap-1.5">
          <span className="mr-1 text-sm tabular-nums text-[var(--muted)]">
            {t("agentNotes.position", { n: position.n, total: position.total })}
          </span>
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev}
            aria-label={t("agentNotes.previous")}
            className={iconButtonClass("outline", "xs")}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            aria-label={t("agentNotes.next")}
            className={iconButtonClass("outline", "xs")}
          >
            ›
          </button>
        </div>
      )}
      {d === undefined ? (
        <div className="card-raised h-40" />
      ) : d === null ? (
        <div className={`${AGENT_PANE_CARD} text-sm text-[var(--muted)]`}>{t("agentNotes.notFound")}</div>
      ) : (
        <ReviewBody d={d} />
      )}
    </div>
  );
}

// Chromeless in place: text at rest, an edge on hover, a field on focus. The
// negative margin keeps the words exactly where read-only text would sit.
const IN_PLACE =
  "-mx-2 block w-[calc(100%+1rem)] rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] hover:border-[var(--border)] focus:border-[var(--accent)]";

function ReviewBody({ d }: { d: Detail }) {
  const { t, language } = useLanguage();
  const setCallReview = useMutation(api.calls.setReview);
  const setTestReview = useMutation(api.agentTests.setReview);
  const setAction = useMutation(api.agentReviews.setAction);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flash = () => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1500);
  };

  const day = new Intl.DateTimeFormat(language, { day: "numeric", month: "short" });
  const when = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const miss = isMiss(d);

  const saveReview = (patch: { note?: string; verdict?: "pass" | "miss" | null }) =>
    (d.kind === "call"
      ? setCallReview({ callId: d.id as Id<"calls">, ...patch })
      : setTestReview({ id: d.id as Id<"agentTests">, ...patch })
    ).then(flash);
  const saveAction = (patch: { text?: string; done?: boolean }) =>
    setAction({ kind: d.kind, id: d.id, ...patch }).then(flash);

  // Seeded once per review (the page is keyed by it); a save keeps what was
  // typed.
  const [note, setNote] = useState(d.note ?? "");
  const [action, setActionText] = useState(d.action ?? "");

  // Who wrote it, that someone else changed it, and the day only when it is
  // not the call's own.
  const sign = (s: { by: string | null; editedBy: string | null; at: number | null }) =>
    [
      s.by,
      s.editedBy ? t("review.editedBy", { name: s.editedBy }) : null,
      s.at !== null && day.format(s.at) !== day.format(d.at) ? day.format(s.at) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const subject = nameOf(d, t);
  return (
    <>
      <section className={AGENT_PANE_CARD}>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 className="min-w-0 flex-1 text-base font-semibold text-[var(--foreground)]">
            {t("agentNotes.review")}
          </h3>
          {/* "Saved" floats left of the buttons and takes no room: nothing
              moves when it shows. */}
          <div className="relative flex flex-wrap items-center gap-2">
            {saved && (
              <span className="absolute right-full mr-3 whitespace-nowrap text-xs text-emerald-600 dark:text-emerald-400">
                {t("common.saved")}
              </span>
            )}
            {/* Mark done ends the item and is the one primary; moving it is
                a correction. */}
            <button
              type="button"
              className={buttonClass("outline", "sm")}
              onClick={() => void saveReview({ verdict: miss ? "pass" : "miss" })}
            >
              {miss ? t("agentNotes.moveToPasses") : t("agentNotes.moveToMisses")}
            </button>
            {d.done ? (
              <>
                <span className="px-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  ✓ {t("agentNotes.done")}
                </span>
                <button
                  type="button"
                  className={buttonClass("quiet", "sm")}
                  onClick={() => void saveAction({ done: false })}
                >
                  {t("agentNotes.reopen")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={buttonClass("primary", "sm")}
                onClick={() => void saveAction({ done: true })}
              >
                {t("agentNotes.markDone")}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className={`${BOX} flex flex-col`}>
            <h4 className={`mb-2 ${BOX_TITLE}`}>{t("agentNotes.feedback")}</h4>
            <AutoGrowTextarea
              value={note}
              rows={3}
              aria-label={t("agentNotes.feedback")}
              placeholder={t("agentNotes.feedbackPlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => {
                if (note !== (d.note ?? "")) void saveReview({ note });
              }}
              className={IN_PLACE}
            />
            <p className="mt-auto min-h-4 pt-1 text-right text-xs text-[var(--muted)]">
              {sign(d.noteSigned)}
            </p>
          </div>
          <div className={`${BOX} flex flex-col`}>
            <h4 className={`mb-2 ${BOX_TITLE}`}>{t("agentNotes.whatWeDid")}</h4>
            <AutoGrowTextarea
              value={action}
              rows={3}
              aria-label={t("agentNotes.whatWeDid")}
              placeholder={t("agentNotes.actionPlaceholder")}
              onChange={(event) => setActionText(event.target.value)}
              onBlur={() => {
                if (action !== (d.action ?? "")) void saveAction({ text: action });
              }}
              className={IN_PLACE}
            />
            <p className="mt-auto min-h-4 pt-1 text-right text-xs text-[var(--muted)]">
              {sign(d.actionSigned)}
            </p>
          </div>
        </div>
      </section>

      <section className={AGENT_PANE_CARD}>
        <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="min-w-0 truncate text-base font-semibold text-[var(--foreground)]">
            {subject}
          </h3>
          <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
            {[
              when.format(d.at),
              d.agentVersion !== null
                ? d.draft
                  ? t("agentTest.versionDraft", { n: d.agentVersion })
                  : `v${d.agentVersion}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {/* Left, the facts: the call, what it heard, and on a test what it
            would have done. Right, alone: the conversation, the long one. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <CallFacts d={d} subject={subject} />
            {d.collected && Object.values(d.collected).some((value) => value !== null && value !== "") && (
              <section className={BOX}>
                <h4 className={`mb-2 ${BOX_TITLE}`}>{t("agentTest.collected")}</h4>
                <CollectedList values={d.collected} />
              </section>
            )}
            {d.kind === "test" && <WouldDo actions={d.toolActions} />}
          </div>
          <Conversation d={d} subject={subject} />
        </div>
      </section>
    </>
  );
}

function CallFacts({ d, subject }: { d: Detail; subject: string }) {
  const { t } = useLanguage();
  const name = d.name ?? t("agentNotes.them");
  const rows: [string, string][] = [];
  if (d.kind === "test") {
    rows.push([t("agentNotes.kind"), d.draft ? t("agentNotes.onDraft") : t("agentNotes.browserTest")]);
  }
  rows.push([
    t("agentNotes.whoCalled"),
    d.direction === "inbound"
      ? t("agentNotes.theyRang", { name: d.name ?? subject })
      : t("agentNotes.weRang", { name }),
  ]);
  if (d.number && d.number !== d.name) rows.push([t("agentNotes.number"), d.number]);
  if (d.placedBy) {
    rows.push([d.kind === "test" ? t("agentNotes.startedBy") : t("agentNotes.placedBy"), d.placedBy]);
  }
  if (d.durationSec !== null) rows.push([t("agentNotes.length"), duration(d.durationSec)]);
  const ended = humanizeCallEnd(d.disconnectionReason, t);
  if (ended) rows.push([t("agentNotes.howEnded"), ended]);
  return (
    <section className={BOX}>
      <h4 className={`mb-2 ${BOX_TITLE}`}>{d.kind === "test" ? t("agentNotes.browserTest") : t("agentNotes.call")}</h4>
      <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[var(--muted-strong)]">{label}</dt>
            <dd className="min-w-0 break-words tabular-nums text-[var(--foreground)]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// The recording, the summary and the words. A call's words are stored with
// it; a test's are the provider's, fetched when the review opens.
function Conversation({ d, subject }: { d: Detail; subject: string }) {
  const { t } = useLanguage();
  const readResult = useAction(api.retellAgent.browserTestResult);
  const [fetched, setFetched] = useState<
    | { turns: { role: string; text: string }[]; recordingUrl: string | null; summary: string | null }
    | "loading"
    | "failed"
    | null
  >(d.kind === "test" && d.callId ? "loading" : null);
  useEffect(() => {
    if (d.kind !== "test" || !d.callId) return;
    let cancelled = false;
    void readResult({ callId: d.callId })
      .then((r) => {
        if (!cancelled) setFetched({ turns: r.turns, recordingUrl: r.recordingUrl, summary: r.summary });
      })
      .catch(() => {
        if (!cancelled) setFetched("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [d.kind, d.callId, readResult]);

  const loaded = typeof fetched === "object" && fetched !== null ? fetched : null;
  const recordingUrl = d.recordingUrl ?? loaded?.recordingUrl ?? null;
  const summary = d.summary ?? loaded?.summary ?? null;
  const turns =
    d.kind === "call"
      ? d.transcript
        ? parseTranscript(d.transcript)
        : []
      : (loaded?.turns ?? []).map((turn) => ({ agent: turn.role === "agent", text: turn.text }));
  return (
    <section className={`${BOX} space-y-3`}>
      <h4 className={BOX_TITLE}>{t("agentTest.conversation")}</h4>
      {recordingUrl && (
        <CallRecording
          url={recordingUrl}
          durationMs={d.durationSec !== null ? d.durationSec * 1000 : undefined}
        />
      )}
      <div>
        <h5 className="mb-1 text-xs font-medium text-[var(--muted-strong)]">{t("agentTest.summary")}</h5>
        <p className={`text-xs leading-relaxed ${summary ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
          {summary || t("agentNotes.noSummary")}
        </p>
      </div>
      {turns.length > 0 ? (
        <TranscriptThread
          turns={turns}
          other={d.kind === "test" ? t("agentTest.callerRole") : subject}
          capped={false}
        />
      ) : d.kind === "call" && d.transcript ? (
        // A transcript whose speakers could not be told apart, as written.
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]">
          {d.transcript}
        </p>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {fetched === "loading" ? t("agentTest.loadingWords") : t("agentNotes.noWords")}
        </p>
      )}
    </section>
  );
}
