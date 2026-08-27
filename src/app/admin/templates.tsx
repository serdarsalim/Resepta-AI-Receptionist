"use client";

// The fleet template desk. Wording and rollout are FLEET facts (Serdar,
// 2026-08-27): the standard set is identical for every business, which is
// what lets one WABA approval serve every hosted number, so the operator
// edits a text once here and pushes it everywhere, and reads approval as a
// matrix of businesses rather than a tour of tenant pages. The per-org
// Templates tab this replaces lasted one day.

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { categoryFor } from "../../../convex/lib/metaTemplate";
import {
  renderTokens,
  type TokenValues,
} from "../../../convex/lib/renderTokens";
import { EmailBodyEditor } from "@/components/EmailBodyEditor";
import { sanitizeEmailHtml } from "@/lib/sanitizeHtml";
import { plainToHtml, htmlToText } from "@/lib/emailText";
import { Section, ago } from "./parts";
import type { useSearch } from "@/lib/useTableState";

type Search = ReturnType<typeof useSearch>;

const LANGUAGES = ["tr", "en", "de"] as const;
const KINDS = [
  "confirmation",
  "reminder",
  "winback",
  "followup",
  "cancellation",
] as const;
// The matrix shows campaign too: its wrapper is parked, but which businesses
// hold an approved one is still a fleet fact.
const MATRIX_KINDS = [...KINDS, "campaign"] as const;

// The sentence the mutation threw, out of Convex's wrapper. The guard
// messages are written for the operator ("tokens the Cloud lane cannot
// send: manage_link") and the [CONVEX M(...)] [Request ID] framing around
// them is transport noise even on an operator page.
function plainError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/Uncaught Error:\s*([\s\S]*?)(?:\s+at handler|\n|$)/);
  return m ? m[1].trim() : msg;
}

// What the Preview tab fills tokens with: labelled slots, not fake data —
// the preview's job is to show the shape of the sentence ("Merhaba ⟨name⟩"),
// not to invent a customer. Same grammar as the salon editor's preview.
const slot = (label: string) => `⟨${label}⟩`;
const PREVIEW_VALUES: TokenValues = {
  firstName: slot("name"),
  businessName: slot("business"),
  appointmentAt: slot("date"),
  staffName: slot("staff"),
  serviceName: slot("service"),
  servicePriceList: slot("price list"),
  price: slot("price"),
  manageLink: slot("manage link"),
  bookingLink: slot("booking link"),
  phone: slot("phone"),
  email: slot("email"),
};

const STATUS_STYLE: Record<string, string> = {
  approved:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  pending:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  draft: "bg-[var(--muted-bg)] text-[var(--muted)]",
};

export function TemplatesTab({ search }: { search: Search }) {
  return (
    <>
      <WordingSection />
      <RolloutSection search={search} />
    </>
  );
}

// ---- Wording ------------------------------------------------------------

function WordingSection() {
  const wording = useQuery(api.waTemplates.platformWording, {});
  const save = useMutation(api.waTemplates.setPlatformWording);
  const clear = useMutation(api.waTemplates.clearPlatformWording);
  const saveEmail = useMutation(api.waTemplates.setPlatformRichText);
  const clearEmail = useMutation(api.waTemplates.clearPlatformRichText);
  const resubmitAll = useAction(api.waTemplates.resubmitTemplateAll);

  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>("tr");
  // Buffered on purpose (the design language's one buffering case): these
  // texts stand behind approved templates that send while you type, so
  // nothing leaves the browser until Save.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // The email lane's buffer, same key: the subject and the WYSIWYG's HTML
  // (the plain body derives from it at save). Doubly buffered for a sharper
  // reason than the Cloud lane: an email save is the rollout — it patches
  // every org's rows the moment it lands.
  const [emailDrafts, setEmailDrafts] = useState<
    Record<string, { subject?: string; html?: string }>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  // One note slot per (kind, language): save confirmations, validation
  // refusals, and per-org resubmit results all land next to the text they
  // are about.
  const [notes, setNotes] = useState<Record<string, string>>({});

  const note = (key: string, text: string | null) =>
    setNotes((prev) => {
      const next = { ...prev };
      if (text === null) delete next[key];
      else next[key] = text;
      return next;
    });

  return (
    <Section
      title="Message wording"
      description="One message, two forms, both fleet facts. The top text is the WhatsApp Cloud template every business registers — identical wording across the fleet is what keeps approval per WABA instead of per client. Saving stores it for every FUTURE registration; already-registered templates keep their old text until you resubmit, which re-enters Meta review while the approved version keeps delivering. If a new text is REJECTED, that kind stops sending for the affected business until re-approved, which is why rollout is per kind. The email row beneath is what the same moment sends as an email (and over non-hosted WhatsApp numbers): subject plus body, no review anywhere, so saving it applies to every business instantly."
    >
      <div className="flex flex-wrap items-center gap-1.5 pb-3">
        {LANGUAGES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setLanguage(option)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              language === option
                ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      {wording === undefined ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <div className="space-y-4">
          {KINDS.map((kind) => {
            const row = wording.find(
              (w) => w.kind === kind && w.language === language,
            );
            if (!row) return null;
            const key = `${kind}/${language}`;
            const draft = drafts[key];
            const value = draft ?? row.body;
            const dirty = draft !== undefined && draft !== row.body;
            const emailKey = `${key}/email`;
            const emailDraft = emailDrafts[key];
            const emailSubject = emailDraft?.subject ?? row.emailSubject;
            // The WYSIWYG's projection pair: the HTML is what the email
            // sends, the plain text (derived at save) is what the session
            // lane sends. Stock texts are plain, so the editor seed lifts
            // them with plainToHtml.
            const emailBaseHtml =
              row.emailBodyHtml ?? plainToHtml(row.emailBody);
            const emailHtml = emailDraft?.html ?? emailBaseHtml;
            const emailDirty =
              emailSubject !== row.emailSubject || emailHtml !== emailBaseHtml;
            const clearEmailDraft = () =>
              setEmailDrafts((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            // What the customer's mail client will show, tokens rendered to
            // labelled slots — a different VIEW of the body, hosted as the
            // editor's own Preview tab (the RemindersView pattern).
            const emailPreview = (
              <div className="email-paper -m-3 flex flex-col">
                <p className="border-b border-black/10 px-3 py-2 text-xs font-semibold">
                  {renderTokens(emailSubject, PREVIEW_VALUES) || "—"}
                </p>
                <div
                  className="email-body-editor min-h-40 px-3 py-3 text-sm"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeEmailHtml(
                      renderTokens(emailHtml, PREVIEW_VALUES),
                    ),
                  }}
                />
              </div>
            );
            return (
              // A card per kind (Serdar, 2026-08-28: the flat wall of boxes
              // "sucks badly"): the kind names the card once, and each lane
              // wears its own chip and controls, so ten near-identical
              // textareas become five messages with two forms each.
              <div
                key={key}
                className="rounded-xl border border-[var(--border)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{kind}</span>
                  {/* What this kind SUBMITS as (categoryFor, the same answer
                      the submission sends). What it LANDED as after review is
                      per business and lives in the matrix below — Meta may
                      recategorise, and the landed one is the billing. */}
                  <span className="rounded-full bg-[var(--muted-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">
                    {categoryFor(kind).toLowerCase()}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    WhatsApp
                  </span>
                  {row.overridden && (
                    <span className="text-xs text-[var(--muted)]">
                      edited from default
                    </span>
                  )}
                  <span className="flex-1" />
                  {row.overridden && !dirty && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setBusy(key);
                        note(key, null);
                        void clear({ kind, language })
                          .then(() => {
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[key];
                              return next;
                            });
                            note(key, "Back to the default. Resubmit to apply at Meta.");
                          })
                          .catch((err) =>
                            note(key, plainError(err)),
                          )
                          .finally(() => setBusy(null));
                      }}
                      className="text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
                    >
                      Reset to default
                    </button>
                  )}
                  {dirty && (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setDrafts((prev) => {
                            const next = { ...prev };
                            delete next[key];
                            return next;
                          });
                          note(key, null);
                        }}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setBusy(key);
                          note(key, null);
                          void save({ kind, language, body: value })
                            .then(() => {
                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                              note(key, "Saved. Resubmit to apply at Meta.");
                            })
                            .catch((err) =>
                              // The mutation throws plain sentences (bad
                              // tokens, over-length); show them as thrown.
                              note(key, plainError(err)),
                            )
                            .finally(() => setBusy(null));
                        }}
                        className="rounded-lg bg-[var(--accent,#2563eb)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {busy === key ? "Saving…" : "Save"}
                      </button>
                    </>
                  )}
                  {/* Resting pages offer nothing: the button exists only
                      while at least one registered template would receive
                      NEW wording (Serdar, 2026-08-27). It appears on its own
                      after a save, names how many businesses it will touch,
                      and disappears when the fleet converges. */}
                  {!dirty && row.stale > 0 && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setBusy(key);
                        note(key, null);
                        void resubmitAll({ kind, language })
                          .then((results) =>
                            note(
                              key,
                              results.length === 0
                                ? "No business has this template registered yet."
                                : results
                                    .map(
                                      (r) =>
                                        `${r.org}: ${
                                          r.ok
                                            ? r.reason === "in-review"
                                              ? "already in review"
                                              : r.reason === "unchanged"
                                                ? "unchanged, skipped"
                                                : "sent to review"
                                            : (r.detail ?? r.reason ?? "failed")
                                        }`,
                                    )
                                    .join(" · "),
                            ),
                          )
                          .catch((err) =>
                            note(key, plainError(err)),
                          )
                          .finally(() => setBusy(null));
                      }}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
                    >
                      {busy === key
                        ? "Working…"
                        : `Resubmit everywhere (${row.stale})`}
                    </button>
                  )}
                </div>
                <textarea
                  value={value}
                  rows={Math.max(3, value.split("\n").length)}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                />
                {notes[key] && (
                  <p className="mt-1 text-xs text-[var(--muted)]">{notes[key]}</p>
                )}
                {/* The email form of the same message. Its Save is the
                    rollout: no review sits between this box and customers,
                    so the note names how many rows it landed on. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
                    Email
                  </span>
                  {row.emailOverridden && !emailDirty && (
                    <span className="text-xs text-[var(--muted)]">
                      edited from default
                    </span>
                  )}
                  <span className="flex-1" />
                  {row.emailOverridden && !emailDirty && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setBusy(emailKey);
                        note(emailKey, null);
                        void clearEmail({ kind, language })
                          .then((patched) => {
                            clearEmailDraft();
                            note(
                              emailKey,
                              `Back to the default, applied to ${patched} template rows.`,
                            );
                          })
                          .catch((err) => note(emailKey, plainError(err)))
                          .finally(() => setBusy(null));
                      }}
                      className="text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
                    >
                      Reset to default
                    </button>
                  )}
                  {emailDirty && (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          clearEmailDraft();
                          note(emailKey, null);
                        }}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setBusy(emailKey);
                          note(emailKey, null);
                          void saveEmail({
                            kind,
                            language,
                            subject: emailSubject,
                            // Both projections of what the editor holds: the
                            // HTML the email sends, the plain text the
                            // session lane sends.
                            body: htmlToText(emailHtml),
                            bodyHtml: emailHtml,
                          })
                            .then((patched) => {
                              clearEmailDraft();
                              note(
                                emailKey,
                                `Saved and applied to ${patched} template rows across the fleet.`,
                              );
                            })
                            .catch((err) => note(emailKey, plainError(err)))
                            .finally(() => setBusy(null));
                        }}
                        className="rounded-lg bg-[var(--accent,#2563eb)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {busy === emailKey ? "Applying…" : "Save"}
                      </button>
                    </>
                  )}
                </div>
                <input
                  value={emailSubject}
                  onChange={(e) =>
                    setEmailDrafts((prev) => ({
                      ...prev,
                      [key]: { ...prev[key], subject: e.target.value },
                    }))
                  }
                  aria-label={`${kind} email subject`}
                  placeholder="Subject"
                  className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
                />
                <div className="mt-1.5">
                  {/* The real email editor — Visual/HTML tabs plus the
                      rendered Preview, the exact component the salon's rule
                      editor uses, so what the desk shows is what the send
                      builds. Variables dropdown off: it lists an ORG's
                      contact fields, and the desk has no org. */}
                  <EmailBodyEditor
                    value={emailHtml}
                    showVariables={false}
                    previewPane={emailPreview}
                    previewLabel="Preview"
                    onLiveChange={(html) =>
                      setEmailDrafts((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], html },
                      }))
                    }
                    onSave={(html) =>
                      setEmailDrafts((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], html },
                      }))
                    }
                  />
                </div>
                {notes[emailKey] && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {notes[emailKey]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ---- Rollout ------------------------------------------------------------

function RolloutSection({ search }: { search: Search }) {
  const fleet = useQuery(api.waTemplates.fleetTemplateStatus, {});
  const registerAll = useAction(api.waTemplates.registerStandardSetAll);
  const registerOrg = useAction(api.waTemplates.registerStandardSet);
  const syncOrg = useAction(api.waTemplates.syncForOrg);
  const submitOne = useAction(api.waTemplates.submitForOrg);

  const [open, setOpen] = useState<Id<"orgs"> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fleetNote, setFleetNote] = useState<string | null>(null);
  // Per-org result lines, shown inside that org's expansion.
  const [orgNotes, setOrgNotes] = useState<Record<string, string>>({});

  const shown = (fleet ?? []).filter((org) => search.matches(org.name));

  return (
    <Section
      title="Businesses"
      description="Who holds which approval. Register creates and submits the standard rows for one business; the fleet button converges every wired business, skipping approved and in-review rows. Open a row for per-template detail and rejection reasons."
    >
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setBusy("all");
            setFleetNote(null);
            void registerAll({})
              .then((all) =>
                setFleetNote(
                  all.length === 0
                    ? "No businesses with a WABA yet."
                    : all
                        .map(
                          (entry) =>
                            `${entry.org}: ${entry.results
                              .map(
                                (r) =>
                                  `${r.kind} ${r.ok ? (r.reason === "already-approved" ? "✓" : r.reason === "in-review" ? "…" : "sent") : (r.detail ?? r.reason ?? "failed")}`,
                              )
                              .join(", ")}`,
                        )
                        .join(" · "),
                ),
              )
              .catch((err) =>
                setFleetNote(plainError(err)),
              )
              .finally(() => setBusy(null));
          }}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
        >
          {busy === "all" ? "Registering…" : "Register standard set on all businesses"}
        </button>
        {fleetNote && (
          <span className="text-xs text-[var(--muted)]">{fleetNote}</span>
        )}
      </div>
      {fleet === undefined ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No business has a WABA wired yet. Wire one on its Setup tab and the
          standard set registers itself.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--muted-strong)]">
                <th className="py-2 pr-3 font-medium">Business</th>
                {MATRIX_KINDS.map((kind) => (
                  <th key={kind} className="px-2 py-2 font-medium">
                    {kind}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {shown.map((org) => (
                <OrgRow
                  key={org.orgId}
                  org={org}
                  open={open === org.orgId}
                  onToggle={() =>
                    setOpen(open === org.orgId ? null : org.orgId)
                  }
                  busy={busy}
                  setBusy={setBusy}
                  note={orgNotes[org.orgId]}
                  setNote={(text) =>
                    setOrgNotes((prev) => ({ ...prev, [org.orgId]: text }))
                  }
                  registerOrg={registerOrg}
                  syncOrg={syncOrg}
                  submitOne={submitOne}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

type FleetOrg = NonNullable<
  ReturnType<typeof useQuery<typeof api.waTemplates.fleetTemplateStatus>>
>[number];

function OrgRow({
  org,
  open,
  onToggle,
  busy,
  setBusy,
  note,
  setNote,
  registerOrg,
  syncOrg,
  submitOne,
}: {
  org: FleetOrg;
  open: boolean;
  onToggle: () => void;
  busy: string | null;
  setBusy: (b: string | null) => void;
  note: string | undefined;
  setNote: (text: string) => void;
  registerOrg: ReturnType<typeof useAction<typeof api.waTemplates.registerStandardSet>>;
  syncOrg: ReturnType<typeof useAction<typeof api.waTemplates.syncForOrg>>;
  submitOne: ReturnType<typeof useAction<typeof api.waTemplates.submitForOrg>>;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer transition-colors hover:bg-[var(--hover-bg,rgba(0,0,0,0.03))]"
      >
        <td className="py-2 pr-3">
          <span className="font-medium">{org.name}</span>
          {!org.hasWaba && (
            <span className="ml-2 text-xs text-[var(--muted)]">no WABA</span>
          )}
        </td>
        {MATRIX_KINDS.map((kind) => {
          const cells = org.rows.filter((row) => row.kind === kind);
          return (
            <td key={kind} className="px-2 py-2">
              {/* Blank over zero: no row, no chip. Language order is fixed so
                  a column scans vertically. */}
              <span className="flex gap-1">
                {LANGUAGES.map((lang) => {
                  const row = cells.find((c) => c.language === lang);
                  if (!row) return null;
                  return (
                    <span
                      key={lang}
                      title={`${lang}: ${row.status}`}
                      className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[row.status] ?? STATUS_STYLE.draft}`}
                    >
                      {lang}
                    </span>
                  );
                })}
              </span>
            </td>
          );
        })}
      </tr>
      {open && (
        <tr>
          <td colSpan={MATRIX_KINDS.length + 1} className="pb-3 pl-3">
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={busy !== null || !org.hasWaba}
                onClick={() => {
                  setBusy(org.orgId);
                  void registerOrg({ orgId: org.orgId })
                    .then((results) =>
                      setNote(
                        results
                          .map(
                            (r) =>
                              `${r.kind}: ${r.ok ? (r.reason === "already-approved" ? "approved" : r.reason === "in-review" ? "in review" : "submitted") : (r.detail ?? r.reason ?? "failed")}`,
                          )
                          .join(" · "),
                      ),
                    )
                    .catch((err) =>
                      setNote(plainError(err)),
                    )
                    .finally(() => setBusy(null));
                }}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
              >
                Register standard set
              </button>
              <button
                type="button"
                disabled={busy !== null || !org.hasWaba}
                onClick={() => {
                  setBusy(org.orgId);
                  void syncOrg({ orgId: org.orgId })
                    .then((r) =>
                      setNote(
                        r.ok
                          ? `Synced, ${r.matched ?? 0} matched`
                          : (r.reason ?? "failed"),
                      ),
                    )
                    .catch((err) =>
                      setNote(plainError(err)),
                    )
                    .finally(() => setBusy(null));
                }}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
              >
                Sync from Meta
              </button>
              {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
            </div>
            {/* A real table, not a wrapped flex line (Serdar, 2026-08-27:
                "it looks super messy"): sixteen rows of drifting pills read
                as noise, aligned columns read as one glance. The kind names
                itself once per language group; every other cell sits under
                the same cell above it. */}
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--border)]">
                  {org.rows.map((row, index) => (
                    <tr key={row._id}>
                      <td className="w-32 py-1.5 pr-3 font-medium">
                        {index === 0 || org.rows[index - 1].kind !== row.kind
                          ? row.kind
                          : null}
                      </td>
                      <td className="w-8 px-2 py-1.5 text-xs text-[var(--muted)]">
                        {row.language}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs text-[var(--muted)]">
                        {row.metaName ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.status] ?? STATUS_STYLE.draft}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-[var(--muted)]">
                        {row.metaCategory ?? ""}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-[var(--muted)]">
                        {row.submittedAt !== null
                          ? `submitted ${ago(row.submittedAt)} ago`
                          : ""}
                      </td>
                      {/* Meta's rejection verdict in the open, in red, next
                          to the row it judges. The status DETAIL only when
                          it says more than the pill already does — after a
                          submission it is literally the word PENDING, and
                          printing that in red beside an amber "pending"
                          pill repeated the state and dressed it as an
                          error. */}
                      <td className="px-2 py-1.5 text-xs">
                        {row.metaRejectionReason ? (
                          <span className="text-red-700 dark:text-red-400">
                            {row.metaRejectionReason}
                          </span>
                        ) : row.metaStatusDetail &&
                          row.metaStatusDetail.toLowerCase() !== row.status ? (
                          <span className="text-[var(--muted)]">
                            {row.metaStatusDetail}
                          </span>
                        ) : null}
                      </td>
                      {/* Three resting states, matching what a click could
                          DO. Pending: nothing — Meta locks a template while
                          it reviews it, so the cell says where things stand
                          instead of inviting a doomed request. Approved and
                          unchanged: nothing — identical text would re-enter
                          review and burn an edit slot to change nothing
                          (Serdar, 2026-08-27: "so i don't accidentally
                          submit again"). Everything else submits. */}
                      <td className="py-1.5 pl-2 text-right">
                        {row.status === "pending" ? (
                          <span className="text-xs text-[var(--muted)]">
                            in review
                          </span>
                        ) : row.status === "approved" && row.changed === false ? (
                          <span className="text-xs text-[var(--muted)]">
                            up to date
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy !== null || !org.hasWaba}
                            onClick={() => {
                              setBusy(row._id);
                              void submitOne({ orgId: org.orgId, templateId: row._id })
                                .then((r) =>
                                  setNote(
                                    r.ok
                                      ? `${row.kind}/${row.language}: submitted`
                                      : `${row.kind}/${row.language}: ${r.detail ?? r.reason ?? "failed"}`,
                                  ),
                                )
                                .catch((err) =>
                                  setNote(plainError(err)),
                                )
                                .finally(() => setBusy(null));
                            }}
                            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
                          >
                            {busy === row._id
                              ? "Submitting…"
                              : row.status === "approved"
                                ? "Resubmit"
                                : "Submit"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
