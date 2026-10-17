"use client";

// /book/<slug>/embed: the booking page inside a business's own website, put
// there by public/embed.js. The ONE route next.config.ts lets any site frame:
// it carries no session and shows nothing but what the business publishes,
// and it tells the website only what was booked, never who (lib/embed).

import { use } from "react";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { languageFromParam } from "@/lib/embed";

export default function EmbeddedBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { slug } = use(params);
  const { lang } = use(searchParams);
  return <BookingFlow slug={slug} embed lang={languageFromParam(lang)} />;
}
