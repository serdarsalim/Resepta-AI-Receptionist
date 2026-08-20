// The stock wording every message starts life with, per language.
//
// A PURE module on purpose. It is read on the server (resetToDefaults writes
// it onto the kind-level fallback rows; ensureTemplate reaches for it when an
// org has no fallback row in its language) AND in the browser, where the Add
// reminder sheet shows the text you are about to get and lets you edit it
// before the rule exists. Importing convex/messageRules.ts for that would drag
// the whole server module — mutations, ctx types, the generated api — into the
// client bundle.
//
// Tokens are written in English token names ([name], [business], [date],
// [service]) — the PROSE is per language, the vocabulary never is. See
// lib/renderTokens.
//
// Every lifecycle message ends with the ACTION it is trying to cause, on its
// own line so renderTokens drops it cleanly when the org has no such link.
// The reminder carries [manage_link] because a reminder that cannot be acted
// on is how you get a no-show instead of a reschedule; the follow-up,
// win-back and cancellation carry [booking_link] because each of those is an
// invitation to the NEXT visit, and ending on "reply to us" asks the salon to
// do that work by hand (the win-back and cancellation did until 2026-08-20).
// Where the link is optional it sits as a bare paragraph after a sentence
// that stands on its own — never under a "book here:" label line, because
// renderTokens drops only the empty line itself and a label with nothing
// under it is a dangling colon.

export type TemplateKind =
  | "confirmation"
  | "reminder"
  | "winback"
  | "followup"
  | "cancellation"
  | "out_of_hours";
export const TEMPLATE_KINDS: TemplateKind[] = [
  "confirmation",
  "reminder",
  "winback",
  "followup",
  "cancellation",
  "out_of_hours",
];

export const DEFAULT_TEMPLATE_TEXTS: Record<
  string,
  Record<TemplateKind, { body: string; subject: string }>
> = {
  tr: {
    // [manage_link] on its own line, like the out_of_hours tokens: an org
    // whose deployment mints no link sends a clean message without it.
    // "alındı", not "oluşturuldu": a person took your booking, a system
    // created a record. Same message, different sender.
    confirmation: {
      body: "Merhaba [name]! [business] randevunuz [date] için alındı.\n\n[service]\n\nDeğiştirmek veya iptal etmek için:\n[manage_link]\n\nSorunuz varsa bu mesajı yanıtlamanız yeterli.",
      subject: "Randevunuz alındı",
    },
    reminder: {
      body: "Merhaba [name]! [business] randevunuzu hatırlatırız: [date].\n\n[service]\n\nDeğiştirmek veya iptal etmek için:\n[manage_link]\n\nDilerseniz bu mesajı yanıtlayabilirsiniz.",
      subject: "Randevu hatırlatması",
    },
    winback: {
      body: "Merhaba [name]! [business] olarak sizi özledik. Yeni bir randevu ayarlayalım mı?\n\n[booking_link]\n\nBu mesajı yanıtlamanız da yeterli.",
      subject: "Sizi özledik!",
    },
    followup: {
      body: "Merhaba [name]! [business] ziyaretiniz için teşekkürler. Memnun kaldıysanız bize birkaç kelime bırakır mısınız?\n\nYeni randevu için:\n[booking_link]",
      subject: "Ziyaretiniz için teşekkürler",
    },
    cancellation: {
      body: "Merhaba [name], [date] tarihli [business] randevunuz iptal edildi. Yeni bir randevu isterseniz buradayız.\n\n[booking_link]\n\nBu mesajı yanıtlamanız da yeterli.",
      subject: "Randevunuz iptal edildi",
    },
    // The two tokens sit on their own lines on purpose: renderTokens drops a
    // line that resolves to nothing, so an org with only a phone (or only a
    // link) sends a clean message instead of a dangling label.
    out_of_hours: {
      body: "Merhaba [name]! [business] şu anda kapalı.\n\nDilerseniz online randevu alabilir veya bizi arayabilirsiniz:\n[booking_link]\n[phone]\n\nAçıldığımızda size döneceğiz.",
      subject: "Şu anda kapalıyız",
    },
  },
  en: {
    confirmation: {
      body: "Hello [name]! Your appointment at [business] is booked for [date].\n\n[service]\n\nNeed to change or cancel it?\n[manage_link]\n\nAny questions? Just reply to this message.",
      subject: "Your appointment is booked",
    },
    reminder: {
      body: "Hi [name]! A reminder from [business]: your appointment is on [date].\n\n[service]\n\nNeed to reschedule or cancel?\n[manage_link]\n\nOr just reply to this message.",
      subject: "Appointment reminder",
    },
    winback: {
      body: "Hi [name]! We've missed you at [business]. Shall we set up your next visit?\n\n[booking_link]\n\nOr just reply to this message.",
      subject: "We've missed you!",
    },
    followup: {
      body: "Hi [name]! Thanks for visiting [business]. If you have a minute, we'd love a few words about how it went.\n\nReady for the next one?\n[booking_link]",
      subject: "Thanks for your visit",
    },
    cancellation: {
      body: "Hi [name], your [business] appointment on [date] has been cancelled. Want to pick a new time?\n\n[booking_link]\n\nOr just reply to this message.",
      subject: "Your appointment was cancelled",
    },
    out_of_hours: {
      body: "Hello [name]! [business] is closed right now.\n\nYou can book online or give us a call:\n[booking_link]\n[phone]\n\nWe'll get back to you as soon as we open.",
      subject: "We're currently closed",
    },
  },
  de: {
    confirmation: {
      body: "Hallo [name]! Ihr Termin bei [business] ist für [date] gebucht.\n\n[service]\n\nZum Verschieben oder Stornieren:\n[manage_link]\n\nBei Fragen antworten Sie einfach auf diese Nachricht.",
      subject: "Ihr Termin ist gebucht",
    },
    reminder: {
      body: "Hallo [name]! [business] erinnert Sie an Ihren Termin am [date].\n\n[service]\n\nZum Verschieben oder Stornieren:\n[manage_link]\n\nOder antworten Sie einfach auf diese Nachricht.",
      subject: "Terminerinnerung",
    },
    winback: {
      body: "Hallo [name]! Wir haben Sie bei [business] vermisst. Wie wäre es mit einem neuen Termin?\n\n[booking_link]\n\nOder antworten Sie einfach auf diese Nachricht.",
      subject: "Wir haben Sie vermisst!",
    },
    followup: {
      body: "Hallo [name]! Danke für Ihren Besuch bei [business]. Wenn Sie eine Minute haben, freuen wir uns über ein paar Worte.\n\nFür den nächsten Termin:\n[booking_link]",
      subject: "Danke für Ihren Besuch",
    },
    cancellation: {
      body: "Hallo [name], Ihr Termin bei [business] am [date] wurde storniert. Einen neuen finden wir jederzeit.\n\n[booking_link]\n\nOder antworten Sie einfach auf diese Nachricht.",
      subject: "Ihr Termin wurde storniert",
    },
    out_of_hours: {
      body: "Hallo [name]! [business] ist gerade geschlossen.\n\nSie können online buchen oder uns anrufen:\n[booking_link]\n[phone]\n\nWir melden uns, sobald wir geöffnet haben.",
      subject: "Wir sind derzeit geschlossen",
    },
  },
};

