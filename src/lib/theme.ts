"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TZ_COORDS } from "./sunCalc";

// Theme: light / dark / auto, where "auto" follows the sun at the user's
// location. We never ask for geolocation — instead we map the browser's IANA
// timezone (Intl) to approximate coordinates and run a standard sunrise/sunset
// calculation. Same trick the Claude apps use: it's not magic, it just knows
// your timezone.
export type Theme = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "randevu.theme";
const RESOLVED_KEY = "randevu.theme-dark"; // "1" | "0", cached for no-flash paint
const VALID: Theme[] = ["light", "dark", "auto"];

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const v = window.localStorage.getItem(STORAGE_KEY);
  // Light is the product default. Auto remains available as an explicit
  // choice, but a first visit should never make the public site unexpectedly
  // dark because it happens to be after sunset.
  return v && (VALID as string[]).includes(v) ? (v as Theme) : "light";
}

// ---------------------------------------------------------------------------
// Sunrise / sunset (NOAA algorithm, adapted from SunCalc — public domain).
// Returns UTC Date objects, or null at the poles when the sun never crosses
// the horizon on the given day (polar day / night).
// ---------------------------------------------------------------------------

const rad = Math.PI / 180;
const dayMs = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the ecliptic
const J0 = 0.0009;
const H0 = -0.833 * rad; // sun's angular radius + atmospheric refraction

const toJulian = (d: Date) => d.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (d: Date) => toJulian(d) - J2000;

function solarMeanAnomaly(d: number) {
  return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number) {
  const C =
    rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372; // perihelion of the Earth
  return M + C + P + Math.PI;
}

function declination(l: number) {
  return Math.asin(Math.sin(l) * Math.sin(e));
}

function solarTransitJ(ds: number, M: number, L: number) {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

function hourAngle(h: number, phi: number, dec: number) {
  return Math.acos(
    (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)),
  );
}

function sunTimes(
  date: Date,
  lat: number,
  lng: number,
): { sunrise: Date; sunset: Date } | null {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);

  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + (0 + lw) / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  const w0 = hourAngle(H0, phi, dec);
  if (Number.isNaN(w0)) return null; // polar day or night

  const Jset = solarTransitJ(J0 + (w0 + lw) / (2 * Math.PI) + n, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

// ---------------------------------------------------------------------------
// Where are we? Resolve coordinates from the IANA timezone, with a longitude
// estimate from the UTC offset as a last resort.
// ---------------------------------------------------------------------------

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function coordsForTimezone(tz: string): { lat: number; lng: number } {
  const hit = TZ_COORDS[tz];
  if (hit) return { lat: hit[0], lng: hit[1] };

  // Fallback: derive longitude from the current UTC offset (15° per hour),
  // and assume a temperate latitude. getTimezoneOffset() is minutes that you
  // add to local time to reach UTC, so it's negative east of Greenwich.
  let lng = 0;
  try {
    lng = -new Date().getTimezoneOffset() / 4;
  } catch {
    lng = 0;
  }
  return { lat: 40, lng };
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function resolveDark(now: Date = new Date()): boolean {
  const { lat, lng } = coordsForTimezone(currentTimezone());
  const today = sunTimes(now, lat, lng);
  if (!today) {
    // Polar day/night — fall back to the OS preference rather than guess.
    return systemPrefersDark();
  }
  return now < today.sunrise || now >= today.sunset;
}

// The next moment "auto" changes value, so we can set one timer. Returns null
// when the sun calc is unavailable (polar day/night).
function nextAutoFlip(now: Date = new Date()): Date | null {
  const { lat, lng } = coordsForTimezone(currentTimezone());
  const today = sunTimes(now, lat, lng);
  if (!today) return null;

  if (now < today.sunrise) return today.sunrise;
  if (now < today.sunset) return today.sunset;

  const tomorrow = sunTimes(new Date(now.getTime() + dayMs), lat, lng);
  return tomorrow ? tomorrow.sunrise : null;
}

export function resolve(theme: Theme): ResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return resolveDark() ? "dark" : "light";
}

function apply(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

function persist(theme: Theme, resolved: ResolvedTheme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
    window.localStorage.setItem(RESOLVED_KEY, resolved === "dark" ? "1" : "0");
  } catch {}
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    setThemeState(readStoredTheme());
  }, []);

  // Apply the active theme. In "auto" schedule a single timer that fires at the
  // next sunrise/sunset to flip the theme, then re-arms itself.
  useEffect(() => {
    if (!mounted) return;
    if (timer.current) clearTimeout(timer.current);

    const sync = () => {
      const r = resolve(theme);
      setResolvedTheme(r);
      apply(r);
      persist(theme, r);

      if (theme === "auto") {
        const flip = nextAutoFlip();
        // Re-sync at the next sun event (cap the delay so a stale tab still
        // recovers, and add a second so we're safely past the boundary).
        const ms = flip
          ? Math.min(
              Math.max(flip.getTime() - Date.now() + 1000, 1000),
              6 * 60 * 60 * 1000,
            )
          : 60 * 60 * 1000;
        timer.current = setTimeout(sync, ms);
      }
    };

    sync();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mounted, theme]);

  // Cross-tab sync.
  useEffect(() => {
    if (!mounted) return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== STORAGE_KEY) return;
      setThemeState(readStoredTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [mounted]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  return { theme, resolvedTheme, setTheme, mounted };
}

// Inline script body. Rendered into <body> by the server-component layout so
// the right class is on <html> before React hydrates — avoids the FOUC
// next-themes used to handle (ported from Nudge). For "auto" we trust the dark value the client
// cached last paint (randevu.theme-dark); useTheme recomputes the exact
// sunrise/sunset state on mount. Lives outside the React tree, so React 19's
// "script tag inside a component" warning doesn't fire.
export const NO_FOUC_SCRIPT = `(() => {
  try {
    // The public request page belongs to whoever is looking at it, not to the
    // salon's account. Embedded in someone's website it must follow THAT
    // visitor's browser, or a light salon homepage gets a black block pasted
    // into it — and the sun-based auto theme, which is right for staff working
    // a late shift, is exactly wrong for a stranger filling in a form.
    if (location.pathname.startsWith('/r/')) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return;
    }
    const stored = localStorage.getItem('${STORAGE_KEY}');
    const theme = stored === 'light' || stored === 'dark' || stored === 'auto'
      ? stored
      : 'light';
    let dark;
    if (theme === 'dark') dark = true;
    else if (theme === 'light') dark = false;
    else {
      const cached = localStorage.getItem('${RESOLVED_KEY}');
      dark = cached == null
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : cached === '1';
    }
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch {}
})();`;

// ---------------------------------------------------------------------------
// IANA timezone -> [latitude, longitude]. Representative coordinates for each
// zone (≈ the zone.tab anchor city). Not exhaustive; unknown zones fall back
// to the UTC-offset estimate above. Ireland and Turkey — this app's two main
// markets — are exact.
// ---------------------------------------------------------------------------

