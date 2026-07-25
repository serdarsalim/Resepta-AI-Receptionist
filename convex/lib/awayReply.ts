// The out-of-hours WhatsApp auto-reply. Meta's own Business app ships this as
// "away message", which is how standard it is; a salon customer who writes at
// 23:00 should not get silence.
//
// What is hardcoded here and what is not, deliberately:
//   - the SENTENCE SHAPE is code, in three languages, so a salon does not have
//     to write Turkish and German copy to serve Turkish and German customers.
//   - every VALUE is org data: business name, booking link, phone, opening
//     hours, the toggle, and an optional full override of the text.
// If you find yourself adding a literal salon name, URL, or number below, that
// is the bug this comment exists to prevent.
//
// This is free-form session text, NOT a Meta template — allowed only because
// the customer just messaged us, which opens the 24h window. Nothing here can
// start a conversation; a cold "we're open, book here" needs an approved
// template and belongs nowhere near this file.

type ReplyLanguage = "tr" | "en" | "de";

function resolveLanguage(raw: string | undefined): ReplyLanguage {
  const short = (raw ?? "").slice(0, 2).toLowerCase();
  return short === "tr" || short === "en" || short === "de" ? short : "en";
}

// Turkish is siz-form with real diacritics, German is Sie-form — same house
// rules as lib/alerts.ts and src/lib/i18n.ts.
const COPY: Record<
  ReplyLanguage,
  {
    closed: (business: string) => string;
    withLink: (url: string) => string;
    withPhone: (phone: string) => string;
    fallback: string;
  }
> = {
  tr: {
    closed: (business) => `Merhaba, ${business} şu anda kapalı.`,
    withLink: (url) => `Randevu almak için: ${url}`,
    withPhone: (phone) => `Dilerseniz ${phone} numaralı telefondan da ulaşabilirsiniz.`,
    fallback: "Açıldığımızda size döneceğiz.",
  },
  en: {
    closed: (business) => `Hello — ${business} is closed right now.`,
    withLink: (url) => `You can book here: ${url}`,
    withPhone: (phone) => `Or call us on ${phone}.`,
    fallback: "We'll get back to you when we open.",
  },
  de: {
    closed: (business) => `Hallo — ${business} ist gerade geschlossen.`,
    withLink: (url) => `Hier können Sie einen Termin buchen: ${url}`,
    withPhone: (phone) => `Oder rufen Sie uns an: ${phone}.`,
    fallback: "Wir melden uns, sobald wir geöffnet haben.",
  },
};

// Returns null when there is nothing useful to say — no link and no phone means
// the message would be "we're closed" and nothing else, which is worse than the
// owner simply seeing the notification and replying in the morning.
export function awayReplyText(args: {
  businessName: string;
  bookingUrl?: string;
  publicPhone?: string;
  // customers.language ?? orgs.language — the customer's, not the salon's.
  language?: string;
  // The org's own wording, used verbatim when set.
  override?: string;
}): string | null {
  const override = args.override?.trim();
  if (override) return override;

  const copy = COPY[resolveLanguage(args.language)];
  const url = args.bookingUrl?.trim();
  const phone = args.publicPhone?.trim();
  if (!url && !phone) return null;

  const lines = [copy.closed(args.businessName)];
  // Link first: it works at 23:00 and cal.com takes it from there. The phone
  // number is the second option, not the first.
  if (url) lines.push(copy.withLink(url));
  if (phone) lines.push(copy.withPhone(phone));
  if (!url) lines.push(copy.fallback);
  return lines.join("\n\n");
}
