// Turning a template the salon WROTE into one Meta will review.
//
// The two formats disagree on everything that matters. The salon writes named
// tokens in their own language ("Merhaba [name], [business] randevunuz [date]
// tarihinde"), because that is the vocabulary every other surface in the app
// speaks. Meta wants positional placeholders ({{1}}, {{2}}, {{3}}), a worked
// example for each one, a slug for a name, and its own language code.
//
// A pure module: the submit action calls it, and the UI calls it to show what
// is about to be sent before anyone commits to a review that takes a day.

// The canonical token keys renderTokens resolves, keyed by every spelling an
// owner might have typed. Deliberately a SUBSET of lib/renderTokens' ALIASES —
// see UNSENDABLE below for what is missing and why.
const TOKEN_KEYS: Record<string, string> = {
  firstname: "firstName",
  name: "firstName",
  ad: "firstName",
  isim: "firstName",
  lastname: "lastName",
  soyad: "lastName",
  nachname: "lastName",
  business: "businessName",
  isletme: "businessName",
  "işletme": "businessName",
  betrieb: "businessName",
  date: "appointmentAt",
  datetime: "appointmentAt",
  tarih: "appointmentAt",
  termin: "appointmentAt",
  datum: "appointmentAt",
  staff: "staffName",
  personel: "staffName",
  mitarbeiter: "staffName",
  phone: "phone",
  telefon: "phone",
  email: "email",
  eposta: "email",
  "e-posta": "email",
  price: "price",
  fiyat: "price",
  preis: "price",
};

// Tokens that CANNOT be a template parameter, whatever they mean locally.
//
// Meta rejects a body parameter containing a newline or four consecutive
// spaces (error 132000), and every one of these renders as a multi-line block:
// [service] is a bulleted list of what was booked, [pricelist] is a receipt.
// A link is worse than rejected — it is silently stripped by review.
//
// They stay perfectly usable in the SAME body on the Evolution and email
// lanes, which have no approval and no parameter rules. This list is about the
// Cloud template lane alone, which is why it lives here and not in
// renderTokens.
export const UNSENDABLE = new Set([
  "service",
  "hizmet",
  "leistung",
  "pricelist",
  "fiyatlistesi",
  "booking_link",
  "bookinglink",
  "manage_link",
  "managelink",
]);

// What Meta shows its reviewer in place of each variable. A review reads the
// example, not the code, so "Mary" earns an approval where "example" invites a
// question about what the message actually says.
const EXAMPLES: Record<string, string> = {
  firstName: "Ayşe",
  lastName: "Yılmaz",
  businessName: "Studio Bella",
  appointmentAt: "14 Mart Cuma 15:30",
  staffName: "Elif",
  phone: "+90 212 000 00 00",
  email: "ayse@ornek.com",
  price: "₺450,00",
};

export type PositionalBody = {
  // The body as Meta will store it, with {{1}}..{{n}}.
  text: string;
  // The canonical token key behind each placeholder, in order. THIS is the
  // contract the send path replays — {{2}} means whatever variables[1] says it
  // means, not "the business name" by convention.
  variables: string[];
  // Tokens found in the body that cannot be parameters. Non-empty means the
  // submission is refused, with these named.
  rejected: string[];
};

// One token → one placeholder, and the SAME token used twice gets the SAME
// number. Meta counts distinct placeholders, so "[name]… [name]" as {{1}} and
// {{2}} would demand two parameters for one fact and read, to a reviewer, like
// a template that cannot decide what it is saying.
export function toPositionalBody(body: string): PositionalBody {
  const variables: string[] = [];
  const rejected: string[] = [];
  const text = body.replace(/\[([^\]\n]{1,32})\]/g, (whole, rawName: string) => {
    const raw = rawName.trim().toLowerCase();
    if (UNSENDABLE.has(raw)) {
      if (!rejected.includes(raw)) rejected.push(raw);
      return whole;
    }
    const key = TOKEN_KEYS[raw];
    // Not a token we know: a custom contact field, or a typo. Either way it is
    // left literal — exactly what renderTokens does with it — because turning
    // an owner's typo into a parameter would approve a template with a hole in
    // it that nothing will ever fill.
    if (!key) return whole;
    const at = variables.indexOf(key);
    if (at >= 0) return `{{${at + 1}}}`;
    variables.push(key);
    return `{{${variables.length}}}`;
  });
  return { text, variables, rejected };
}

// The example row Meta requires beside the body: one worked value per
// placeholder, in placeholder order.
export function examplesFor(variables: string[]): string[] {
  return variables.map((key) => EXAMPLES[key] ?? "örnek");
}

// A Meta template name: lowercase, digits and underscores, 512 max. Built from
// the kind and language rather than from anything the owner typed, because the
// name is an identifier the send path looks up by — not a label anybody reads.
export function metaNameFor(kind: string, language: string): string {
  return `${kind}_${language}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 512);
}

// Our language column → Meta's code. Meta wants a locale for some languages
// and a bare code for others, and getting it wrong creates a SECOND template
// rather than failing, which is the kind of mistake you find weeks later with
// two half-approved copies on the WABA.
const META_LANGUAGES: Record<string, string> = {
  tr: "tr",
  en: "en",
  de: "de",
};

export function metaLanguageFor(language: string): string | null {
  return META_LANGUAGES[language.trim().toLowerCase()] ?? null;
}

// Meta's status vocabulary is wider than ours and mostly says the same three
// things. APPROVED sends; anything terminal does not and needs a human;
// everything else is still in flight.
//
// Normalising rather than widening the column is deliberate: `status ===
// "approved"` gates every Cloud send in wa.ts, and a fifth value would have to
// be handled correctly in each place that reads it or a template would quietly
// become unsendable. The raw word is kept beside it for display.
export function normalizeMetaStatus(
  raw: string,
): "pending" | "approved" | "rejected" {
  const status = raw.trim().toUpperCase();
  if (status === "APPROVED") return "approved";
  if (
    status === "REJECTED" ||
    status === "DISABLED" ||
    status === "DELETED" ||
    status === "PAUSED" ||
    status === "LIMIT_EXCEEDED"
  ) {
    return "rejected";
  }
  return "pending";
}

// The Cloud lane's OWN wording for the lifecycle kinds — what actually gets
// registered at Meta, regardless of what the row's rich body says.
//
// Two facts make this split correct rather than sneaky. First, Meta sends ITS
// stored text: the row's body is only ever raw material for registration, so
// the Cloud template and the rich body were always allowed to differ — the
// send fills metaParams into Meta's copy. Second, the rich bodies carry
// [service] and [manage_link], which the Cloud lane cannot register (UNSENDABLE
// above) — and does not need: every lifecycle template already declares the
// confirm/cancel quick replies (buttonsFor), which are the manage link's job
// in button form. The rich body keeps serving Evolution and email untouched.
//
// Platform-owned by decision (Serdar, 2026-08-26): salons do not edit the
// Cloud wording, the operator approves this exact set from /admin, and custom
// per-salon templates are a later feature. One text per kind per language,
// here, is the whole registry.
export const CLOUD_TEMPLATE_TEXTS: Record<
  string,
  Record<string, string>
> = {
  tr: {
    confirmation:
      "Merhaba [name]! [business] randevunuz [date] için alındı.\n\nSorunuz varsa bu mesajı yanıtlamanız yeterli.",
    reminder:
      "Merhaba [name]! [business] randevunuzu hatırlatırız: [date].\n\nDeğişiklik için bu mesajı yanıtlayabilirsiniz.",
    winback:
      "Merhaba [name]! [business] olarak sizi özledik. Yeni bir randevu ayarlayalım mı?\n\nBu mesajı yanıtlamanız yeterli.",
    followup:
      "Merhaba [name]! [business] ziyaretiniz için teşekkürler. Memnun kaldıysanız bize birkaç kelime bırakır mısınız?",
    cancellation:
      "Merhaba [name], [date] tarihli [business] randevunuz iptal edildi. Yeni bir randevu isterseniz bu mesajı yanıtlamanız yeterli.",
  },
  en: {
    confirmation:
      "Hello [name]! Your appointment at [business] is booked for [date].\n\nAny questions? Just reply to this message.",
    reminder:
      "Hi [name]! A reminder from [business]: your appointment is on [date].\n\nNeed a change? Just reply to this message.",
    winback:
      "Hi [name]! We've missed you at [business]. Shall we set up your next visit?\n\nJust reply to this message.",
    followup:
      "Hi [name]! Thanks for visiting [business]. If you have a minute, we'd love a few words about how it went.",
    cancellation:
      "Hi [name], your [business] appointment on [date] has been cancelled. Want a new time? Just reply to this message.",
  },
  de: {
    confirmation:
      "Hallo [name]! Ihr Termin bei [business] ist für [date] gebucht.\n\nBei Fragen antworten Sie einfach auf diese Nachricht.",
    reminder:
      "Hallo [name]! [business] erinnert Sie an Ihren Termin am [date].\n\nFür Änderungen antworten Sie einfach auf diese Nachricht.",
    winback:
      "Hallo [name]! Wir haben Sie bei [business] vermisst. Wie wäre es mit einem neuen Termin?\n\nAntworten Sie einfach auf diese Nachricht.",
    followup:
      "Hallo [name]! Danke für Ihren Besuch bei [business]. Wenn Sie eine Minute haben, freuen wir uns über ein paar Worte.",
    cancellation:
      "Hallo [name], Ihr Termin bei [business] am [date] wurde storniert. Einen neuen finden wir jederzeit — antworten Sie einfach auf diese Nachricht.",
  },
};

export function cloudBodyFor(kind: string, language: string): string | null {
  return CLOUD_TEMPLATE_TEXTS[language.trim().toLowerCase()]?.[kind] ?? null;
}

// Which Meta category a kind belongs in.
//
// Appointment messages are UTILITY: they are about a transaction the customer
// already entered into, which is both true and the category with the cheaper
// rate and the easier review. The win-back and campaigns are MARKETING and
// saying otherwise is how a WABA gets its templates pulled — Meta
// recategorises what it disagrees with, and a business that keeps
// mislabelling marketing as utility does not stay in good standing.
export function categoryFor(kind: string): "UTILITY" | "MARKETING" {
  return kind === "winback" || kind === "campaign" ? "MARKETING" : "UTILITY";
}

// Does this kind's send attach confirm/cancel quick replies?
//
// wa.sendAppointmentMessage passes two buttons on every appointment-lifecycle
// send, and Meta rejects a send whose button components the approved template
// does not declare. So the submission has to declare exactly what the send
// will pass — this function is the single answer both sides read.
export function buttonsFor(kind: string): boolean {
  return (
    kind === "confirmation" ||
    kind === "reminder" ||
    kind === "followup" ||
    kind === "cancellation" ||
    kind === "winback"
  );
}

// The quick-reply labels, in the language the template is written in. Index 0
// is confirm and index 1 is cancel, matching the payload order the send uses
// and the confirm:/cancel: prefixes webhook.ts parses back.
const BUTTON_LABELS: Record<string, [string, string]> = {
  tr: ["Onaylıyorum", "İptal ediyorum"],
  en: ["Confirm", "Cancel"],
  de: ["Bestätigen", "Absagen"],
};

export function buttonLabelsFor(language: string): [string, string] {
  return BUTTON_LABELS[language.trim().toLowerCase()] ?? BUTTON_LABELS.en;
}

// The whole components array Meta's create endpoint wants.
export function componentsFor(args: {
  kind: string;
  language: string;
  text: string;
  variables: string[];
  // Overrides the per-token examples. The campaign wrapper needs them: {{3}}
  // is a whole promotional message, and "örnek" in that slot tells a reviewer
  // nothing about what the business intends to send.
  examples?: string[];
}): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: args.text,
      ...(args.variables.length
        ? {
            example: {
              body_text: [args.examples ?? examplesFor(args.variables)],
            },
          }
        : {}),
    },
  ];
  if (buttonsFor(args.kind)) {
    const [confirm, cancel] = buttonLabelsFor(args.language);
    components.push({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: confirm },
        { type: "QUICK_REPLY", text: cancel },
      ],
    });
  }
  return components;
}

// The owner's "when empty, print…" value for a canonical token key.
//
// waTemplates.variableDefaults is keyed by the token AS THE OWNER TYPED IT
// ("ad", "personel"), because that is the box they filled in beside their own
// sentence. metaParams is keyed canonically ("firstName", "staffName"),
// because that is what the send resolves against. So the two do not meet
// without this: every spelling that maps to the key, tried in turn.
//
// It matters more than it looks. Meta rejects an EMPTY body parameter and
// fails the whole send, so this is the difference between a reminder going out
// with the owner's chosen wording in the hole and no reminder at all.
export function defaultForKey(
  key: string,
  defaults: Record<string, string> | undefined,
): string {
  if (!defaults) return "";
  for (const [raw, canonical] of Object.entries(TOKEN_KEYS)) {
    if (canonical !== key) continue;
    const value = defaults[raw]?.trim();
    if (value) return value;
  }
  return "";
}

// The campaign template is a WRAPPER, not the salon's wording.
//
// convex/campaigns.ts sends [firstName, orgName, line] as {{1}}/{{2}}/{{3}},
// where {{3}} is the whole message the owner typed for that run. That is the
// design, and it is what makes ONE approved template serve every campaign they
// will ever send — so its Meta body cannot come from toPositionalBody, which
// would read whatever tokens happen to be in the row and produce a template
// the campaign send does not fill.
//
// CAVEAT worth knowing before a campaign fails at 2am: Meta rejects a body
// parameter containing a newline, and {{3}} is a whole message. A campaign
// written as one paragraph sends; one written with line breaks is refused by
// Meta with error 132000. That is a property of the campaign design, not of
// this submission — see the note in convex/campaigns.ts.
const CAMPAIGN_BODIES: Record<string, string> = {
  tr: "Merhaba {{1}},\n\n{{3}}\n\n{{2}}",
  en: "Hello {{1}},\n\n{{3}}\n\n{{2}}",
  de: "Hallo {{1}},\n\n{{3}}\n\n{{2}}",
};

export const CAMPAIGN_PARAMS = ["firstName", "businessName", "campaignLine"];

export function campaignBodyFor(language: string): string | null {
  return CAMPAIGN_BODIES[language.trim().toLowerCase()] ?? null;
}

// The example row for the campaign wrapper. {{3}} gets a plausible promo line
// rather than "örnek", because a reviewer reading "example" in the slot that
// carries the whole message has no idea what the business intends to send.
export const CAMPAIGN_EXAMPLES: Record<string, string[]> = {
  tr: ["Ayşe", "Studio Bella", "Bu hafta tüm saç bakımlarında %20 indirim var."],
  en: ["Ayşe", "Studio Bella", "20% off every hair treatment this week."],
  de: ["Ayşe", "Studio Bella", "Diese Woche 20% auf alle Haarbehandlungen."],
};
