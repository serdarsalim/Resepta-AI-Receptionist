import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyMetaSignature, verifyRetellSignature } from "./lib/metaSig";
import { handler as mcpHandler } from "./mcp";
import { handler as voiceMcpHandler } from "./voiceMcp";
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
import {
  hasBusinessHours,
  isWithinActiveWindow,
  localDayRangeUtc,
  parseLocalStart,
  todayInZone,
} from "./lib/businessHours";
import { voiceValuesFromToolArgs } from "./lib/voicePayload";

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

// Inbound from the Evolution API lane (self-hosted Baileys).
//
// No signature to verify: Evolution posts a bare JSON body with no shared
// secret and no HMAC. The org is resolved from the instance name in the
// payload, and an instance name is a guessable string, so treat this endpoint
// as UNAUTHENTICATED and size the blast radius accordingly — the handler mints
// contacts and logs messages, which is the same reach a spoofed Cloud webhook
// would have if WA_APP_SECRET were unset. Put the Evolution server behind a
// funnel only this deployment can reach, and give each org an instance name
// that is not its business name.
//
// Always 200. Evolution retries anything else, and a retry cannot conjure the
// org row that was missing.
http.route({
  path: "/whatsapp/evolution",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("ok", { status: 200 });
    }
    try {
      await ctx.runMutation(internal.webhook.handleEvolutionEvent, { payload });
    } catch (err) {
      console.error("evolution webhook failed", err);
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
    // Operator config, so it comes from platformConfig (falling back to the
    // env var) rather than the environment alone.
    const mailConfig = await ctx.runQuery(internal.platformConfig.forSend, {});
    const secret = await ctx.runQuery(internal.platformConfig.webhookSecret, {});
    if (!secret) {
      console.warn("inbound email dropped: no Resend webhook secret configured");
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

    const received = await fetchReceivedEmail(emailId, mailConfig.apiKey);
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

// Every route below records the verdict of its signature check against the
// agent, because a rejection is the one failure the app otherwise cannot see:
// it happens before the event is stored, so nothing lands in voiceEvents and
// nothing appears in the activity feed. The provider logs it and the caller
// hears the agent stumble, which is how it stayed invisible for a whole call.
async function noteSignature(
  ctx: ActionCtx,
  agentId: string,
  route: string,
  ok: boolean,
  wasRejected: boolean,
): Promise<void> {
  // Never let health bookkeeping decide whether a real webhook is processed.
  try {
    if (ok) {
      if (wasRejected) {
        await ctx.runMutation(internal.retell.clearSignatureRejection, {
          retellAgentId: agentId,
        });
      }
      return;
    }
    await ctx.runMutation(internal.retell.recordSignatureRejection, {
      retellAgentId: agentId,
      route,
    });
  } catch {
    // Ignored on purpose.
  }
}

async function retellGuard(
  ctx: ActionCtx,
  request: Request,
  route: string,
): Promise<
  | {
      ok: true;
      payload: Record<string, unknown>;
      agentId: string;
      orgId: string;
    }
  | { ok: false; response: Response }
> {
  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, response: new Response("bad json", { status: 400 }) };
  }
  const call = (payload.call ?? {}) as Record<string, unknown>;
  const inbound = (payload.call_inbound ?? {}) as Record<string, unknown>;
  const agentId = String(call.agent_id ?? inbound.agent_id ?? payload.agent_id ?? "");
  if (!agentId) {
    return { ok: false, response: new Response("unknown agent", { status: 401 }) };
  }
  const auth = await ctx.runQuery(internal.retell.webhookAuthContext, {
    retellAgentId: agentId,
  });
  if (!auth?.apiKey) {
    return { ok: false, response: new Response("unknown agent", { status: 401 }) };
  }
  const valid = await verifyRetellSignature(
    auth.apiKey,
    rawBody,
    request.headers.get("x-retell-signature"),
  );
  await noteSignature(ctx, agentId, route, valid, auth.signatureRejected);
  if (!valid) {
    return { ok: false, response: new Response("bad signature", { status: 401 }) };
  }
  return { ok: true, payload, agentId, orgId: String(auth.orgId) };
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

// When the salon is open, shaped for a body the LLM reads verbatim. Shared by
// the tool that TELLS the agent the hours and the one that REFUSES a booking
// outside them, so a rejection can quote the same hours the agent was given
// rather than a second, subtly different phrasing of them.
//
// Day names go out in English and the model says them in the call's language —
// the same split the `note` fields already use: times the caller hears are
// localised, instructions to the model are not.
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function openHoursForAgent(
  hours:
    | { activeDays?: number[]; startMinute?: number; endMinute?: number }
    | null
    | undefined,
): { open_hours?: string; closed_days?: string[] } {
  if (!hours) return {};
  const asClock = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const out: { open_hours?: string; closed_days?: string[] } = {};
  if (hours.startMinute !== undefined && hours.endMinute !== undefined) {
    out.open_hours = `${asClock(hours.startMinute)}-${asClock(hours.endMinute)}`;
  }
  // Empty or absent activeDays means open every day (the schema's rule), so
  // only a non-empty list closes anything. The agent needs the COMPLEMENT —
  // the days it must not offer — because "we are open Mon-Sat" is a fact it
  // has to invert under time pressure, and inverting it is how Sunday gets
  // offered.
  const days = hours.activeDays;
  if (days && days.length > 0) {
    const closed = WEEKDAY_NAMES.filter((_, day) => !days.includes(day));
    if (closed.length > 0) out.closed_days = closed;
  }
  return out;
}

// Runs while an inbound call is still ringing. Retell knows the agent and the
// caller number at this point, which is exactly enough to resolve an org and
// inject the context that agent is allowed to know before saying hello.
http.route({
  path: "/retell/inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const inbound =
      payload.call_inbound && typeof payload.call_inbound === "object"
        ? (payload.call_inbound as Record<string, unknown>)
        : payload;
    const agentId = String(inbound.agent_id ?? "");
    const fromNumber = String(inbound.from_number ?? "");
    if (!agentId) return new Response("unknown agent", { status: 200 });
    const context = (await ctx.runQuery(internal.retell.beforeCallContext, {
      retellAgentId: agentId,
      phone: fromNumber,
    })) as {
      apiKey: string | null;
      dynamicVariables: Record<string, string>;
      signatureRejected: boolean;
    } | null;
    if (!context) return new Response("agent disabled", { status: 200 });
    if (!context.apiKey) return new Response("agent unavailable", { status: 503 });
    const valid = await verifyRetellSignature(
      context.apiKey,
      rawBody,
      request.headers.get("x-retell-signature"),
    );
    await noteSignature(ctx, agentId, "inbound", valid, context.signatureRejected);
    if (!valid) return new Response("bad signature", { status: 401 });
    return Response.json({
      call_inbound: {
        override_agent_id: agentId,
        dynamic_variables: context.dynamicVariables,
      },
    });
  }),
});

// Custom function calls from the agent mid-conversation. The response body is
// read by the LLM verbatim — return short, speakable facts, never internals.
http.route({
  path: "/retell/functions",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const guard = await retellGuard(ctx, request, "functions");
    if (!guard.ok) return guard.response;
    const payload = guard.payload;
    const call = (payload.call ?? {}) as Record<string, unknown>;
    const agentId = guard.agentId;
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
      const today = todayInZone(org.timezone);
      const dayIso = String(args.date ?? today);
      // "tomorrow" is not a date. It used to reach localDayRangeUtc, fail its
      // regex and produce a window around the literal string — a day that does
      // not exist, answered as if it were empty. Handing the miss back with
      // today's date attached is what lets the agent do the arithmetic.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) {
        return respond({
          error: "date-must-be-yyyy-mm-dd",
          today,
          timezone: org.timezone,
        });
      }
      const { startIso, endIso } = localDayRangeUtc(dayIso, org.timezone);
      // No cal.com is not "no calendar". Resepta holds every appointment this
      // org has, so the agent gets the day's bookings from our own table and
      // works around them. It used to answer "no-calendar-connected", which
      // the agent relayed to a caller as "the calendar isn't linked" — an
      // internals leak that is also simply false.
      if (!org.calcomApiKey || !org.calcomEventTypeId) {
        const booked = (await ctx.runQuery(internal.retell.bookedBetween, {
          orgId: org._id,
          startMs: Date.parse(startIso),
          endMs: Date.parse(endIso),
        })) as {
          capacity: number;
          full: { startAt: number; durationMinutes: number | null }[];
        };
        const hours = org.businessHours ?? null;
        const openness = openHoursForAgent(hours);
        return respond({
          date: dayIso,
          // Speakable ranges, not raw timestamps: this body goes to the LLM
          // verbatim and gets read down a phone line.
          // FULL times, not merely booked ones — a shop with four people
          // working can take four at once, so a single 14:00 booking is not a
          // reason to turn anybody away. bookedBetween does that arithmetic.
          booked_slots: booked.full.map((slot) => ({
            start: formatAppointmentTime(slot.startAt, org.timezone, org.language),
            duration_minutes: slot.durationMinutes ?? 30,
          })),
          // open_hours says when the doors are open; closed_days says which
          // days they never open at all. The second used to be missing, so an
          // agent that knew "09:00-18:00" would offer 09:00 on a Sunday the
          // salon is shut.
          ...openness,
          note:
            "These times are FULL — every person is already busy. Everything" +
            " else is free. Offer times that avoid them" +
            (openness.open_hours ? ", stay inside open_hours" : "") +
            (openness.closed_days ? ", never offer a date on closed_days" : "") +
            ".",
        });
      }
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
      // Wall time at the BUSINESS, not UTC — see parseLocalStart. An agent
      // writing down "five o'clock tomorrow" as a zone-less stamp used to
      // book two hours late in summer Vienna.
      const startAt = parseLocalStart(String(args.start ?? ""), org.timezone);
      const customerName = String(args.name ?? "").trim();
      if (Number.isNaN(startAt) || !customerName || !callerPhone) {
        return respond({ error: "missing-name-phone-or-start" });
      }
      // A date the model made up parses just as cleanly as one the caller
      // said. This booked 8 June 2024 off a live call — two years past, a
      // confirmation sent for it, and a slot in the salon's list nobody can
      // explain. Handing the miss back is the only safe answer: the agent can
      // ask again, and inventing a plausible date on the caller's behalf is
      // exactly what it must not do.
      const now = Date.now();
      if (startAt < now - 5 * 60_000) {
        return respond({ error: "start-is-in-the-past" });
      }
      if (startAt > now + 400 * 24 * 60 * 60_000) {
        return respond({ error: "start-is-too-far-ahead" });
      }
      // check_availability TELLS the agent the hours, but being told is not
      // being bound: on the call that exposed this, that tool failed its
      // signature check and answered nothing, so the model proposed 08:00 at a
      // salon opening at 09:00 and nothing here disagreed. The prompt is the
      // cooperative layer; a write to the appointments table has to hold the
      // invariant itself.
      //
      // Checked before cal.com too, and deliberately: businessHours is the
      // salon's own statement of when it is open, so a slot outside it is
      // wrong whichever calendar is holding the inventory — and refusing here
      // avoids creating a provider booking we would then have to undo.
      const openHours = org.businessHours;
      if (
        openHours &&
        hasBusinessHours(openHours) &&
        !isWithinActiveWindow(startAt, org.timezone, openHours)
      ) {
        // Speakable, not a bare code. An error the agent cannot act on becomes
        // "something went wrong" down the phone and ends a call that was one
        // sentence from booking; handed the hours, it counters with a time
        // that works.
        return respond({
          error: "outside-open-hours",
          attempted: formatAppointmentTime(startAt, org.timezone, org.language),
          ...openHoursForAgent(openHours),
          note:
            "The salon is CLOSED then, so this was not booked. Tell the caller" +
            " and offer the nearest time inside open_hours on a day that is not" +
            " in closed_days.",
        });
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
      const values = voiceValuesFromToolArgs(args);
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

// Post-call webhook. Authentication and durable storage happen before the
// acknowledgement; customer updates run from the stored event with retries.
http.route({
  path: "/retell/call-ended",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const guard = await retellGuard(ctx, request, "call-ended");
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
    const callId = String(call.call_id ?? "");
    if (!callId) return new Response("ok", { status: 200 });
    await ctx.runMutation(internal.voiceEvents.enqueue, {
      orgId: guard.orgId as never,
      retellAgentId: guard.agentId,
      retellCallId: callId,
      eventType: event === "call_analyzed" ? "call_analyzed" : "call_ended",
      payload: guard.payload,
    });
    return new Response("ok", { status: 200 });
  }),
});

// The MCP control surface — this URL is what gets pasted into Claude or
// ChatGPT as a custom connector. An exact path, not a prefix: MCP is a single
// ── Email open pixel ────────────────────────────────────────────────────────
//
// Winback and campaign mail carries <img src=".../e/o/<token>"> (injected by
// lib/email.withOpenPixel); this route resolves the token to its message row
// (messages.recordEmailOpen) and always answers with a 1×1 transparent GIF —
// unknown or expired tokens included, so a broken image never shows in the
// mail client. No auth on purpose: the token is the capability, and the route
// reveals nothing. Ported from Nudge.
const PIXEL_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

http.route({
  pathPrefix: "/e/o/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).pathname.slice("/e/o/".length).trim();
    if (token) {
      try {
        await ctx.runMutation(internal.messages.recordEmailOpen, { token });
      } catch {
        // Never let a tracking failure break the image load.
      }
    }
    return new Response(PIXEL_GIF, {
      headers: {
        "content-type": "image/gif",
        // Every open must re-hit the route — a cached pixel would swallow
        // repeat opens.
        "cache-control": "no-store, no-cache, must-revalidate, private",
      },
    });
  }),
});

// JSON-RPC endpoint, not a REST tree. GET is routed so the handler can explain
// itself to a client probing for the deprecated SSE transport.
for (const method of ["GET", "POST"] as const) {
  http.route({ path: "/mcp", method, handler: mcpHandler });
  http.route({ path: "/retell/mcp", method, handler: voiceMcpHandler });
}

export default http;
