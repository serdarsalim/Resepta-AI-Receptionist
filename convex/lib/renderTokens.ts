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
// ── ONE VOCABULARY, AND IT IS ENGLISH ───────────────────────────────────────
//
// The app ships in Turkish, English and German, and a token is stored text
// inside a message body. Making the names translate would mean a body written
// by a Turkish owner reads as a broken token the day someone switches the
// interface to English — the stored string is one string and it cannot be
// right in three languages at once.
//
// So: the CANONICAL names are English, and every surface that offers a token
// (the Insert-variable dropdown, the field hints, the stock templates) offers
// the English name in all three interfaces. What translates is the LABEL
// beside it — "Business name" / "İşletme adı" / "Betriebsname" all insert
// [business].
//
// The Turkish and German aliases below stay valid forever. They are not
// offered anywhere anymore; they exist so bodies already written with them —
// and a Turkish owner who types [ad] out of habit — keep working.

export type TokenValues = {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  // Already formatted in the org's timezone and language by lib/format.
  appointmentAt?: string;
  staffName?: string;
  // The BUSINESS's number — the enabled voice agent's inbound line, resolved
  // at send time by lib/publicPhone. Never the customer's own phone: a
  // message TO someone has no reason to tell them their number.
  phone?: string;
  email?: string;
  // orgs.bookingUrl — the org's public booking page. In every template so the
  // 2h reminder, the closed-hours reply and the winback can all say "book
  // here" without the owner pasting a URL into each one.
  bookingLink?: string;
  // THIS appointment's self-serve page (/appt/<manageToken>) — reschedule and
  // cancel without texting anyone. Only appointment-lifecycle sends can fill
  // it; everywhere else the token resolves to nothing, cleanly.
  manageLink?: string;
  // The appointment's line items, one bullet line each ("• Saç kesimi").
  serviceName?: string;
  // The same lines with each service's price appended
  // ("• Saç kesimi — ₺350,00"). Two tokens instead of a setting: the owner
  // picks the receipt look or the plain look per message.
  servicePriceList?: string;
  // The appointment's total, already formatted in the org's currency and the
  // message language ("₺410,00"). Opt-in by design: a variable the owner
  // types, never a toggle that stamps prices onto every message.
  price?: string;
  // The org's OWN vocabulary: contactFields.key → this customer's value.
  // This is what keeps tokens honest — [age] works because the Fields tab
  // says a field named `age` exists, not because this file guessed it might.
  // Callers fill EVERY org field key (empty string when the customer has no
  // value) so a real field always resolves — to nothing, cleanly — while a
  // token nobody defined stays visibly literal.
  custom?: Record<string, string>;
};

// Canonical token → the value it resolves to. Aliases map onto the same key,
// so [ad] and [firstname] are the same token and always will be.
const ALIASES: Record<string, Exclude<keyof TokenValues, "custom">> = {
  // Customer
  firstname: "firstName",
  name: "firstName",
  ad: "firstName",
  isim: "firstName",
  lastname: "lastName",
  soyad: "lastName",
  nachname: "lastName",
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
  datum: "appointmentAt",
  // People and contact
  staff: "staffName",
  personel: "staffName",
  mitarbeiter: "staffName",
  phone: "phone",
  telefon: "phone",
  email: "email",
  eposta: "email",
  "e-posta": "email",
  // Booking page. One canonical name; the second spelling is defensive, since
  // the underscore is the exact kind of detail an owner retypes wrong.
  booking_link: "bookingLink",
  bookinglink: "bookingLink",
  manage_link: "manageLink",
  managelink: "manageLink",
  // Service — the same word the voice agent's variables use, because a token
  // vocabulary that differs per screen is two vocabularies.
  service: "serviceName",
  hizmet: "serviceName",
  leistung: "serviceName",
  pricelist: "servicePriceList",
  fiyatlistesi: "servicePriceList",
  preisliste: "servicePriceList",
  // Money
  price: "price",
  fiyat: "price",
  preis: "price",
  total: "price",
  toplam: "price",
};

// Whether a [token] name is one this renderer resolves. The platform desk
// validates fleet-wide texts with it at save time: an unknown token stays
// literal at render (see below), which is the right behavior for a salon's
// typo and exactly wrong for wording that goes to every customer of every
// business.
export function isKnownToken(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALIASES, name.trim().toLowerCase());
}

// Storage form (an array, so the editor can keep row order) → lookup form.
// Blank values are dropped: an empty box means "no fallback", and keeping it
// would make the token resolve to an empty string it was already resolving to.
export function tokenDefaults(
  pairs: ReadonlyArray<{ key: string; value: string }> | undefined,
): Record<string, string> | undefined {
  if (!pairs?.length) return undefined;
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim().toLowerCase();
    const value = pair.value.trim();
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

// Render a free-text body.
//
// An unresolved token — one the writer invented, or one whose value is empty
// for this customer — renders as NOTHING rather than as itself. A customer
// receiving "Merhaba [ad]" is worse than receiving "Merhaba": the first tells
// them they are talking to broken software, the second just reads as brief.
// The whitespace cleanup below is what makes that come out as a sentence.
// `defaults` is the template's own "when empty, print…" table, keyed by the
// token as the owner typed it (waTemplates.variableDefaults). It is consulted
// ONLY after the real chain has run and only for a token this renderer
// recognises: an unknown token stays literal, so a typo stays visible rather
// than being quietly answered by a fallback the owner meant for a real field.
export function renderTokens(
  body: string,
  values: TokenValues,
  defaults?: Record<string, string>,
): string {
  const fallback = (raw: string) => defaults?.[raw]?.trim() ?? "";
  const filled = body.replace(/\[([^\]\n]{1,32})\]/g, (whole, rawName: string) => {
    const raw = rawName.trim().toLowerCase();
    const key = ALIASES[raw];
    if (key) return values[key]?.trim() || fallback(raw);
    // The org's own fields, by exact key. hasOwnProperty rather than a truthy
    // read: an empty value is a field that resolves to nothing, which is a
    // different fact from a token that is not a field at all.
    const custom = values.custom;
    if (custom && Object.prototype.hasOwnProperty.call(custom, raw)) {
      return custom[raw].trim() || fallback(raw);
    }
    return whole; // Not a token we know — leave the writer's text alone.
  });

  return (
    filled
      // A parenthetical whose token resolved to nothing is an empty "()" —
      // the stock texts put the service list in one, and an appointment
      // without line items must not advertise the fact.
      .replace(/\(\s*\)/g, "")
      // A token that resolved to nothing leaves a double space behind, and
      // "Merhaba  ," is the tell that a machine wrote this.
      .replace(/[ \t]{2,}/g, " ")
      // Same for the space now sitting in front of punctuation.
      .replace(/[ \t]+([,.!?;:])/g, "$1")
      // And for a line that is now only whitespace.
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      // A paragraph token ([hizmet] on its own line) that resolved to nothing
      // leaves two blank lines back to back; one is intentional spacing, more
      // is the hole where the list was.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// Whether a body would still say something for this customer. Used before a
// campaign send: a template that resolves to an empty string is a message
// nobody should receive, and finding that out at send time is too late.
export function rendersToSomething(body: string, values: TokenValues): boolean {
  return renderTokens(body, values).length > 0;
}
