import type { Metadata } from "next";

// What a page declares when it must not turn up in a search result.
//
// Both halves matter, and the second one is the reason this exists at all.
// src/app/layout.tsx sets the homepage canonical for the entire tree, and
// Next.js merges metadata one field at a time, so every route that does not
// declare its own `alternates` inherits it. The three routes that use this
// constant cannot declare their own the ordinary way — /r/<slug>,
// /book/<slug> and /appt/<token> all start with "use client", and a client
// component cannot export metadata at all — so each gets a server layout whose
// only job is to carry this object.
//
// Left alone, every salon's request form shipped a canonical claiming it was
// the Mahlas homepage. Google reads that as "this page is a duplicate, index
// the other one", which is a worse outcome than either indexing the form or
// hiding it, because it is the site telling a lie about itself.
export const UNLISTED: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};
