// Personalising the messages Meta does NOT constrain.
//
// ── TWO KINDS OF TEMPLATE, DON'T CONFUSE THEM ───────────────────────────────
//
// A business-initiated WhatsApp send rides a Meta-approved template message,
// whose body is registered with Meta and filled by POSITION: {{1}} customer
// first name, {{2}} business name, {{3}} appointment date+time. That
// convention is fixed, it is documented in AGENTS.md, and nothing in this file
// touches it. Meta approved that exact string; we do not get to rewrite it.
//
// Everything else the salon writes is free text — an away-reply, an email
// body, a message typed into the composer, a campaign. Those are ours, and
// {{1}} is a terrible thing to ask a salon owner to remember. So they get
// NAMED tokens instead: "Merhaba [ad], [isletme] olarak..." reads as the
// sentence it will become.
//
// ── WHY THE TOKENS ARE ENGLISH-ISH BUT AI ALIASED ───────────────────────────
//
// The app ships in Turkish, English and German, and a token is typed by a
// human. Making the token names translate would mean a template written by a
// Turkish owner breaks the day someone switches the interface to English —
// the stored text is one string and it cannot be right in three languages at
// once. So the canonical names are stable and each has aliases, including the
// Turkish ones, because that is what a Turkish salon owner will actually type.

export type TokenValues = {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  // Already formatted in the org's timezone and language by lib/format.
  appointmentAt?: string;
  staffName?: string;
  phone?: string;
  // The appointment's line items, joined for display ("Saç kesimi, Fön").
  serviceName?: string;
};

// Canonical token → the value it resolves to. Aliases map onto the same key,
// so [ad] and [firstname] are the same token and always will be.
const ALIASES: Record<string, keyof TokenValues> = {
  // Customer
  firstname: "firstName",
  name: "firstName",
  ad: "firstName",
  isim: "firstName",
  lastname: "lastName",
  soyad: "lastName",
  // Business
  business: "businessName",
  isletme: "businessName",
  "işletme": "businessName",
  betrieb: "businessName",
  // Appointment
  date: "appointmentAt",
  datetime: "appointmentAt",
  tarih: "appointmentAt",
  termin: "appointmentAt",
  // People and contact
  staff: "staffName",
  personel: "staffName",
  phone: "phone",
  telefon: "phone",
  // Service — the same word the voice agent's variables use, because a token
  // vocabulary that differs per screen is two vocabularies.
  service: "serviceName",
  hizmet: "serviceName",
  leistung: "serviceName",
};

// What the editor offers. Ordered by how often a salon actually reaches for
// them, not alphabetically — the first two are ninety percent of real use.
export const TOKEN_HINTS = [
  "[ad]",
  "[isletme]",
  "[tarih]",
  "[hizmet]",
  "[soyad]",
  "[personel]",
  "[telefon]",
] as const;

// Render a free-text body.
//
// An unresolved token — one the writer invented, or one whose value is empty
// for this customer — renders as NOTHING rather than as itself. A customer
// receiving "Merhaba [ad]" is worse than receiving "Merhaba": the first tells
// them they are talking to broken software, the second just reads as brief.
// The whitespace cleanup below is what makes that come out as a sentence.
export function renderTokens(body: string, values: TokenValues): string {
  const filled = body.replace(/\[([^\]\n]{1,24})\]/g, (whole, rawName: string) => {
    const key = ALIASES[rawName.trim().toLowerCase()];
    if (!key) return whole; // Not a token we know — leave the writer's text alone.
    return values[key]?.trim() ?? "";
  });

  return (
    filled
      // A token that resolved to nothing leaves a double space behind, and
      // "Merhaba  ," is the tell that a machine wrote this.
      .replace(/[ \t]{2,}/g, " ")
      // Same for the space now sitting in front of punctuation.
      .replace(/[ \t]+([,.!?;:])/g, "$1")
      // And for a line that is now only whitespace.
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim()
  );
}

// Whether a body would still say something for this customer. Used before a
// campaign send: a template that resolves to an empty string is a message
// nobody should receive, and finding that out at send time is too late.
export function rendersToSomething(body: string, values: TokenValues): boolean {
  return renderTokens(body, values).length > 0;
}
