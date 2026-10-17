// The out-of-hours reply's WORDS. Meta's own Business app ships this as "away
// message", which is how standard it is; a salon customer who writes at 23:00
// should not get silence.
//
// Content comes from the same engine as every other automated message now: the
// out_of_hours rule's own waTemplates row first, the kind-level fallback row
// second, the stock text in messageRules.DEFAULT_TEMPLATE_TEXTS last. This
// file only RESOLVES and RENDERS — who may send, on which channel, and how
// often is the callers' business (webhook.ts for WhatsApp, email.ts for mail),
// because the throttle stamps live where the inbound lands.
//
// On WhatsApp this is free-form session text, NOT a Meta template — allowed
// only because the customer just messaged us, which opens the 24h window.
// Nothing here can start a conversation; a cold "we're open, book here" needs
// an approved template and belongs nowhere near this file.

import type { Doc, Id } from "../_generated/dataModel";
import { DEFAULT_TEMPLATE_TEXTS } from "./templateTexts";
import { renderTokens, tokenDefaults } from "./renderTokens";

// The same exact-language match as wa.sendAppointmentMessage — the customer's
// language, falling back to the org's, and stock text has to cover whatever
// that resolves to.
function resolveLanguage(raw: string | undefined): string {
  const short = (raw ?? "").slice(0, 2).toLowerCase();
  return short || "en";
}

export type OutOfHoursTemplate = Pick<
  Doc<"waTemplates">,
  | "ruleId"
  | "kind"
  | "language"
  | "body"
  | "bodyHtml"
  | "subject"
  | "variableDefaults"
>;

// Returns null when there is nothing useful to say: no authored wording, and
// neither a booking link nor a phone to offer — the stock text would then be
// "we're closed" and a dangling label, which is worse than the owner simply
// seeing the notification and replying in the morning. A rendered body that
// comes out empty is null for the same reason.
export function outOfHoursMessage(args: {
  templates: OutOfHoursTemplate[];
  ruleId: Id<"messageRules">;
  org: { name: string; bookingUrl?: string; publicPhone?: string; address?: string };
  // customers.language ?? orgs.language — the customer's, not the salon's.
  language?: string;
  // Absent for a customer we know nothing about beyond an address or number;
  // renderTokens drops the token rather than printing it.
  firstName?: string;
  lastName?: string;
  // contactFields keys → this customer's values, so an owner who wrote
  // [hair_type] into their closed-hours wording resolves like anywhere else.
  custom?: Record<string, string>;
}): { body: string; subject: string; bodyHtml?: string } | null {
  const language = resolveLanguage(args.language);
  const ruleTemplate = args.templates.find(
    (t) => t.ruleId === args.ruleId && t.language === language,
  );
  const kindTemplate = args.templates.find(
    (t) =>
      t.ruleId === undefined && t.kind === "out_of_hours" && t.language === language,
  );
  const authored = ruleTemplate ?? kindTemplate;
  const stock = (DEFAULT_TEMPLATE_TEXTS[language] ?? DEFAULT_TEMPLATE_TEXTS.en)
    .out_of_hours;

  const bookingLink = args.org.bookingUrl?.trim() || undefined;
  const phone = args.org.publicPhone?.trim() || undefined;
  // Stock wording exists to hand over the link or the number; with neither
  // configured it has nothing to hand over. An owner's OWN wording is sent on
  // its own authority — they wrote it, they meant it.
  if (!authored?.body && !bookingLink && !phone) return null;

  const values = {
    firstName: args.firstName,
    lastName: args.lastName,
    businessName: args.org.name,
    phone,
    bookingLink,
    address: args.org.address,
    custom: args.custom,
  };
  // Only the AUTHORED text carries defaults; the stock copy is ours and has
  // no editor behind it to have set any.
  const defaults = tokenDefaults(authored?.variableDefaults);
  const body = renderTokens(authored?.body ?? stock.body, values, defaults);
  if (!body) return null;
  const subject =
    renderTokens(authored?.subject ?? stock.subject, values, defaults) || args.org.name;
  const bodyHtml = authored?.bodyHtml
    ? renderTokens(authored.bodyHtml, values, defaults)
    : undefined;
  return { body, subject, bodyHtml: bodyHtml || undefined };
}
