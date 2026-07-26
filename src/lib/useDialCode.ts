"use client";

import { getCountryCallingCode } from "react-phone-number-input/min";
import { useDetectedCountry } from "@/lib/detectCountry";

// The dial code to start a fresh phone field on, from the visitor's IP. A
// Turkish salon should not have to pick Türkiye every single time, and a
// Vienna one should land on +43 without touching the picker.
//
// Undefined while the lookup is in flight or if it failed, which is the signal
// callers use to leave the picker empty rather than guessing a wrong country —
// a silently wrong dial code is worse than an empty one, because it looks
// answered.
export function useDetectedDialCode(): string | undefined {
  const country = useDetectedCountry();
  if (!country) return undefined;
  try {
    return getCountryCallingCode(country);
  } catch {
    return undefined;
  }
}
