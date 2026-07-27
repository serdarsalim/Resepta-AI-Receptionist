// The Evolution API lane: a self-hosted Baileys REST wrapper talking to a
// phone-linked WhatsApp account, rather than Meta's Cloud API.
//
// ── READ THIS BEFORE YOU SEND ANYTHING ON IT ────────────────────────────────
//
// This lane is for DEMOS AND TRIALS, and the constraints are not stylistic.
// docs/competitive-plan.md section 7 rejected Evolution as a product lane on
// findings that still hold:
//
//  1. QUICK-REPLY BUTTONS DO NOT DELIVER. `sendButtons` returns HTTP 201 and
//     the message never arrives (Evolution issue #2404, open since Feb 2026).
//     Randevu's whole confirm/cancel loop is buttons, so this lane sends TEXT
//     carrying the reply words and relies on the bare EVET/İPTAL fallback that
//     convex/http.ts already resolves against the customer's next appointment.
//     There is deliberately no button sender in this file. Do not add one:
//     it would typecheck, ship, and quietly do nothing on a client's phone.
//
//  2. COLD OUTBOUND FAILS SILENTLY. WhatsApp's Reachout Timelock drops
//     business-initiated messages to people who have never written to the
//     number, ACK error 463, while the instance still reports `open` and the
//     send still returns success. Every first reminder to a walk-in is exactly
//     that. In a demo the phone in the room has usually messaged first, which
//     is why the demo works and production would not.
//
// A 2xx here means ACCEPTED, never delivered. Treat it that way.

export type EvolutionSendResult = { ok: true; messageId?: string } | { ok: false; reason: string };

// Evolution wants a bare number, no plus. Randevu stores E.164 with the dial
// code (lib/orgAuth assertE164), so this is the one place that strips it.
function toEvolutionNumber(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

// One text send. Non-2xx surfaces Evolution's own status and message so the
// failure is readable in the messages row rather than being "it didn't work".
export async function sendEvolutionText(args: {
  baseUrl: string;
  apiKey: string;
  instance: string;
  to: string;
  body: string;
}): Promise<EvolutionSendResult> {
  const url = `${trimBase(args.baseUrl)}/message/sendText/${encodeURIComponent(args.instance)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: args.apiKey },
      body: JSON.stringify({ number: toEvolutionNumber(args.to), text: args.body }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const err = (await res.json()) as {
          message?: unknown;
          error?: unknown;
          response?: { message?: unknown };
        };
        const msg = err.response?.message ?? err.message ?? err.error;
        if (msg) detail = `: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
      } catch {
        /* non-JSON error body — the status alone is the reason */
      }
      return { ok: false, reason: `evolution-http-${res.status}${detail}` };
    }
    const out = (await res.json()) as { key?: { id?: string } };
    return { ok: true, messageId: out.key?.id };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "evolution-unreachable" };
  }
}

export type EvolutionState =
  | { ok: true; state: string; connected: boolean }
  | { ok: false; reason: string };

// Whether the instance is linked to a phone. `open` is connected; `close` and
// `connecting` are not.
//
// Worth being blunt about what this does NOT tell you: a healthy `open` is
// perfectly compatible with every cold outbound message being silently dropped
// (see the header). Connection state answers "is the phone linked", never "are
// messages arriving".
export async function fetchEvolutionState(args: {
  baseUrl: string;
  apiKey: string;
  instance: string;
}): Promise<EvolutionState> {
  const url = `${trimBase(args.baseUrl)}/instance/connectionState/${encodeURIComponent(args.instance)}`;
  try {
    const res = await fetch(url, { headers: { apikey: args.apiKey } });
    if (!res.ok) return { ok: false, reason: `evolution-http-${res.status}` };
    const out = (await res.json()) as { instance?: { state?: string }; state?: string };
    const state = out.instance?.state ?? out.state ?? "unknown";
    return { ok: true, state, connected: state === "open" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "evolution-unreachable" };
  }
}

export type EvolutionQr =
  | { ok: true; qr: string | null; connected: boolean }
  | { ok: false; reason: string };

// The pairing QR, as a data URI ready to drop into an <img>. Already connected
// instances return no QR and say so, which is the difference between "scan
// this" and "you are done".
export async function fetchEvolutionQr(args: {
  baseUrl: string;
  apiKey: string;
  instance: string;
}): Promise<EvolutionQr> {
  const url = `${trimBase(args.baseUrl)}/instance/connect/${encodeURIComponent(args.instance)}`;
  try {
    const res = await fetch(url, { headers: { apikey: args.apiKey } });
    if (!res.ok) return { ok: false, reason: `evolution-http-${res.status}` };
    const out = (await res.json()) as {
      base64?: string;
      code?: string;
      instance?: { state?: string };
    };
    if (out.instance?.state === "open") return { ok: true, qr: null, connected: true };
    const raw = out.base64 ?? null;
    if (!raw) return { ok: true, qr: null, connected: false };
    // Some builds return a bare base64 payload and some a full data URI.
    const qr = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
    return { ok: true, qr, connected: false };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "evolution-unreachable" };
  }
}

export type EvolutionProvision =
  | { ok: true; instance: string; apiKey: string | null }
  | { ok: false; reason: string };

// Create the instance. Needs the ADMIN key, not the send key — this is the
// server-level credential, which is why it is a separate optional field and
// why an operator who does not hold one falls back to creating the instance in
// Evolution's own UI and pasting the token back.
export async function provisionEvolutionInstance(args: {
  baseUrl: string;
  adminKey: string;
  instance: string;
}): Promise<EvolutionProvision> {
  const url = `${trimBase(args.baseUrl)}/instance/create`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: args.adminKey },
      body: JSON.stringify({
        instanceName: args.instance,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });
    if (!res.ok) return { ok: false, reason: `evolution-http-${res.status}` };
    const out = (await res.json()) as {
      hash?: string | { apikey?: string };
      instance?: { instanceName?: string };
    };
    // The per-instance token has moved between builds: a bare string on some,
    // { apikey } on others. Either is the value that sends messages.
    const apiKey =
      typeof out.hash === "string" ? out.hash : (out.hash?.apikey ?? null);
    return { ok: true, instance: out.instance?.instanceName ?? args.instance, apiKey };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "evolution-unreachable" };
  }
}
