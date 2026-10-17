// iCalendar invites for appointment mail. An .ics attachment with
// METHOD:REQUEST is what makes Gmail, Apple Mail and Outlook offer the event
// as a real calendar entry — no provider API, no OAuth, just a MIME part built
// from data the email already carries. METHOD:CANCEL with the SAME UID is how
// the cancellation notice removes that entry again, which is why the UID is
// derived from the appointment id and nothing else.
//
// Times go out as UTC instants (the "Z" form), deliberately: an appointment is
// an absolute moment, every client renders it in the viewer's own zone, and
// emitting VTIMEZONE blocks by hand is a compatibility swamp this sidesteps
// entirely.

// TEXT values per RFC 5545 §3.3.11: backslash first, then the separators, and
// literal newlines become \n.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// 20260804T050000Z — RFC 5545 UTC date-time.
function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Lines over 75 octets must fold onto a continuation line starting with a
// space (§3.1). Folding on characters rather than octets is technically loose
// with multi-byte text, but 60 leaves headroom and every parser tested accepts
// it — the alternative is octet arithmetic over UTF-8 for no observed gain.
function foldLine(line: string): string {
  if (line.length <= 60) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 60) {
    parts.push((i === 0 ? "" : " ") + line.slice(i, i + 60));
  }
  return parts.join("\r\n");
}

export function appointmentIcs(args: {
  method: "REQUEST" | "CANCEL";
  // The appointment's own id — MUST be identical between the invite and its
  // cancellation or the entry never leaves the customer's calendar.
  uid: string;
  startAtMs: number;
  durationMinutes: number;
  // "Bella Hair Salon — Erkek saç kesimi". Already in the org's language.
  summary: string;
  description?: string;
  // Where it happens: the business's address (orgs.address), so the entry
  // offers directions. Absent = no LOCATION line rather than an empty one.
  location?: string;
  // The salon, so the entry shows who it is with and replies thread sensibly.
  organizerName: string;
  organizerEmail: string;
  // The customer. Without an ATTENDEE matching the recipient, Gmail shows a
  // bare attachment instead of the inline event card.
  attendeeName: string;
  attendeeEmail: string;
  // appointments.icsSequence — how many times the time has moved. Unset means
  // the appointment never rescheduled, which is the old hardcoded 0.
  sequence?: number;
}): string {
  const now = utcStamp(Date.now());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Resepta//Appointments//EN",
    `METHOD:${args.method}`,
    "BEGIN:VEVENT",
    `UID:${escapeText(args.uid)}@randevu`,
    `DTSTAMP:${now}`,
    `DTSTART:${utcStamp(args.startAtMs)}`,
    `DTEND:${utcStamp(args.startAtMs + args.durationMinutes * 60_000)}`,
    `SUMMARY:${escapeText(args.summary)}`,
    ...(args.description ? [`DESCRIPTION:${escapeText(args.description)}`] : []),
    ...(args.location ? [`LOCATION:${escapeText(args.location)}`] : []),
    `ORGANIZER;CN=${escapeText(args.organizerName)}:mailto:${args.organizerEmail}`,
    `ATTENDEE;CN=${escapeText(args.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=` +
      `${args.method === "CANCEL" ? "DECLINED" : "NEEDS-ACTION"};RSVP=TRUE:mailto:${args.attendeeEmail}`,
    // CANCEL must outrank the REQUEST it retracts (§3.8.7.4), hence the bump.
    `SEQUENCE:${(args.sequence ?? 0) + (args.method === "CANCEL" ? 1 : 0)}`,
    `STATUS:${args.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
