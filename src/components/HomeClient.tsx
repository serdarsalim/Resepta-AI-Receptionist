"use client";

import { useConvexAuth } from "convex/react";
import dynamic from "next/dynamic";
import { Landing } from "@/components/Landing";

// The app half stays behind a client-only boundary. A static import pulls all
// product views into the server bundle and reaches browser-oriented inbox
// dependencies that cannot be evaluated there.
const AppHome = dynamic(
  () => import("@/components/AppHome").then((module) => module.AppHome),
  { ssr: false },
);

export function HomeClient({
  initiallyAuthenticated,
}: {
  initiallyAuthenticated: boolean;
}) {
  const auth = useConvexAuth();
  const isAuthenticated = auth.isLoading
    ? initiallyAuthenticated
    : auth.isAuthenticated;

  return isAuthenticated ? <AppHome /> : <Landing />;
}
