// Appointment date+time as it appears inside WhatsApp messages ({{3}} in the
// template convention). Formatted in the ORG's timezone and the message
// language — the customer reads "23 Temmuz Perşembe 14:30", never UTC ms.

const LOCALE_BY_LANGUAGE: Record<string, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
};

export function formatAppointmentTime(
  startAt: number,
  timezone: string,
  language: string,
): string {
  const locale = LOCALE_BY_LANGUAGE[language] ?? language;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(startAt));
  } catch {
    // Unknown zone/locale: an ISO stamp beats a crashed reminder send.
    return new Date(startAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}
