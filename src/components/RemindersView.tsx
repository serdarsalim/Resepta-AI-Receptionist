"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { sanitizeEmailHtml } from "@/lib/sanitizeHtml";
import { useConfirm } from "./ConfirmDialog";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import {
  DEFAULT_TEMPLATE_TEXTS,
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
import { ROW_GRID, RowLabel } from "./RowLabel";
import { TimezoneSelect } from "./TimezoneSelect";
import { InfoTip } from "./InfoTip";
import { Card } from "./Card";
import { Sheet } from "./Sheet";

// Nudge settings conventions: label-left/input-right on the shared RowLabel
// grid (ROW_GRID, defined next to RowLabel itself), autosave on blur/change,
// explanations behind InfoTips.

// The three columns left of the toggle. A three-column table from sm up; on a
// phone the same three cells fold into two columns — when over what on the
// left, channel pinned right — rather than stacking flush left down one edge
// and leaving half the row empty. The header uses the same inner grid so the
// columns line up without a real <table>, which would need its own mobile
// story; it is sm-only, so the phone placement below never reaches it.
const RULE_COLUMNS =
  "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3";

// Phone placement for the two cells that are not already in the top-left slot.
// Applied at each row call site because only a row has these three children in
// this order — the sm-only headers share the grid but not the folding.
const RULE_WHAT_CELL = "max-sm:col-start-1 max-sm:row-start-2";
const RULE_CHANNEL_CELL =
  "max-sm:col-start-2 max-sm:row-start-1 max-sm:row-span-2 max-sm:justify-self-end";

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
  body?: string;
  bodyHtml?: string;
  subject?: string;
  variableDefaults?: VariableDefault[];
  bodyPreview?: string;
  emailSentCount?: number;
  emailOpenCount?: number;
  emailReplyCount?: number;
  emailLastSentAt?: number;
};

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

// The two projections of one authored email. plainToHtml lifts a legacy
// plain-text body into the WYSIWYG editor; htmlToText derives the WhatsApp
// text the send path uses from whatever the editor holds. Deriving on SAVE —
// not at send time — keeps the backend blind to HTML parsing.
function plainToHtml(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function htmlToText(html: string): string {
  const prepared = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  // SSR guard: this only runs for real in the browser; the server render just
  // needs to not crash before hydration.
  if (typeof window === "undefined") {
    return prepared
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const doc = new DOMParser().parseFromString(prepared, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
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
  orgTimezone,
  orgBookingUrl,
  orgPublicPhone,
  emailEnabled,
  waConnected,
  onSaveTemplate,
}: {
  rule: RuleRowData;
  template: TemplateRow | undefined;
  contactFields: { key: string; label: string }[];
  orgName: string;
  orgLanguage: string;
  orgCurrency: string;
  orgTimezone: string;
  orgBookingUrl?: string;
  orgPublicPhone?: string;
  emailEnabled: boolean;
  waConnected: boolean;
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
  const [body, setBody] = useState(template?.body ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  // What the WYSIWYG editor currently holds, saved or not — the previews
  // track it live. Seeded from the stored HTML, or the plain body lifted into
  // HTML for rows that predate the editor.
  const [liveHtml, setLiveHtml] = useState(
    template?.bodyHtml ?? plainToHtml(template?.body ?? ""),
  );
  // The "when empty, print…" table. Held here so the preview can render the
  // UNSAVED value — you are typing a fallback to see how the sentence reads,
  // and a preview that waited for the blur would be showing the old one.
  const [defaults, setDefaults] = useState<VariableDefault[]>(
    template?.variableDefaults ?? [],
  );
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // The row is created by ensureTemplate when the panel opens; until the
  // query catches up there is nothing to bind to.
  const templateId = template?._id;
  useEffect(() => {
    setBody(template?.body ?? "");
    setSubject(template?.subject ?? "");
    setDefaults(template?.variableDefaults ?? []);
    setLiveHtml(template?.bodyHtml ?? plainToHtml(template?.body ?? ""));
    // Re-seed exactly when the editor starts talking about a different row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // ── Preview data: a real booking, or no preview at all ──────────────────
  //
  // This used to fall back to samples — "Emma", a €350 haircut, tomorrow at
  // 14:00 — and that made the pane a liar in the exact place it is trusted.
  // An owner checking whether [pricelist] reads right cannot tell a broken
  // template from an invented number, and a €350.00 sample in a shop that
  // charges €35 reads as a pricing bug in the product. So: the preview renders
  // ONE customer's ONE real appointment, or it renders a line telling you to
  // pick one. Nothing in this pane is ever made up.
  const contacts = useQuery(api.customers.options, {}) ?? [];
  const [contactQuery, setContactQuery] = useState("");
  const [contactId, setContactId] = useState<Id<"customers"> | null>(null);
  // A real booking of this salon's own, so the preview is filled the moment
  // the page opens and nobody has to configure a fallback to see the sentence
  // work. Auto-picked, never sticky: choosing someone yourself replaces it,
  // and clearing the box drops back to this.
  const sample = useQuery(api.appointments.sampleForPreview, {});
  const effectiveContactId = contactId ?? sample?.customerId ?? null;
  // Which lane the preview is showing. One message goes out two ways, so this
  // is a view of the same thing rather than two things — stacking both cards
  // made the pane look like the rule sends twice.
  const [lanePref, setLanePref] = useState<"email" | "whatsapp">("email");
  const picked = useQuery(
    api.customers.get,
    effectiveContactId ? { customerId: effectiveContactId } : "skip",
  );
  const matches =
    contactQuery.trim() && !contactId
      ? contacts
          .filter((c) =>
            `${c.firstName} ${c.lastName ?? ""} ${c.phone}`
              .toLocaleLowerCase(orgLanguage)
              .includes(contactQuery.trim().toLocaleLowerCase(orgLanguage)),
          )
          .slice(0, 6)
      : [];

  // The booking the preview speaks about: the soonest one still ahead, and
  // failing that the most recent past one. Rows arrive newest-first.
  const appointments = useQuery(
    api.appointments.listForCustomer,
    effectiveContactId ? { customerId: effectiveContactId } : "skip",
  );
  const appointment = useMemo(() => {
    if (!appointments?.length) return null;
    const now = Date.now();
    const upcoming = [...appointments].reverse().find((a) => a.startAt >= now);
    return upcoming ?? appointments[0];
  }, [appointments]);

  // Null until there is a real customer AND a real booking to render — the
  // pane reads that as "nothing to show yet" rather than filling the gap.
  //
  // Every value below is built the way convex/wa.ts builds it at send time,
  // including prices being MINOR units (the old sample divided by nothing and
  // printed €350.00 for a 350-kuruş line).
  // Live, not persisted: you are typing a fallback to watch the sentence
  // settle, so the preview has to read what is in the box right now.
  const liveDefaults = tokenDefaults(defaults);
  const previewValues = useMemo(() => {
    if (!picked) return null;
    // The away reply speaks to a person, not a booking — everyone else still
    // needs the real appointment their tokens describe.
    if (!appointment && rule.trigger !== "out_of_hours") return null;
    const formatMoney = (minor: number) =>
      new Intl.NumberFormat(orgLanguage, {
        style: "currency",
        currency: orgCurrency,
      }).format(minor / 100);
    // Every org field key present, empty when valueless — mirrors the send
    // path exactly, so a real field renders to nothing rather than staying a
    // literal token in the preview.
    const custom: Record<string, string> = {};
    for (const field of contactFields) {
      custom[field.key] = picked.custom?.[field.key] ?? "";
    }
    const items = appointment?.items ?? [];
    // × quantity. AGENTS.md, under Goods: "Quantity rides the line, price stays
    // per unit … if you sum prices anywhere new, multiply." This preview was a
    // new sum that did not, so three cakes at ₺120 previewed as ₺120 and were
    // sent as ₺360 — the owner tuning wording against a third of what the
    // customer receives, in the pane whose own comment promises it is "built the
    // way convex/wa.ts builds it at send time".
    const totalMinor = items.reduce(
      (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
      0,
    );
    // A real send collapses a token with nothing behind it, along with the
    // whitespace it leaves — renderTokens does that on purpose, so a message
    // never goes out saying "Merhaba ," or carrying an empty bracket. In a
    // PREVIEW that same kindness is a lie: the line simply vanishes, and the
    // writer cannot tell a token that will fill on a real send from one they
    // misspelled. So a built-in with no sample data behind it previews as its
    // own label in guillemets instead of as nothing.
    //
    // Contact fields are deliberately NOT given this treatment. The preview
    // speaks about a real customer, and a field that person never answered is
    // honestly blank for them — that is information, not a gap.
    const sample = (value: string | undefined, key: string, label: string) =>
      value?.trim() || liveDefaults?.[key] || `⟨${label}⟩`;
    return {
      firstName: picked.firstName,
      lastName: picked.lastName,
      // The BUSINESS's number and link — what [phone] and [booking_link]
      // resolve to at send time (see convex/lib/renderTokens).
      phone: sample(orgPublicPhone, "phone", t("vars.phone")),
      email: picked.email,
      bookingLink: sample(orgBookingUrl, "booking_link", t("vars.bookingLink")),
      businessName: orgName,
      appointmentAt: appointment
        ? formatAppointmentTime(appointment.startAt, orgTimezone, orgLanguage)
        : (liveDefaults?.date ?? `⟨${t("vars.date")}⟩`),
      staffName: sample(appointment?.staffName, "staff", t("vars.staff")),
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
            // Quantity prefix and line worth, both of which the send path emits
            // and this dropped — and price !== undefined, so a service priced 0
            // previews as free rather than as unpriced. Mirrors convex/wa.ts.
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
    orgTimezone,
    orgPublicPhone,
    orgBookingUrl,
    contactFields,
    picked,
    appointment,
    rule.trigger,
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
  const contactlessSlot = (key: string, label: string) =>
    liveDefaults?.[key] ?? `⟨${label}⟩`;
  const contactlessValues = {
    // True no matter who is reading, so they resolve for real.
    businessName: orgName,
    phone: orgPublicPhone || contactlessSlot("phone", t("vars.phone")),
    bookingLink:
      orgBookingUrl || contactlessSlot("booking_link", t("vars.bookingLink")),
    // Everything that belongs to a person or a booking. A labelled slot rather
    // than the raw [token] Nudge leaves behind: it reads as the shape of the
    // sentence instead of as syntax, which is what a preview is for.
    firstName: contactlessSlot("name", t("vars.firstName")),
    appointmentAt: contactlessSlot("date", t("vars.date")),
    staffName: contactlessSlot("staff", t("vars.staff")),
    serviceName: contactlessSlot("service", t("vars.service")),
    servicePriceList: contactlessSlot("pricelist", t("vars.priceList")),
    price: contactlessSlot("price", t("vars.price")),
    manageLink: contactlessSlot("manage_link", t("vars.manageLink")),
    // Org fields resolve to their own labelled slots too, so a body built out
    // of contact fields is not a row of blanks before anyone is picked.
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
  const pickedLabel = picked
    ? `${picked.firstName} ${picked.lastName ?? ""}`.trim()
    : "";

  // The preview, as ONE node the editor can host in its own tab strip. It
  // used to be a second column: the same formatted message rendered twice,
  // side by side, each in half the width. What the preview alone can say is
  // that [name] becomes Kerem and [date] becomes Friday 31 July — a different
  // VIEW of the body, which is what a tab is for, not a different panel.
  const previewPane = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        {/* Two lanes, one message: a toggle, not two cards. Only rendered
            when the rule really can travel both ways — otherwise the label
            alone says which lane you are looking at. */}
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
        {/* Typeahead over real contacts — the preview's only data source.
            Picking one fills every token from their record and their next
            booking; the × empties the pane again. */}
        <span className="relative min-w-0 max-w-56 flex-1">
          <input
            className="h-9 w-full text-sm"
            value={
              contactId
                ? pickedLabel
                : contactQuery || (sample && !contactQuery ? sample.name : "")
            }
            placeholder={t("settings.previewPickContact")}
            onChange={(e) => {
              setContactId(null);
              setContactQuery(e.target.value);
            }}
          />
          {(contactId || contactQuery) && (
            <button
              type="button"
              aria-label={t("common.delete")}
              onClick={() => {
                setContactId(null);
                setContactQuery("");
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              ×
            </button>
          )}
          {matches.length > 0 && (
            <ul className="absolute right-0 top-full z-30 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
              {matches.map((c) => (
                <li key={c._id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setContactId(c._id);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--muted-bg)]"
                  >
                    <span className="truncate">
                      {c.firstName} {c.lastName ?? ""}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--muted)]">
                      {c.phone}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      </div>
      {/* No contact, or a contact with nothing booked: say which, and say
          nothing else. An empty pane with a reason beats a filled pane with
          invented facts. */}
      {lane === "email" ? (
        /* The email as the customer's mail client shows it: white paper no
           matter the app theme, subject on top, the authored HTML below. */
        <div className="email-paper flex flex-col overflow-hidden rounded-lg border border-[var(--border)]">
          <p className="border-b border-black/10 px-3 py-2 text-xs font-semibold">
            {renderFor(subject) ||
              [orgName || "—", previewValues?.appointmentAt]
                .filter(Boolean)
                .join(", ")}
          </p>
          <div
            className="email-body-editor min-h-40 px-3 py-2 text-sm"
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
        <p className="text-[11px] leading-relaxed text-[var(--muted)]">
          {t("editor.previewPlaceholder")}
        </p>
      )}
    </div>
  );

  return (
    // ONE column. The editor gets the full width of the panel, the way every
    // mail composer worth using does — the split gave the box you type in
    // half a page so that the other half could show the same words again.
    <div className="space-y-2 pb-4">
      {/* Subject first — that is the order an email reads in. Placeholder
            instead of a label so the input gets the full row width. */}
      {emailEnabled && (
        // h-10 matches the preview header row beside it, so the editor box
        // and the preview paper start on the same line.
        <input
          className="h-10 w-full"
          value={subject}
          placeholder={t("settings.templateSubject")}
          aria-label={t("settings.templateSubject")}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={() => onSaveTemplate(template._id, { subject })}
        />
      )}
      {emailEnabled ? (
        // The real email editor — Visual/HTML tabs, toolbar with variables
        // and emoji built in. Every save writes BOTH projections: the HTML
        // the email sends and the plain text the WhatsApp lane sends.
        <EmailBodyEditor
          value={template.bodyHtml ?? plainToHtml(template.body ?? "")}
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

// Adding a rule, as a sheet you open from the button above the card. It used
// to be a row of chips parked under the table — "+ 2 days before", "+ 1 hour
// before" — which had two problems. It charged the card a permanent strip of
// buttons for a job done a handful of times, and it could only ever offer the
// timings somebody guessed in advance: a salon that wanted 36 hours had no way
// in, and the chips vanished one by one as they were used, so the strip also
// changed shape under you. Here the message types are always all six, and the
// timing is a number you type with the unit beside it.
function AddRuleSheet({
  rules,
  templates,
  orgLanguage,
  onAdd,
  onClose,
}: {
  rules: RuleRowData[];
  // The org's kind-level fallback rows, so the sheet shows the wording this
  // business will actually get rather than the shipped stock text they may
  // have already rewritten. Same resolution order as ensureTemplate.
  templates: TemplateRow[];
  orgLanguage: string;
  onAdd: (
    trigger: RuleTrigger,
    offsetHours: number | undefined,
    text: { body: string; subject: string },
  ) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [trigger, setTrigger] = useState<RuleTrigger | null>(null);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"hours" | "days">("hours");
  const [error, setError] = useState<string | null>(null);
  // The wording, seeded on pick and editable here. Adding a reminder without
  // seeing what it says meant discovering the words afterwards, in a second
  // screen, on a rule that was already live.
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");

  const selected =
    ADD_OPTIONS.find((option) => option.trigger === trigger) ?? null;
  const taken = (option: AddOption) =>
    !option.repeatable && rules.some((rule) => rule.trigger === option.trigger);

  // ensureTemplate's order, mirrored: this org's own fallback for the kind,
  // then the stock text for the language, then English. Getting this wrong
  // would show one message in the sheet and save a different one.
  const seedFor = (option: AddOption) => {
    const kind = KIND_FOR_TRIGGER[option.trigger];
    const fallback = templates.find(
      (tpl) =>
        tpl.ruleId === undefined &&
        tpl.kind === kind &&
        tpl.language === orgLanguage,
    );
    const stock = (DEFAULT_TEMPLATE_TEXTS[orgLanguage] ??
      DEFAULT_TEMPLATE_TEXTS.en)[kind as TemplateKind];
    return {
      body: fallback?.body ?? stock?.body ?? "",
      subject: fallback?.subject ?? stock?.subject ?? "",
    };
  };

  const pick = (option: AddOption) => {
    setTrigger(option.trigger);
    setError(null);
    const seed = seedFor(option);
    setBody(seed.body);
    setSubject(seed.subject);
    if (option.timing) {
      setAmount(String(option.timing.defaultAmount));
      setUnit(option.timing.defaultUnit);
    }
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
    if (!selected) return;
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
    onAdd(selected.trigger, offsetHours, { body, subject });
    onClose();
  };

  return (
    <Sheet title={t("settings.ruleAdd")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset>
          <legend className="mb-1.5 text-xs text-[var(--muted)]">
            {t("settings.ruleAddPick")}
          </legend>
          <div className="space-y-1">
            {ADD_OPTIONS.map((option) => {
              const disabled = taken(option);
              const on = trigger === option.trigger;
              return (
                <label
                  key={option.trigger}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                    disabled
                      ? "cursor-not-allowed border-[var(--border)] opacity-50"
                      : on
                        ? "cursor-pointer border-[var(--accent)] bg-[var(--muted-bg)]"
                        : "cursor-pointer border-[var(--border)] hover:bg-[var(--muted-bg)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="rule-trigger"
                    className="w-auto"
                    checked={on}
                    disabled={disabled}
                    onChange={() => pick(option)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {t(option.nameKey)}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {disabled
                        ? t("settings.ruleAlreadyAdded")
                        : t(option.whenKey)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Only the three triggers that hang off a clock get a timing row. The
            event ones fire on the mutation, so a number there would be a
            promise nothing keeps (messageRules.clampOffset pins them to 0). */}
        {selected?.timing && (
          <div>
            <span className="mb-1.5 block text-xs text-[var(--muted)]">
              {t("settings.ruleAddTiming")}
            </span>
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
          </div>
        )}

        {/* The words, before the rule exists. Picking a message type used to
            add it sight-unseen and leave you to find the wording afterwards
            on a second screen — so the stock text was something you inherited
            rather than something you agreed to. Editable here because the
            moment you read a sentence is the moment you want to change it. */}
        {selected && (
          <div className="space-y-1.5">
            <span className="block text-xs text-[var(--muted)]">
              {t("settings.ruleAddMessage")}
            </span>
            <input
              value={subject}
              placeholder={t("settings.templateSubject")}
              aria-label={t("settings.templateSubject")}
              onChange={(event) => setSubject(event.target.value)}
            />
            <AutoGrowTextarea
              value={body}
              rows={5}
              placeholder={t("settings.templateBodyPlaceholder")}
              aria-label={t("settings.templateBody")}
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              {t("settings.ruleAddMessageHint")}
            </p>
          </div>
        )}

        {/* Reserved whether or not it holds anything, so a rejected number does
            not shove the buttons out from under the pointer. */}
        <p className="min-h-[1.25rem] text-sm text-red-600 dark:text-red-400">
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
            disabled={!selected}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-60"
          >
            {t("common.add")}
          </button>
        </div>
      </form>
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

  const orgHasChannel = waConnected || evolutionEnabled || emailEnabled;
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
    if (isOwner)
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
    if (opened && isOwner) {
      void ensureTemplate({ ruleId: opened._id, language: org.language });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?._id, isOwner, org.language]);

  const pad = (h: number) => String(h).padStart(2, "0");
  const winbackHint = `${t("settings.ruleWinbackHint")}\n${t("settings.ruleSendWindow")}: ${pad(
    org.quietHoursStart,
  )}:00–${pad(org.quietHoursEnd)}:00`;

  // The row's version: the same sentence with the number as TEXT. A row that
  // opens a page must not also hold controls — clicking the "24" to retype it
  // and clicking two millimetres away to navigate are different intentions,
  // and one of them was going to be a surprise. Everything editable now lives
  // inside the page the row opens.
  const ruleWhenStatic = (rule: RuleRowData) => {
    switch (rule.trigger) {
      case "booking":
        return t("settings.ruleWhenBooked");
      case "cancellation":
        return t("settings.ruleWhenCancelled");
      case "out_of_hours":
        return t("settings.ruleWhenClosed");
      case "before_start":
        return `${rule.offsetHours} ${t("settings.ruleHoursBefore")}`;
      case "after_end":
        return `${rule.offsetHours} ${t("settings.ruleHoursAfterEnd")}`;
      case "no_show":
        return `${Math.round(rule.offsetHours / 24)} ${t("settings.ruleDaysAfterNoShow")}`;
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
  const doAdd = async (
    trigger: RuleTrigger,
    offsetHours: number | undefined,
    text: { body: string; subject: string },
  ) => {
    const ruleId = await addRule({ trigger, offsetHours: offsetHours ?? 0 });
    const templateId = await ensureTemplate({ ruleId, language: org.language });
    await updateTemplate({
      templateId,
      body: text.body,
      bodyHtml: plainToHtml(text.body),
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
    return (
      <Card disabled={!isOwner}>
        {/* Back arrow left, title centred, an equal-width spacer right so the
            centring is of the ROW and not of what happens to be left over
            after the button. The arrow carries the label as its tooltip and
            its accessible name rather than printing it: a word next to a
            glyph that already says "back" is the second half of the same
            sentence, and it was competing with the title for rank. */}
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => openRule(null)}
            title={t("settings.rulesBack")}
            aria-label={t("settings.rulesBack")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            ←
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-lg font-semibold">
            {ruleName(opened.trigger)}
          </h2>
          <span className="h-9 w-9 shrink-0" aria-hidden />
        </div>

        {/* Everything editable about the rule ITSELF — when it fires and which
            lanes it travels — in one strip above the words it sends. Both used
            to live on the list row, back when the row expanded in place; a row
            that opens a page cannot also be a control panel. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--border)] pb-3">
          <span className="flex items-center gap-1.5 text-sm">
            {ruleWhen(opened)}
            {opened.trigger === "no_show" && <InfoTip text={winbackHint} />}
            {opened.trigger === "after_end" && (
              <InfoTip text={t("settings.ruleFollowupHint")} />
            )}
            {opened.trigger === "out_of_hours" && (
              <InfoTip text={t("settings.ruleOutOfHoursHint")} />
            )}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            {wiredFor(opened).map((channel) => {
              const on = activeChannels(opened).has(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${ruleName(opened.trigger)} — ${channelLabel(channel)}`}
                  onClick={() => toggleChannel(opened, channel)}
                  className={`rounded-full px-2.5 py-0.5 transition-colors ${
                    on
                      ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {channelLabel(channel)}
                </button>
              );
            })}
          </span>
        </div>
        <RuleEditor
          rule={opened}
          template={ownTemplate}
          contactFields={contactFieldRows}
          orgName={org.name}
          orgLanguage={org.language}
          orgCurrency={org.currency}
          orgTimezone={org.timezone}
          orgBookingUrl={org.bookingUrl}
          orgPublicPhone={org.publicPhone}
          emailEnabled={emailEnabled}
          waConnected={waConnected}
          onSaveTemplate={(templateId, patch) =>
            void updateTemplate({ templateId, ...patch })
          }
        />
        {/* Deleting lives with the thing being deleted. */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => void deleteRule(opened)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {t("settings.deleteRule")}
          </button>
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
      {/* Above the card and hard right, the same place and the same solid
          button Customers puts "Add customer" — this is the page's primary
          action, not a footnote under the table it adds to. */}
      {isOwner && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("settings.ruleAdd")}
          </button>
        </div>
      )}
      <Card disabled={!isOwner}>
        <div className="hidden items-center gap-3 pb-2 sm:flex">
          <div className={RULE_COLUMNS}>
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              {t("settings.rulesWhen")}
              <InfoTip text={t("settings.rulesHint")} />
            </span>
            <span className="text-xs text-[var(--muted)]">
              {t("settings.rulesWhat")}
            </span>
            <span className="text-xs text-[var(--muted)]">
              {t("settings.rulesWhere")}
            </span>
          </div>
        </div>

        <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {rules.map((rule) => {
            const rowChannels = wiredFor(rule);
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
                  className="-mx-3 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-[var(--muted-bg)]"
                >
                  <div className={RULE_COLUMNS}>
                    <span className="flex items-center gap-1.5 text-sm">
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
                    </span>
                    <span
                      className={`text-sm text-[var(--muted)] ${RULE_WHAT_CELL}`}
                    >
                      {ruleName(rule.trigger)}
                    </span>
                    {/* Which lanes this rule is ON, stated. The switches moved
                        inside with everything else editable. */}
                    <span
                      className={`flex flex-wrap items-center gap-1.5 text-xs ${RULE_CHANNEL_CELL}`}
                    >
                      {rowChannels
                        .filter((channel) => activeChannels(rule).has(channel))
                        .map((channel) => (
                          <span
                            key={channel}
                            className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          >
                            {channelLabel(channel)}
                          </span>
                        ))}
                      {rowChannels.every(
                        (channel) => !activeChannels(rule).has(channel),
                      ) && (
                        <span className="text-[var(--muted)]">
                          {t("settings.ruleOff")}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!orgHasChannel && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            {t("settings.rulesNoChannel")}
          </p>
        )}

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
          orgLanguage={org.language}
          onAdd={(trigger, offsetHours, text) =>
            void doAdd(trigger, offsetHours, text)
          }
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
    };
  };
  update: (args: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  const days = weekdayNames(language);
  const hours = org.businessHours ?? {};
  const activeDays = hours.activeDays ?? [];

  const patchHours = (next: Partial<NonNullable<typeof org.businessHours>>) =>
    update({ businessHours: { ...hours, ...next } });

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
        <TimezoneSelect
          value={org.timezone}
          onChange={(zone) => update({ timezone: zone })}
        />
        <RowLabel
          label={t("settings.businessHours")}
          hint={t("settings.businessHoursHint")}
        />
        <div className="flex flex-wrap gap-1.5">
          {/* Shown Monday-first — the week as this market reads it — while
              the STORED indices stay 0=Sunday, because that is what
              Date.getDay() speaks and what the away-reply check compares. */}
          {[1, 2, 3, 4, 5, 6, 0].map((index) => {
            const label = days[index];
            const active = activeDays.includes(index);
            return (
              <button
                key={index}
                type="button"
                onClick={() =>
                  patchHours({
                    activeDays: active
                      ? activeDays.filter((d) => d !== index)
                      : [...activeDays, index].sort((a, b) => a - b),
                  })
                }
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  active
                    ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ONE row, not two. Opening and closing are not two settings, they
            are the two ends of one range, and giving each its own labelled row
            made the reader parse a relationship the word "to" states outright.
            It also cost the card a third of its height to say one thing.

            Still two inputs, which is the rule ("split compound values into
            two labelled inputs"): what that forbids is one box parsing two
            syntaxes, not two boxes sharing a row. Each keeps its own accessible
            name, since the visible label now covers the pair.

            Phrased to match "Days you're open" directly above it. */}
        <RowLabel label={t("settings.openHours")} />
        <div className="flex items-center gap-2">
          <input
            type="time"
            aria-label={t("settings.openFrom")}
            className="min-w-0 flex-1"
            defaultValue={
              hours.startMinute == null
                ? ""
                : minutesToTimeValue(hours.startMinute)
            }
            onChange={(e) =>
              patchHours({ startMinute: timeValueToMinutes(e.target.value) })
            }
          />
          <span className="shrink-0 text-sm text-[var(--muted)]">
            {t("settings.openUntil")}
          </span>
          <input
            type="time"
            aria-label={t("settings.openTo")}
            className="min-w-0 flex-1"
            defaultValue={
              hours.endMinute == null ? "" : minutesToTimeValue(hours.endMinute)
            }
            onChange={(e) =>
              patchHours({ endMinute: timeValueToMinutes(e.target.value) })
            }
          />
        </div>
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
  const updateTemplate = useMutation(api.orgs.updateTemplate);

  if (!settings || !rulesData)
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;

  // Backend enforces this too (requireOwner); the fieldsets are just honest UI.
  const isOwner = settings.me.role !== "staff";
  // What the lower templates card still owns. Rule-bound wording moved into
  // each rule's own panel, so this card is the Meta registration desk (plus the
  // campaign row, which was always its own thing): rows only exist to be edited
  // when a Cloud number makes approval a real concept.
  //
  // The `migrated` fork is gone from this file. Every org runs on messageRules
  // (migrateAll has run in prod, and seedDefaultRules stamps new orgs at
  // creation), so the legacy NotificationRulesCard and the three conditions that
  // chose between the two models were unreachable — a second full editor for the
  // same settings, maintained in parallel, that no signup could ever see.
  const metaTemplates = settings.templates.filter((template) => {
    if (template.ruleId !== undefined) return false;
    // The campaign's email subject moved into the campaign composer, where
    // campaigns are actually written. What is left of this row is its Meta
    // registration, which only exists as a concept on a Cloud number.
    return settings.whatsapp.connected;
  });

  return (
    // Wider than the settings default: the expanded rule panel is a real
    // split-pane (editor beside a rendered email) and 3xl squeezed both.
    <div className="mx-auto max-w-5xl space-y-4 page-stack">
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

        {/* The templates the rules send, one editor per kind. The body is
              the salon's own words in named tokens; where a send actually
              leaves from is a single status line, and the Meta registration
              (name + approval) is a technical detail row that only exists
              while a Business number is connected — the shop phone and email
              need no approval from anybody. */}
        {metaTemplates.length > 0 && (
          <Card
            title={t("settings.templates")}
            tip={t("settings.templatesHint")}
            disabled={!isOwner}
          >
            <div className="divide-y divide-[var(--border)]">
              {metaTemplates.map((template) => (
                <div key={template._id} className="space-y-2 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {template.kind === "confirmation"
                        ? t("settings.ruleConfirmation")
                        : template.kind === "reminder"
                          ? t("settings.ruleReminder")
                          : template.kind === "winback"
                            ? t("settings.ruleWinback")
                            : template.kind === "followup"
                              ? t("settings.ruleFollowup")
                              : template.kind === "cancellation"
                                ? t("settings.ruleCancellation")
                                : t("settings.templateKindCampaign")}
                    </span>
                    {/* Which number this leaves from, in the salon's words.
                          Cloud wins whenever it exists (lib/waLane rule 2),
                          so the shop-phone line only shows when the shop
                          phone is the org's only WhatsApp. Neither lane: the
                          rules card already says so once, in amber. */}
                    {(settings.whatsapp.connected ||
                      settings.evolutionEnabled) && (
                      <span className="text-xs text-[var(--muted)]">
                        {settings.whatsapp.connected
                          ? t("settings.templateLaneCloud")
                          : t("settings.templateLaneShopPhone")}
                      </span>
                    )}
                  </div>
                  {/* Outside the campaign guard: a campaign has no body
                        here, but its emails need a subject like everyone
                        else's (campaigns.fanOut renders it per customer). On
                        the rules model every other subject lives in its
                        rule's panel. */}
                  {template.kind === "campaign" && settings.emailEnabled && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-36 shrink-0 text-xs text-[var(--muted)]">
                        {t("settings.templateSubject")}
                      </span>
                      <input
                        className="min-w-0 flex-1"
                        defaultValue={template.subject ?? ""}
                        onBlur={(e) =>
                          void updateTemplate({
                            templateId: template._id,
                            subject: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                  {settings.whatsapp.connected && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex w-36 shrink-0 items-center gap-1 text-xs text-[var(--muted)]">
                        {t("settings.templateName")}
                        {/* The exact string Meta approved, for checking the
                              authored body against it. */}
                        {template.bodyPreview && (
                          <InfoTip text={template.bodyPreview} />
                        )}
                      </span>
                      <input
                        className="min-w-0 flex-1"
                        defaultValue={template.metaName ?? ""}
                        onBlur={(e) =>
                          void updateTemplate({
                            templateId: template._id,
                            metaName: e.target.value,
                          })
                        }
                      />
                      <select
                        defaultValue={template.status}
                        aria-label={t("settings.templateStatus")}
                        onChange={(e) =>
                          void updateTemplate({
                            templateId: template._id,
                            status: e.target.value as
                              "draft" | "pending" | "approved" | "rejected",
                          })
                        }
                      >
                        <option value="draft">{t("template.draft")}</option>
                        <option value="pending">{t("template.pending")}</option>
                        <option value="approved">
                          {t("template.approved")}
                        </option>
                        <option value="rejected">
                          {t("template.rejected")}
                        </option>
                      </select>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </>

      <ShopPhoneCard isOwner={isOwner} />
    </div>
  );
}
