"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import dynamic from "next/dynamic";
import { Landing } from "@/components/Landing";

// `/` is two pages behind one URL: the landing page for a stranger, the app for
// someone signed in. Doing it this way rather than moving the app to /app keeps
// every existing link, bookmark, and post-login redirect working.
//
// The app half is loaded with ssr:false and NOT imported directly. A static
// import pulled all eight views into the server bundle for this route, and
// through InboxView it reached isomorphic-dompurify and jsdom, whose
// html-encoding-sniffer require()s an ESM-only package. That took production
// down with ERR_REQUIRE_ESM as soon as `/` started rendering for signed-out
// visitors. See src/components/AppHome.tsx for the check to run before
// converting this back to a static import.
const AppHome = dynamic(
  () => import("@/components/AppHome").then((m) => m.AppHome),
  { ssr: false },
);

// AuthLoading renders an empty frame rather than guessing. Guessing wrong is
// expensive both ways: an owner reading marketing copy every morning, or a
// stranger watching the app frame flash before it is swapped out. A blank
// moment reads as loading; the wrong screen reads as broken.
export default function Home() {
  return (
    <>
      <AuthLoading>
        <div className="min-h-dvh" />
      </AuthLoading>
      <Unauthenticated>
        <Landing />
      </Unauthenticated>
      <Authenticated>
        <AppHome />
      </Authenticated>
    </>
  );
}
