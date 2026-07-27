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
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs shadow-lg backdrop-blur">
        <span>
          Working in <span className="font-semibold">{acting.name}</span> as Autotakt
        </span>
        <button
          type="button"
          onClick={() => {
            void stop({}).then(() => router.push(`/admin/${acting.orgId}`));
          }}
          className="rounded-full px-2 py-0.5 font-medium hover:bg-amber-500/20"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
