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
      let detail = "";
      try {
        const err = (await res.json()) as { error?: { message?: string } };
        if (err.error?.message) detail = `: ${err.error.message.slice(0, 120)}`;
      } catch {}
      return { ok: false, reason: `calcom-booking-http-${res.status}${detail}` };
    }
    const out = (await res.json()) as { data?: { uid?: string } };
    return { ok: true, uid: out.data?.uid };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "calcom-booking" };
  }
}
