// What a failed WhatsApp send MEANS, in words a business owner can read out
// to a customer (P10 of the Nudge port; Nudge's lib/waFailure.ts, 76762ef1).
//
// A failure reason is stored raw, as the lane produced it:
// `wa-cloud-http-400-131026: Message undeliverable` from a refused send
// (lib/waCloud.ts), or `wa-cloud-131026: Message undeliverable` from a
// delivery status that came back failed (webhook.ts). Printed straight that
// is our lane's name and a Meta error number, at someone who has heard of
// neither; the thread printed a bare "not sent" instead, which says nothing.
//
// Only codes we are SURE of are mapped. A guess here becomes a sentence
// somebody reads to a customer, so an unknown code keeps the plain "not sent"
// in the thread and the provider's own text in the alert.
//
// A LEAF: imports nothing, so the thread (src) and the alert mail
// (lib/alerts) read the same table.

export type WaFailureKind =
  | "not-on-whatsapp"
  | "window-closed"
  | "spam-rate-limit"
  | "rate-limit"
  | "service-down"
  | "missing-parameter"
  | "bad-value"
  | "template-params"
  | "template-missing"
  | "template-too-long"
  | "template-rejected"
  | "marketing-cap"
  | "marketing-stopped";

// Meta Cloud API error codes.
const CODES: Record<string, WaFailureKind> = {
  // The number is not on WhatsApp, or cannot receive messages at all.
  "131026": "not-on-whatsapp",
  // Outside the 24-hour window and the send was not an approved template.
  "131047": "window-closed",
  "131048": "spam-rate-limit",
  // Meta held back a marketing message so one customer does not get too
  // many from businesses ("healthy ecosystem" cap).
  "131049": "marketing-cap",
  // The customer stopped marketing messages from this business on WhatsApp.
  "131050": "marketing-stopped",
  "130429": "rate-limit",
  "131016": "service-down",
  "131008": "missing-parameter",
  "131009": "bad-value",
  "132000": "template-params",
  "132001": "template-missing",
  "132005": "template-too-long",
  "132007": "template-rejected",
  "132012": "template-params",
};

/** The Meta code in a stored reason, or null. */
export function waCloudCode(reason: string | undefined | null): string | null {
  const text = reason ?? "";
  const http = text.match(/^wa-cloud-http-\d{3}-(\d{3,6})\b/);
  if (http) return http[1];
  const status = text.match(/^wa-cloud-(\d{3,6})\b/);
  return status ? status[1] : null;
}

/** What the failure means, or null when we do not know. */
export function waFailureKind(reason: string | undefined | null): WaFailureKind | null {
  const code = waCloudCode(reason);
  return code ? (CODES[code] ?? null) : null;
}

// The same sentences for the alert mail, in the reader's language. The
// thread reads its own copies from src/lib/i18n.ts (waFail.*), typed there.
export const WA_FAILURE_SENTENCES: Record<WaFailureKind, { tr: string; en: string; de: string }> = {
  "not-on-whatsapp": {
    tr: "Bu numara WhatsApp kullanmıyor.",
    en: "This number is not on WhatsApp.",
    de: "Diese Nummer nutzt kein WhatsApp.",
  },
  "window-closed": {
    tr: "Müşterinin son mesajından bu yana 24 saat geçti; artık yalnızca onaylı şablon gönderilebilir.",
    en: "More than 24 hours since the customer last wrote; only an approved template can go now.",
    de: "Seit der letzten Nachricht des Kunden sind über 24 Stunden vergangen; jetzt geht nur eine freigegebene Vorlage.",
  },
  "spam-rate-limit": {
    tr: "WhatsApp, kısa sürede çok mesaj gittiği için bunu durdurdu. Biraz sonra yeniden deneyin.",
    en: "WhatsApp held this back because too many messages went in a short time. Try again later.",
    de: "WhatsApp hat dies zurückgehalten, weil in kurzer Zeit zu viele Nachrichten gingen. Später erneut versuchen.",
  },
  "rate-limit": {
    tr: "Gönderim sınırına ulaşıldı. Biraz sonra yeniden deneyin.",
    en: "The sending limit was reached. Try again later.",
    de: "Das Sendelimit wurde erreicht. Später erneut versuchen.",
  },
  "service-down": {
    tr: "WhatsApp şu an hizmet vermiyor. Biraz sonra yeniden deneyin.",
    en: "WhatsApp is not available right now. Try again later.",
    de: "WhatsApp ist gerade nicht erreichbar. Später erneut versuchen.",
  },
  "missing-parameter": {
    tr: "Mesajda doldurulması gereken bir alan boş kaldı.",
    en: "A field the message needs was empty.",
    de: "Ein Feld, das die Nachricht braucht, war leer.",
  },
  "bad-value": {
    tr: "Mesajdaki bir değer WhatsApp'ın kabul etmediği biçimdeydi.",
    en: "A value in the message was in a form WhatsApp does not accept.",
    de: "Ein Wert in der Nachricht hatte eine Form, die WhatsApp nicht annimmt.",
  },
  "template-params": {
    tr: "Şablonun alanları onaylanan şablonla uyuşmadı.",
    en: "The template's fields did not match the approved template.",
    de: "Die Felder passten nicht zur freigegebenen Vorlage.",
  },
  "template-missing": {
    tr: "Bu dilde onaylı bir şablon yok.",
    en: "There is no approved template in this language.",
    de: "In dieser Sprache gibt es keine freigegebene Vorlage.",
  },
  "template-too-long": {
    tr: "Mesaj, şablonun izin verdiğinden uzun.",
    en: "The message is longer than the template allows.",
    de: "Die Nachricht ist länger, als die Vorlage erlaubt.",
  },
  "template-rejected": {
    tr: "Şablon Meta tarafından onaylanmadı ya da durduruldu.",
    en: "Meta did not approve the template, or paused it.",
    de: "Meta hat die Vorlage nicht freigegeben oder pausiert.",
  },
  "marketing-cap": {
    tr: "WhatsApp, bu müşteriye yakın zamanda çok sayıda tanıtım mesajı gittiği için bunu tutmadı.",
    en: "WhatsApp held this back because the customer has had many promotional messages lately.",
    de: "WhatsApp hat dies zurückgehalten, weil der Kunde zuletzt viele Werbenachrichten bekam.",
  },
  "marketing-stopped": {
    tr: "Müşteri WhatsApp'ta bu işletmeden tanıtım mesajlarını kapattı.",
    en: "The customer turned off promotional messages from this business on WhatsApp.",
    de: "Der Kunde hat Werbenachrichten dieses Geschäfts auf WhatsApp abgeschaltet.",
  },
};
