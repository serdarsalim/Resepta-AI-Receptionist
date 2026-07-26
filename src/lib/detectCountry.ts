"use client";

// Copied from egitimirlanda-portal (src/lib/detectCountry.ts) rather than
// rewritten — same GeoJS lookup, same session cache, same fail-silent
// contract, so the two apps cannot drift on the one behaviour Serdar asked
// not to repeat. Only the "use client" directive is new: Next needs it, Vite
// does not.
import { useEffect, useState } from 'react';
import { getCountries, type Country } from 'react-phone-number-input/min';

// Detect the visitor's country from their IP so the phone field defaults to
// where they actually are (German flag from Germany, Irish from Ireland)
// instead of a hardcoded home market. The lookup runs once per session
// (module-cached, single in-flight request shared across every PhoneField)
// and fails silent — callers fall back to their own default when this
// returns undefined.

let cached: Country | undefined;
let inflight: Promise<Country | undefined> | null = null;

// Validate against the library's own country list so an unexpected payload
// (or a code react-phone-number-input doesn't know) can never reach the input.
function asCountry(code: unknown): Country | undefined {
  if (typeof code !== 'string') return undefined;
  const upper = code.toUpperCase();
  return (getCountries() as string[]).includes(upper)
    ? (upper as Country)
    : undefined;
}

// 3s budget so a slow/blocked geo service never holds the flag back for long;
// guarded because AbortSignal.timeout is recent and may be absent.
function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
      return AbortSignal.timeout(ms);
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

export async function detectCountry(): Promise<Country | undefined> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // GeoJS: free, keyless, HTTPS, and built for client-side use — it
      // returns `Access-Control-Allow-Origin: *` for browser requests.
      // (ipwho.is 403s CORS-origin fetches, which is why this used to fall
      // back to the default country in the browser.) `country` is ISO-3166
      // alpha-2, e.g. "MY".
      const res = await fetch('https://get.geojs.io/v1/ip/country.json', {
        signal: timeoutSignal(3000),
      });
      if (!res.ok) return undefined;
      const data: { country?: string } = await res.json();
      cached = asCountry(data.country);
      return cached;
    } catch {
      return undefined;
    }
  })();
  return inflight;
}

// Returns the detected country once resolved, or undefined while pending /
// on failure. Re-uses the session cache so later mounts resolve instantly.
export function useDetectedCountry(): Country | undefined {
  const [country, setCountry] = useState<Country | undefined>(cached);
  useEffect(() => {
    if (cached) {
      setCountry(cached);
      return;
    }
    let active = true;
    void detectCountry().then((c) => {
      if (active && c) setCountry(c);
    });
    return () => {
      active = false;
    };
  }, []);
  return country;
}
