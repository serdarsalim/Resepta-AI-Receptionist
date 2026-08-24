"use client";

import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import dynamic from "next/dynamic";

// The app half stays behind a client-only boundary. A static import pulls all
// product views into the server bundle and reaches browser-oriented inbox
// dependencies that cannot be evaluated there.
const AppHome = dynamic(
  () => import("@/components/AppHome").then((module) => module.AppHome),
  { ssr: false },
);

// The server already sent every signed-out visitor to /signin, so by the time
// this renders the answer is nearly always "yes". This is the OTHER case: a
// session that expired between the server's check and the browser's, which
// used to fall back to the landing page and now has nowhere to fall back to.
//
// Redirecting rather than rendering the sign-in card in place, so there is one
// address where signing in happens and the back button behaves.
export function HomeClient() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/signin");
  }, [isLoading, isAuthenticated, router]);

  // Nothing while the client makes up its mind. The alternative is a spinner
  // for a check that resolves in milliseconds against a page that is about to
  // paint anyway.
  if (!isAuthenticated) return null;
  return <AppHome />;
}
