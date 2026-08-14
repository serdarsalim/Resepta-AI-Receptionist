"use client";

// "You are not looking at your own business."
//
// The one piece of operator UI that lives inside the tenant-facing app, and it
// earns its place: an operator with their own salon has two orgs that look
// identical from the inside, and the failure mode is editing a client's hours
// believing they are your own. So this renders on every screen, not just the
// one you arrived on.
//
// FIXED rather than a bar in the layout, deliberately. The shell is a careful
// flex tree and a banner in the flow would resize every pane below it the
// moment it appeared, which is the thing the house rules say not to do. This
// floats over the top and moves nothing.
//
// TOP, not bottom. At the bottom it sat over the composer and the calendar's
// late hours — the parts of the screen you actually work in — and it is a
// warning, so it belongs where warnings go. It also stops squatting on the
// spot a toast wants.
//
// English, like the rest of /admin: exactly one person ever sees it.

import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../convex/_generated/api";

export function OperatorBanner() {
  const acting = useQuery(api.platform.actingAs, {});
  const stop = useMutation(api.platform.stopActingAs);
  const router = useRouter();

  // null for every normal user — platform.actingAs returns null rather than
  // throwing precisely so a salon's shell can call it and get nothing.
  if (!acting) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      {/* Minimal on purpose. "Working in X as Autotakt" plus a filled amber
          pill and a shadow was a lot of furniture for a state exactly one
          person is ever in, and that person already knows who they are. The
          org NAME is the whole message — it is the thing that could be
          mistaken for your own — so that plus a way out is all that is left. */}
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] ring-1 ring-inset ring-amber-500/25 backdrop-blur">
        <span className="font-medium text-amber-800 dark:text-amber-300">
          {acting.name}
        </span>
        <button
          type="button"
          onClick={() => {
            void stop({}).then(() => router.push(`/admin/${acting.orgId}`));
          }}
          className="rounded-full px-1 text-amber-800/70 transition-colors hover:text-amber-900 dark:text-amber-300/70 dark:hover:text-amber-200"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
