// Limits the booking page and the booking backend must AGREE on, in a module
// with no Convex imports so the browser can read them.
//
// That last part is the whole reason this file exists. The cap first lived in
// convex/booking.ts and the page imported it from there, which was correct
// about the value and wrong about the module: importing anything from a file
// that defines Convex functions drags that file's entire import graph into the
// client bundle — booking.ts → lib/newCustomer → lib/alerts, which defines an
// internalQuery — and Convex warns in the console that its functions are being
// loaded in a browser.
//
// The rule this file keeps: `convex/lib/*` modules that are pure values and
// type-only imports are the shared surface between the two sides. Every other
// client import in this repo already reaches into convex/ that way
// (lib/inboundAddress, lib/money, lib/businessHours, lib/keys). Never import a
// value from `convex/<name>.ts` in src/.

// How many lines one booking can hold. A brake, not a business rule — the same
// reasoning as MAX_UPCOMING_PER_PHONE. A real customer picks two or three;
// nobody real picks eleven.
//
// Both sides need it: the server refuses a longer basket, and the page has to
// stop the customer BEFORE they reach that refusal. When only the server knew,
// ticking a twelfth line made the slot grid answer "no free times" — a lie —
// and the real refusal arrived after the phone number was typed.
export const MAX_LINES_PER_BOOKING = 10;

// How many open bookings one customer may hold at once. Not a business rule:
// a brake on a bored teenager with the booking link. A real family books
// four; nobody real books six. Moved here from booking.ts on 2026-10-13 when
// the assistants started obeying it too (retell.bookingProblem): one brake
// for every door a booking can come through, whatever the door.
export const MAX_UPCOMING_PER_PHONE = 5;
