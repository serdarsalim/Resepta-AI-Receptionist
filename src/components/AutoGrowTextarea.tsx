"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

// A textarea that is exactly as tall as its content, ported from Nudge. The
// variables table uses it for descriptions: the description is the
// instruction the analysis model follows, so it is the cell worth reading in
// full — a one-line input hiding two thirds of it made rows look equally
// trivial when they weren't.
export function AutoGrowTextarea({
  value,
  className = "",
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const grow = () => {
      const el = ref.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    grow();
    window.addEventListener("resize", grow);
    return () => window.removeEventListener("resize", grow);
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      // overflow-hidden because a box sized to its own content has nothing
      // left to scroll — and a stray scrollbar here inflates the row.
      className={`resize-none overflow-hidden ${className}`}
      {...rest}
    />
  );
}
