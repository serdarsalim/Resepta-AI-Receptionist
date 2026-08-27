"use client";

import { Component, type ReactNode } from "react";
import { ErrorState } from "./ErrorState";

// A render error inside one pane costs that pane, not the whole app.
//
// It used to cost the whole app. Nothing in this tree caught anything, so a
// query that threw took the sidebar, the tab strip and the workspace switcher
// down with it and left Next's own bare error screen. Losing the switcher is
// the expensive half: when a workspace holds the data that breaks a view, the
// switcher is the way out of it.
//
// A class, because catching a render error is the one thing React still has no
// hook for.
type Props = {
  // Whatever decides what the children are ABOUT: the open tab, the open
  // contact, the active workspace. A caught error clears when one of them
  // moves, so navigating away recovers on its own and nobody has to notice the
  // retry button first.
  resetKeys: unknown[];
  children: ReactNode;
};

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // The screen says what to do. This is for whoever opens the console after
    // being told it went blank.
    console.error("View failed to render:", error);
  }

  componentDidUpdate(previous: Props) {
    if (!this.state.failed) return;
    const before = previous.resetKeys;
    const after = this.props.resetKeys;
    const moved =
      before.length !== after.length ||
      before.some((key, index) => key !== after[index]);
    if (moved) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <ErrorState onRetry={() => this.setState({ failed: false })} />
      </div>
    );
  }
}
