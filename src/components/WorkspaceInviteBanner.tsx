"use client";

// "Somebody added you to a business."
//
// Without this, being invited is completely silent. An owner adds you from the
// team list, a membership row appears, and you find out by reloading and
// noticing that the org name in the sidebar has quietly become a dropdown. This
// is the only thing that tells you.
//
// Shape ported from OperatorBanner, deliberately and exactly: fixed, floating
// over the bottom of the shell, moving nothing. The shell is a careful flex
// tree and a bar in the flow would resize every pane below it the moment a
// membership arrived, which is the one thing the house rules forbid.
//
// One workspace at a time, oldest first, because two stacked pills is a wall
// and the second one is still there after you deal with the first.

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";

export function WorkspaceInviteBanner() {
  const { t } = useLanguage();
  const pending = useQuery(api.users.unseenWorkspaces, {});
  const markSeen = useMutation(api.users.markWorkspaceSeen);
  const setActiveOrg = useMutation(api.users.setActiveOrg);

  const workspace = pending?.[0];
  if (!workspace) return null;

  // Opening it is also an acknowledgement, so both buttons stamp. Switch first
  // and stamp second: if the switch fails there is nothing to acknowledge, and
  // the notice should still be there next time.
  const open = async () => {
    await setActiveOrg({ orgId: workspace.orgId });
    await markSeen({ orgId: workspace.orgId });
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-xs shadow-lg backdrop-blur">
        <span>
          {t("workspace.added")}{" "}
          <span className="font-semibold">{workspace.name}</span>
        </span>
        <button
          type="button"
          onClick={() => void open()}
          className="rounded-full bg-[var(--accent)] px-3 py-1 font-medium text-[var(--accent-fg)] transition-opacity duration-[120ms] hover:opacity-90"
        >
          {t("workspace.open")}
        </button>
        <button
          type="button"
          onClick={() => void markSeen({ orgId: workspace.orgId })}
          className="rounded-full px-2 py-1 text-[var(--muted)] transition-colors duration-[120ms] hover:text-[var(--foreground)]"
        >
          {t("workspace.dismiss")}
        </button>
      </div>
    </div>
  );
}
