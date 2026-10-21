// The built-in dynamic variables both agent lanes read — {{business_name}},
// {{customer_name}}, {{now}}, {{services}}, {{contact}} and the rest — built
// from plain row data in ONE place. This is the "one context module, two
// renderers" of docs/agent-core.md: the voice lane injects these at ring time
// (retell.beforeCallContext, style "spoken"), the chat lane substitutes them
// into the same Talimat text on every message (style "written").
//
// The two styles differ ONLY where the medium forces it: a duration is
// "doksan dakika" down a phone line and "90 dk" on a screen, a price loses
// its symbol when spoken and keeps it when written. Everything else is the
// same string in both, deliberately — a fact that differed by lane would be
// the drift this module exists to end.
//
// Every value builder here was MOVED VERBATIM from beforeCallContext; the
// comments moved with them. Change a builder and both lanes change — that is
// the point, and also the warning.

import { getLocalPartsSafe } from "./businessHours";
import { spokenDateTime, spokenDuration, spokenPrice } from "./speech";
import { formatAppointmentTime } from "./format";
import { formatMoney } from "./money";
import { noteText } from "./noteBody";
import { answerOrEmpty, isNonAnswer } from "./nonAnswer";

export type AgentVariableStyle = "spoken" | "written";

// Structural row shapes rather than Doc<> types, so both lanes can hand over
// the rows they already fetched without a mapping pass.
export function builtinAgentVariables(args: {
  style: AgentVariableStyle;
  org: {
    name: string;
    language: string;
    timezone: string;
    currency?: string;
    priceDecimals?: boolean;
    voiceLockedIdentity?: string[];
  };
  // "" when the salon never named the persona — and deliberately "" on the
  // chat lane, where the assistant is nameless by decision (the prompt line
  // that reads {{agent_name}} says what empty means).
  personaName: string;
  customer: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    language?: string;
    custom?: Record<string, string>;
  } | null;
  // What identified the caller when no customer row matched — the normalised
  // inbound number.
  fallbackPhone?: string;
  nextAppointmentAt: number | null;
  staffRows: { active: boolean; order: number; name: string }[];
  services: {
    active: boolean;
    name: string;
    durationMinutes?: number | null;
    price?: number | null;
  }[];
  knowledgeRows: { title: string; body: string; order: number }[];
  contactFields: {
    key: string;
    label: string;
    // Optional in the schema; an unset source simply never matches "voice".
    source?: string;
    voiceVisible?: boolean;
  }[];
}): Record<string, string> {
  const { org, style } = args;
  // The card as an agent may hear it: a placeholder a call stored before
  // lib/nonAnswer existed reads as an empty field, so it is neither spoken as
  // a fact ("Belirtilmedi Bey") nor offered as the caller's details. Same
  // rule as the registry rows in retell.beforeCallContext.
  const customer = args.customer
    ? {
        ...args.customer,
        firstName: answerOrEmpty(args.customer.firstName, "name"),
        lastName: answerOrEmpty(args.customer.lastName, "name"),
        email: answerOrEmpty(args.customer.email),
        custom: Object.fromEntries(
          Object.entries(args.customer.custom ?? {}).filter(
            ([, value]) => !isNonAnswer(value),
          ),
        ),
      }
    : null;
  const lang = customer?.language ?? org.language;
  const currency = org.currency ?? "TRY";
  return {
    business_name: org.name,
    // Empty when the salon never named her. The prompt line that reads this
    // says what empty means, rather than leaving the model to invent a name
    // for itself — see GENERAL_PROMPTS in lib/voiceAgentTemplate.
    agent_name: args.personaName,
    customer_name: customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim()
      : "",
    // Kept alongside the two columns: an opening line saying the whole name
    // is the common case, and {{customer_name}} is already written into
    // prompts. It is READ-only context — nothing writes back through it.
    customer_first_name: customer?.firstName ?? "",
    customer_last_name: customer?.lastName ?? "",
    customer_phone: customer?.phone ?? args.fallbackPhone ?? "",
    customer_email: customer?.email ?? "",
    customer_language: lang,
    // The one styled datetime: spokenDateTime says "akşam sekiz elli sekiz"
    // for the mouth, formatAppointmentTime writes "26 Ağustos Çarşamba 20:58"
    // for the screen — the pair the chat thread and the reminders already use.
    next_appointment:
      args.nextAppointmentAt !== null
        ? style === "spoken"
          ? spokenDateTime(args.nextAppointmentAt, org.timezone, lang)
          : formatAppointmentTime(args.nextAppointmentAt, org.timezone, lang)
        : "",
    // What "yarın" means, resolved here rather than by a tool. The agent has
    // no clock of its own and the salon may be in another timezone than the
    // caller; both spellings go over because one is for saying out loud (or
    // reading, per style) and the other is what book_appointment needs to
    // receive.
    now: (() => {
      const parts = getLocalPartsSafe(Date.now(), org.timezone);
      const pad = (n: number) => String(n).padStart(2, "0");
      const iso = `${parts.y}-${pad(parts.m0 + 1)}-${pad(parts.d)}`;
      const styled =
        style === "spoken"
          ? spokenDateTime(Date.now(), org.timezone, lang)
          : formatAppointmentTime(Date.now(), org.timezone, lang);
      return `${styled} (${iso} ${pad(parts.hour)}:${pad(parts.minutesOfDay % 60)}, ${org.timezone})`;
    })(),
    // Names only. Which of them is free at three o'clock is availability's
    // job; this exists so a caller asking for a person by name gets an agent
    // that knows whether that person works here.
    staff: args.staffRows
      .filter((row) => row.active)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((row) => row.name)
      .join(", "),
    // The whole customer card and the writable keys, from ONE list: the
    // Contact fields table. Identity columns first under their table keys,
    // then every unlocked custom field. Locked fields are withheld
    // entirely, value and definition both — the standing doctrine: data
    // that never arrives cannot be read back to whoever is on the phone.
    //
    // contact says what IS; information says what may be WRITTEN. Empty
    // values ride along as a dash so the agent also knows what is missing.
    contact: (() => {
      const labels =
        lang === "tr"
          ? { firstname: "Ad", lastname: "Soyad", email: "E-posta" }
          : lang === "de"
            ? { firstname: "Vorname", lastname: "Nachname", email: "E-Mail" }
            : { firstname: "First name", lastname: "Last name", email: "Email" };
      const parts = [
        `${labels.firstname}: ${customer?.firstName || "-"}`,
        `${labels.lastname}: ${customer?.lastName || "-"}`,
        `${labels.email}: ${customer?.email || "-"}`,
        ...args.contactFields
          // Seen ≠ written. The card carries every field the agent may
          // KNOW: the ones it fills, plus staff-curated fields flagged
          // voiceVisible ("agent sees" without "agent fills") — a VIP note
          // it can read back but never asks about. `information` below
          // stays voice-only, because that list is the WRITE gate's public
          // face and a visible-only field must never appear writable.
          .filter((field) => field.source === "voice" || field.voiceVisible === true)
          .map((field) => `${field.label}: ${String(customer?.custom?.[field.key] ?? "") || "-"}`),
      ];
      return parts.join(", ");
    })(),
    // Identity keys drop out when the salon locked them and this caller's
    // card already has the value — the write list must match what the gate
    // will accept or the agent invents excuses. A lock stops a CHANGE, not a
    // first value (retell.applyVoiceContactValues), so while a locked column
    // is empty it stays writable. They stay on the card above either way:
    // withholding the caller's own name would break the greeting.
    information: [
      ...(["firstname", "lastname", "email"] as const).filter(
        (key) =>
          !(org.voiceLockedIdentity ?? []).includes(key) ||
          !(key === "firstname"
            ? customer?.firstName
            : key === "lastname"
              ? customer?.lastName
              : customer?.email),
      ),
      ...args.contactFields
        .filter((field) => field.source === "voice")
        .map((field) => field.key),
    ].join(", "),
    // Spoken, not written — the voice variant is read down a phone line
    // verbatim. This exact line is where Bella got "90 dk için ₺3.000":
    // "dk" was hardcoded here, and the price came from Intl with its
    // grouping separator and symbol still in. lib/speech owns the spoken
    // wording; the written style keeps the digits and the symbol, because
    // on a screen they are the clearer form.
    services: args.services
      .filter((service) => service.active)
      .map((service) => {
        // null for a good — both duration renderers refuse 0, correctly: a
        // cake has a price and no length, and "(null)" down a phone line
        // was the bug this branch exists to avoid.
        const duration =
          style === "spoken"
            ? spokenDuration(service.durationMinutes ?? 0, lang)
            : writtenDuration(service.durationMinutes ?? 0, lang);
        const price =
          service.price !== undefined && service.price !== null
            ? style === "spoken"
              ? spokenPrice(service.price, currency, lang)
              : formatMoney(service.price, currency, org.language, org.priceDecimals)
            : null;
        const parts = [duration, price].filter(Boolean);
        return parts.length
          ? `${service.name} (${parts.join(", ")})`
          : service.name;
      })
      .join("; "),
    // What the business wrote about itself (the Knowledge tab), injected at
    // ring time like everything else here so an edit reaches the very next
    // call with no republish. PLAIN TEXT by contract: knowledge.forAgent's
    // rule — whatever the editor renders, the agent reads words. Capped so
    // a thirty-block org cannot blow the provider's payload; the cut lands
    // between blocks, never mid-sentence.
    knowledge: (() => {
      const blocks = args.knowledgeRows
        .filter((row) => noteText(row.body).trim())
        .sort((a, b) => a.order - b.order);
      const parts: string[] = [];
      let budget = 8000;
      for (const block of blocks) {
        const text = `${block.title}: ${noteText(block.body).trim()}`;
        if (text.length > budget) break;
        budget -= text.length;
        parts.push(text);
      }
      return parts.join("\n");
    })(),
  };
}

// The written duration: digits and the reader's own abbreviation, no words —
// "90 dk" where the phone says "doksan dakika". Refuses 0 like spokenDuration
// so a good renders with its price alone.
function writtenDuration(
  minutes: number | null | undefined,
  language: string | null | undefined,
): string | null {
  if (!minutes || minutes <= 0) return null;
  const lang = (language ?? "").trim().toLowerCase();
  const unit = lang === "tr" ? "dk" : lang === "de" ? "Min." : "min";
  return `${minutes} ${unit}`;
}
