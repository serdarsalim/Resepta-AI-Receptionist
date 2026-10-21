"use client";

import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { buttonClass, fieldClass } from "./Control";
import { InfoTip } from "./InfoTip";
import { SearchableSelect } from "./SearchableSelect";
import { CustomerPickField, type PickedCustomer } from "./CustomerPickField";
import { AgentTestsLog, AGENT_PANE_CARD, type CurrentTest } from "./AgentTestsLog";
import { AgentTestResult, dressKey, type TestResult } from "./AgentTestResult";
import { OPENER_KEY, renderOpener, type AgentOpeners } from "../../convex/lib/opener";

// The agent page's Testing tab (P9 of the Nudge port; redone on Nudge's
// AgentTestPanel 2026-10-21). The owner talks to the agent through the
// microphone, as a customer they pick or as a stranger, and nobody's phone
// rings. The agent hears exactly what it would hear on a real ring (the
// backend builds the variables with the same read every call uses), and the
// owner can type over any of them first.
//
// ONE card holds everything that goes INTO the test, stacked: the setup row
// (who, which way, which microphone and speaker), then what the agent knows
// in a bordered box of its own, then the action under it all, since Start
// fires a call that reads the setup AND the edited values. The Test results
// card under it holds the running test as its open top row.
//
// Nothing it does is real: on a test call the agent's tools answer dry, and
// what they would have done is listed afterwards (convex/agentTests.ts). The
// minutes are real and billed like a call.
//
// The SDK is imported lazily, inside the click: it pulls in a whole WebRTC
// stack, far too much for a page whose job is editing text, and most opens of
// the agent page never press Start.
//
// NOTE for whoever bumps the SDK past 3.x: RetellWebClient is the token-only
// client and goes away in 4.0. Its replacement takes an API KEY in the
// browser, which is not a trade to make; keep the token path (Nudge's note).

type Phase = "idle" | "connecting" | "live" | "ended";
type Direction = "outbound" | "inbound";
type Polled = TestResult & { ready: boolean };
// One variable the call carries. `read`: this agent's prompt or opening line
// names it in braces. Every row is sent, but only a read one changes what the
// agent says, so the rest fold behind one line.
type Row = { key: string; value: string; read: boolean; long: boolean };

// The microphone and speaker of the web call. Left to itself the browser takes
// the SYSTEM default input, and macOS hands that to a nearby iPhone the moment
// Continuity decides its microphone is the better one, so a test from a
// MacBook with a phone on the desk opened on the phone in another room (Nudge,
// 2026-09-20). The SDK takes a device id per direction; the pick is per
// browser and remembered there, a per-viewer convenience and nothing more.
// SYSTEM_DEFAULT sends no id at all, which is what every test before the
// picker did.
type AudioDevice = { id: string; label: string };
type AudioChoice = { mic: string; speaker: string };
const AUDIO_CHOICE_KEY = "randevu.agentTest.audio";
const SYSTEM_DEFAULT = "system";

function readAudioChoice(): AudioChoice {
  try {
    const raw = window.localStorage.getItem(AUDIO_CHOICE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioChoice>;
      return {
        mic: typeof parsed.mic === "string" ? parsed.mic : SYSTEM_DEFAULT,
        speaker: typeof parsed.speaker === "string" ? parsed.speaker : SYSTEM_DEFAULT,
      };
    }
  } catch {
    // A private window or blocked storage: the default is the default.
  }
  return { mic: SYSTEM_DEFAULT, speaker: SYSTEM_DEFAULT };
}

function writeAudioChoice(choice: AudioChoice) {
  try {
    window.localStorage.setItem(AUDIO_CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Nothing to do: the choice still holds for this page.
  }
}

// Every {{name}} a text reaches for, the way the provider substitutes them.
function placeholders(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) found.add(match[1]);
  return found;
}

// A value too long or too many lines for a one-line box: a list of services,
// the knowledge text. Judged on what the call resolved, never on what is being
// typed, so a box never turns into another one under the cursor.
const isLong = (value: string) => value.includes("\n") || value.length > 60;

const E164_RE = /^\+[1-9]\d{6,14}$/;

const SETUP_LABEL = "text-xs font-medium text-[var(--foreground)]";
const FOLD_LINK =
  "text-left text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]";
// A value you may change for this test: plain text until hovered, a field
// when you are in it (the inline edit, not a parked form control).
// On a phone the box reaches 8px past the label's edge on each side, so its
// text lines up under the label.
const VALUE_FIELD =
  "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-xs text-[var(--foreground)] hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--background)] focus:outline-none disabled:hover:border-transparent max-sm:-mx-2";

export function AgentBrowserTest({
  agentId,
  agentName,
  active,
  hasEdits,
  stage,
  beginMessage,
  openers,
  promptText,
  labels,
  phoneTestStale,
}: {
  agentId: string;
  agentName: string;
  // The Testing tab is showing. The first showing is when the reads start:
  // an action per agent page open, for a tab most opens never visit, is a
  // call nobody asked for.
  active: boolean;
  // Whether the page holds edits (or a provider draft) the test should hear.
  hasEdits: boolean;
  // Puts those edits on the provider's draft and says which version to dial;
  // null = dial the published version.
  stage: () => Promise<number | null>;
  // The opening line and first sentences as on screen, saved or not (P34),
  // so the panel shows, and the test says, what Publish would make it say.
  beginMessage: string;
  openers: AgentOpeners;
  // The prompt as on screen: which variables this agent reads.
  promptText: string;
  // What each variable is called, by key: the registry's rows and the
  // built-ins, the list the prompt's @ picker offers.
  labels: Record<string, string>;
  // The page has edits a phone test would not hear: it rings the published
  // version.
  phoneTestStale: boolean;
}) {
  const { t } = useLanguage();
  const readVariables = useAction(api.retellAgent.browserTestVariables);
  const startTest = useAction(api.retellAgent.startBrowserTest);
  const readResult = useAction(api.retellAgent.browserTestResult);

  // Has the tab ever been shown. Reads start on the first showing, not on
  // mount (see `active`).
  const [seen, setSeen] = useState(active);
  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);

  const [picked, setPicked] = useState<PickedCustomer | null>(null);
  const [direction, setDirection] = useState<Direction>("outbound");
  const [vars, setVars] = useState<Record<string, string> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // What a person typed, by variable key. Cleared whenever the person, the
  // direction or the first sentences change, because a value typed for one
  // call is not a value for another.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // The two folds: rows with no value, and rows this agent never reads.
  const [showEmpty, setShowEmpty] = useState(false);
  const [showUnread, setShowUnread] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  // stage() is running: the status says the draft is being written, because
  // the microphone prompt is not what is happening yet.
  const [staging, setStaging] = useState(false);
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Polled | null>(null);
  const [testId, setTestId] = useState<Id<"agentTests"> | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [usedDraft, setUsedDraft] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);

  // The live client. A ref, not state: it is an event emitter with a socket
  // behind it, and a re-render must never be what tears a call down.
  const clientRef = useRef<{ stopCall: () => void } | null>(null);

  const live = phase === "connecting" || phase === "live";

  // Which microphone and speaker the call uses (AudioDevice above). The
  // browser names the devices only once it has been allowed a microphone,
  // which the first test does; until then the picker offers System default
  // alone and fills in after that call.
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [devicesUnnamed, setDevicesUnnamed] = useState(false);
  const [audio, setAudio] = useState<AudioChoice>({
    mic: SYSTEM_DEFAULT,
    speaker: SYSTEM_DEFAULT,
  });
  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // Chrome lists the system default twice more ("default", and
      // "communications" on Windows) beside the device itself; the picker
      // has its own line for that.
      const named = (kind: MediaDeviceKind): AudioDevice[] =>
        all
          .filter(
            (device) =>
              device.kind === kind &&
              device.label &&
              device.deviceId &&
              device.deviceId !== "default" &&
              device.deviceId !== "communications",
          )
          .map((device) => ({ id: device.deviceId, label: device.label }));
      setMics(named("audioinput"));
      setSpeakers(named("audiooutput"));
      const inputs = all.filter((device) => device.kind === "audioinput");
      setDevicesUnnamed(inputs.length > 0 && inputs.every((device) => !device.label));
    } catch {
      // No list: the picker offers the system default and the SDK asks for it.
    }
  }, []);
  useEffect(() => {
    if (!seen) return;
    setAudio(readAudioChoice());
    void refreshDevices();
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.addEventListener) return;
    const onChange = () => void refreshDevices();
    media.addEventListener("devicechange", onChange);
    return () => media.removeEventListener("devicechange", onChange);
  }, [seen, refreshDevices]);
  const chooseAudio = (patch: Partial<AudioChoice>) =>
    setAudio((prev) => {
      const next = { ...prev, ...patch };
      writeAudioChoice(next);
      return next;
    });
  // A remembered device that is not plugged in today falls back to the default.
  const micId = mics.some((device) => device.id === audio.mic) ? audio.mic : undefined;
  const speakerId = speakers.some((device) => device.id === audio.speaker)
    ? audio.speaker
    : undefined;
  // A phone's browser names no device until a call has run, and lets
  // nobody pick a speaker: a picker offering "System default" alone is
  // noise there, so it waits for names. A desktop shows it from the start.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);
  const showAudio =
    mics.length > 0 || speakers.length > 0 || (devicesUnnamed && !coarsePointer);

  // What the agent would be handed, read again whenever the person, the
  // direction or the first sentences change: the last two decide {{opener}}.
  // A read: it costs nothing and runs before anybody commits to a minute.
  // Only while the tab is showing and no call is up. The first sentences
  // are typed on Setup, and a read per keystroke there, each one wiping the
  // values typed here, was a call nobody asked for; coming back to the tab
  // reads once if anything changed meanwhile.
  const readKey = JSON.stringify({ agentId, customer: picked?.id ?? null, direction, openers });
  const lastRead = useRef<string | null>(null);
  useEffect(() => {
    if (!active || live || readKey === lastRead.current) return;
    lastRead.current = readKey;
    let landed = false;
    let cancelled = false;
    const sent = JSON.parse(readKey) as { openers: AgentOpeners };
    void readVariables({
      agentId,
      direction,
      openers: sent.openers,
      ...(picked ? { customerId: picked.id } : {}),
    })
      .then((r) => {
        landed = true;
        if (cancelled) return;
        setVars(r.variables);
        setUnavailable(r.unavailable);
        setOverrides({});
      })
      .catch(() => {
        landed = true;
        if (cancelled) return;
        lastRead.current = null;
        setError(t("agentTest.failed"));
      });
    return () => {
      cancelled = true;
      // Dropped before it landed: the next showing reads again.
      if (!landed) lastRead.current = null;
    };
  }, [active, live, readKey, agentId, picked, direction, readVariables, t]);

  const hangUp = () => {
    try {
      clientRef.current?.stopCall();
    } catch {
      // Already gone.
    }
    clientRef.current = null;
  };
  // Leaving the page hangs up: a web call left running bills by the minute
  // and no other surface would show it.
  useEffect(() => hangUp, []);

  // The provider writes the call up a beat after it ends, so this asks a few
  // times rather than show an empty result and call it done.
  const fetchResult = async (callId: string) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 2500));
      try {
        const r = await readResult({ callId });
        setResult(r);
        if (r.ready && (r.summary || r.turns.length > 0) && r.recordingUrl) return;
      } catch {
        return;
      }
    }
  };

  const start = () => {
    setError(null);
    setResult(null);
    setTestId(null);
    setVersion(null);
    setPhase("connecting");
    void (async () => {
      // The page's edits go onto the draft FIRST, so the call hears what is
      // on screen.
      let agentVersion: number | null = null;
      if (hasEdits) {
        setStaging(true);
        try {
          agentVersion = await stage();
        } finally {
          setStaging(false);
        }
      }
      setUsedDraft(agentVersion !== null);
      // Server first: if the provider refuses, nothing has asked for the
      // microphone and the panel can say why without a prompt in the way.
      const session = await startTest({
        agentId,
        direction,
        openers,
        ...(picked ? { customerId: picked.id } : {}),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        ...(agentVersion !== null ? { agentVersion } : {}),
      });
      setTestId(session.testId);
      setVersion(session.agentVersion);
      const { RetellWebClient } = await import("retell-client-js-sdk");
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on("call_started", () => {
        setPhase("live");
        // The call has just taken the microphone, so the browser now names
        // the devices: the picker fills in for the next test.
        void refreshDevices();
      });
      client.on("call_ended", () => {
        setPhase("ended");
        setTalking(false);
        clientRef.current = null;
        void fetchResult(session.callId);
      });
      client.on("agent_start_talking", () => setTalking(true));
      client.on("agent_stop_talking", () => setTalking(false));
      client.on("error", () => {
        setError(t("agentTest.failed"));
        hangUp();
        setPhase("ended");
        void fetchResult(session.callId);
      });
      // Everything the provider answered with, handed straight back. The
      // transport is load-bearing (see the returns note on startBrowserTest).
      await client.startCall({
        accessToken: session.accessToken,
        callId: session.callId,
        ...(session.transport
          ? { transport: session.transport as "livekit" | "gateway" }
          : {}),
        ...(session.iceServers.length > 0
          ? { iceServers: session.iceServers as RTCIceServer[] }
          : {}),
        // The picked devices, by id. Omitted = the system default, as before.
        ...(micId ? { captureDeviceId: micId } : {}),
        ...(speakerId ? { playbackDeviceId: speakerId } : {}),
      });
    })().catch((err: unknown) => {
      const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      setError(
        /NotAllowed|Permission/i.test(raw)
          ? t("agentTest.micDenied")
          : raw.includes("test-unavailable")
            ? t("agentTest.unavailable")
            : t("agentTest.failed"),
      );
      hangUp();
      setPhase("idle");
    });
  };

  const valueOf = (row: Row) => overrides[row.key] ?? row.value;
  // The rows: every variable the call carries plus every one the prompt
  // reaches for, so a name the prompt needs always has a line even when
  // nothing fills it (that empty line is the finding). {{opener}} is shown
  // as the whole first sentence instead: the fields on Setup are where it is
  // written.
  // The first sentences count: a name an opener speaks is one the agent
  // says. {{when}} is the openers' own word, not a variable.
  const asked = useMemo(() => {
    const keys = placeholders([promptText, beginMessage, ...Object.values(openers)].join("\n"));
    keys.delete("when");
    return keys;
  }, [promptText, beginMessage, openers]);
  const labelOf = useCallback((key: string) => labels[key] ?? dressKey(key), [labels]);
  const rows = useMemo<Row[] | null>(() => {
    if (!vars) return null;
    const keys = new Set([...Object.keys(vars), ...asked]);
    keys.delete(OPENER_KEY);
    // The one-line values first, two to a line, then the lists and texts
    // across the box's whole width: interleaved, a tall row broke the pairs.
    return [...keys]
      .map((key) => {
        const value = vars[key] ?? "";
        return { key, value, read: asked.has(key), long: isLong(value) };
      })
      .sort(
        (a, b) =>
          Number(a.long) - Number(b.long) || labelOf(a.key).localeCompare(labelOf(b.key)),
      );
  }, [vars, asked, labelOf]);
  // A row you have typed into, cleared or are in stays put, so nothing jumps
  // away mid-edit.
  const hasValue = (row: Row) =>
    valueOf(row).trim() !== "" || overrides[row.key] !== undefined || focusedKey === row.key;
  const knowRows = (rows ?? []).filter((row) => row.read || showUnread);
  const emptyCount = knowRows.filter((row) => !hasValue(row)).length;
  const shownRows = showEmpty ? knowRows : knowRows.filter(hasValue);
  const unreadCount = (rows ?? []).filter((row) => !row.read).length;
  // The opening line with this call's variables in it, the values typed
  // above included: what the person on the line hears first.
  const firstSentence =
    vars && beginMessage.trim()
      ? renderOpener(
          beginMessage,
          Object.fromEntries(
            Object.entries(vars).map(([key, value]) => [key, overrides[key] ?? value]),
          ),
        )
      : "";
  const setRow = (key: string, value: string) =>
    setOverrides((current) => ({ ...current, [key]: value }));

  const statusLine = error
    ? { warn: true, text: error }
    : phase === "connecting"
      ? { warn: false, text: staging ? t("agentTest.staging") : t("agentTest.connectingMic") }
      : unavailable
        ? { warn: true, text: t("agentTest.unavailable") }
        : null;

  const current: CurrentTest | null =
    phase === "idle"
      ? null
      : {
          testId,
          who:
            (picked?.name || picked?.phone) ??
            (direction === "inbound" ? t("agentTest.unknownCaller") : t("agentTest.coldCall")),
          status:
            phase === "ended" ? (
              <span className="text-[var(--muted)]">{t("agentTest.ended")}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-[var(--foreground)]">
                {/* Lit while the agent is talking. */}
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    talking ? "bg-emerald-500" : "bg-[var(--muted)]"
                  }`}
                />
                {phase === "connecting"
                  ? t("agentTest.connecting")
                  : version !== null
                    ? usedDraft
                      ? t("agentTest.liveOnDraft", { n: version })
                      : t("agentTest.liveOn", { n: version })
                    : t("agentTest.live")}
              </span>
            ),
          // There is no live transcript on a web call (the data channel
          // carries none), so the words arrive on hang-up and the row says so
          // while the call is up.
          body: (review) =>
            phase !== "ended" ? (
              <p className="px-1 text-xs text-[var(--muted)] sm:px-4 lg:px-8">
                {t("agentTest.afterHangUp")}
              </p>
            ) : !result || (!result.ready && result.turns.length === 0) ? (
              <p className="px-1 text-xs text-[var(--muted)] sm:px-4 lg:px-8">
                {t("agentTest.waiting")}
              </p>
            ) : (
              <AgentTestResult
                result={result}
                note={result.turns.length === 0 ? t("agentTest.waiting") : null}
                review={{ testId, ...review }}
              />
            ),
        };

  return (
    <div className="space-y-4">
      <section className={AGENT_PANE_CARD}>
        <div className="mb-3 flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">{t("agentTest.setupTitle")}</h3>
          <InfoTip
            text={
              t("agentTest.setupHint", { name: agentName }) +
              (hasEdits ? ` ${t("agentTest.draftIncluded")}` : "")
            }
          />
        </div>

        {/* ONE row of label-over-control pairs: who, which way, which
            microphone and speaker. Three equal columns whether or not the
            Audio picker shows, so it appearing moves nothing; stacked on a
            phone. */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className={SETUP_LABEL}>{t("agentTest.callAs")}</span>
            <CustomerPickField
              value={picked}
              onChange={setPicked}
              disabled={live}
              placeholder={t("agentTest.searchCustomer")}
              clearLabel={t("agentTest.stranger")}
            />
          </div>
          {/* A dropdown, not a segmented track: it sits beside a boxed field,
              and a two-option picker naming the whole answer reads as one
              more field in the row (Nudge, 2026-09-19). */}
          <div className="flex min-w-0 flex-col gap-1">
            <span className={SETUP_LABEL}>{t("agentTest.direction")}</span>
            <SearchableSelect
              value={direction}
              searchable={false}
              menuWidth="trigger"
              disabled={live}
              placeholder={t("agentTest.direction")}
              options={[
                { value: "outbound", label: t("agentTest.outbound") },
                { value: "inbound", label: t("agentTest.inbound") },
              ]}
              onChange={(next) => setDirection(next as Direction)}
            />
          </div>
          {/* ONE dropdown with two groups, the Meet shape: microphone and
              speaker are one decision, which headset. The field names the
              microphone; the menu ticks the pick in each group and stays open
              so both can be set in one visit. */}
          {showAudio && (
            <div className="flex min-w-0 flex-col gap-1">
              <span className={SETUP_LABEL}>{t("agentTest.audio")}</span>
              <SearchableSelect
                value=""
                values={[`mic:${micId ?? SYSTEM_DEFAULT}`, `spk:${speakerId ?? SYSTEM_DEFAULT}`]}
                triggerLabel={
                  mics.find((device) => device.id === micId)?.label ??
                  t("agentTest.systemDefault")
                }
                searchable={false}
                menuWidth="trigger"
                menuMinWidth={320}
                disabled={live}
                placeholder={t("agentTest.audio")}
                options={[
                  {
                    value: `mic:${SYSTEM_DEFAULT}`,
                    label: t("agentTest.systemDefault"),
                    group: t("agentTest.mic"),
                  },
                  ...mics.map((device) => ({
                    value: `mic:${device.id}`,
                    label: device.label,
                    group: t("agentTest.mic"),
                  })),
                  {
                    value: `spk:${SYSTEM_DEFAULT}`,
                    label: t("agentTest.systemDefault"),
                    group: t("agentTest.speaker"),
                  },
                  ...speakers.map((device) => ({
                    value: `spk:${device.id}`,
                    label: device.label,
                    group: t("agentTest.speaker"),
                  })),
                ]}
                onChange={(next) => {
                  if (next.startsWith("mic:")) chooseAudio({ mic: next.slice(4) });
                  else chooseAudio({ speaker: next.slice(4) });
                }}
              />
            </div>
          )}
        </div>
        {/* The line that explains the state, under the row, only when there
            is one. */}
        {statusLine && (
          <p
            className={`mt-3 text-xs ${
              statusLine.warn ? "text-amber-700 dark:text-amber-400" : "text-[var(--muted)]"
            }`}
          >
            {statusLine.text}
          </p>
        )}

        {/* What the agent knows going in, a box of its own: the opening line,
            then every value it reads, each editable for this test. An empty
            box is not "send nothing": a blank row is omitted from the wire,
            so the agent falls back as it would on a real call. */}
        <div className="mt-5 min-w-0 rounded-lg border border-[var(--border)] p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <h4 className="text-sm font-semibold">{t("agentTest.variables")}</h4>
            <InfoTip text={t("agentTest.variablesHint")} />
          </div>
          {rows === null ? (
            <p className="text-xs text-[var(--muted)]">{t("agentTest.reading")}</p>
          ) : (
            <>
              {firstSentence && (
                <div className={shownRows.length > 0 ? "mb-4" : ""}>
                  <div className={SETUP_LABEL}>{t("voiceDetail.opening")}</div>
                  {/* Wraps: an opening line is often two sentences, and a cut
                      one hides the part that changes per caller. */}
                  <p className="mt-1 text-xs leading-relaxed text-[var(--foreground)]">
                    {firstSentence}
                  </p>
                </div>
              )}
              {shownRows.length > 0 && (
                <div className="grid grid-cols-1 gap-x-8 gap-y-0.5 md:grid-cols-2">
                  {shownRows.map((row) => (
                    // Label beside its value from sm; on a phone the label
                    // sits over a value that gets the whole width, as the
                    // setup row's pairs do.
                    <label
                      key={row.key}
                      className={`flex min-w-0 flex-col gap-0.5 text-xs max-sm:py-1 sm:flex-row sm:gap-2 ${
                        row.long ? "sm:items-start md:col-span-2" : "sm:items-center"
                      }`}
                    >
                      {/* The label is how you FIND the row, the value is what
                          you read: --muted-strong against --foreground. The
                          key rides in the title for whoever needs it. */}
                      <span
                        title={row.key}
                        className={`shrink-0 truncate text-[var(--muted-strong)] sm:w-44 ${
                          row.long ? "sm:pt-1.5" : ""
                        }`}
                      >
                        {labelOf(row.key)}
                      </span>
                      {row.long ? (
                        <textarea
                          value={valueOf(row)}
                          rows={Math.min(4, Math.max(2, valueOf(row).split("\n").length))}
                          disabled={live}
                          onFocus={() => setFocusedKey(row.key)}
                          onBlur={() => setFocusedKey(null)}
                          onChange={(event) => setRow(row.key, event.target.value)}
                          className={`${VALUE_FIELD} thin-scroll resize-none py-1 leading-relaxed`}
                        />
                      ) : (
                        <input
                          value={valueOf(row)}
                          disabled={live}
                          onFocus={() => setFocusedKey(row.key)}
                          onBlur={() => setFocusedKey(null)}
                          onChange={(event) => setRow(row.key, event.target.value)}
                          className={`${VALUE_FIELD} h-7`}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
              {/* Two folds, and each says what it hides. The first holds the
                  rows with no value: open it to type one. Everything under the
                  second is on the wire too, but this agent's prompt never
                  mentions it. */}
              {(emptyCount > 0 || unreadCount > 0) && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                  {emptyCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowEmpty((open) => !open)}
                      className={FOLD_LINK}
                    >
                      {showEmpty
                        ? t.plural("agentTest.unknownHide", emptyCount)
                        : t.plural("agentTest.unknownMore", emptyCount)}
                    </button>
                  )}
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowUnread((open) => !open)}
                      className={FOLD_LINK}
                    >
                      {showUnread
                        ? t.plural("agentTest.unreadHide", unreadCount)
                        : t.plural("agentTest.unreadMore", unreadCount)}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* The action, under both sections and trailing: it fires a call that
            reads the setup AND the edited values. The phone test stays one
            click away at the other end: Nudge cut its own (a contact's Call
            button does the same, and it rings the published agent, not the
            draft), Resepta keeps it reachable. */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => setPhoneOpen((open) => !open)}
            aria-expanded={phoneOpen}
            className={FOLD_LINK}
          >
            {phoneOpen ? t("agentTest.phoneClose") : t("agentTest.phoneOpen")}
          </button>
          {live ? (
            <button
              type="button"
              onClick={() => {
                hangUp();
                setPhase("ended");
              }}
              className={`${buttonClass("danger", "sm")} ml-auto`}
            >
              {t("agentTest.hangUp")}
            </button>
          ) : (
            <button
              type="button"
              disabled={unavailable || rows === null}
              onClick={start}
              className={`${buttonClass("primary", "sm")} ml-auto`}
            >
              {phase === "ended" ? t("agentTest.again") : t("agentTest.start")}
            </button>
          )}
        </div>
        {phoneOpen && (
          <AgentPhoneTest agentId={agentId} agentName={agentName} stale={phoneTestStale} />
        )}
      </section>

      {seen && <AgentTestsLog agentId={agentId} current={current} />}
    </div>
  );
}

// The real-phone test: rings a number with this agent's PUBLISHED version
// (testCall pins it), so it proves the line rather than the draft. A real
// call, recorded like any other.
function AgentPhoneTest({
  agentId,
  agentName,
  stale,
}: {
  agentId: string;
  agentName: string;
  stale: boolean;
}) {
  const { t } = useLanguage();
  const testCall = useAction(api.retellAgent.testCall);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ warn: boolean; text: string } | null>(null);

  const ring = () => {
    const number = to.trim();
    // Checked here as well as in the action: the action's error is English,
    // this one speaks the business's language.
    if (!E164_RE.test(number)) {
      setLine({ warn: true, text: t("voiceDetail.badNumber") });
      return;
    }
    setBusy(true);
    setLine({ warn: false, text: t("voiceDetail.calling") });
    void testCall({ agentId, toNumber: number })
      .then((res) =>
        setLine({
          warn: false,
          text: t("voiceDetail.callingFromTo", { to: res.to, from: res.from }),
        }),
      )
      .catch((err: unknown) =>
        // The number belongs to a customer who asked not to be called by the
        // AI. A test call has nobody to say "call anyway" on their behalf;
        // their record's Place call does.
        setLine({
          warn: true,
          text:
            err instanceof Error && err.message.includes("no-ai-calls")
              ? t("voiceDetail.noAiCalls")
              : t("settings.voiceActionFailed"),
        }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={to}
          inputMode="tel"
          autoComplete="off"
          onChange={(event) => setTo(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && !busy && ring()}
          placeholder="+905321234567"
          aria-label={t("agentTest.phoneNumber")}
          className={`${fieldClass("sm")} w-full sm:w-56`}
        />
        <button
          type="button"
          disabled={busy || !to.trim()}
          onClick={ring}
          className={buttonClass("outline", "sm")}
        >
          {t("voiceDetail.callMe")}
        </button>
        <InfoTip text={t("voiceDetail.testHint")} />
      </div>
      {/* The state to act on stays visible: the call would not hear what is
          on screen. */}
      {stale && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("voiceDetail.testUnsaved")}
        </p>
      )}
      {/* What pressing Call does, once there is a number to name; the line
          is reserved either way, so typing moves nothing. */}
      <p
        className={`min-h-4 text-xs ${
          line?.warn ? "text-amber-700 dark:text-amber-400" : "text-[var(--muted)]"
        }`}
      >
        {line?.text ??
          (to.trim() ? t("voiceDetail.confirmCall", { to: to.trim(), name: agentName }) : "")}
      </p>
    </div>
  );
}
