// "GMT+03" for a zone at an instant: the calendar's gutter corner and the
// booking page's time zone list. The offset at that instant, because "GMT+03"
// is ambiguous the weeks a year when DST moves it.
export function gmtLabel(timezone: string | undefined, at: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(at));
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    // "GMT+3" → "GMT+03"; "GMT+5:30" and plain "GMT" pass through untouched.
    return name.replace(/^GMT([+-])(\d)$/, "GMT$10$2");
  } catch {
    return "GMT";
  }
}
