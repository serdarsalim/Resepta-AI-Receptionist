"use client";

import { useMutation, useQuery, useConvex } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { useNumberDocumentUpload } from "./NumberRequestCard";
import { BrandMark } from "./BrandMark";
import { LANGUAGES, type Language } from "@/lib/i18n";
import { presetLanguage } from "../../convex/lib/industryPresets";

// First sign-in onboarding: the one-question gate grown into a short wizard.
// Five screens — language, name, industry, business info, phone number — in
// the /book wizard's grammar: the middle SWAPS and scrolls, the bottom bar's action
// button is always in the corner (greyed, never absent) with Back opposite.
// NOT the /book card's fixed height: that rule was written for steps that
// hold similar amounts, and these do not (one input vs eight options), so a
// fixed card left the name step crammed at the top of a void (Serdar,
// 2026-08-21). The card sizes to its step between a floor and the viewport
// cap; centered, so growth expands symmetrically instead of shoving.
//
// The org's NAME is saved LAST, deliberately. The gate condition is
// `org.name === ""`, so the moment a name lands the shell unlocks and this
// wizard unmounts — which makes the final save the natural commit point for
// everything the wizard collected, and an abandoned wizard simply reopens
// next visit (every earlier write — language, preset, knowledge, document —
// is idempotent or additive). Naming the org is also what schedules voice
// agent auto-provisioning (orgs.update), so by then the language and the
// catalog the agent reads at ring time are already in place.

type Step = "language" | "name" | "industry" | "info" | "number";
const STEPS: Step[] = ["language", "name", "industry", "info", "number"];

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 3H4a1 1 0 00-1 1v8a1 1 0 001 1h2M10.5 5.5L13 8l-2.5 2.5M13 8H6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// An option row with the selected shape the design language demands: a hue
// alone reads as decoration, so the active row carries a check.
function OptionRow({
  selected,
  title,
  hint,
  onClick,
}: {
  selected: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-[var(--border)] hover:bg-[var(--muted-bg)]"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {hint && (
          <span className="mt-0.5 block text-xs text-[var(--muted)]">
            {hint}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 text-[var(--accent)] ${selected ? "" : "invisible"}`}
      >
        <CheckIcon />
      </span>
    </button>
  );
}

export function OnboardingWizard() {
  const { t, language, setLanguage } = useLanguage();
  const { signOut } = useAuthActions();
  const convex = useConvex();
  const update = useMutation(api.orgs.update);
  const applyPreset = useMutation(api.onboarding.applyIndustryPreset);
  const createKnowledge = useMutation(api.knowledge.create);
  const numberRequest = useQuery(api.numberRequests.mine, {});
  const {
    uploading,
    error: uploadError,
    upload: uploadDocument,
  } = useNumberDocumentUpload();

  const [step, setStep] = useState<Step>("language");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  // A plain string, not IndustryKey: the catalogue is served by a query now
  // (convex/industryPresets), and an operator can coin a vertical the code
  // module has never heard of. The server validates the key on apply.
  const [industry, setIndustry] = useState<string | null>(null);
  const [prefill, setPrefill] = useState(true);
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const stepIndex = STEPS.indexOf(step);
  const presetLang = presetLanguage(language);
  // The verticals on offer, from the deployment rather than from this bundle.
  // They used to be a static import, which meant a vertical retired or added
  // in /admin reached nobody until the next deploy — and meant a browser
  // holding an old bundle could still offer one that is gone.
  const catalogue = useQuery(api.industryPresets.catalogue, {});

  // The language step STAYS a step (Serdar, 2026-08-21, after weighing
  // drop-it-entirely and a-field-on-the-name-step): the agent and every
  // customer message are born in this language, which earns it a screen of
  // its own. What protects the first impression is not the step but two
  // things around it: the step arrives PRESELECTED with the landing's
  // language (a German visitor sees Deutsch already checked), and AppShell's
  // language sync stands down while the org is unnamed — without that, the
  // founding default "tr" flipped this screen to Turkish for everyone. The
  // inherited language is stamped onto the org immediately (and re-stamped
  // on every pick), so it is in place before the name save fires
  // auto-provisioning. A header-pill version of this control shipped for an
  // hour and died: three bare two-letter codes explained nothing.
  const stampedLanguage = useRef<string | null>(null);
  useEffect(() => {
    if (stampedLanguage.current === language) return;
    stampedLanguage.current = language;
    void update({ language });
  }, [language, update]);

  const pickLanguage = (lang: Language) => {
    setLanguage(lang);
  };

  // Everything the wizard collected, committed with the name save last (see
  // the header comment). Preset and knowledge writes are idempotent enough
  // for a retry after a taken name: the preset skips existing keys, and the
  // knowledge writes only run once thanks to the sent ref.
  const knowledgeSent = useRef(false);
  const finish = async () => {
    setBusy(true);
    setNameError(null);
    try {
      if (industry) {
        await applyPreset({ industry, prefill });
      }
      if (!knowledgeSent.current) {
        const blocks: { title: string; body: string }[] = [];
        if (address.trim())
          blocks.push({ title: t("onboarding.kbAddress"), body: address.trim() });
        if (website.trim())
          blocks.push({ title: t("onboarding.kbWebsite"), body: website.trim() });
        if (about.trim())
          blocks.push({ title: t("onboarding.kbAbout"), body: about.trim() });
        for (const block of blocks) await createKnowledge(block);
        knowledgeSent.current = true;
      }
      await update({ name: name.trim() });
      // The shell unlocks by itself: org.name is no longer "", and the gate
      // in AppShell stops rendering this component.
    } catch (err) {
      setBusy(false);
      if (String(err).includes("name-taken")) {
        setNameError(t("onboarding.nameTaken"));
        setStep("name");
      } else {
        setNameError(t("settings.nameRejected"));
        setStep("name");
      }
    }
  };

  const next = async () => {
    if (step === "name") {
      const trimmed = name.trim();
      if (!trimmed) return;
      setNameError(null);
      const free = await convex.query(api.onboarding.nameAvailable, {
        name: trimmed,
      });
      if (!free) {
        setNameError(t("onboarding.nameTaken"));
        return;
      }
    }
    if (step === "number") {
      await finish();
      return;
    }
    setStep(STEPS[stepIndex + 1]);
  };

  const canContinue =
    !busy &&
    !uploading &&
    (step === "name"
      ? name.trim().length > 0
      : step === "industry"
        ? industry !== null
        : true);

  return (
    // The card holds ONLY the step (Serdar, 2026-08-21: "welcome, three
    // languages and a sign-out button" on one line was three unrelated
    // things fighting). Product identity and the way out are PAGE chrome —
    // brand top-left, sign out top-right — and the card's heading is the
    // step's own QUESTION, never a greeting with the question demoted to
    // subtext.
    <div className="flex h-[100dvh] flex-col bg-[var(--pane)]">
      <header className="flex shrink-0 items-center justify-between px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark small />
          <span className="font-semibold tracking-tight">Resepta</span>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          <SignOutIcon />
          {t("nav.signOut")}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="flex max-h-full min-h-[340px] w-full max-w-lg flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
          <div className="px-5 pt-5">
            <h2 className="text-lg font-semibold">
              {step === "language" && t("onboarding.langTitle")}
              {step === "name" && t("onboarding.nameTitle")}
              {step === "industry" && t("onboarding.industryTitle")}
              {step === "info" && t("onboarding.infoTitle")}
              {step === "number" && t("onboarding.numberTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {step === "language" && t("onboarding.langHint")}
              {step === "name" && t("onboarding.nameHint")}
              {step === "industry" && t("onboarding.industryHint")}
              {step === "info" && t("onboarding.infoHint")}
              {step === "number" && t("onboarding.numberPromise")}
            </p>
          </div>

          <div className="thin-scroll stable-gutter mt-4 min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          {step === "language" && (
            <div className="space-y-2">
              {LANGUAGES.map((entry) => (
                <OptionRow
                  key={entry.code}
                  selected={language === entry.code}
                  title={entry.label}
                  onClick={() => pickLanguage(entry.code)}
                />
              ))}
            </div>
          )}

          {step === "name" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void next();
              }}
            >
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                aria-label={t("onboarding.businessName")}
                required
                autoFocus
                className="w-full"
              />
              {/* Reserved line: an appearing error must not push the card
                  around under the pointer. */}
              <p className="mt-2 min-h-5 text-sm text-red-600 dark:text-red-400">
                {nameError}
              </p>
            </form>
          )}

          {step === "industry" && (
            <div className="space-y-2">
              {/* One line rather than a skeleton: the card sizes to its step,
                  so a placeholder the shape of eight options would be a bigger
                  lie about what is coming than a word. */}
              {catalogue === undefined ? (
                <p className="py-2 text-sm text-[var(--muted)]">
                  {t("common.loading")}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {catalogue.map((preset) => (
                    <OptionRow
                      key={preset.key}
                      selected={industry === preset.key}
                      title={preset.name[presetLang]}
                      onClick={() => setIndustry(preset.key)}
                    />
                  ))}
                </div>
              )}
              {/* Always rendered so picking an industry does not grow the
                  card; moot for "other", which seeds nothing either way. */}
              <div className="space-y-2 pt-3">
                <OptionRow
                  selected={prefill}
                  title={t("onboarding.prefillYes")}
                  hint={t("onboarding.prefillYesHint")}
                  onClick={() => setPrefill(true)}
                />
                <OptionRow
                  selected={!prefill}
                  title={t("onboarding.prefillNo")}
                  hint={t("onboarding.prefillNoHint")}
                  onClick={() => setPrefill(false)}
                />
              </div>
            </div>
          )}

          {step === "info" && (
            <div className="space-y-3">
              <label className="block text-sm">
                {t("onboarding.address")}
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  className="mt-1 w-full"
                />
              </label>
              <label className="block text-sm">
                {t("onboarding.website")}
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  inputMode="url"
                  className="mt-1 w-full"
                />
              </label>
              <label className="block text-sm">
                {t("onboarding.about")}
                <textarea
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  rows={4}
                  placeholder={t("onboarding.aboutPlaceholder")}
                  className="mt-1 w-full"
                />
              </label>
            </div>
          )}

          {step === "number" && (
            <div className="space-y-3">
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadDocument(file);
                  e.target.value = "";
                }}
              />
              {numberRequest ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                  {t("onboarding.uploaded").replace(
                    "{file}",
                    numberRequest.fileName,
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
                >
                  {uploading ? t("common.loading") : t("onboarding.uploadDoc")}
                </button>
              )}
              <p className="text-xs text-[var(--muted)]">
                {t("onboarding.uploadHint")}
              </p>
              {uploadError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {uploadError}
                </p>
              )}
              <p className="text-sm text-[var(--muted)]">
                {t("onboarding.uploadLater")}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={() => setStep(STEPS[stepIndex - 1])}
            disabled={stepIndex === 0 || busy}
            className={`rounded-lg px-3 py-2 text-sm text-[var(--muted-strong)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] ${
              stepIndex === 0 ? "invisible" : ""
            }`}
          >
            {t("onboarding.back")}
          </button>
          <div className="flex flex-1 items-center justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  i === stepIndex
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--border)]"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => void next()}
            disabled={!canContinue}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          >
            {busy
              ? t("onboarding.working")
              : step === "number"
                ? t("onboarding.finish")
                : t("onboarding.continue")}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
