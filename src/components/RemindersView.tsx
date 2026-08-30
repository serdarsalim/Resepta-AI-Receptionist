"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
// Pure TS shared with the backend on purpose: the preview must be the SAME
// renderer the send path uses, or the preview becomes a second opinion.
import { renderTokens, tokenDefaults } from "../../convex/lib/renderTokens";
import {
  VariableDefaultsEditor,
  type VariableDefault,
} from "./VariableDefaultsEditor";
// Same reason: the preview prints the date in the shape the send path prints
// it, timezone and all, rather than a second date formatter's opinion.
import { formatAppointmentTime } from "../../convex/lib/format";
// The SAME normaliser the backend reads hours through. A client-side reading of
// the legacy fields would be a second opinion about which days are open, and
// the card would eventually show a week the booking page disagreed with.
import {
  hasBusinessHours,
  windowForWeekday,
} from "../../convex/lib/businessHours";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatMoney as formatMinorUnits } from "@/lib/money";
import type { TranslationKey } from "@/lib/i18n";
import { sanitizeEmailHtml } from "@/lib/sanitizeHtml";
import { plainToHtml, htmlToText } from "@/lib/emailText";
import { previewSampleValues } from "@/lib/previewSamples";
import { useConfirm } from "./ConfirmDialog";
import {
  DEFAULT_TEMPLATE_TEXTS,
  isWordingLocked,
  type TemplateKind,
} from "../../convex/lib/templateTexts";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { EmojiPicker } from "./EmojiPicker";
import { VariableInsertDropdown } from "./VariableInsertDropdown";
import {
  minutesToTimeValue,
  timeValueToMinutes,
  weekdayNames,
} from "@/lib/datetime";
import { FIELD, ROW_GRID, RowLabel } from "./RowLabel";
import { TimezoneSelect } from "./TimezoneSelect";
import { InfoTip } from "./InfoTip";
import { Card } from "./Card";
import { SegmentedControl } from "./SegmentedControl";
import { Sheet } from "./Sheet";

// Nudge settings conventions: label-left/input-right on the shared RowLabel
// grid (ROW_GRID, defined next to RowLabel itself), autosave on blur/change,
// explanations behind InfoTips.

// ── Flow strip ──────────────────────────────────────────────────────────────
// A rule drawn as the automation it is: when → message → channel, nodes
// joined by arrows, instead of the three-column table this used to be. Same
// rows, same click-through into the editor — only the reading changed. The
// strip stacks vertically on a phone, where a horizontal chain would scroll
// or wrap mid-arrow.

function FlowNode({
  icon,
  children,
}: {
  icon: "zap" | "clock" | "message";
  children: ReactNode;
}) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        // One accent per strip, on the opening node's icon — bolt for the
        // event rules, clock for the timed ones. Everything after it is an
        // effect, and a chain of coloured icons is a chain with no start.
        className={
          icon === "message"
            ? "shrink-0 text-[var(--muted)]"
            : "shrink-0 text-[var(--accent)]"
        }
      >
        {icon === "zap" && (
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        )}
        {icon === "clock" && (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        )}
        {icon === "message" && (
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5z" />
        )}
      </svg>
      {children}
    </span>
  );
}

// FlowArrow, the joint between nodes, lived here until 2026-08-28: the list
// became two named columns and the arrows had nothing left to join.

type RuleTrigger =
  | "booking"
  | "before_start"
  | "after_end"
  | "cancellation"
  | "no_show"
  | "out_of_hours";

type RuleRowData = {
  _id: Id<"messageRules">;
  trigger: RuleTrigger;
  offsetHours: number;
  channel: "whatsapp" | "email" | "both";
  paused: boolean;
};

type TemplateRow = {
  _id: Id<"waTemplates">;
  ruleId?: Id<"messageRules">;
  kind: string;
  language: string;
  status: string;
  metaName?: string;
  metaStatusDetail?: string;
  metaRejectionReason?: string;
  submittedAt?: number;
  metaTemplateId?: string;
  body?: string;
  bodyHtml?: string;
  subject?: string;
  variableDefaults?: VariableDefault[];
  bodyPreview?: string;
  emailSentCount?: number;
  emailOpenCount?: number;
  emailReplyCount?: number;
  emailLastSentAt?: number;
  // The editor's unsaved buffer (schema waTemplates.draft) and the flag the
  // "Unsaved" pill keys on. Dirtiness is SERVER state here, not a client
  // compare, so the rule header can render it without reaching into the
  // editor's local state.
  draft?: TemplateDraftBlob;
  hasUnsavedChanges?: boolean;
};

type TemplateDraftBlob = {
  body?: string;
  bodyHtml?: string;
  subject?: string;
  variableDefaults?: VariableDefault[];
};

// What the editor opens with: the DRAFT when one exists, so a half-written
// message resumes where it was left, and the live fields otherwise. The same
// precedence orgs.commitTemplateDraft applies, so what you see is what Save
// publishes.
//
// ignoreDraft is the Discard path. Seeding from the live fields there is
// immune to the stale beat — the subscription can still be emitting the blob
// being thrown away, and live fields do not move on a discard.
function editorSeed(template?: TemplateRow, ignoreDraft = false) {
  const draft = ignoreDraft ? undefined : template?.draft;
  const body = draft?.body ?? template?.body ?? "";
  return {
    body,
    subject: draft?.subject ?? template?.subject ?? "",
    // || over ??: an empty-string bodyHtml on a row or draft must fall back
    // to the plain body, not seed a blank editor.
    bodyHtml: draft?.bodyHtml || template?.bodyHtml || plainToHtml(body),
    defaults: draft?.variableDefaults ?? template?.variableDefaults ?? [],
  };
}

// What "Add reminder" can add, and what timing each one accepts. The bounds
// are messageRules.clampOffset's, restated here so the sheet can refuse a
// number before the mutation silently rounds it into range — an owner who
// types 300 hours should be told the ceiling is 168, not handed a 168 they
// never asked for.
//
// `repeatable` marks the two that are genuinely a list: a 24h reminder and a
// 2h one are two different messages, and so are a review ask two hours after
// the visit and a rebooking nudge three weeks later. The rest are singletons —
// there is one confirmation, one away reply.
type AddOption = {
  trigger: RuleTrigger;
  nameKey: TranslationKey;
  whenKey: TranslationKey;
  repeatable?: boolean;
  timing?: {
    minHours: number;
    maxHours: number;
    defaultAmount: number;
    defaultUnit: "hours" | "days";
  };
};

const ADD_OPTIONS: AddOption[] = [
  {
    trigger: "booking",
    nameKey: "settings.ruleConfirmation",
    whenKey: "settings.ruleWhenBooked",
  },
  {
    trigger: "before_start",
    nameKey: "settings.ruleReminder",
    whenKey: "settings.ruleBeforeAppointment",
    repeatable: true,
    timing: {
      minHours: 1,
      maxHours: 168,
      defaultAmount: 24,
      defaultUnit: "hours",
    },
  },
  {
    trigger: "after_end",
    nameKey: "settings.ruleFollowup",
    whenKey: "settings.ruleAfterAppointment",
    repeatable: true,
    timing: {
      minHours: 1,
      maxHours: 720,
      defaultAmount: 24,
      defaultUnit: "hours",
    },
  },
  {
    trigger: "cancellation",
    nameKey: "settings.ruleCancellation",
    whenKey: "settings.ruleWhenCancelled",
  },
  {
    trigger: "no_show",
    nameKey: "settings.ruleWinback",
    whenKey: "settings.ruleAfterNoShow",
    timing: {
      minHours: 24,
      maxHours: 90 * 24,
      defaultAmount: 14,
      defaultUnit: "days",
    },
  },
  {
    trigger: "out_of_hours",
    nameKey: "settings.ruleOutOfHours",
    whenKey: "settings.ruleWhenClosed",
  },
];

// Same map as messageRules.kindForTrigger — which template bucket words a
// trigger, for the fallback lookup and the row labels.
const KIND_FOR_TRIGGER: Record<RuleTrigger, string> = {
  booking: "confirmation",
  before_start: "reminder",
  after_end: "followup",
  cancellation: "cancellation",
  no_show: "winback",
  out_of_hours: "out_of_hours",
};

// What a rule can actually reach today, mirroring wa.sendAppointmentMessage:
// email needs a From on the org and template text; WhatsApp depends on which
// lane would carry the send. A Cloud number wins whenever it exists
// (lib/waLane rule 2), so with one connected the send stands or falls on
// Meta's approval — the shop phone carries rules only when it is the only
// WhatsApp the org has, and then all it needs is the words.
//
// ── The rules-model card ────────────────────────────────────────────────────
//
// One row per messageRules document, in customer-journey order, each owning
// its timing, its channel and — behind the chevron — its own wording with a
// live preview. The legacy card above renders only for orgs the migration has
// not reached and dies with the legacy fields.

// The two projections of one authored email — plainToHtml and htmlToText —
// moved to lib/emailText when the fleet desk started making the same split.

// A platform-owned message, shown the only way a salon ever meets it:
// rendered (Serdar, 2026-08-28 — the raw token box "sucks"). One channel at
// a time behind an Email/WhatsApp toggle when the rule really travels both;
// a single wired lane shows itself with nothing to click. Both faces fill
// their tokens from the sample booking, so the owner reads the message a
// customer will read, not syntax.
function LockedPreview({
  lanes,
  subject,
  body,
  bodyHtml,
  values,
  orgName,
}: {
  lanes: ("email" | "whatsapp")[];
  subject: string;
  body: string;
  bodyHtml?: string;
  values: ReturnType<typeof previewSampleValues>;
  orgName: string;
}) {
  const { t } = useLanguage();
  const [pick, setPick] = useState<"email" | "whatsapp" | null>(null);
  // Nothing wired yet: still show both faces — the owner is reading words a
  // channel the operator will connect later is going to carry.
  const shown: ("email" | "whatsapp")[] =
    lanes.length > 0 ? lanes : ["email", "whatsapp"];
  const lane = pick && shown.includes(pick) ? pick : shown[0];
  return (
    <div className="space-y-2">
      {shown.length > 1 && (
        // The app's segmented switch (native radios auditioned here for an
        // afternoon; Serdar: "ugly"): a muted track, the picked face riding
        // it as a card — the same control the rule editor's preview toggle
        // already taught.
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--muted-bg)] p-0.5 text-xs">
          {shown.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPick(option)}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                lane === option
                  ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {option === "email" ? t("settings.ruleEmail") : t("channel.whatsapp")}
            </button>
          ))}
        </span>
      )}
      {lane === "email" ? (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <div className="email-paper flex flex-col">
            <p className="border-b border-black/10 px-3 py-2 text-xs font-semibold">
              {renderTokens(subject, values) || orgName}
            </p>
            <div
              className="email-body-editor px-3 py-3 text-sm"
              dangerouslySetInnerHTML={{
                __html: sanitizeEmailHtml(
                  // || over ??: a row that carries bodyHtml as an empty
                  // STRING (found live on Bella's reminder) must fall back
                  // to the plain body, not render a blank sheet.
                  renderTokens(bodyHtml || plainToHtml(body), values),
                ),
              }}
            />
          </div>
        </div>
      ) : (
        <div className="max-w-[90%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-emerald-100 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100">
          {renderTokens(body, values)}
        </div>
      )}
    </div>
  );
}

// A number that reads as part of the sentence until it is touched: no border,
// no spinners, just an underline on hover saying "this is yours to change".
// The row copy is "24 hours before" — a boxed input in the middle of that
// made every row look like a form, and a rules list is a list, not a form.
function InlineNumber({
  value,
  min,
  max,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (next: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      defaultValue={value}
      aria-label={label}
      onBlur={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next) && next > 0 && next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-10 border-0 bg-transparent p-0 text-center text-sm underline decoration-[var(--border)] decoration-dotted underline-offset-4 [appearance:textfield] hover:decoration-[var(--foreground)] focus:decoration-solid focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

// The message editor behind a rule's chevron. Controlled state rather than
// defaultValue+blur alone, because the variable insert and the preview both
// need the text as it is being written, not as it was last saved.
function RuleEditor({
  rule,
  template,
  contactFields,
  orgName,
  orgLanguage,
  orgCurrency,
  orgPriceDecimals,
  orgTimezone,
  orgBookingUrl,
  orgPublicPhone,
  emailEnabled,
  waConnected,
  meta,
  resetToken,
  onSaveTemplate,
}: {
  rule: RuleRowData;
  template: TemplateRow | undefined;
  contactFields: { key: string; label: string }[];
  orgName: string;
  orgLanguage: string;
  orgCurrency: string;
  orgPriceDecimals?: boolean;
  orgTimezone: string;
  orgBookingUrl?: string;
  orgPublicPhone?: string;
  emailEnabled: boolean;
  waConnected: boolean;
  // The rule's own properties — when it fires, which lanes it travels — as
  // leading rows of THIS form's grid rather than a strip above it. They are
  // the same kind of thing as the subject: a labelled field describing the
  // message. RulesCard owns the mutations behind them, so it supplies the
  // rows and the editor only places them.
  meta: React.ReactNode;
  // Bumped by the page's Discard. The editor holds the working copy, so only
  // the owner of the buffer can tell it the buffer is gone.
  resetToken: number;
  onSaveTemplate: (
    templateId: Id<"waTemplates">,
    patch: {
      body?: string;
      bodyHtml?: string;
      subject?: string;
      variableDefaults?: VariableDefault[];
    },
  ) => void;
}) {
  const { t } = useLanguage();
  const [body, setBody] = useState(() => editorSeed(template).body);
  const [subject, setSubject] = useState(() => editorSeed(template).subject);
  // What the WYSIWYG editor currently holds, saved or not — the previews
  // track it live. Seeded from the stored HTML, or the plain body lifted into
  // HTML for rows that predate the editor.
  const [liveHtml, setLiveHtml] = useState(() => editorSeed(template).bodyHtml);
  // The "when empty, print…" table. Held here so the preview can render the
  // UNSAVED value — you are typing a fallback to see how the sentence reads,
  // and a preview that waited for the blur would be showing the old one.
  const [defaults, setDefaults] = useState<VariableDefault[]>(
    () => editorSeed(template).defaults,
  );
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // The row is created by ensureTemplate when the panel opens; until the
  // query catches up there is nothing to bind to.
  const templateId = template?._id;
  const lastResetRef = useRef(resetToken);
  useEffect(() => {
    // A bumped token means Discard just ran — take the live fields and leave
    // the draft alone, per editorSeed's note.
    const afterDiscard = lastResetRef.current !== resetToken;
    lastResetRef.current = resetToken;
    const seed = editorSeed(template, afterDiscard);
    setBody(seed.body);
    setSubject(seed.subject);
    setDefaults(seed.defaults);
    setLiveHtml(seed.bodyHtml);
    // Re-seed exactly when the editor starts talking about a different row, or
    // when a discard has thrown the buffer away. NOT on every refetch: the
    // autosave that follows each blur would otherwise reset the box under a
    // still-typing owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, resetToken]);

  // ── Preview data: an invented PERSON, the salon's real SERVICES ─────────
  //
  // The pane used to speak about a real customer and their real booking,
  // auto-picked, with a typeahead to choose another. That was a reaction to an
  // older sample — "Emma", a €350 haircut — which made the pane a liar in the
  // exact place it is trusted: an owner checking whether [pricelist] reads
  // right cannot tell a broken template from an invented number, and €350.00
  // in a shop that charges €35 reads as a pricing bug in the product.
  //
  // That reasoning was right about MONEY and wrong about the name. Inventing a
  // price is a claim about the business; inventing a first name is not. So the
  // person is fictional now — no more of a real customer's name appearing,
  // unasked, in a settings screen — and everything a salon could mistake for
  // its own data still comes from its own data: the service list, its prices,
  // the org's currency, language and timezone.
  //
  // Four queries went with the picker (customers.options, customers.get,
  // appointments.sampleForPreview, appointments.listForCustomer).
  const services = useQuery(api.services.list, {});
  // Which lane the preview is showing. One message goes out two ways, so this
  // is a view of the same thing rather than two things — stacking both cards
  // made the pane look like the rule sends twice.
  const [lanePref, setLanePref] = useState<"email" | "whatsapp">("email");

  // The line items: the salon's first active service, priced as they priced
  // it. A shop with an empty catalogue previews the token as a placeholder
  // rather than as an invented haircut.
  const previewItems = useMemo(() => {
    const rows = services ?? [];
    const first = rows.find((row) => row.active) ?? rows[0];
    return first ? [{ name: first.name, price: first.price, quantity: 1 }] : [];
  }, [services]);

  // Tomorrow, on the hour, in the org's own timezone. A date has to be made up
  // for the token to render at all, and unlike a price it claims nothing about
  // the business. Anchored to the DAY so it does not flicker as the clock
  // moves under a re-render.
  const previewStartAt = useMemo(() => {
    const day = new Date();
    day.setHours(14, 0, 0, 0);
    return day.getTime() + 24 * 3600_000;
  }, []);

  // Built the way convex/wa.ts builds it at send time, including prices being
  // MINOR units (an older sample divided by nothing and printed €350.00 for a
  // 350-kuruş line).
  //
  // Live, not persisted: you are typing a fallback to watch the sentence
  // settle, so the preview has to read what is in the box right now.
  const liveDefaults = tokenDefaults(defaults);
  const previewValues = useMemo(() => {
    // The SHARED formatter, not a local Intl call. This preview hand-rolled
    // its own — without narrowSymbol and with a hardcoded /100 — which is the
    // exact drift lib/money's header describes: the preview promised "TRY
    // 400.00" for a message that sends "₺400,00". It now writes money the way
    // the send path writes it, decimals setting included.
    const formatMoney = (minor: number) =>
      formatMinorUnits(minor, orgCurrency, orgLanguage, orgPriceDecimals);
    // A real send collapses a token with nothing behind it, along with the
    // whitespace it leaves — renderTokens does that on purpose, so a message
    // never goes out saying "Merhaba ," or carrying an empty bracket. In a
    // PREVIEW that same kindness is a lie: the line simply vanishes, and the
    // writer cannot tell a token that will fill on a real send from one they
    // misspelled. So a token with no sample data behind it previews as its own
    // label in guillemets instead of as nothing.
    const sample = (value: string | undefined, key: string, label: string) =>
      value?.trim() || liveDefaults?.[key] || `⟨${label}⟩`;
    // Contact fields get the same treatment now. They used not to: the pane
    // spoke about a REAL customer, so a field that person had never answered
    // was honestly blank for them — information, not a gap. Against an
    // invented customer there is no such person to be honest about, and a
    // silently empty [hair_type] is indistinguishable from one misspelled.
    const custom: Record<string, string> = {};
    for (const field of contactFields) {
      custom[field.key] = liveDefaults?.[field.key] || `⟨${field.label}⟩`;
    }
    const items = previewItems;
    // × quantity. AGENTS.md, under Goods: "Quantity rides the line, price stays
    // per unit … if you sum prices anywhere new, multiply."
    const totalMinor = items.reduce(
      (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
      0,
    );
    return {
      firstName: t("settings.previewFirstName"),
      lastName: t("settings.previewLastName"),
      // The BUSINESS's number and link — what [phone] and [booking_link]
      // resolve to at send time (see convex/lib/renderTokens).
      phone: sample(orgPublicPhone, "phone", t("vars.phone")),
      email: t("settings.previewEmail"),
      bookingLink: sample(orgBookingUrl, "booking_link", t("vars.bookingLink")),
      businessName: orgName,
      appointmentAt: formatAppointmentTime(
        previewStartAt,
        orgTimezone,
        orgLanguage,
      ),
      staffName: sample(undefined, "staff", t("vars.staff")),
      serviceName: sample(
        // The send path prefixes the quantity here too (convex/wa.ts).
        items
          .map((item) =>
            (item.quantity ?? 1) > 1
              ? `• ${item.quantity}× ${item.name}`
              : `• ${item.name}`,
          )
          .join("\n"),
        "service",
        t("vars.service"),
      ),
      servicePriceList: sample(
        items
          .map((item) => {
            // price !== undefined, so a service priced 0 previews as free
            // rather than as unpriced. Mirrors convex/wa.ts.
            const quantity = item.quantity ?? 1;
            const label =
              quantity > 1 ? `${quantity}× ${item.name}` : item.name;
            return `• ${label}${
              item.price !== undefined
                ? ` — ${formatMoney(item.price * quantity)}`
                : ""
            }`;
          })
          .join("\n"),
        "pricelist",
        t("vars.priceList"),
      ),
      price:
        totalMinor > 0
          ? formatMoney(totalMinor)
          : (liveDefaults?.price ?? `⟨${t("vars.price")}⟩`),
      // Never resolvable outside an appointment-lifecycle send, so it is a
      // placeholder in every preview rather than sometimes-blank.
      manageLink: liveDefaults?.manage_link ?? `⟨${t("vars.manageLink")}⟩`,
      custom,
    };
  }, [
    orgName,
    orgLanguage,
    orgCurrency,
    orgPriceDecimals,
    orgTimezone,
    orgPublicPhone,
    orgBookingUrl,
    contactFields,
    previewItems,
    previewStartAt,
    liveDefaults,
    t,
  ]);

  if (!template) {
    return (
      <p className="py-3 text-xs text-[var(--muted)]">{t("common.loading")}</p>
    );
  }

  // Inserts land at the CURSOR, not the end — Nudge's VariableChips pattern.
  // Plain-textarea mode only; the WYSIWYG editor's own toolbar handles both
  // inserts against the tiptap caret.
  const insertAtCursor = (token: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    onSaveTemplate(template._id, { body: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  // The lanes this rule could ACTUALLY travel — the rule's own channel
  // narrowed by what the org has wired. WhatsApp used to preview whether or
  // not a number existed, so a salon with email only was shown a green bubble
  // for a message WhatsApp will never carry.
  const lanes: ("email" | "whatsapp")[] = [];
  if (rule.channel !== "whatsapp" && emailEnabled) lanes.push("email");
  if (rule.channel !== "email" && waConnected) lanes.push("whatsapp");
  // Nothing wired yet: still show the words, in whichever shape the editor is
  // writing. The owner is authoring for a channel the operator will connect.
  const lane = lanes.includes(lanePref)
    ? lanePref
    : (lanes[0] ?? (emailEnabled ? "email" : "whatsapp"));
  // What each lane would actually send: WhatsApp the derived plain text,
  // email the authored HTML — both through the same token renderer.
  const previewPlain = emailEnabled ? htmlToText(liveHtml) : body;
  // Before a contact is picked the preview still renders — it just speaks
  // about nobody. Org facts (name, phone, booking link) are true regardless of
  // who is reading, so they resolve; anything that belongs to a person or a
  // booking stays literal, and a token with a fallback shows the fallback.
  // That is Nudge's rule, and it is the honest one: no invented names, no
  // invented prices, but never a blank pane either.
  // The sample booking (lib/previewSamples), a template's own "when empty"
  // fallback still winning where the owner typed one. Real org facts resolve
  // for real; person and booking tokens read as Ayşe's Wednesday booking
  // (Serdar, 2026-08-28: fake names over labelled slots) — a message, not
  // syntax.
  const sample = previewSampleValues(orgLanguage);
  const contactlessSlot = (key: string, fallback: string | undefined) =>
    liveDefaults?.[key] ?? fallback ?? "";
  const contactlessValues = {
    // True no matter who is reading, so they resolve for real.
    businessName: orgName,
    phone: orgPublicPhone || contactlessSlot("phone", sample.phone),
    bookingLink:
      orgBookingUrl || contactlessSlot("booking_link", sample.bookingLink),
    firstName: contactlessSlot("name", sample.firstName),
    appointmentAt: contactlessSlot("date", sample.appointmentAt),
    staffName: contactlessSlot("staff", sample.staffName),
    serviceName: contactlessSlot("service", sample.serviceName),
    servicePriceList: contactlessSlot("pricelist", sample.servicePriceList),
    price: contactlessSlot("price", sample.price),
    manageLink: contactlessSlot("manage_link", sample.manageLink),
    // Org fields still preview as labelled slots — the sample booking cannot
    // invent a value for a field only this business defines.
    custom: Object.fromEntries(
      contactFields.map((field) => [
        field.key,
        liveDefaults?.[field.key] ?? `⟨${field.label}⟩`,
      ]),
    ),
  };
  const renderFor = (text: string) =>
    previewValues
      ? renderTokens(text, previewValues, liveDefaults)
      : renderTokens(text, contactlessValues, liveDefaults);
  const rendered = renderFor(previewPlain);
  // Same swap the send path makes: inside HTML a bare \n is a space, so the
  // service list rides <br/>.
  const renderedEmailHtml = previewValues
    ? sanitizeEmailHtml(
        renderTokens(
          liveHtml,
          {
            ...previewValues,
            serviceName: previewValues.serviceName?.replace(/\n/g, "<br/>"),
            servicePriceList: previewValues.servicePriceList?.replace(
              /\n/g,
              "<br/>",
            ),
          },
          liveDefaults,
        ),
      )
    : sanitizeEmailHtml(
        renderTokens(liveHtml, contactlessValues, liveDefaults),
      );
  // Whether what the reader is looking at right now contains a placeholder.
  // Checked against the RENDERED text of whichever lane is showing, subject
  // included — the raw template always holds tokens, which would light this
  // permanently and teach everyone to ignore it.
  const showsPlaceholder =
    /⟨[^⟩]+⟩/.test(lane === "email" ? renderedEmailHtml : rendered) ||
    /⟨[^⟩]+⟩/.test(renderFor(subject));
  // The preview, as ONE node the editor can host in its own tab strip. It
  // used to be a second column: the same formatted message rendered twice,
  // side by side, each in half the width. What the preview alone can say is
  // that [name] becomes Kerem and [date] becomes Friday 31 July — a different
  // VIEW of the body, which is what a tab is for, not a different panel.
  const previewPane = (
    <div className="flex flex-col gap-3">
      {/* Two lanes, one message: a toggle, not two cards. Only rendered when
          the rule really can travel both ways — otherwise there is nothing to
          choose and the row would be a control with one option. */}
      <div className="flex items-center justify-end gap-2 empty:hidden">
        {lanes.length > 1 && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--muted-bg)] p-0.5 text-xs">
            {lanes.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLanePref(option)}
                className={`rounded-full px-2.5 py-1 transition-colors ${
                  lane === option
                    ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {option === "email"
                  ? t("settings.ruleEmail")
                  : t("channel.whatsapp")}
              </button>
            ))}
          </span>
        )}
      </div>
      {lane === "email" ? (
        /* The email as the customer's mail client shows it: white paper no
           matter the app theme, subject on top, the authored HTML below.
           NO border of its own — it lives inside the editor's frame now, and
           a bordered card inside a bordered panel inside a card was three
           rectangles drawn around one message. The white ground is what
           separates it; the only rule left is the one under the subject,
           which is doing a job a mail client does too. */
        <div className="email-paper -m-3 flex flex-col">
          <p className="border-b border-black/10 px-3 py-2 text-xs font-semibold">
            {renderFor(subject) ||
              [orgName || "—", previewValues?.appointmentAt]
                .filter(Boolean)
                .join(", ")}
          </p>
          <div
            className="email-body-editor min-h-40 px-3 py-3 text-sm"
            dangerouslySetInnerHTML={{
              __html:
                renderedEmailHtml ||
                `<p style="color:#9ca3af">${t("settings.templateBodyPlaceholder")}</p>`,
            }}
          />
        </div>
      ) : (
        <div className="max-w-[90%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-emerald-100 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100">
          {rendered || (
            <span className="text-[var(--muted)]">
              {t("settings.templateBodyPlaceholder")}
            </span>
          )}
        </div>
      )}
      {/* Only when a placeholder is actually on screen. A standing note about
          brackets under a preview that has none is the sort of caption people
          learn to stop reading. */}
      {showsPlaceholder && (
        <p className="pt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          {t("editor.previewPlaceholder")}
        </p>
      )}
    </div>
  );

  return (
    // ONE column. The editor gets the full width of the panel, the way every
    // mail composer worth using does — the split gave the box you type in
    // half a page so that the other half could show the same words again.
    <div className="space-y-4 pb-4">
      {/* When, Channel, Subject: the settings-page grammar — label left,
          capped input right — but NOT the settings-page grid. ROW_GRID
          reserves 260px for labels because Business has labels like "Incoming
          email address"; the longest word here is "Email subject", and under
          it that column was mostly void, with the values starting a hand's
          width from the words that name them. Same grammar, local measurements:
          a label column sized to these labels, tight row gap, rows centred
          because every one of them is a single line. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(6rem,8rem)_minmax(0,24rem)] sm:items-center">
        {meta}
        {emailEnabled && (
          <>
            <RowLabel
              label={t("settings.templateSubject")}
              hint={t("settings.templateSubjectHint")}
            />
            <input
              value={subject}
              placeholder={t("settings.templateSubject")}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => onSaveTemplate(template._id, { subject })}
            />
          </>
        )}
      </div>
      {emailEnabled ? (
        // The real email editor — Visual/HTML tabs, toolbar with variables
        // and emoji built in. Every save writes BOTH projections: the HTML
        // the email sends and the plain text the WhatsApp lane sends.
        <EmailBodyEditor
          value={template.bodyHtml || plainToHtml(template.body ?? "")}
          placeholder={t("settings.templateBodyPlaceholder")}
          previewPane={previewPane}
          previewLabel={t("settings.rulePreview")}
          onLiveChange={setLiveHtml}
          onSave={(html) => {
            setLiveHtml(html);
            onSaveTemplate(template._id, {
              bodyHtml: html,
              body: htmlToText(html),
            });
          }}
        />
      ) : (
        <>
          <textarea
            ref={bodyRef}
            rows={5}
            className="w-full"
            value={body}
            placeholder={t("settings.templateBodyPlaceholder")}
            aria-label={t("settings.templateBody")}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => onSaveTemplate(template._id, { body })}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <VariableInsertDropdown onInsert={insertAtCursor} />
            <EmojiPicker
              onPick={insertAtCursor}
              title={t("editor.insertEmoji")}
            />
          </div>
          {/* A plain textarea has no tab strip to host the preview, and
                here it duplicates nothing: the box shows [name], this shows
                what [name] becomes. */}
          {previewPane}
        </>
      )}
      {/* Session text needs no Meta approval, so the Cloud note would
            mislead on the away reply. */}
      {waConnected && rule.trigger !== "out_of_hours" && (
        <p className="text-xs text-[var(--muted)]">
          {t("settings.ruleCloudNote")}
        </p>
      )}
      {/* Email engagement, once this message has actually sent one. Rates
            over the template, never per-customer facts — the opens hint
            explains why the number is a trend, not a truth. */}
      {(template.emailSentCount ?? 0) > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
          <span>
            {t("settings.statSent")}: {template.emailSentCount}×
            {template.emailLastSentAt
              ? ` · ${new Intl.DateTimeFormat(orgLanguage, {
                  day: "numeric",
                  month: "short",
                }).format(template.emailLastSentAt)}`
              : ""}
          </span>
          <span className="flex items-center gap-1">
            {t("settings.statOpens")}:{" "}
            {Math.round(
              ((template.emailOpenCount ?? 0) /
                (template.emailSentCount ?? 1)) *
                100,
            )}
            %
            <InfoTip text={t("settings.templateEmailOpensHint")} />
          </span>
          <span>
            {t("settings.statReplies")}:{" "}
            {Math.round(
              ((template.emailReplyCount ?? 0) /
                (template.emailSentCount ?? 1)) *
                100,
            )}
            %
          </span>
        </p>
      )}

      {/* Directly under the body it repairs — the fallback is part of
            writing the sentence, not a setting somewhere else. Renders
            nothing until the body uses a token we can resolve. */}
      {templateId && (
        <VariableDefaultsEditor
          bodies={[body, subject]}
          defaults={defaults}
          onChange={(next) => {
            setDefaults(next);
            onSaveTemplate(templateId, { variableDefaults: next });
          }}
        />
      )}
    </div>
  );
}

// The message hub, as a sheet you open from the button above the card. A
// sidebar of message types on the left — flat rows, the way the app's own nav
// draws them, never a stack of bordered mini-cards — and on the right the same
// WYSIWYG editor the rule page uses, with the preview riding its tab strip.
// The frame is FIXED-HEIGHT from sm up: picking a type swaps what is inside
// the right pane and nothing else, because a dialog that resizes under the
// pointer is a dialog you cannot read (Serdar, 2026-08-20, twice).
//
// A type that is already added is not a dead end: selecting it shows the
// wording its rule actually sends, editable in place, and Save writes to that
// rule's template. Only the repeatable kinds (reminder, follow-up) offer Add
// once an instance exists — a second confirmation is not a thing, but a
// second reminder is. Timing for an existing rule is edited on its row, where
// it already lives inline; this sheet owns timing only at birth.
function AddRuleSheet({
  rules,
  templates,
  org,
  emailEnabled,
  waConnected,
  onAdd,
  onSaveExisting,
  onClose,
}: {
  // What the org has wired, so the locked preview shows the channel faces a
  // send could actually take.
  emailEnabled: boolean;
  waConnected: boolean;
  rules: RuleRowData[];
  // The org's kind-level fallback rows, so the sheet shows the wording this
  // business will actually get rather than the shipped stock text they may
  // have already rewritten. Same resolution order as ensureTemplate.
  templates: TemplateRow[];
  // Enough of the org for the preview to resolve the tokens that are true no
  // matter who reads the message; person and booking tokens stay labelled
  // slots, the same contactless rule the rule page's preview follows.
  org: {
    name: string;
    language: string;
    bookingUrl?: string;
    publicPhone?: string;
  };
  onAdd: (
    trigger: RuleTrigger,
    offsetHours: number | undefined,
    text: { body: string; bodyHtml: string; subject: string },
  ) => void;
  // The edit half: writes the wording onto the EXISTING rule for this trigger.
  onSaveExisting: (
    ruleId: Id<"messageRules">,
    text: { body: string; bodyHtml: string; subject: string },
  ) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  // Preselected, not null: the right pane exists from the first frame, so
  // there is never a moment where picking makes content appear from nothing.
  const [trigger, setTrigger] = useState<RuleTrigger>("booking");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"hours" | "days">("hours");
  const [error, setError] = useState<string | null>(null);
  // Edits keyed by trigger, so toggling between types to compare wording never
  // throws away a sentence you were halfway through on another one. The body
  // is HTML — the editor's native shape; the plain text the WhatsApp lane
  // needs is derived once, on submit, the same way the rule page derives it.
  const [drafts, setDrafts] = useState<
    Partial<Record<RuleTrigger, { html: string; subject: string }>>
  >({});

  const selected =
    ADD_OPTIONS.find((option) => option.trigger === trigger) ?? ADD_OPTIONS[0];
  // Platform-owned wording (lib/templateTexts): the sheet still creates the
  // rule and sets its timing, but the message renders as the preview alone —
  // what you read is what sends, and there is nothing to type.
  const locked = isWordingLocked(KIND_FOR_TRIGGER[trigger]);
  const taken = (option: AddOption) =>
    !option.repeatable && rules.some((rule) => rule.trigger === option.trigger);
  // Present exactly when the selected type is a non-repeatable that already
  // has its rule: the sheet is then editing, not adding.
  const editingRule = taken(selected)
    ? rules.find((rule) => rule.trigger === selected.trigger) ?? null
    : null;

  // ensureTemplate's order, mirrored — with one extra head for an existing
  // rule: that rule's OWN template first, because "show me the Confirmation"
  // must show the sentence its sends actually carry. Then this org's fallback
  // for the kind, then the stock text for the language, then English. Getting
  // this wrong would show one message in the sheet and save a different one.
  const seedFor = (option: AddOption) => {
    const kind = KIND_FOR_TRIGGER[option.trigger];
    const rule = taken(option)
      ? rules.find((r) => r.trigger === option.trigger)
      : undefined;
    const own = rule
      ? templates.find(
          (tpl) => tpl.ruleId === rule._id && tpl.language === org.language,
        )
      : undefined;
    const fallback = templates.find(
      (tpl) =>
        tpl.ruleId === undefined &&
        tpl.kind === kind &&
        tpl.language === org.language,
    );
    const stock = (DEFAULT_TEMPLATE_TEXTS[org.language] ??
      DEFAULT_TEMPLATE_TEXTS.en)[kind as TemplateKind];
    const source = own ?? fallback;
    // || over ??, deliberately: rows exist whose bodyHtml or body is an
    // empty STRING, and seeding "" gives the sheet a blank preview with a
    // working subject over it (found live on Bella's reminder).
    return {
      html:
        (source && (source.bodyHtml || plainToHtml(source.body || ""))) ||
        plainToHtml(stock?.body ?? ""),
      subject: source?.subject || stock?.subject || "",
    };
  };

  const draft = drafts[trigger] ?? seedFor(selected);
  const patchDraft = (patch: Partial<{ html: string; subject: string }>) =>
    setDrafts((prev) => ({
      ...prev,
      [trigger]: { ...(prev[trigger] ?? seedFor(selected)), ...patch },
    }));

  const pick = (option: AddOption) => {
    setError(null);
    if (option.trigger !== trigger && option.timing) {
      setAmount(String(option.timing.defaultAmount));
      setUnit(option.timing.defaultUnit);
    }
    setTrigger(option.trigger);
  };

  // The bounds live in hours; the message has to speak the unit the box is
  // currently in, or "between 1 and 168" reads as nonsense next to a Days
  // dropdown. Ceil the floor and floor the ceiling so every number the
  // sentence names is actually accepted.
  const boundsIn = (timing: NonNullable<AddOption["timing"]>) =>
    unit === "days"
      ? {
          min: Math.max(1, Math.ceil(timing.minHours / 24)),
          max: Math.floor(timing.maxHours / 24),
        }
      : { min: timing.minHours, max: timing.maxHours };

  const submit = () => {
    const text = {
      body: htmlToText(draft.html),
      bodyHtml: draft.html,
      subject: draft.subject,
    };
    if (editingRule) {
      onSaveExisting(editingRule._id, text);
      onClose();
      return;
    }
    let offsetHours: number | undefined;
    if (selected.timing) {
      const bounds = boundsIn(selected.timing);
      const typed = Number(amount);
      if (!Number.isFinite(typed) || typed < bounds.min || typed > bounds.max) {
        setError(
          t("settings.ruleRange")
            .replace("{min}", String(bounds.min))
            .replace("{max}", String(bounds.max))
            .replace(
              "{unit}",
              unit === "days"
                ? t("settings.ruleUnitDays")
                : t("settings.ruleUnitHours"),
            ),
        );
        return;
      }
      offsetHours = Math.round(unit === "days" ? typed * 24 : typed);
      // Two rules at the same moment would send the same message twice.
      if (
        rules.some(
          (rule) =>
            rule.trigger === selected.trigger &&
            rule.offsetHours === offsetHours,
        )
      ) {
        setError(t("settings.ruleExists"));
        return;
      }
    }
    onAdd(selected.trigger, offsetHours, text);
    onClose();
  };

  // The sample booking, org facts kept real (lib/previewSamples): the sheet
  // previews a message a customer could actually receive, not a row of
  // labelled slots.
  const previewValues = previewSampleValues(org.language, {
    businessName: org.name,
    phone: org.publicPhone,
    bookingLink: org.bookingUrl,
  });
  const previewPane = (
    // The email as a mail client shows it — same email-paper the rule page
    // renders, so the sheet's preview and the page's preview can never look
    // like two different products.
    <div className="email-paper -m-3 flex flex-col">
      <p className="border-b border-black/10 px-3 py-2 text-xs font-semibold">
        {renderTokens(draft.subject, previewValues) || org.name}
      </p>
      <div
        className="email-body-editor min-h-40 px-3 py-3 text-sm"
        dangerouslySetInnerHTML={{
          __html:
            sanitizeEmailHtml(renderTokens(draft.html, previewValues)) ||
            `<p style="color:#9ca3af">${t("settings.templateBodyPlaceholder")}</p>`,
        }}
      />
    </div>
  );

  return (
    <Sheet title={t("settings.ruleAdd")} wide onClose={onClose}>
      <div className="flex flex-col gap-4 sm:h-[32rem] sm:flex-row sm:gap-0">
        {/* A sidebar, drawn like the app's own: flat rows, the open one
            carries a fill, nothing wears a border. "Already added" is a
            subtitle, not a lock. */}
        <nav className="shrink-0 space-y-0.5 sm:w-52 sm:border-r sm:border-[var(--border)] sm:pr-3">
          {ADD_OPTIONS.map((option) => {
            const added = taken(option);
            const on = trigger === option.trigger;
            return (
              <button
                key={option.trigger}
                type="button"
                onClick={() => pick(option)}
                aria-pressed={on}
                className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                  on
                    ? "bg-[var(--muted-bg)]"
                    : "hover:bg-[var(--muted-bg)]"
                }`}
              >
                <span
                  className={`block text-sm ${on ? "font-semibold" : "font-medium"}`}
                >
                  {t(option.nameKey)}
                </span>
                <span className="block truncate text-xs text-[var(--muted)]">
                  {added ? t("settings.ruleAlreadyAdded") : t(option.whenKey)}
                </span>
              </button>
            );
          })}
        </nav>

        {/* The editor column scrolls INSIDE the fixed frame; the footer stays
            pinned. Nothing here may change the sheet's outer height. */}
        <form
          className="flex min-h-0 flex-1 flex-col sm:pl-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {/* Only the timed triggers get a timing row, and only at birth —
                an existing rule's timing is edited inline on its row, and two
                places writing one number is how they disagree. The event
                triggers fire on the mutation, so a number there would be a
                promise nothing keeps (messageRules.clampOffset pins to 0). */}
            {!editingRule && selected.timing && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={boundsIn(selected.timing).min}
                  max={boundsIn(selected.timing).max}
                  value={amount}
                  aria-label={t("settings.ruleAddTiming")}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError(null);
                  }}
                  className="w-24"
                />
                <select
                  value={unit}
                  aria-label={t("settings.ruleAddTiming")}
                  onChange={(event) => {
                    setUnit(event.target.value as "hours" | "days");
                    setError(null);
                  }}
                  className="w-32"
                >
                  <option value="hours">{t("settings.ruleUnitHours")}</option>
                  <option value="days">{t("settings.ruleUnitDays")}</option>
                </select>
                <span className="text-sm text-[var(--muted)]">
                  {t(selected.whenKey)}
                </span>
              </div>
            )}
            {locked ? (
              <>
                <LockedPreview
                  lanes={[
                    ...(emailEnabled ? (["email"] as const) : []),
                    ...(waConnected ? (["whatsapp"] as const) : []),
                  ]}
                  subject={draft.subject}
                  body={htmlToText(draft.html)}
                  bodyHtml={draft.html}
                  values={previewValues}
                  orgName={org.name}
                />
                <p className="text-xs text-[var(--muted)]">
                  {t("settings.wordingLockedHint")}
                </p>
              </>
            ) : (
              <>
                <input
                  value={draft.subject}
                  placeholder={t("settings.templateSubject")}
                  aria-label={t("settings.templateSubject")}
                  onChange={(event) => patchDraft({ subject: event.target.value })}
                />
                {/* The SAME editor the rule page opens, preview tab included —
                    keyed by trigger so tiptap re-seeds when the sidebar picks a
                    different message instead of carrying the old buffer over. */}
                <EmailBodyEditor
                  key={trigger}
                  value={draft.html}
                  placeholder={t("settings.templateBodyPlaceholder")}
                  previewPane={previewPane}
                  previewLabel={t("settings.rulePreview")}
                  onLiveChange={(html) => patchDraft({ html })}
                  onSave={(html) => patchDraft({ html })}
                />
              </>
            )}
          </div>

          {/* Reserved whether or not it holds anything, so a rejected number
              does not shove the buttons out from under the pointer. */}
          <p className="min-h-[1.25rem] pt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
            >
              {editingRule ? t("common.save") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </Sheet>
  );
}

function RulesCard({
  isOwner,
  org,
  templates,
  rules,
  waConnected,
  evolutionEnabled,
  emailEnabled,
}: {
  isOwner: boolean;
  org: {
    name: string;
    language: string;
    currency: string;
    priceDecimals?: boolean;
    timezone: string;
    quietHoursStart: number;
    quietHoursEnd: number;
    messageChannel: "whatsapp" | "email" | "both";
    bookingUrl?: string;
    publicPhone?: string;
  };
  templates: TemplateRow[];
  rules: RuleRowData[];
  waConnected: boolean;
  evolutionEnabled: boolean;
  emailEnabled: boolean;
}) {
  const { t } = useLanguage();
  const addRule = useMutation(api.messageRules.add);
  const updateRule = useMutation(api.messageRules.update);
  const removeRule = useMutation(api.messageRules.remove);
  const ensureTemplate = useMutation(api.messageRules.ensureTemplate);
  const updateTemplate = useMutation(api.orgs.updateTemplate);
  // Whether a rule's WORDING is platform-owned (lib/templateTexts): the
  // editor never opens for these, and the mutations refuse them anyway. The
  // rule itself — timing, channels, on/off — stays the salon's.
  const wordingLocked = (trigger: RuleTrigger) =>
    isWordingLocked(KIND_FOR_TRIGGER[trigger]);
  // Blur writes go to the BUFFER, never to the live row: reminders send from a
  // cron, so a body caught mid-sentence used to be a body a customer could
  // receive. Save is what makes words live. (Ported from Nudge's
  // templates.saveDraft/commitDraft/discardDraft.)
  const saveTemplateDraft = useMutation(api.orgs.saveTemplateDraft);
  const commitTemplateDraft = useMutation(api.orgs.commitTemplateDraft);
  const discardTemplateDraft = useMutation(api.orgs.discardTemplateDraft);
  const [saving, setSaving] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  // For the preview's custom-token map — the same registry the variable
  // dropdown reads, so preview and menu can never disagree.
  const contactFieldRows = useQuery(api.contactFields.list, {}) ?? [];
  // The open rule lives in the URL, the same way the app's tab does and the
  // same way VoiceView carries its open agent. Expand-in-place was fine while
  // a rule was three fields; it now opens a two-column editor with its own
  // preview, and a panel that tall unfolding inside a list left no way to tell
  // what you were looking at. So a rule is a PAGE you go into and come back
  // from — and because the id is in the URL, a refresh or a trip to another
  // tab and back returns you to it rather than to the top of the list.
  const [openId, setOpenId] = useState<Id<"messageRules"> | null>(null);
  // Read after mount: initialising state from window during render is a
  // hydration mismatch (AppHome's tab does the same dance).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("rule");
    if (wanted) setOpenId(wanted as Id<"messageRules">);
  }, []);
  const openRule = (next: Id<"messageRules"> | null) => {
    setOpenId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("rule", next);
    else url.searchParams.delete("rule");
    // replaceState, not push: a drill-in is not history. The back button in
    // the header is the way out, and filling the browser stack with every
    // rule glanced at makes Back stop meaning "the page before this one".
    window.history.replaceState(null, "", url);
  };
  const [confirm, confirmDialog] = useConfirm();
  const [adding, setAdding] = useState(false);

  const deleteRule = async (rule: RuleRowData) => {
    const ok = await confirm({
      title: t("settings.deleteRule"),
      body: t("settings.deleteRuleConfirm"),
    });
    if (!ok) return;
    openRule(null);
    void removeRule({ ruleId: rule._id });
  };

  // One chip per channel that could ACTUALLY carry this rule — the chip list
  // is the truth, so there is nothing to warn about beside it. WhatsApp
  // qualifies through an Evolution outbound number, or through a Cloud number
  // WITH a Meta-approved template for this message (an unapproved Cloud
  // template cannot send, so its chip would be a lie). Approval is per
  // message, which is why this is computed per rule.
  //
  // The chips are also the on/off control: a rule with every chip off is
  // paused, which is why there is no separate Active column — "sends nowhere"
  // and "off" are the same fact, and two controls for one fact is how the old
  // card confused people.
  const wiredFor = (rule: RuleRowData): ("whatsapp" | "email")[] => {
    // The away reply is session text — an answer to a customer who just
    // wrote, which Meta allows without any approved template. All WhatsApp
    // needs here is the Cloud number itself (wa.sendAwayReply's lane).
    if (rule.trigger === "out_of_hours") {
      return [
        ...(waConnected ? (["whatsapp"] as const) : []),
        ...(emailEnabled ? (["email"] as const) : []),
      ];
    }
    const own = templates.find(
      (tpl) => tpl.ruleId === rule._id && tpl.language === org.language,
    );
    const fallback = templates.find(
      (tpl) =>
        tpl.ruleId === undefined &&
        tpl.kind === KIND_FOR_TRIGGER[rule.trigger] &&
        tpl.language === org.language,
    );
    const metaSource =
      own && own.status === "approved" && own.metaName ? own : fallback;
    const cloudApproved =
      waConnected &&
      metaSource?.status === "approved" &&
      Boolean(metaSource?.metaName);
    const waOk = evolutionEnabled || cloudApproved;
    return [
      ...(waOk ? (["whatsapp"] as const) : []),
      ...(emailEnabled ? (["email"] as const) : []),
    ];
  };
  // What the ROW stores, ignoring paused. Kept separate because `paused` and
  // `channel` are two axes and collapsing them is what lost data below.
  const storedChannels = (rule: RuleRowData): Set<"whatsapp" | "email"> => {
    const active = new Set<"whatsapp" | "email">();
    if (rule.channel !== "email") active.add("whatsapp");
    if (rule.channel !== "whatsapp") active.add("email");
    return active;
  };
  // What the chips SHOW: a paused rule shows none.
  const activeChannels = (rule: RuleRowData): Set<"whatsapp" | "email"> =>
    rule.paused ? new Set() : storedChannels(rule);
  const toggleChannel = (rule: RuleRowData, channel: "whatsapp" | "email") => {
    // Built from what is stored, so a paused rule turning a chip back on
    // resumes with the pair it had rather than with only that chip.
    const next = storedChannels(rule);
    if (activeChannels(rule).has(channel)) next.delete(channel);
    else next.add(channel);
    const on = wiredFor(rule).filter((w) => next.has(w));
    if (on.length === 0) {
      // Last chip off: the rule keeps its channel and pauses, so switching a
      // chip back on restores exactly what was there.
      void updateRule({ ruleId: rule._id, paused: true });
      return;
    }
    // `channel` comes from the full stored set, NOT from `on`. Deriving it from
    // the wired subset meant an unwired lane could never survive a toggle: in an
    // email-only org, a rule at "both" that had its one chip switched off and
    // back on came back as "email" — and stayed email-only, silently, on the day
    // WhatsApp was finally connected. wiredFor decides whether the rule can run
    // at all; it does not get to rewrite what the owner asked for.
    void updateRule({
      ruleId: rule._id,
      paused: false,
      channel: next.size === 2 ? "both" : [...next][0],
    });
  };

  const ruleName = (trigger: RuleTrigger) =>
    trigger === "booking"
      ? t("settings.ruleConfirmation")
      : trigger === "before_start"
        ? t("settings.ruleReminder")
        : trigger === "after_end"
          ? t("settings.ruleFollowup")
          : trigger === "cancellation"
            ? t("settings.ruleCancellation")
            : trigger === "out_of_hours"
              ? t("settings.ruleOutOfHours")
              : t("settings.ruleWinback");

  const channelLabel = (channel: "whatsapp" | "email" | "both") =>
    channel === "whatsapp"
      ? t("channel.whatsapp")
      : channel === "email"
        ? t("settings.ruleEmail")
        : t("settings.channelBoth");

  const open = (rule: RuleRowData) => {
    openRule(rule._id);
    // Creates the rule's own wording row (copied from the kind fallback) the
    // first time it is opened; a no-op after that.
    if (isOwner && !wordingLocked(rule.trigger))
      void ensureTemplate({ ruleId: rule._id, language: org.language });
  };
  // A rule deleted in another tab, or an id someone pasted: fall back to the
  // list rather than holding a page that cannot render.
  const opened = rules.find((rule) => rule._id === openId) ?? null;
  useEffect(() => {
    if (openId && rules.length > 0 && !opened) openRule(null);
  }, [openId, opened, rules.length]);
  // Re-runs ensureTemplate for a rule restored from the URL, which never went
  // through open() — a refresh inside a rule that had no wording row yet
  // would otherwise land on an editor with nothing to bind to.
  useEffect(() => {
    if (opened && isOwner && !wordingLocked(opened.trigger)) {
      void ensureTemplate({ ruleId: opened._id, language: org.language });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?._id, isOwner, org.language]);

  const pad = (h: number) => String(h).padStart(2, "0");
  const winbackHint = `${t("settings.ruleWinbackHint")}\n${t("settings.ruleSendWindow")}: ${pad(
    org.quietHoursStart,
  )}:00–${pad(org.quietHoursEnd)}:00`;

  // The strip's opening node, as TEXT — a row that opens a page must not also
  // hold controls; everything editable lives inside the page the row opens.
  //
  // ONE node, not trigger-plus-wait (2026-08-25, hours after shipping the
  // wait node): arrows read left-to-right as "this, then that", and a wait
  // node after the event — "Randevu → 2 saat önce" — narrated time running
  // backwards. The timed rules keep their whole sentence and wear a clock;
  // the event rules wear the bolt.
  const ruleWhenStatic = (rule: RuleRowData) => {
    switch (rule.trigger) {
      case "booking":
        return t("settings.ruleWhenBooked");
      case "cancellation":
        return t("settings.ruleWhenCancelled");
      case "out_of_hours":
        return t("settings.ruleWhenClosed");
      case "before_start":
        return t("settings.ruleWhenBeforeFull").replace(
          "{n}",
          String(rule.offsetHours),
        );
      case "after_end":
        return t("settings.ruleWhenAfterEndFull").replace(
          "{n}",
          String(rule.offsetHours),
        );
      case "no_show":
        return t("settings.ruleWhenNoShowFull").replace(
          "{n}",
          String(Math.round(rule.offsetHours / 24)),
        );
    }
  };

  const ruleWhen = (rule: RuleRowData) => {
    switch (rule.trigger) {
      case "booking":
        return <>{t("settings.ruleWhenBooked")}</>;
      case "cancellation":
        return <>{t("settings.ruleWhenCancelled")}</>;
      case "before_start":
        return (
          <span className="flex items-center gap-1.5">
            <InlineNumber
              value={rule.offsetHours}
              min={1}
              max={168}
              label={t("settings.ruleHoursBefore")}
              onCommit={(hours) =>
                void updateRule({ ruleId: rule._id, offsetHours: hours })
              }
            />
            {t("settings.ruleHoursBefore")}
          </span>
        );
      case "after_end":
        return (
          <span className="flex items-center gap-1.5">
            <InlineNumber
              value={rule.offsetHours}
              min={1}
              max={720}
              label={t("settings.ruleHoursAfterEnd")}
              onCommit={(hours) =>
                void updateRule({ ruleId: rule._id, offsetHours: hours })
              }
            />
            {t("settings.ruleHoursAfterEnd")}
          </span>
        );
      case "no_show":
        return (
          <span className="flex items-center gap-1.5">
            <InlineNumber
              value={Math.round(rule.offsetHours / 24)}
              min={1}
              max={90}
              label={t("settings.ruleDaysAfterNoShow")}
              onCommit={(days) =>
                void updateRule({ ruleId: rule._id, offsetHours: days * 24 })
              }
            />
            {t("settings.ruleDaysAfterNoShow")}
          </span>
        );
      case "out_of_hours":
        return <>{t("settings.ruleWhenClosed")}</>;
    }
  };

  // Three steps because the wording has nowhere to live until the rule does:
  // add creates the row, ensureTemplate mints its template (seeded from the
  // same fallback-then-stock order the sheet previewed), and only then can the
  // edited text be written. Saved unconditionally — the sheet's box is what
  // the owner just read and approved, so it is the truth even when they
  // changed nothing.
  // The sheet authors in the WYSIWYG editor, so the HTML arrives authored —
  // not lifted from plain text after the fact.
  const doAdd = async (
    trigger: RuleTrigger,
    offsetHours: number | undefined,
    text: { body: string; bodyHtml: string; subject: string },
  ) => {
    const ruleId = await addRule({ trigger, offsetHours: offsetHours ?? 0 });
    // Locked kinds take the rule and its timing but never the wording — the
    // sheet showed a read-only preview, and orgs.updateTemplate would refuse
    // the body anyway.
    if (wordingLocked(trigger)) return;
    const templateId = await ensureTemplate({ ruleId, language: org.language });
    await updateTemplate({
      templateId,
      body: text.body,
      bodyHtml: text.bodyHtml,
      subject: text.subject,
    });
  };

  // The sheet's edit half: same tail as doAdd, minus the birth. ensureTemplate
  // is idempotent — it returns the rule's existing template row when one is
  // already there — so this writes onto whatever the rule really sends from.
  const doSaveExisting = async (
    ruleId: Id<"messageRules">,
    text: { body: string; bodyHtml: string; subject: string },
  ) => {
    const rule = rules.find((row) => row._id === ruleId);
    if (!rule || wordingLocked(rule.trigger)) return;
    const templateId = await ensureTemplate({ ruleId, language: org.language });
    await updateTemplate({
      templateId,
      body: text.body,
      bodyHtml: text.bodyHtml,
      subject: text.subject,
    });
  };

  // One rule, full width, with the way back in the header — the drill-in
  // VoiceView uses for an agent. The list is gone while you are in here on
  // purpose: half a list above an editor was the confusion.
  if (opened) {
    const ownTemplate = templates.find(
      (tpl) => tpl.ruleId === opened._id && tpl.language === org.language,
    );
    // Platform-owned wording (lib/templateTexts LOCKED_TEMPLATE_KINDS): the
    // drill-in still owns timing and channels, but the message itself renders
    // read-only — what you read here is what the approved Cloud template and
    // the session lanes send, resolved the way sends resolve it.
    const openedLocked = wordingLocked(opened.trigger);
    const openedKind = KIND_FOR_TRIGGER[opened.trigger] as TemplateKind;
    // The text that actually sends, all three faces of it, in send-path
    // resolution order: this rule's own row, the kind-level fallback, stock.
    const lockedSource =
      ownTemplate ??
      templates.find(
        (tpl) =>
          tpl.ruleId === undefined &&
          tpl.kind === openedKind &&
          tpl.language === org.language,
      );
    const lockedStock = (DEFAULT_TEMPLATE_TEXTS[org.language] ??
      DEFAULT_TEMPLATE_TEXTS.en)[openedKind];
    // || over ??: an empty-string body or bodyHtml on the row must fall
    // through, not preview as a blank message.
    const lockedText = {
      body: lockedSource?.body || lockedStock.body,
      bodyHtml: lockedSource?.bodyHtml || undefined,
      subject: lockedSource?.subject || lockedStock.subject,
    };
    // The lanes this rule could actually travel — RuleEditor's own rule: the
    // rule's channel narrowed by what the org has wired.
    const lockedLanes: ("email" | "whatsapp")[] = [];
    if (opened.channel !== "whatsapp" && emailEnabled) lockedLanes.push("email");
    if (opened.channel !== "email" && waConnected) lockedLanes.push("whatsapp");
    // Every channel, always (Serdar, 2026-08-28: "not showing them is
    // stupid") — a wired one is a switch, an unwired one sits greyed with
    // the reason in its tooltip. An empty Kanal row read as a broken page.
    const openedChannelPills = (
      <>
        {(["whatsapp", "email"] as const).map((channel) => {
          const wired = wiredFor(opened).includes(channel);
          if (!wired) {
            return (
              <span
                key={channel}
                title={t("settings.channelUnavailable")}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-[var(--muted)] opacity-50"
              >
                {channelLabel(channel)}
              </span>
            );
          }
          const on = activeChannels(opened).has(channel);
          return (
            <button
              key={channel}
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`${ruleName(opened.trigger)} — ${channelLabel(channel)}`}
              onClick={() => toggleChannel(opened, channel)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
                on
                  ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {/* The check is what says "pressed" — colour alone made
                  the on-state read as a decorative tag, and the off
                  state as a button not yet discovered. */}
              {on && (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
              {channelLabel(channel)}
            </button>
          );
        })}
      </>
    );
    const openedWhenHint =
      opened.trigger === "no_show"
        ? winbackHint
        : opened.trigger === "after_end"
          ? t("settings.ruleFollowupHint")
          : opened.trigger === "out_of_hours"
            ? t("settings.ruleOutOfHoursHint")
            : undefined;
    const openedMeta = (
      <>
        <RowLabel label={t("settings.rulesWhen")} hint={openedWhenHint} />
        <span className="flex min-h-8 items-center gap-1.5 text-sm">
          {ruleWhen(opened)}
        </span>
        <RowLabel label={t("settings.rulesWhere")} />
        <span className="flex min-h-8 flex-wrap items-center gap-1.5 text-sm">
          {openedChannelPills}
        </span>
      </>
    );

    return (
      <Card disabled={!isOwner}>
        {/* Back left, title centred. The button PRINTS its label rather than
            hiding it in a tooltip: a bare glyph is only obvious to someone who
            already knows the way out, and this page is reached by drilling in
            from a list you need to get back to. */}
        {/* Three columns with equal outer tracks, so the title is centred on
            the ROW rather than on whatever is left over beside the button —
            which matters now that the button's width follows a translated
            word ("Back" / "Geri" / "Zurück"). */}
        <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <button
            type="button"
            onClick={() => openRule(null)}
            title={t("settings.rulesBack")}
            className="flex h-9 w-fit shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted-bg)]"
          >
            {/* A chevron, not "←". The long-shafted arrow read as a stray
                line of punctuation at the size the row needs, and it was
                drawn in muted grey — the way back should be the most
                findable thing on a page you opened by drilling in. */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
            {t("common.back")}
          </button>
          <h2 className="min-w-0 truncate text-center text-lg font-semibold">
            {ruleName(opened.trigger)}
          </h2>
          {/* Save and Discard live in the header rather than under the body:
              on a long message the foot of the page is below the fold, and a
              Save button people have to hunt for is a Save button that does
              not get pressed. They appear only when there is something to
              save — a permanently lit Save teaches you to ignore it. */}
          <span className="flex items-center justify-end gap-2">
            {ownTemplate?.hasUnsavedChanges && (
              <>
                <span
                  className="hidden shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 sm:inline-flex dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
                  title={t("settings.templateUnsavedHint")}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {t("settings.templateUnsaved")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      const ok = await confirm({
                        title: t("settings.templateDiscard"),
                        body: t("settings.templateDiscardConfirm"),
                        confirmLabel: t("settings.templateDiscard"),
                      });
                      if (!ok) return;
                      await discardTemplateDraft({
                        templateId: ownTemplate._id,
                      });
                      setResetToken((n) => n + 1);
                    })();
                  }}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:border-red-300 hover:text-red-600 dark:hover:text-red-400"
                >
                  {t("settings.templateDiscard")}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void (async () => {
                      setSaving(true);
                      try {
                        await commitTemplateDraft({
                          templateId: ownTemplate._id,
                        });
                      } finally {
                        setSaving(false);
                      }
                    })();
                  }}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-60"
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </>
            )}
          </span>
        </div>

        {openedLocked ? (
          // The read-only face (Serdar, 2026-08-28: the label/value grid
          // read "pretty empty and weirdly organized" here): When and Kanal
          // side by side under their own headers, then the message itself,
          // full width, rendered. No editor, no drafts, no Save — the
          // wording is the platform's, and the mutations refuse it anyway
          // (orgs.updateTemplate, "wording-locked").
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center gap-1.5 pb-1.5 text-xs font-medium text-[var(--muted-strong)]">
                  {t("settings.rulesWhen")}
                  {openedWhenHint && <InfoTip text={openedWhenHint} />}
                </div>
                <span className="flex min-h-8 items-center gap-1.5 text-sm">
                  {ruleWhen(opened)}
                </span>
              </div>
              <div>
                <div className="pb-1.5 text-xs font-medium text-[var(--muted-strong)]">
                  {t("settings.rulesWhere")}
                </div>
                <span className="flex min-h-8 flex-wrap items-center gap-1.5 text-sm">
                  {openedChannelPills}
                </span>
              </div>
            </div>
            <div>
              {/* "Mesaj", not "Standart mesaj": it IS the message content,
                  and the lock is the (i)'s story, not the label's. */}
              <div className="flex items-center gap-1.5 pb-1.5 text-xs font-medium text-[var(--muted-strong)]">
                {t("settings.rulesWhat")}
                <InfoTip text={t("settings.wordingLockedHint")} />
              </div>
              <LockedPreview
                lanes={lockedLanes}
                subject={lockedText.subject}
                body={lockedText.body}
                bodyHtml={lockedText.bodyHtml}
                values={previewSampleValues(org.language, {
                  businessName: org.name,
                  phone: org.publicPhone,
                  bookingLink: org.bookingUrl,
                })}
                orgName={org.name}
              />
            </div>
          </div>
        ) : (
          <RuleEditor
            rule={opened}
            // When and Channel, as rows of the editor's own grid. They used to
            // be an unlabelled strip above it ("When booked  Email"), which read
            // as one drifting phrase and hid that the amber pill is a switch.
            meta={openedMeta}
            template={ownTemplate}
            contactFields={contactFieldRows}
            orgName={org.name}
            orgLanguage={org.language}
            orgCurrency={org.currency}
            orgPriceDecimals={org.priceDecimals}
            orgTimezone={org.timezone}
            orgBookingUrl={org.bookingUrl}
            orgPublicPhone={org.publicPhone}
            emailEnabled={emailEnabled}
            waConnected={waConnected}
            resetToken={resetToken}
            onSaveTemplate={(templateId, patch) =>
              void saveTemplateDraft({ templateId, ...patch })
            }
          />
        )}
        {/* Deleting lives with the thing being deleted, and sits at the far
            end from Save: the two are opposite intentions, and a destructive
            button next to the one people press on every visit is a mis-click
            waiting to happen.

            Save is rendered whether or not there is anything to save, and
            disabled when there is not. The header pair appears and disappears
            with the draft, which is right for a strip that would otherwise be
            empty — but the foot of the form is where people look for Save,
            and a button that is missing until you have earned it is a button
            you have to learn about first. */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => void deleteRule(opened)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {t("settings.deleteRule")}
          </button>
          <span className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted)]">
              {ownTemplate?.hasUnsavedChanges
                ? t("settings.templateNotLive")
                : ""}
            </span>
            <button
              type="button"
              disabled={!ownTemplate?.hasUnsavedChanges || saving}
              onClick={() => {
                if (!ownTemplate) return;
                void (async () => {
                  setSaving(true);
                  try {
                    await commitTemplateDraft({ templateId: ownTemplate._id });
                  } finally {
                    setSaving(false);
                  }
                })();
              }}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </span>
        </div>
        {/* The confirm has to be mounted in THIS branch too. useConfirm's
            promise only resolves when its dialog is on screen, so without
            this the delete button above simply did nothing — it awaited an
            answer from a dialog that only the list branch rendered. */}
        {confirmDialog}
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <Card
        disabled={!isOwner}
        // Inside the card, hard right, the same corner Customers and Team
        // now use. It floated on the page above the card, which read as a
        // button belonging to the page rather than to the list it adds to.
        //
        // Gated on isOwner here rather than by the fieldset: a Card's action
        // renders outside it.
        action={
          isOwner ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="card-action"
            >
              {t("settings.ruleAdd")}
            </button>
          ) : undefined
        }
      >
        {/* Two named columns (Serdar, 2026-08-28): when, and what we send.
            The arrow chain narrated itself row after row; a header says it
            once. The channel is no longer a third node — the message chip's
            own icons say WhatsApp, email or both, and a rule sending nowhere
            says so by dimming. */}
        <div className="hidden grid-cols-[minmax(0,17rem)_minmax(0,1fr)] gap-x-6 px-3 pb-1.5 pt-1 text-xs font-medium text-[var(--muted-strong)] sm:grid">
          <span>{t("settings.rulesWhen")}</span>
          <span>{t("settings.rulesWhat")}</span>
        </div>
        <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {rules.map((rule) => {
            const liveChannels = wiredFor(rule).filter((channel) =>
              activeChannels(rule).has(channel),
            );
            return (
              <div key={rule._id}>
                {/* The whole row opens the rule. It used to unfold in place,
                    which read fine while a rule was three fields and stopped
                    reading at all once the panel grew a two-column editor with
                    its own preview: the list above it stayed on screen, so
                    nothing told you which rule you were inside. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => open(rule)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(rule);
                    }
                  }}
                  className="-mx-3 cursor-pointer rounded-lg px-3 py-3 transition-colors hover:bg-[var(--muted-bg)]"
                >
                  {/* A rule sending nowhere dims its whole row: "off" is a
                      fact about the chain, not a word at its end. */}
                  <div
                    className={`grid grid-cols-1 gap-y-1 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] sm:items-center sm:gap-x-6 ${
                      liveChannels.length === 0 ? "opacity-60" : ""
                    }`}
                  >
                    <FlowNode
                      icon={
                        rule.trigger === "before_start" ||
                        rule.trigger === "after_end" ||
                        rule.trigger === "no_show"
                          ? "clock"
                          : "zap"
                      }
                    >
                      {ruleWhenStatic(rule)}
                      {rule.trigger === "no_show" && (
                        <InfoTip text={winbackHint} />
                      )}
                      {rule.trigger === "after_end" && (
                        <InfoTip text={t("settings.ruleFollowupHint")} />
                      )}
                      {rule.trigger === "out_of_hours" && (
                        <InfoTip text={t("settings.ruleOutOfHoursHint")} />
                      )}
                    </FlowNode>
                    <span className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs">
                      {/* The channel icons ARE the message's type icons: a
                          bubble for WhatsApp, an envelope for email, both
                          when it travels both. A rule sending on NEITHER
                          shows no icon at all (Serdar, 2026-08-28) — a
                          bubble on a message that cannot send is
                          decoration. */}
                      {liveChannels.map((channel) =>
                        channel === "email" ? (
                          <svg
                            key={channel}
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                            className="shrink-0 text-sky-600 dark:text-sky-400"
                          >
                            <title>{channelLabel(channel)}</title>
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <path d="m3 7 9 6 9-6" />
                          </svg>
                        ) : (
                          // The REAL WhatsApp glyph (Serdar, 2026-08-28), not
                          // a generic bubble: the icon names a brand's
                          // channel, so it wears the brand's mark. Filled
                          // path, unlike its stroke-drawn neighbours — that
                          // is how the logo is drawn.
                          <svg
                            key={channel}
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden
                            className="shrink-0 text-emerald-600 dark:text-emerald-400"
                          >
                            <title>{channelLabel("whatsapp")}</title>
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                          </svg>
                        ),
                      )}
                      <span className="max-w-56 truncate font-medium">
                        {ruleName(rule.trigger)}
                      </span>
                      {/* A pending draft is visible without opening anything —
                          otherwise the only way to learn that words are
                          waiting to go live is to remember. */}
                      {templates.some(
                        (tpl) =>
                          tpl.ruleId === rule._id &&
                          tpl.language === org.language &&
                          tpl.hasUnsavedChanges,
                      ) && (
                        <span
                          className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          title={t("settings.templateUnsavedHint")}
                        >
                          {t("settings.templateUnsaved")}
                        </span>
                      )}
                    </span>
                    {/* Nothing wired at all: say WHY this row is dim instead
                        of letting a bare chip imply a working automation. */}
                    {wiredFor(rule).length === 0 && (
                      <span className="text-xs text-[var(--muted)]">
                        {t("settings.ruleWontSend")}
                      </span>
                    )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* "Reset to defaults" stood here until 2026-08-19. It offered to
            throw away every rule and every word an owner had written, in
            exchange for a state they can reach a rule at a time — a
            destructive button parked under a list, earning its place by
            being quiet. api.messageRules.resetToDefaults still exists for
            support to call. */}
        {confirmDialog}
      </Card>
      {adding && (
        <AddRuleSheet
          rules={rules}
          templates={templates}
          org={org}
          emailEnabled={emailEnabled}
          waConnected={waConnected}
          onAdd={(trigger, offsetHours, text) =>
            void doAdd(trigger, offsetHours, text)
          }
          onSaveExisting={(ruleId, text) => void doSaveExisting(ruleId, text)}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

// Business hours + the out-of-hours WhatsApp reply. Everything the reply says
// is org data, so this card is the whole configuration surface for it: which
// days, which hours, the link, the number, and an optional override of the
// wording. Weekday names come from Intl (see weekdayNames), not the dictionary.
//
// Exported and rendered under Business → Hours, not here. The hours stopped
// being a WhatsApp detail the day the voice agent started scheduling by them;
// finding "when are we open" behind a WhatsApp tab was a scavenger hunt. The
// component keeps living in this file because the away-reply half of it is
// still wired to everything else here.
// Pure schedule — days and open/close, nothing else. The away-reply that used
// to live here is the out_of_hours rule in Reminders now, and the booking link
// + public phone are facts about the business, edited in Business settings
// (BusinessView's BookingCard and DetailsCard). They spent a while here as a
// "Message variables" card, which named the [booking_link] / [phone] tokens
// rather than the things themselves and put a salon's own phone number
// somewhere nobody would look for it.
// The business's own answer to "what does the assistant do with an incoming
// WhatsApp message" — the owner's half of the chat agent.
//
// It renders ONLY when the operator has brought this org's agent live
// (orgs.chatAgentMode), because that field is the entitlement gate and a
// control for a feature you do not have is worse than no control. Which is
// also why the operator's own three states — and the budget, the model and
// the turn log — are not here: a tenant sets behaviour, an operator owns the
// switch and the bill.
export function ChatAgentCard({
  isOwner,
  behavior,
  stopOnHandover,
  update,
}: {
  isOwner: boolean;
  behavior: "off" | "suggest" | "live";
  stopOnHandover: boolean;
  update: (args: Record<string, unknown>) => void;
}) {
  const { t } = useLanguage();
  return (
    <Card title={t("settings.chatAgent")} disabled={!isOwner}>
      <div className={ROW_GRID}>
        <RowLabel
          label={t("settings.chatAgent")}
          hint={t("settings.chatAgentHint")}
        />
        <div>
          <SegmentedControl
            value={behavior}
            disabled={!isOwner}
            onChange={(mode) => update({ chatAgentBehavior: mode })}
            segments={[
              { id: "off", label: t("agent.mode.off"), hint: t("agent.mode.offHint") },
              { id: "suggest", label: t("agent.mode.suggest"), hint: t("agent.mode.suggestHint") },
              { id: "live", label: t("agent.mode.live"), hint: t("agent.mode.liveHint") },
            ]}
          />
          {/* The chosen mode explained under the pills rather than in a
              tooltip: these three differ in what reaches a CUSTOMER, which is
              not a difference to make somebody hover to discover. */}
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {t(
              behavior === "off"
                ? "agent.mode.offHint"
                : behavior === "suggest"
                  ? "agent.mode.suggestHint"
                  : "agent.mode.liveHint",
            )}
          </p>
        </div>

        {/* Only a business whose assistant actually replies has a handover
            policy to set. On drafts a person reads every message already, so
            "what happens when it needs a person" has no meaning. */}
        {behavior === "live" && (
          <>
            <RowLabel
              label={t("settings.chatAgentHandover")}
              hint={t("settings.chatAgentHandoverHint")}
            />
            <SegmentedControl
              value={stopOnHandover ? "stop" : "keep"}
              disabled={!isOwner}
              onChange={(next) =>
                update({ chatAgentStopOnHandover: next === "stop" })
              }
              // Two POSITIVE options, not a checkbox. Both are real products a
              // business might want, and phrasing one as the absence of the
              // other ("don't stop") makes the default look like the setting
              // nobody got round to.
              segments={[
                { id: "keep", label: t("settings.chatAgentKeepAnswering") },
                { id: "stop", label: t("settings.chatAgentStop") },
              ]}
            />
          </>
        )}
      </div>
    </Card>
  );
}

export function BusinessHoursCard({
  isOwner,
  org,
  update,
}: {
  isOwner: boolean;
  org: {
    timezone: string;
    businessHours?: {
      activeDays?: number[];
      startMinute?: number;
      endMinute?: number;
      days?: ({ startMinute: number; endMinute: number } | null)[];
    };
  };
  update: (args: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  // Written out — "Pazartesi", not "Pzt". The rows have the room, and the
  // abbreviation made the one card an owner reads slowly ("when are we
  // open?") the one place the day needed decoding. The grid below sizes the
  // day column to the longest name of the CURRENT language, so no width
  // constant has to be right for three languages at once.
  const dayNames = weekdayNames(language, "long");
  const hours = org.businessHours ?? {};

  // Always seven entries to render against, whichever shape the org carries.
  // windowForWeekday is the same normaliser the backend reads through, so the
  // card cannot show a week the booking page disagrees with — which is what a
  // second, client-side interpretation of the legacy fields would have bought.
  // An org that has configured NOTHING reads as seven closed days, not seven
  // open ones. windowForWeekday answers 00:00-24:00 for {} because
  // "unrestricted" is the right default for the gates that ask whether an
  // instant is inside the window — but rendering that as the truth would show
  // a brand-new salon open around the clock, and the first unrelated toggle
  // would then SAVE it. hasBusinessHours is the same question the backend asks
  // before it trusts any of this.
  const configured = hasBusinessHours(hours);
  const week = Array.from({ length: 7 }, (_, day) =>
    configured ? windowForWeekday(hours, day) : null,
  );

  // Every save writes the whole week. The legacy fields are left out on
  // purpose: the first edit on this card is what migrates an org off them, and
  // orgs.update carries `days` forward when a save does not mention it.
  const writeWeek = (next: ({ startMinute: number; endMinute: number } | null)[]) =>
    update({ businessHours: { ...hours, days: next } });

  const patchDay = (
    day: number,
    win: { startMinute: number; endMinute: number } | null,
  ) => writeWeek(week.map((row, index) => (index === day ? win : row)));

  // The time inputs are UNCONTROLLED (defaultValue), which this counter exists
  // to work around. A controlled <input type="time"> plus autosave-on-change
  // fights the typist: every keystroke fires the mutation, React re-renders
  // with the value the server has not acknowledged yet, and the field snaps
  // back under the cursor. The card that shipped before this one used
  // defaultValue for exactly that reason.
  //
  // Uncontrolled means the DOM keeps the user's edit and the server catches up
  // — but it also means a write from ANYWHERE ELSE never reaches the field. So
  // the two writes that are not the user typing into that very input — the
  // day being switched on, and apply-to-all — bump this, and the key remounts
  // the row so it re-reads. Keying on the VALUE instead would remount on every
  // keystroke and take the focus with it.
  const [bulkVersion, setBulkVersion] = useState(0);

  // The first open day, which is what "apply to all" copies from and what a
  // day being switched back on inherits — so turning Saturday on gives it the
  // week's hours rather than an empty pair nobody can submit.
  // Monday-first, matching the order the rows are READ in. Searching the
  // Sunday-indexed array directly meant a salon open on Sunday handed its
  // Sunday window to apply-to-all — the bottom row setting the whole week.
  const template = [1, 2, 3, 4, 5, 6, 0]
    .map((day) => week[day])
    .find((row) => row !== null) ?? {
    startMinute: 9 * 60,
    endMinute: 18 * 60,
  };

  return (
    // Titled since Business became one page: the chip strip used to name this
    // card, and a middle card in a stack has nothing to name it.
    <Card title={t("settings.hours")} disabled={!isOwner}>
      <div className={ROW_GRID}>
        {/* The clock the rows below are read in, and it leads them because
            "09:00 to 18:00" means nothing until you know whose 09:00. It used
            to sit in General, one chip away, which split a single thought
            across two screens: the calendar shades closed bands by projecting
            these hours from the business timezone onto the viewer's, so the
            two settings are one setting wearing two labels.

            Folding Hours INTO General was the other way to close that gap and
            was rejected twice, most recently 2026-08-12. General already
            carries nine rows across three unrelated jobs, and a chip strip
            where one chip scrolls while five swap the pane is two grammars in
            one control. Moving the single coupled row is the smaller fix. */}
        <RowLabel
          label={t("settings.timezone")}
          hint={t("settings.timezoneHint")}
        />
        {/* Capped like the General card's boxes: this trigger set the LOOK the
            other fields adopted (FIELD in RowLabel), but it was still spanning
            the full 24rem value column — the widest control on the page for a
            single city name. The anchored panel sizes off the trigger, so the
            dropdown narrows with it. */}
        <div className="w-full sm:max-w-56">
          <TimezoneSelect
            value={org.timezone}
            onChange={(zone) => update({ timezone: zone })}
          />
        </div>
      </div>

      {/* NOT a ROW_GRID row (2026-08-29). The seven day chips and the one
          open/close pair were what sized that grid's value column to 24rem,
          and seven rows of weekday + switch + two times do not fit it. Rather
          than widening the shared grid — which AGENTS.md forbids, because the
          grid is the settings-page grammar and not this card's layout — the
          week gets its own block below it, still label-left and value-right so
          it reads as the same page.

          Every day keeps BOTH time inputs whether it is open or shut, dimmed
          and disabled when shut. Hiding them would resize the card under the
          pointer on every toggle, and it would also throw away the hours you
          are about to want back when you reopen Tuesday. */}
      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <div className="mb-2">
          <RowLabel
            label={t("settings.businessHours")}
            hint={t("settings.businessHoursHint")}
          />
        </div>
        {/* ONE grid for the week, not seven flex rows: the first column is
            `auto`, so the day pills are all exactly as wide as the longest
            name in whatever language is on — which is what lets the names be
            written out instead of clamped to a `w-20` that fit "Pzt" and
            nothing longer. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
          {/* Monday-first — the week as this market reads it — while the
              STORED index stays 0=Sunday, because that is what Date.getDay()
              speaks and what every guard downstream compares. */}
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const win = week[day];
            const open = win !== null;
            return (
              <Fragment key={day}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={open}
                  aria-label={`${dayNames[day]} — ${t("settings.dayOpenAria")}`}
                  onClick={() => patchDay(day, open ? null : { ...template })}
                  // An open day is an ON state, so it wears what every other
                  // ON state in this app wears. The name sits INSIDE the
                  // switch, as it did when this was a chip, so the row starts
                  // with the word you are looking for.
                  className={`rounded-full px-3 py-1 text-left text-sm transition-colors ${
                    open
                      ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {dayNames[day]}
                </button>
                <input
                  key={`from-${day}-${open}-${bulkVersion}`}
                  type="time"
                  aria-label={`${dayNames[day]} ${t("settings.openFrom")}`}
                  disabled={!open}
                  className={`${FIELD} w-full min-w-0 disabled:opacity-40`}
                  defaultValue={win ? minutesToTimeValue(win.startMinute) : ""}
                  onChange={(e) => {
                    const minutes = timeValueToMinutes(e.target.value);
                    // A half-typed or cleared time is not a window. Dropping it
                    // leaves the last good value stored and the DOM showing
                    // what is being typed, which is what uncontrolled buys.
                    if (minutes == null || !win) return;
                    // Moving a day LATER means editing the opening first, and
                    // orgs.update stores any window whose start is at or past
                    // its end as a CLOSED day — so typing 19:00 over 09:00 on a
                    // 09:00-18:00 day used to shut the day, blank both boxes
                    // and flip the switch off, with nothing said. The closing
                    // time gives way instead, and the row remounts to show it.
                    patchDay(day, {
                      startMinute: minutes,
                      endMinute:
                        minutes >= win.endMinute
                          ? Math.min(24 * 60, minutes + 60)
                          : win.endMinute,
                    });
                    if (minutes >= win.endMinute) setBulkVersion((n) => n + 1);
                  }}
                />
                <span className="text-sm text-[var(--muted)]">
                  {t("settings.openUntil")}
                </span>
                <input
                  key={`to-${day}-${open}-${bulkVersion}`}
                  type="time"
                  aria-label={`${dayNames[day]} ${t("settings.openTo")}`}
                  disabled={!open}
                  className={`${FIELD} w-full min-w-0 disabled:opacity-40`}
                  defaultValue={win ? minutesToTimeValue(win.endMinute) : ""}
                  onChange={(e) => {
                    const minutes = timeValueToMinutes(e.target.value);
                    if (minutes == null || !win) return;
                    // The mirror of the opening box above: the opening gives
                    // way rather than the day closing itself.
                    patchDay(day, {
                      startMinute:
                        minutes <= win.startMinute
                          ? Math.max(0, minutes - 60)
                          : win.startMinute,
                      endMinute: minutes,
                    });
                    if (minutes <= win.startMinute) setBulkVersion((n) => n + 1);
                  }}
                />
              </Fragment>
            );
          })}
        </div>
        {/* Most businesses are one pattern with one or two exceptions, so the
            common case is typing the same pair seven times. Ghost, not
            outlined: the card's own action slot belongs to Add closure below,
            and one loud thing per screen is the budget. */}
        {isOwner && (
          <button
            type="button"
            onClick={() => {
              writeWeek(week.map((row) => (row === null ? null : { ...template })));
              setBulkVersion((n) => n + 1);
            }}
            className="mt-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            {t("settings.copyToOpenDays")}
          </button>
        )}
      </div>
    </Card>
  );
}

// The salon's shop phone on the Evolution lane.
//
// Hidden entirely unless the operator has provisioned this org an instance:
// a salon on Cloud only should never meet a QR code for a product nobody sold
// them. The credentials that fetch all this are operator-installed and stay
// server-side; what reaches this component is a picture, a state and a number.
//
// This is the one setup step that CANNOT be done from the admin console,
// because it needs the handset in the salon's hand.
function ShopPhoneCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const statusAction = useAction(api.evolution.status);
  const qrAction = useAction(api.evolution.qr);
  const [status, setStatus] = useState<{
    enabled: boolean;
    connected: boolean;
    state: string;
    number: string | null;
    error: string | null;
  } | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await statusAction({});
    setStatus(next);
    // A completed scan retires the code it was scanned from.
    if (next.connected) setQr(null);
    return next;
  }, [statusAction]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Only while a code is on screen. Evolution's QRs expire in well under a
  // minute, so this is a short window by nature, and polling a salon's
  // settings page forever to watch a phone that is already linked is work
  // nobody asked for.
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [qr, refresh]);

  if (!status?.enabled) return null;

  const showQr = async () => {
    const result = await qrAction({});
    if (result.connected) {
      void refresh();
      return;
    }
    setQr(result.qr);
  };

  return (
    <Card disabled={!isOwner}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{t("settings.waShopPhone")}</span>
        {status.connected ? (
          <>
            <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t("settings.waConnected")}
            </span>
            {/* The number matters as much as the state: it is how somebody
                notices they linked their own phone instead of the shop's. */}
            <span className="text-[var(--muted)]">{status.number ?? "—"}</span>
          </>
        ) : (
          <>
            <span className="text-[var(--muted)]">
              {t("settings.waNotLinked")}
            </span>
            <button
              type="button"
              onClick={() => void showQr()}
              className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
            >
              {t("settings.waLinkPhone")}
            </button>
          </>
        )}
      </div>
      {qr && !status.connected && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI
              from the Evolution server, not an asset next/image can optimise */}
          <img
            src={qr}
            alt=""
            width={192}
            height={192}
            className="rounded-lg bg-white p-2"
          />
          <div className="text-xs text-[var(--muted)]">
            <p>{t("settings.waScanHint")}</p>
            <p className="mt-1">{t("settings.waWaitingScan")}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

// Settings holds the connections and the sending rules, nothing else. What the
// business IS (its name, timezone, language, team, services, contact fields)
// lives next door in Business, its own sidebar destination. The business's own
// identity was the first chip here and it never belonged: a name and a
// timezone are not a connection.
//
// Sections rather than one long scroll of cards.
// What used to be Settings, whittled down until the name stopped being true:
// voice became its own tab, bookings went to the operator's admin console, AI
// connectors joined Business next to People, credentials moved behind /admin
// and the hours card to Business → Hours. What remained no longer justified
// tabs, so there are none.

// One flat page, no tabs. Reminders/WhatsApp was a two-tab split where the
// second tab held credentials (now /admin's job) and the hours card (now
// Business → Hours); what is left — the rules, the templates the rules send,
// and the shop phone — is one story read top to bottom.
export function RemindersView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const rulesData = useQuery(api.messageRules.list, {});
  const updateOrg = useMutation(api.orgs.update);

  if (!settings || !rulesData)
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;

  // Backend enforces this too (requireOwner); the fieldsets are just honest UI.
  const isOwner = settings.me.role !== "staff";
  // The `migrated` fork is gone from this file. Every org runs on messageRules
  // (migrateAll has run in prod, and seedDefaultRules stamps new orgs at
  // creation), so the legacy NotificationRulesCard and the three conditions that
  // chose between the two models were unreachable — a second full editor for the
  // same settings, maintained in parallel, that no signup could ever see.
  //
  // The Meta registration desk that used to render here moved to /admin
  // (2026-08-26) — approval is operator work now, and the Cloud wording is
  // platform text (lib/metaTemplate CLOUD_TEMPLATE_TEXTS).

  return (
    // Wider than the settings default: the expanded rule panel is a real
    // split-pane (editor beside a rendered email) and 3xl squeezed both.
    // max-w-3xl like Services: both pages are a list of the org's own rows,
    // and the editor inside is a message column — 5xl gave it newspaper-wide
    // lines nobody writes an SMS-length text in.
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}

      <RulesCard
        isOwner={isOwner}
        org={settings.org}
        templates={settings.templates}
        rules={rulesData.rules}
        waConnected={settings.whatsapp.connected}
        evolutionEnabled={settings.evolutionEnabled}
        emailEnabled={settings.emailEnabled}
      />

      <>
        {/* No connect form here. The Meta credentials — phone number id,
              access token — are operator plumbing, entered from /admin like
              the Retell key. A salon owner was being shown a password field
              for an account they do not have; all they need to know is
              whether the number works, and the templates card already goes
              amber when it does not. */}
        {settings.whatsapp.connected && (
          <Card disabled={!isOwner}>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {t("settings.waConnected")}
              </span>
              <span className="text-[var(--muted)]">
                {settings.whatsapp.displayNumber ??
                  settings.whatsapp.phoneNumberId}
              </span>
            </div>
          </Card>
        )}

        {/* No registration desk here any more (Serdar, 2026-08-26): the
            Meta name, status and Onaya gönder moved to /admin with the
            credentials they depend on — same doctrine as the connect
            form above. The Cloud wording is platform text; a salon
            never meets Meta. */}
      </>

      {/* Below the rules, above the phone: the rules card is what the salon
          sends on its own schedule, this is what answers when somebody writes
          back, and both are "what goes out on WhatsApp without me". Absent
          entirely until an operator enables the agent. */}
      {settings.org.chatAgentMode === "live" && (
        <ChatAgentCard
          isOwner={isOwner}
          behavior={settings.org.chatAgentBehavior ?? "live"}
          stopOnHandover={settings.org.chatAgentStopOnHandover ?? false}
          update={(args) => void updateOrg(args)}
        />
      )}

      <ShopPhoneCard isOwner={isOwner} />

      {/* Campaigns are PARKED (roadmap §9; Serdar, 2026-08-28: "hide
          campaigns all together until we built this feature") — the card is
          one Submit from live but not launched, and a visible door to an
          unbuilt room invites walking through it. CampaignsView stays
          intact; re-mounting it here is the whole relaunch. */}
    </div>
  );
}



