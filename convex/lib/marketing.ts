// Marketing, and the one switch that stops it (2026-10-21).
//
// MARKETING is the business starting a conversation to sell: a campaign, a
// bulk run (message or call) and a win-back. Everything else it sends is
// about a booking the customer made or a message they wrote, and reaches
// every customer: confirmations, reminders, follow-ups, cancellation notices,
// the away reply, the assistants' answers, and whatever a person writes in
// the composer.
//
// There is no consent gate in front of any of it any more. customers.consentAt
// gated every channel until 2026-10-21, when Serdar removed it: every customer
// a business reaches out to has already agreed to hear from it, so the switch
// mostly stopped reminders reaching people added by hand or imported.
// Recording marketing consent where the law asks for it (İYS in Türkiye) is
// the business's own duty; Resepta does not keep that record.
//
// What stops marketing is Unsubscribe, the customer's request or the record's
// switch, on every channel: customers.marketingEmailOptOutAt, named for the
// email link that set it first. Read it through isUnsubscribed, never the
// field: the name still says email, the rule is every channel.

import type { Doc } from "../_generated/dataModel";
import { isMarketingEmailKind } from "./email";

export function isUnsubscribed(customer: Pick<Doc<"customers">, "marketingEmailOptOutAt">): boolean {
  return customer.marketingEmailOptOutAt !== undefined;
}

// The WhatsApp rows that are marketing, by message kind: the kind is the one
// fact every send path has on the row, the first attempt, the retry queue and
// the claim alike. Email's own set lives in lib/email, because it also
// decides the unsubscribe link and headers a mail carries.
const MARKETING_WHATSAPP_KINDS: ReadonlySet<string> = new Set([
  "campaign",
  "bulk",
  "winback",
]);

export function isMarketingKind(kind: string): boolean {
  return MARKETING_WHATSAPP_KINDS.has(kind) || isMarketingEmailKind(kind);
}
