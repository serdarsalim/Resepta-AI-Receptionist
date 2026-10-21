// The business's address (orgs.address), written the way it goes on an
// envelope: up to three lines, "Bağdat Caddesi No: 5" / "Kadıköy" /
// "34728 İstanbul" (Serdar, 2026-10-21: a real address cannot be one long
// bar). It is stored with its line breaks, and the Business card shows it in a
// three-line box.
//
// Everywhere else it is ONE line, and reads it through addressOneLine: a
// calendar invite's location, the [address] token in WhatsApp and email, the
// booking and manage pages beside the time, a pasted link's preview. Joined
// with commas there, because a bare newline either breaks a sentence in two
// ("Adresimiz: Bağdat Caddesi No: 5" then "Kadıköy" on a line of its own), is
// refused outright (a Meta template parameter may not hold one), or collapses
// to a space in HTML and runs the street into the district.

export const ADDRESS_MAX_LINES = 3;
export const ADDRESS_MAX_LENGTH = 200;

function linesOf(value: string): string[] {
  return value
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// "Kadıköy," then "İstanbul" reads "Kadıköy, İstanbul", not "Kadıköy,,
// İstanbul": a line that already ends in a separator keeps only the comma.
function joinLines(lines: string[]): string {
  return lines
    .map((line, i) => (i < lines.length - 1 ? line.replace(/[\s,;]+$/, "") : line))
    .filter(Boolean)
    .join(", ");
}

// What orgs.update stores: spaces folded inside each line, blank lines
// dropped, anything past the third line joined onto the third, capped.
// Undefined when nothing is left, which clears the field.
export function normaliseAddress(raw: string): string | undefined {
  const lines = linesOf(raw);
  if (lines.length > ADDRESS_MAX_LINES) {
    const rest = joinLines(lines.splice(ADDRESS_MAX_LINES - 1));
    lines.push(rest);
  }
  return lines.join("\n").slice(0, ADDRESS_MAX_LENGTH).trim() || undefined;
}

// The address on one line: "Bağdat Caddesi No: 5, Kadıköy, 34728 İstanbul".
// An address written on one line comes back as it was.
export function addressOneLine(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  return joinLines(linesOf(address)) || undefined;
}
