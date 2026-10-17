"use client";

// /book/<slug>: the booking page on its own. The page itself is BookingFlow,
// shared with the framed copy at ./embed (P29).

import { use } from "react";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { languageFromParam } from "@/lib/embed";

export default function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { slug } = use(params);
  const { lang } = use(searchParams);
  return <BookingFlow slug={slug} lang={languageFromParam(lang)} />;
}
