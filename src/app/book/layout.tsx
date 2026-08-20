import type { Metadata } from "next";
import { UNLISTED } from "@/lib/seo";

// Same reasoning as the request form at /r: the booking page is a link an
// owner hands to a customer, not a page anyone should arrive at from a search.
// It is left crawlable in robots.txt on purpose — a crawler has to be allowed
// to fetch the page before it can read this noindex.
export const metadata: Metadata = UNLISTED;

// The PLANE. Everything in the design language follows from one relationship —
// the page is a plane with a faint wash, content is paper lifted off it — and
// this route was the last surface still missing its half of that. Without the
// wash, `card-raised`'s shadow lifts off nothing and the booking page reads as
// flat white, which is why it looked like a different product from the app
// that mints its link.
//
// Painted on the route root rather than inherited, because /book has no
// AppShell — the same position /admin puts it in (docs/design-language.md,
// "The operator console is not an exception"). `bg-fixed` is load-bearing for
// the same reason it is there and not in the salon app: a gradient restarts
// inside whatever box draws it, and this route scrolls the DOCUMENT, so
// without it the wash slides out from under the card on a long slot list.
export default function BookingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-[image:var(--content-bg)] bg-fixed">{children}</div>
  );
}
