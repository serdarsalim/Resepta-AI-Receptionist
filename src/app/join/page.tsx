"use client";

// The accept step.
//
// Being invited used to be indistinguishable from having the right email
// address: convex/auth.ts matched an open invite on the address alone at first
// sign-in and put the account straight into that workspace. This page is the
// other half of the fix — the invited person arrives holding the token that was
// mailed to them, signs in, and joins on purpose.
//
// The token is read from the URL and stashed in sessionStorage before anything
// else, because signing in leaves the page: Google redirects away and comes
// back, and the query string does not survive the round trip. sessionStorage
// does, dies with the tab, and is never read by anything else.

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { LEGAL_UI } from "@/lib/legal";

const STASH_KEY = "resepta.inviteToken";

// Every failure the mutation can report gets its own line. "Invalid invite"
// would make the reader guess which of four different things to do about it.
const REASON_COPY: Record<string, TranslationKey> = {
  "not-found": "join.notFound",
  "already-accepted": "join.alreadyAccepted",
  expired: "join.expired",
  "wrong-account": "join.wrongAccount",
};

type State =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "joining" }
  | { kind: "joined"; orgName: string }
  | { kind: "error"; key: TranslationKey };

export default function JoinPage() {
  const { t, language } = useLanguage();
  const { signIn } = useAuthActions();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const acceptInvite = useMutation(api.team.acceptInvite);

  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  // Accepting is a write, and this effect can re-run — StrictMode double-mounts
  // in development, and isAuthenticated flips as the session resolves. The
  // mutation is idempotent, but firing it twice would still race two writes to
  // the same invite row for no reason.
  const attempted = useRef(false);

  const token = useCallback((): string => {
    if (typeof window === "undefined") return "";
    const fromUrl = new URLSearchParams(window.location.search).get("t") ?? "";
    if (fromUrl) {
      window.sessionStorage.setItem(STASH_KEY, fromUrl);
      // Out of the address bar and out of the tab's history. The token is a
      // credential; it should not be sitting in a URL somebody screenshots or
      // pastes into a chat asking why the link did not work.
      window.history.replaceState(null, "", window.location.pathname);
      return fromUrl;
    }
    return window.sessionStorage.getItem(STASH_KEY) ?? "";
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const value = token();
    if (!value) {
      setState({ kind: "error", key: "join.notFound" });
      return;
    }
    if (!isAuthenticated) {
      setState({ kind: "signin" });
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    setState({ kind: "joining" });
    void (async () => {
      try {
        const result = await acceptInvite({ token: value });
        if (result.ok) {
          window.sessionStorage.removeItem(STASH_KEY);
          setState({ kind: "joined", orgName: result.orgName ?? "" });
          return;
        }
        setState({
          kind: "error",
          key: REASON_COPY[result.reason ?? ""] ?? "join.notFound",
        });
      } catch {
        // The mutation reports its refusals in the return value, so reaching
        // here means the network or the session failed. Let them try again
        // rather than telling them their invite is bad.
        attempted.current = false;
        setState({ kind: "signin" });
      }
    })();
  }, [isLoading, isAuthenticated, token, acceptInvite]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">{t("join.title")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("app.tagline")}</p>
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          {(state.kind === "loading" || state.kind === "joining") && (
            <p className="text-sm text-[var(--muted)]">{t("join.working")}</p>
          )}

          {state.kind === "signin" && (
            <>
              <p className="text-sm">{t("join.prompt")}</p>
              <button
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-fg)] disabled:opacity-60"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await signIn("google");
                  } catch {
                    setBusy(false);
                  }
                }}
              >
                {t("auth.continueWithGoogle")}
              </button>
            </>
          )}

          {state.kind === "joined" && (
            <>
              <p className="text-sm">
                {t("join.welcome")}{" "}
                <span className="font-semibold">{state.orgName}</span>
              </p>
              <Link
                href="/"
                className="flex w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-fg)]"
              >
                {t("join.open")}
              </Link>
            </>
          )}

          {state.kind === "error" && (
            <>
              <p className="text-sm text-red-600 dark:text-red-400">
                {t(state.key)}
              </p>
              <Link
                href="/signin"
                className="block w-full rounded-lg px-4 py-2 text-center text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {t("auth.continueWithGoogle")}
              </Link>
            </>
          )}
        </div>

        <nav className="mt-4 flex justify-center gap-x-5 text-xs text-[var(--muted)]">
          <Link
            href="/privacy"
            className="transition-colors duration-[120ms] hover:text-[var(--foreground)]"
          >
            {LEGAL_UI[language].privacy}
          </Link>
          <Link
            href="/terms"
            className="transition-colors duration-[120ms] hover:text-[var(--foreground)]"
          >
            {LEGAL_UI[language].terms}
          </Link>
        </nav>
      </div>
    </div>
  );
}
