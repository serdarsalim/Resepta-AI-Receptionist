// cal.com API adapter — the ONLY place that talks to cal.com's REST API.
// cal.com IS the scheduler (spec §Phase C/D): slots and bookings come from
// here; the booking echo returns through our webhook and dedupes by
// externalUid. Defensive parsing throughout — cal.com's v2 shapes vary by
// endpoint version, so we accept the documented variants.

const CALCOM_BASE = "https://api.cal.com/v2";

export type SlotsResult =
  | { ok: true; slots: string[] } // ISO start times
  | { ok: false; reason: string };

export async function getAvailableSlots(args: {
  apiKey: string;
  eventTypeId: string;
  startIso: string;
  endIso: string;
}): Promise<SlotsResult> {
  try {
    const url = new URL(`${CALCOM_BASE}/slots`);
    url.searchParams.set("eventTypeId", args.eventTypeId);
    url.searchParams.set("start", args.startIso);
    url.searchParams.set("end", args.endIso);
    const res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${args.apiKey}`,
        "cal-api-version": "2024-09-04",
      },
    });
    if (!res.ok) return { ok: false, reason: `calcom-slots-http-${res.status}` };
    const out = (await res.json()) as {
      data?: Record<string, { start?: string }[] | { time?: string }[]>;
    };
    const slots: string[] = [];
    for (const day of Object.values(out.data ?? {})) {
      for (const slot of day) {
        const iso =
          (slot as { start?: string }).start ?? (slot as { time?: string }).time;
        if (iso) slots.push(iso);
      }
    }
    return { ok: true, slots };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "calcom-slots" };
  }
}

export type BookingResult =
  | { ok: true; uid?: string }
  | { ok: false; reason: string };

export async function createBooking(args: {
  apiKey: string;
  eventTypeId: string;
  startIso: string;
  name: string;
  phone: string;
  email?: string;
  timeZone: string;
  language: string;
}): Promise<BookingResult> {
  try {
    const res = await fetch(`${CALCOM_BASE}/bookings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.apiKey}`,
        "content-type": "application/json",
        "cal-api-version": "2024-08-13",
      },
      body: JSON.stringify({
        eventTypeId: Number(args.eventTypeId),
        start: args.startIso,
        attendee: {
          name: args.name,
          // cal.com requires an email; a phone-only walk-in gets a routable
          // placeholder that keeps notifications off our real customers.
          email: args.email ?? `${args.phone.replace(/\D/g, "")}@noemail.randevu.app`,
          phoneNumber: args.phone,
          timeZone: args.timeZone,
          language: args.language,
        },
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: `calcom-booking-http-${res.status}${await errorDetail(res)}`,
      };
    }
    const out = (await res.json()) as { data?: { uid?: string } };
    return { ok: true, uid: out.data?.uid };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "calcom-booking" };
  }
}

// cal.com puts the useful part of a failure in error.message; surfacing it is
// what turns "it didn't work" into a fixable line in the logs.
async function errorDetail(res: Response): Promise<string> {
  try {
    const err = (await res.json()) as { error?: { message?: string } };
    return err.error?.message ? `: ${err.error.message.slice(0, 120)}` : "";
  } catch {
    return "";
  }
}

// Cancel and reschedule answer cal-api-version 2026-02-25, NOT the versions the
// two functions above use (/slots is 2024-09-04, POST /bookings is 2024-08-13).
// cal.com versions each endpoint separately and its reference warns that a
// wrong value silently falls back to an older shape, so this value is checked
// against the docs rather than assumed to match its neighbours.
const BOOKINGS_MUTATE_VERSION = "2026-02-25";

// cal.com owns the calendar, the slot inventory and the notification emails.
// A cancel that only patches our own row leaves the salon holding a blocked
// slot for a customer who is not coming, with nothing sent to either of them —
// so every cancel goes through here before our status moves.
export async function cancelBooking(args: {
  apiKey: string;
  uid: string;
  reason?: string;
}): Promise<BookingResult> {
  try {
    const res = await fetch(
      `${CALCOM_BASE}/bookings/${encodeURIComponent(args.uid)}/cancel`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${args.apiKey}`,
          "content-type": "application/json",
          "cal-api-version": BOOKINGS_MUTATE_VERSION,
        },
        body: JSON.stringify({
          cancellationReason: args.reason ?? "Cancelled by the customer",
        }),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        reason: `calcom-cancel-http-${res.status}${await errorDetail(res)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "calcom-cancel" };
  }
}

// Rescheduling MINTS A NEW BOOKING. The response carries a new uid and cal.com
// retires the old one, so the caller must write `uid` back onto the appointment
// or the next cancel will address a booking that no longer exists. The
// BOOKING_RESCHEDULED webhook does the same thing from the other direction
// (calcom.ts), whichever arrives first.
export async function rescheduleBooking(args: {
  apiKey: string;
  uid: string;
  startIso: string;
  reason?: string;
}): Promise<BookingResult> {
  try {
    const res = await fetch(
      `${CALCOM_BASE}/bookings/${encodeURIComponent(args.uid)}/reschedule`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${args.apiKey}`,
          "content-type": "application/json",
          "cal-api-version": BOOKINGS_MUTATE_VERSION,
        },
        body: JSON.stringify({
          start: args.startIso,
          reschedulingReason: args.reason ?? "Rescheduled by the customer",
        }),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        reason: `calcom-reschedule-http-${res.status}${await errorDetail(res)}`,
      };
    }
    const out = (await res.json()) as { data?: { uid?: string } };
    return { ok: true, uid: out.data?.uid };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "calcom-reschedule",
    };
  }
}
