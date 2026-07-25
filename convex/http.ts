import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyMetaSignature, verifyRetellSignature } from "./lib/metaSig";
import { createBooking, getAvailableSlots } from "./lib/calcomApi";
import { formatAppointmentTime } from "./lib/format";

const http = httpRouter();
auth.addHttpRoutes(http);

// Meta's webhook verification handshake. The token is deployment-wide (one
// Meta app fronting every org's number); per-org routing happens on POST via
// metadata.phone_number_id.
http.route({
  path: "/whatsapp/webhook",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === process.env.WA_WEBHOOK_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }),
});

// Always 200 for parse/handler problems: Meta retries non-2xx for hours and
// disables the webhook after repeated failures, so a payload we can't use is
// still an acknowledged one. A BAD SIGNATURE is the one exception — that's
// not Meta having a bad day, it's someone else entirely, and it gets a 401.
http.route({
  path: "/whatsapp/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();

    const appSecret = process.env.WA_APP_SECRET;
    if (appSecret) {
      const valid = await verifyMetaSignature(
        appSecret,
        rawBody,
        request.headers.get("x-hub-signature-256"),
      );
      if (!valid) return new Response("bad signature", { status: 401 });
    } else {
      // Dev convenience only. Prod must set WA_APP_SECRET (see .env.example).
      console.warn("WA_APP_SECRET unset — webhook signature NOT verified");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("ok", { status: 200 });
    }
    try {
      await ctx.runMutation(internal.webhook.handleWhatsappEvent, { payload });
    } catch (err) {
      console.error("whatsapp webhook failed", err);
    }
    return new Response("ok", { status: 200 });
  }),
});

// cal.com booking intake. `token` (query param) identifies the org.
http.route({
  path: "/calcom/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!token) return new Response("missing token", { status: 401 });
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const result = await ctx.runMutation(internal.calcom.handleCalcomEvent, {
      token,
      payload,
    });
    // An unknown token is a real 401 (cal.com surfaces it to whoever pasted
    // the URL); anything else is acknowledged so cal.com stops retrying.
    if (!result.ok && result.reason === "unknown-token") {
      return new Response("unknown token", { status: 401 });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

// ---- Voice lane (Retell) ----

async function retellGuard(request: Request): Promise<
  { ok: true; payload: Record<string, unknown> } | { ok: false; response: Response }
> {
  const rawBody = await request.text();
  const apiKey = process.env.RETELL_API_KEY;
  if (apiKey) {
    const valid = await verifyRetellSignature(
      apiKey,
      rawBody,
      request.headers.get("x-retell-signature"),
    );
    if (!valid) {
      return { ok: false, response: new Response("bad signature", { status: 401 }) };
    }
  } else {
    console.warn("RETELL_API_KEY unset — Retell signature NOT verified");
  }
  try {
    return { ok: true, payload: JSON.parse(rawBody) as Record<string, unknown> };
  } catch {
    return { ok: false, response: new Response("bad json", { status: 400 }) };
  }
}

// Custom function calls from the agent mid-conversation. The response body is
// read by the LLM verbatim — return short, speakable facts, never internals.
http.route({
  path: "/retell/functions",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const guard = await retellGuard(request);
    if (!guard.ok) return guard.response;
    const payload = guard.payload;
    const call = (payload.call ?? {}) as Record<string, unknown>;
    const agentId = String(call.agent_id ?? payload.agent_id ?? "");
    const name = String(payload.name ?? "");
    const args = (payload.args ?? {}) as Record<string, unknown>;
    const respond = (body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const context = await ctx.runQuery(internal.retell.loadVoiceContext, {
      retellAgentId: agentId,
    });
    if (!context) return respond({ error: "agent-not-configured" });
    const { org } = context;
    const callerPhone = String(args.phone ?? call.from_number ?? "");

    if (name === "check_availability") {
      if (!org.calcomApiKey || !org.calcomEventTypeId) {
        return respond({ error: "no-calendar-connected" });
      }
      const dayIso = String(args.date ?? new Date().toISOString().slice(0, 10));
      const result = await getAvailableSlots({
        apiKey: org.calcomApiKey,
        eventTypeId: org.calcomEventTypeId,
        startIso: `${dayIso}T00:00:00Z`,
        endIso: `${dayIso}T23:59:59Z`,
      });
      if (!result.ok) return respond({ error: result.reason });
      return respond({
        available_slots: result.slots.slice(0, 10).map((iso) => ({
          start: iso,
          spoken: formatAppointmentTime(Date.parse(iso), org.timezone, org.language),
        })),
      });
    }

    if (name === "book_appointment") {
      const startAt = Date.parse(String(args.start ?? ""));
      const customerName = String(args.name ?? "").trim();
      if (Number.isNaN(startAt) || !customerName || !callerPhone) {
        return respond({ error: "missing-name-phone-or-start" });
      }
      let externalUid: string | undefined;
      if (org.calcomApiKey && org.calcomEventTypeId) {
        const booking = await createBooking({
          apiKey: org.calcomApiKey,
          eventTypeId: org.calcomEventTypeId,
          startIso: new Date(startAt).toISOString(),
          name: customerName,
          phone: callerPhone.startsWith("+") ? callerPhone : `+${callerPhone}`,
          timeZone: org.timezone,
          language: org.language,
        });
        if (!booking.ok) return respond({ error: booking.reason });
        externalUid = booking.uid;
      }
      try {
        await ctx.runMutation(internal.retell.voiceBook, {
          orgId: org._id,
          name: customerName,
          phone: callerPhone.startsWith("+") ? callerPhone : `+${callerPhone}`,
          startAt,
          externalUid,
        });
      } catch (err) {
        return respond({ error: err instanceof Error ? err.message : "book-failed" });
      }
      return respond({
        booked: true,
        spoken_time: formatAppointmentTime(startAt, org.timezone, org.language),
      });
    }

    if (name === "cancel_appointment") {
      if (!callerPhone) return respond({ error: "missing-phone" });
      const cancelled = await ctx.runMutation(internal.retell.voiceCancel, {
        orgId: org._id,
        phone: callerPhone.startsWith("+") ? callerPhone : `+${callerPhone}`,
      });
      return respond({ cancelled });
    }

    return respond({ error: `unknown-function-${name}` });
  }),
});

// Post-call webhook: transcript, summary, recording. call_analyzed carries
// the analysis; recordCall is idempotent so both events are safe to send.
http.route({
  path: "/retell/call-ended",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const guard = await retellGuard(request);
    if (!guard.ok) return guard.response;
    const call = (guard.payload.call ?? {}) as Record<string, unknown>;
    const analysis = (call.call_analysis ?? {}) as Record<string, unknown>;
    const startedAt = Number(call.start_timestamp ?? Date.now());
    const endedAt = Number(call.end_timestamp ?? 0);
    const callId = String(call.call_id ?? "");
    const agentId = String(call.agent_id ?? "");
    if (callId && agentId) {
      await ctx.runMutation(internal.retell.recordCall, {
        retellAgentId: agentId,
        retellCallId: callId,
        fromNumber: String(call.from_number ?? "") || undefined,
        startedAt,
        durationSec: endedAt > startedAt ? Math.round((endedAt - startedAt) / 1000) : undefined,
        outcome: String(analysis.call_successful ?? "") || undefined,
        summary: String(analysis.call_summary ?? "") || undefined,
        transcript: String(call.transcript ?? "") || undefined,
        recordingUrl: String(call.recording_url ?? "") || undefined,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
