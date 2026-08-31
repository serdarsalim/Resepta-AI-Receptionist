"use client";

// "You are not looking at your own business."
//
// The one piece of operator UI that lives inside the tenant-facing app, and it
// earns its place: an operator with their own salon has two orgs that look
// identical from the inside, and the failure mode is editing a client's hours
// believing they are your own.
//
// In the SIDEBAR, under the Admin door (Serdar, 2026-08-31) — it used to float
// fixed over the top center of every screen, which put a permanent chip over
// the working area for a state the operator can be in for an afternoon. The
// sidebar row groups it with the other operator-only furniture (the Admin
// anchor it now sits beneath), keeps it on every screen the sidebar is on, and
// costs the layout nothing the sidebar wasn't already spending. The trade is
// honest: on a phone it is only visible while the drawer is open.
//
// English, like the rest of /admin: exactly one person ever sees it.

import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../convex/_generated/api";

export function OperatorBanner({ collapsed }: { collapsed?: boolean }) {
  const acting = useQuery(api.platform.actingAs, {});
  const stop = useMutation(api.platform.stopActingAs);
  const router = useRouter();

  // null for every normal user — platform.actingAs returns null rather than
  // throwing precisely so a salon's shell can call it and get nothing.
  if (!acting) return null;

  const leave = () => {
    void stop({}).then(() => router.push(`/admin/${acting.orgId}`));
  };

  // The rail keeps the warning without the words: an amber initial where the
  // pill would be. Clicking it leaves — the only action the pill offers, and
  // the title spells out both the org and the consequence first.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={leave}
        title={`${acting.name} — Leave`}
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.05]"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300">
          {acting.name.charAt(0).toUpperCase()}
        </span>
      </button>
    );
  }

  return (
    // Minimal on purpose. "Working in X as Autotakt" plus a filled amber
    // pill and a shadow was a lot of furniture for a state exactly one
    // person is ever in, and that person already knows who they are. The
    // org NAME is the whole message — it is the thing that could be
    // mistaken for your own — so that plus a way out is all that is left.
    <div className="mx-2 mt-1 flex w-fit max-w-full items-center gap-2 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] ring-1 ring-inset ring-amber-500/25">
      <span className="min-w-0 truncate font-medium text-amber-800 dark:text-amber-300">
        {acting.name}
      </span>
      <button
        type="button"
        onClick={leave}
        className="shrink-0 rounded-full px-1 text-amber-800/70 transition-colors hover:text-amber-900 dark:text-amber-300/70 dark:hover:text-amber-200"
      >
        Leave
      </button>
    </div>
  );
}
