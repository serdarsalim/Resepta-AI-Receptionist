import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyMetaSignature, verifyRetellSignature } from "./lib/metaSig";
import {
  cancelBooking,
  createBooking,
  getAvailableSlots,
  rescheduleBooking,
} from "./lib/calcomApi";
import {
  fetchReceivedEmail,
  htmlToText,
  localPart,
  verifyResendSignature,
} from "./lib/emailInbound";
import { formatAppointmentTime } from "./lib/format";
import { localDayRangeUtc, todayInZone } from "./lib/businessHours";

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

// Inbound email from Resend. TWO calls, because the `email.received` event
// carries metadata only — id, from, to, subject — and the body has to be
// fetched with that id afterwards (lib/emailInbound.fetchReceivedEmail).
//
// The org is resolved from the LOCAL PART of the address it was sent to, so
// one verified domain serves every customer instead of burning a Resend
// domain slot per salon.
//
// Always 200 on anything we have verified, even when we drop it. A 4xx makes
// Resend retry, and retrying will not conjure the org row that was missing —
// it just replays the same dead delivery until the attempts run out. The only
// non-200s here are "we could not prove this came from Resend".
http.route({
  path: "/email/inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      console.warn("inbound email dropped: RESEND_WEBHOOK_SECRET is unset");
      return new Response("not configured", { status: 503 });
    }
    // Raw text, never a re-serialised object: the signature covers the exact
    // bytes, and JSON.stringify(JSON.parse(body)) is not the same bytes.
    const rawBody = await request.text();
    const verified = await verifyResendSignature({
      secret,
      rawBody,
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    });
    if (!verified) return new Response("bad signature", { status: 401 });

    let event: {
      type?: string;
      data?: {
        email_id?: string;
        from?: string;
        to?: string[];
        received_for?: string[];
        subject?: string;
      };
    };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return new Response("ok", { status: 200 });
    }
    if (event.type !== "email.received") return new Response("ok", { status: 200 });

    const data = event.data ?? {};
    const emailId = data.email_id;
    const from = data.from;
    if (!emailId || !from) return new Response("ok", { status: 200 });

    // `received_for` first: it is the address the mail was actually routed
    // for, while `to` also carries anyone CC'd or a list address, so matching
    // on `to` would file a customer's reply under whichever org happened to
    // be copied.
    const candidates = [...(data.received_for ?? []), ...(data.to ?? [])];
    let orgId = null;
    for (const candidate of candidates) {
      orgId = await ctx.runQuery(internal.email.orgByInboundAddress, {
        localPart: localPart(candidate),
      });
      if (orgId) break;
    }
    if (!orgId) {
      console.warn(`inbound email ${emailId} dropped: no org for ${candidates.join(", ")}`);
      return new Response("ok", { status: 200 });
    }

    // Checked BEFORE the body fetch, so a retry storm doesn't spend a call to
    // Resend per duplicate. Re-checked inside the mutation for the real guard.
    const seen = await ctx.runQuery(internal.email.emailAlreadyLogged, { emailId });
    if (seen) return new Response("ok", { status: 200 });

    const received = await fetchReceivedEmail(emailId);
    // Plain text when the sender provided it; the HTML flattened when they
    // did not. A bubble in a timeline wants the words, not a layout.
    const body = received?.text?.trim()
      ? received.text.trim()
      : received?.html
        ? htmlToText(received.html)
        : undefined;

    await ctx.runMutation(internal.email.recordInbound, {
      orgId,
      emailId,
      from,
      subject: data.subject,
      body,
      // Kept as sent. The flattened text above is what lists and indexes
      // show; this is what the reader gets when they open the message.
      html: received?.html,
    });
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

// Retell hands values back in whatever shape the agent's function schema was
// written in, so accept the nested object under the name most configs use and
// fall back to the remaining top-level args. Non-scalars are dropped; keys
// that could never be a contactFields key are dropped with them.
function coerceContactValues(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_]*$/.test(key)) continue;
    const text = String(value).trim();
    // An empty value is Retell saying it did not collect this field, never
    // "erase what you have". Post-call analysis reports every configured key
    // whether or not the caller answered, so passing "" through would let one
    // vague call wipe a value a human typed. Clearing a field is a job for the
    // contact page, by hand.
    if (!text) continue;
    out[key] = text;
  }
  return out;
}

function contactValuesFromArgs(args: Record<string, unknown>): Record<string, string> {
  const nested = args.values ?? args.properties ?? args.fields;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return coerceContactValues(nested as Record<string, unknown>);
  }
  const { phone: _phone, name: _name, ...rest } = args;
  return coerceContactValues(rest);
}

// Short English sentence for the model to relay in the call's own language.
// The arrays next to it are what a transcript reader checks. Each rejection
// bucket gets its own clause: "did not stick" is useless to whoever reads the
// transcript, "the value did not fit the field" tells them to ask again.
function contactUpdateSentence(result: {
  updatedLabels: string[];
  ignored: string[];
  notForVoice: string[];
  rejected: string[];
}): string {
  const parts: string[] = [];
  if (result.updatedLabels.length > 0) {
    parts.push(`Saved ${result.updatedLabels.join(", ")}.`);
  }
  if (result.rejected.length > 0) {
    parts.push(
      `Could not save ${result.rejected.join(", ")}: the value did not fit that field. Ask again and have the caller say it plainly.`,
    );
  }
  if (result.notForVoice.length > 0) {
    parts.push(`${result.notForVoice.join(", ")} is filled in by staff, so it was left alone.`);
  }
  if (result.ignored.length > 0) {
    parts.push(
      `Ignored ${result.ignored.join(", ")}, not a contact field for this business.`,
    );
  }
  return parts.join(" ") || "Nothing to save.";
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
      const dayIso = String(args.date ?? todayInZone(org.timezone));
      const { startIso, endIso } = localDayRangeUtc(dayIso, org.timezone);
      const result = await getAvailableSlots({
        apiKey: org.calcomApiKey,
        eventTypeId: org.calcomEventTypeId,
        startIso,
        endIso,
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
      let booking: { serviceName?: string };
      try {
        booking = await ctx.runMutation(internal.retell.voiceBook, {
          orgId: org._id,
          name: customerName,
          phone: callerPhone.startsWith("+") ? callerPhone : `+${callerPhone}`,
          startAt,
          externalUid,
          // Whatever the caller called it. Matching against the org's own list
          // happens in voiceBook, not here and not in the agent's prompt.
          service: String(args.service ?? "").trim() || undefined,
        });
      } catch (err) {
        return respond({ error: err instanceof Error ? err.message : "book-failed" });
      }
      return respond({
        booked: true,
        spoken_time: formatAppointmentTime(startAt, org.timezone, org.language),
        // Absent means the spoken service matched nothing the salon offers.
        // The booking still stands; the agent can read this back to confirm,
        // and its absence is the cue to ask again rather than assume.
        service: booking.serviceName,
      });
    }

    // Set org-defined contact properties mid-call. The org decides which
    // properties exist (Settings → contact fields); this endpoint only fills
    // in the ones already there.
    if (name === "update_contact") {
      if (!callerPhone) return respond({ saved: false, message: "No number for this contact." });
      const values = contactValuesFromArgs(args);
      if (Object.keys(values).length === 0) {
        return respond({ saved: false, updated: [], ignored: [], message: "Nothing to save." });
      }
      let result;
      try {
        result = await ctx.runMutation(internal.retell.updateContactFromVoice, {
          retellAgentId: agentId,
          phone: callerPhone,
          values,
        });
      } catch (err) {
        console.error("update_contact failed", err);
        return respond({ saved: false, message: "Could not save that right now." });
      }
      if (!result.ok) {
        return respond({
          saved: false,
          reason: result.reason,
          message:
            result.reason === "no-contact-with-that-number"
              ? "No contact with that number yet."
              : "That number did not look right.",
        });
      }
      return respond({
        saved: result.updated.length > 0,
        updated: result.updated,
        ignored: result.ignored,
        not_for_voice: result.notForVoice,
        rejected: result.rejected,
        message: contactUpdateSentence(result),
      });
    }

    // Everything below addresses an appointment the caller already has, so it
    // shares one lookup. cal.com is told BEFORE our status moves: it owns the
    // slot inventory, the salon's Google Calendar and the notification emails,
    // and a local-only write leaves the salon holding a slot for someone who
    // is not coming. A walk-in typed in by hand has no externalUid and so has
    // nothing on cal.com to move — that branch stays local by design.
    if (
      name === "find_appointment" ||
      name === "cancel_appointment" ||
      name === "reschedule_appointment"
    ) {
      if (!callerPhone) return respond({ error: "missing-phone" });
      const phone = callerPhone.startsWith("+") ? callerPhone : `+${callerPhone}`;
      const found = await ctx.runQuery(internal.retell.nextAppointmentForPhone, {
        orgId: org._id,
        phone,
      });
      const spokenOf = (at: number) =>
        formatAppointmentTime(at, org.timezone, org.language);

      // Lets the agent name the appointment before acting on it, instead of
      // cancelling whatever happens to be next for a caller with two bookings.
      if (name === "find_appointment") {
        return respond(
          found
            ? { found: true, spoken_time: spokenOf(found.startAt) }
            : { found: false },
        );
      }
      if (!found) return respond({ error: "no-upcoming-appointment" });
      if (found.externalUid && !org.calcomApiKey) {
        // The booking lives on a calendar we can no longer reach. Saying so
        // beats moving our row and letting the two drift apart.
        return respond({ error: "no-calendar-connected" });
      }

      if (name === "cancel_appointment") {
        if (found.externalUid && org.calcomApiKey) {
          const result = await cancelBooking({
            apiKey: org.calcomApiKey,
            uid: found.externalUid,
            reason: "Cancelled by phone",
          });
          if (!result.ok) return respond({ cancelled: false, error: result.reason });
        }
        await ctx.runMutation(internal.appointments.markCancelled, {
          appointmentId: found.appointmentId,
        });
        return respond({ cancelled: true });
      }

      const startAt = Date.parse(String(args.start ?? ""));
      if (Number.isNaN(startAt)) return respond({ error: "missing-or-bad-start" });
      let newUid: string | undefined;
      if (found.externalUid && org.calcomApiKey) {
        const result = await rescheduleBooking({
          apiKey: org.calcomApiKey,
          uid: found.externalUid,
          startIso: new Date(startAt).toISOString(),
          reason: "Rescheduled by phone",
        });
        if (!result.ok) return respond({ rescheduled: false, error: result.reason });
        // cal.com minted a new booking; carry its uid or the next cancel 404s.
        newUid = result.uid;
      }
      await ctx.runMutation(internal.appointments.markRescheduled, {
        appointmentId: found.appointmentId,
        startAt,
        externalUid: newUid,
      });
      return respond({ rescheduled: true, spoken_time: spokenOf(startAt) });
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
    // Retell posts EVERY lifecycle event to this one URL. call_started carries
    // no transcript, no duration and nothing collected, and recordCall is
    // first-write-wins by call id, so letting it through would park an empty
    // row and lock the real one out. An event field we don't recognise is
    // acknowledged and ignored; a payload without the field at all still runs,
    // which keeps older test posts working.
    const event = String(guard.payload.event ?? "");
    if (event && event !== "call_ended" && event !== "call_analyzed") {
      return new Response("ok", { status: 200 });
    }
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

    // Retell also posts what it collected during the call. Same mapping, same
    // guards as the mid-call function: only keys the org defined as contact
    // fields, only fields marked as voice-filled, and only values that survive
    // their type. This runs outside recordCall's idempotency check on purpose:
    // the analysis arrives on the second event, after the call row already
    // exists. Both call_ended and call_analyzed reach here (the gate above
    // dropped call_started); writing the same values twice is a no-op.
    if (agentId) {
      const collected: Record<string, unknown> = {
        ...(call.retell_llm_dynamic_variables as Record<string, unknown> | undefined),
        ...(call.collected_dynamic_variables as Record<string, unknown> | undefined),
        ...(analysis.custom_analysis_data as Record<string, unknown> | undefined),
      };
      const values = coerceContactValues(collected);
      const fromNumber = String(call.from_number ?? "");
      if (fromNumber && Object.keys(values).length > 0) {
        try {
          await ctx.runMutation(internal.retell.updateContactFromVoice, {
            retellAgentId: agentId,
            phone: fromNumber,
            values,
          });
        } catch (err) {
          console.error("post-call contact update failed", err);
        }
      }
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
