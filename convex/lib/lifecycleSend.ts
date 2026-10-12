// What an appointment message (a confirmation, a cancellation notice) will do
// when wa.sendAppointmentMessage runs, decided by the send path's own
// predicates, so the moment a message is SCHEDULED can know what the moment
// it is SENT will decide (2026-10-13). The send path calls these same
// functions to choose its branches, so the two cannot drift apart.
//
// Why it exists: the chat assistant stays quiet when the business's own
// confirmation is on its way (chatAgent's automationAnswered), and the phone
// agent tells the caller a message will follow. Both used to read a count of
// SCHEDULED messages, and a scheduled message can still fail at send time for
// reasons visible in advance: no consent, a Cloud template not approved in
// the customer's language, no WhatsApp connected, no words for the shop
// phone, an email-only rule. The customer then heard nothing from anyone.

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isDemo } from "../demo";
import { isDeleting } from "./customerDeletion";
import { customerSender, emailLaneConfigured } from "./email";
import { emailConfig, resolveWaAccount } from "./platformConfig";
import {
  laneAvailability,
  laneForOutbound,
  loadEvolutionCreds,
  type WaLane,
} from "./waLane";

type Channel = "whatsapp" | "email" | "both";

type TemplateRow = {
  ruleId?: string;
  kind: string;
  language: string;
  status?: string;
  metaName?: string;
  body?: string;
  bodyPreview?: string;
};

// Which template rows a send uses, for one kind in one language. The rule's
// own wording first, the kind-level row for anything not worded per rule. No
// cross-language fallback: the wrong language is worse than none.
//
// `registered` (the Cloud lane's Meta template) resolves SEPARATELY and falls
// back to the kind-level row: wording a rule specifically must not cut off a
// Cloud lane that was sending fine on the shared approved template. Cloud
// needs both halves of the registration, the approval and the name.
export function lifecycleTemplates<T extends TemplateRow>(
  templates: readonly T[],
  rule: { _id: string } | null | undefined,
  kind: string,
  language: string,
): { content: T | undefined; registered: (T & { metaName: string }) | undefined } {
  const ruleTemplate = rule
    ? templates.find((row) => row.ruleId === rule._id && row.language === language)
    : undefined;
  const kindTemplate = templates.find(
    (row) => row.ruleId === undefined && row.kind === kind && row.language === language,
  );
  const metaSource =
    ruleTemplate && ruleTemplate.status === "approved" && ruleTemplate.metaName
      ? ruleTemplate
      : kindTemplate;
  return {
    content: ruleTemplate ?? kindTemplate,
    registered:
      metaSource && metaSource.status === "approved" && metaSource.metaName
        ? (metaSource as T & { metaName: string })
        : undefined,
  };
}

// The WhatsApp half of a send.
export type WhatsAppVerdict =
  | { send: WaLane }
  // Nothing goes on WhatsApp. `reason` is the failure row the send logs,
  // absent when WhatsApp is simply not in play (an email-only rule, or a
  // business that never connected WhatsApp). `stop` ends the whole send,
  // email included.
  | { send: null; reason?: string; stop?: boolean };

export function whatsappVerdict(a: {
  channel: Channel;
  // The lane a business-initiated send takes (laneForOutbound), null for an
  // email-only rule.
  lane: WaLane | null;
  // A Cloud account that can authenticate (resolveWaAccount).
  cloud: boolean;
  // Shop-phone credentials behind the instance (loadEvolutionCreds).
  evolution: boolean;
  // The content row has words to send as they are (shop phone, email).
  hasWords: boolean;
  // An approved, named Meta template for this language.
  registered: boolean;
  language: string;
}): WhatsAppVerdict {
  if (a.lane === "evolution" && a.evolution) {
    // No approval to satisfy on the shop phone, but it needs words: a row
    // nobody authored once sent the customer the string "undefined".
    return a.hasWords
      ? { send: "evolution" }
      : { send: null, reason: `no-template-text-${a.language}`, stop: true };
  }
  // Switched off, or never connected: not a failure of anything.
  if (a.channel === "email") return { send: null };
  if (!a.cloud && !a.evolution) return { send: null };
  if (!a.cloud) return { send: null, reason: "wa-not-configured" };
  if (!a.registered) return { send: null, reason: `no-approved-template-${a.language}` };
  return { send: "cloud" };
}

// The email half of a send. On "both", a customer email cannot reach is
// skipped silently (WhatsApp carried it or logged its own failure); on
// email-only every reason nothing went out is a visible row.
export function emailVerdict(a: {
  channel: Channel;
  configured: boolean;
  sender: boolean;
  address: boolean;
  hasWords: boolean;
  language: string;
}): { send: boolean; reason?: string } {
  if (a.channel === "whatsapp") return { send: false };
  if (a.channel === "email" && (!a.configured || !a.sender)) {
    return { send: false, reason: "email-not-configured" };
  }
  if (a.channel === "email" && !a.address) return { send: false, reason: "no-email-address" };
  if (a.channel === "email" && !a.hasWords) {
    return { send: false, reason: `no-template-text-${a.language}` };
  }
  return { send: a.configured && a.address && a.sender && a.hasWords };
}

const OPEN: Doc<"appointments">["status"][] = ["scheduled", "confirmed"];

// Whether the message the business's own rules just scheduled about this
// appointment will reach its customer, judged per live rule on the trigger
// the way the send will judge it: on WhatsApp (`whatsapp`, the conversation
// the chat assistant is in), or on any channel (`any`, what the phone agent
// may promise). A provider can still refuse at send time; this answers
// everything that is already knowable.
export async function lifecycleReaches(
  ctx: QueryCtx,
  appointmentId: Id<"appointments">,
  trigger: "booking" | "cancellation",
  where: "whatsapp" | "any",
): Promise<boolean> {
  const appointment = await ctx.db.get(appointmentId);
  if (!appointment) return false;
  const [org, customer] = await Promise.all([
    ctx.db.get(appointment.orgId),
    ctx.db.get(appointment.customerId),
  ]);
  if (!org || !customer || customer.orgId !== org._id || isDeleting(customer)) {
    return false;
  }
  const kind = trigger === "booking" ? "confirmation" : "cancellation";
  // The send's status gate: a confirmation about an open appointment, a
  // cancellation notice about a cancelled one.
  if (
    kind === "confirmation"
      ? !OPEN.includes(appointment.status)
      : appointment.status !== "cancelled"
  ) {
    return false;
  }
  const rules = (
    await ctx.db
      .query("messageRules")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect()
  ).filter((rule) => rule.trigger === trigger && !rule.paused);
  if (rules.length === 0) return false;
  // The gates every channel shares, in the send's order: a suspended
  // business sends nothing, and KVKK consent gates every channel.
  if ((org.status ?? "active") === "suspended") return false;
  if (customer.consentAt === undefined) return false;
  // The showroom simulates every send into the thread.
  if (isDemo(org)) return true;
  const [account, templates, evolution, mail] = await Promise.all([
    ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .unique()
      .then((row) => resolveWaAccount(ctx, row)),
    ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect(),
    loadEvolutionCreds(ctx, org._id, org.evolutionInstance),
    emailConfig(ctx),
  ]);
  const available = laneAvailability({
    org,
    waAccount: account,
    evolutionConfigured: Boolean(evolution),
  });
  const language = customer.language ?? org.language;
  for (const rule of rules) {
    const channel: Channel = rule.channel ?? org.messageChannel ?? "both";
    const { content, registered } = lifecycleTemplates(templates, rule, kind, language);
    const hasWords = Boolean(content?.body?.trim() || content?.bodyPreview?.trim());
    const onWhatsApp = whatsappVerdict({
      channel,
      lane: channel === "email" ? null : laneForOutbound(available),
      cloud: Boolean(account),
      evolution: Boolean(evolution),
      hasWords,
      registered: Boolean(registered),
      language,
    });
    if (onWhatsApp.send) return true;
    if (where === "any" && !onWhatsApp.stop) {
      const byEmail = emailVerdict({
        channel,
        configured: emailLaneConfigured(mail),
        sender: Boolean(customerSender(org, mail)),
        address: Boolean(customer.email),
        hasWords,
        language,
      });
      if (byEmail.send) return true;
    }
  }
  return false;
}
