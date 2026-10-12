import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import {
  verifyMetaSignature,
  verifyRetellSignature,
  verifyStripeSignature,
} from "./lib/metaSig";
import { handler as mcpHandler } from "./mcp";
import { handler as voiceMcpHandler } from "./voiceMcp";
import { createBooking, getAvailableSlots } from "./lib/calcomApi";
import { writeOwnChange } from "./agentAppointments";
import {
  fetchReceivedEmail,
  htmlToText,
  localPart,
  verifyResendSignature,
} from "./lib/emailInbound";
import { spokenDateTime } from "./lib/speech";
import { openHoursForAgent } from "./lib/businessHours";
import {
  hasBusinessHours,
  isWithinActiveWindow,
  judgeRequestedTime,
  localDayRangeUtc,
  localMinuteIso,
  parseLocalStart,
  closureBlocks,
  getLocalPartsSafe,
  suggestFreeSlots,
  todayInZone,
} from "./lib/businessHours";
import { voiceValuesFromToolArgs } from "./lib/voicePayload";
import { cleanError } from "./lib/mcpProtocol";
import type { AgentBooking } from "./retell";
import { answerOrEmpty } from "./lib/nonAnswer";
import { queueOrgAlert } from "./lib/alerts";
import { formatAppointmentTime } from "./lib/format";
import {
  CHANGES_PER_DAY,
  NEAREST_FREE_NOTE,
  changeRefusalNote,
  isChangeRefusal,
  isTimeRefusal,
} from "./lib/agentChange";

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

    // Fails CLOSED, like /email/inbound and /stripe/webhook do. This used to
    // log a warning and process the payload unsigned "for local-development
    // convenience" — one console.warn nobody reads, on the route that mints
    // contacts, opens the 24-hour session window and cancels appointments. A
    // deployment that shipped without the variable was fully forgeable by
    // anyone who knew an org's phone_number_id, and nothing in the app would
    // have said so.
    const appSecret = process.env.WA_APP_SECRET;
    if (!appSecret) {
      console.error("WA_APP_SECRET unset — refusing the WhatsApp webhook");
      return new Response("not configured", { status: 503 });
    }
    const valid = await verifyMetaSignature(
      appSecret,
      rawBody,
      request.headers.get("x-hub-signature-256"),
    );
    if (!valid) return new Response("bad signature", { status: 401 });

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

// Inbound from the Evolution API lane (self-hosted Baileys). `token` (query
// param) identifies the org, exactly as on the cal.com route.
//
// Evolution posts a bare JSON body with no HMAC and no shared secret of its
// own, so the token in the URL is the whole credential. It used to be the
// instance NAME out of the payload — a string nothing in this codebase
// generates, with no length or charset rule — which left this endpoint
// unauthenticated in practice while the comment here asked the operator to
// compensate by choosing a name "that is not its business name". The handler
// reaches processInboundMessage, which cancels real appointments and spends the
// org's LLM budget on a reply, so that was the wrong thing to leave to a naming
// convention.
//
// A missing token is a 401 rather than a silent 200: it means the URL in
// Evolution's settings is the old one, and the operator needs to see that.
// Anything past that point is acknowledged — Evolution retries a non-2xx, and a
// retry cannot conjure the org row that was missing.
http.route({
  path: "/whatsapp/evolution",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!token) return new Response("missing token", { status: 401 });
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("ok", { status: 200 });
    }
    try {
      await ctx.runMutation(internal.webhook.handleEvolutionEvent, {
        token,
        payload,
      });
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

// How long after a change an engine without appointment_start (template < 14)
// is refused another one: long enough to cover a provider retry and a caller
// repeating "yes", short enough that a real second change later in a long
// call still goes through, against the next appointment as it always did.
const LEGACY_REPEAT_MS = 3 * 60_000;

// The same booking asked for twice is one booking (retell.voiceBook): the
// agent is told so, rather than reading a second confirmation as news.
const ALREADY_BOOKED_NOTE =
  "They already had exactly this booked, so nothing new was made. Confirm the booking they have, once.";

// What the voice tools answer when the call carries no usable caller number:
// a hidden caller ID, a web call, or a leg that resolved to the business's own
// line (retell.callerOfCall). Sentences the agent can act on, never a bare code
// that turns into "something went wrong" down the phone. Each one tells the
// agent NOT to take a number from the caller instead: a number read out loud
// is anybody's, and acting on it is the hole the call leg closes.
const NO_CALLER_NUMBER = {
  book: {
    error: "no-caller-number",
    note:
      "This call has no caller number (hidden caller ID or an internet call), so no booking can be made on it. Do not ask for their number to book with instead. Say so plainly and ask them to call back from their own phone with caller ID on.",
  },
  appointments: {
    error: "no-caller-number",
    note:
      "This call has no caller number (hidden caller ID or an internet call), so their appointments cannot be looked up or changed on it. Do not ask for their number to look one up instead. Say so plainly and ask them to call back from the phone they booked with, with caller ID on.",
  },
  save: {
    saved: false,
    reason: "no-caller-number",
    message:
      "This call has no caller number, so nothing can be saved to a customer record during it. Carry on with the call and do not say anything was saved.",
  },
};

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
    let agentId = String(inbound.agent_id ?? "");
    const fromNumber = String(inbound.from_number ?? "");
    // A number bound via Retell's weighted inbound_agents array sends no
    // agent_id here; the dialled line still names the agent. Without this,
    // the early "unknown agent" return meant every inbound call on such a
    // number ran without dynamic variables — see agentForInboundNumber.
    if (!agentId) {
      const toNumber = String(inbound.to_number ?? "");
      if (toNumber) {
        agentId =
          (await ctx.runQuery(internal.retell.agentForInboundNumber, {
            number: toNumber,
          })) ?? "";
      }
    }
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
    // WHO IS CALLING comes from the call, never from the model (2026-10-13).
    // The customer's leg by direction, normalized with the org's dial code and
    // never the business's own line: retell.callerOfCall, the same reading
    // recordCall makes once the call ends. This used to prefer `args.phone`,
    // so a caller who read out somebody else's number could have that
    // person's appointment found, moved or cancelled, or details saved onto
    // their record. A phone argument an older agent still sends is ignored.
    //
    // null = no usable number: a hidden caller ID, a web call, or a leg that
    // resolved to the business itself. Every tool that needs to know whose
    // record this is refuses then, with a sentence the agent can say.
    //
    // Resolved on first use, not up front: check_availability is the tool an
    // agent calls most and needs no caller, and every round trip here is
    // silence on a live line.
    let caller: { phone: string | null; customerId: Id<"customers"> | null } | null = null;
    const callerOfCall = async () =>
      (caller ??= await ctx.runQuery(internal.retell.callerOfCall, {
        orgId: org._id,
        direction: String(call.direction ?? "") || undefined,
        fromNumber: String(call.from_number ?? "") || undefined,
        toNumber: String(call.to_number ?? "") || undefined,
      }));

    // The free times nearest one that is taken or shut, spoken, so a "no"
    // arrives with something to say yes to (retell.nearestFreeTimes, the
    // booking page's own slot rules). Only on refusals: it reads a few days
    // of the book, and the happy path must not pay for it.
    const nearestFree = async (a: {
      at: number;
      services?: string[];
      // A move: the start of the caller's appointment being moved.
      moving?: number;
    }): Promise<{ nearest_free?: string[] }> => {
      if (!Number.isFinite(a.at)) return {};
      const who = await callerOfCall();
      const near = await ctx.runQuery(internal.retell.nearestFreeTimes, {
        orgId: org._id,
        at: a.at,
        ...(who.customerId ? { customerId: who.customerId } : {}),
        ...(a.moving !== undefined ? { moving: a.moving } : {}),
        ...(a.services && a.services.length > 0 ? { services: a.services } : {}),
      });
      return near.length > 0
        ? { nearest_free: near.map((ms) => spokenDateTime(ms, org.timezone, org.language)) }
        : {};
    };

    // Loaded once for the whole tool call, because startRefusal below is a
    // synchronous closure and check_availability needs the same rows — two
    // reads of one table inside one request that must agree with each other.
    const closures = await ctx.runQuery(internal.closures.forOrg, {
      orgId: org._id,
    });

    // The three things an agent-supplied start has to survive before it becomes
    // a row. One copy, shared by both write branches, because it WAS written
    // twice and the second copy — reschedule_appointment — had none of the
    // three and read the timezone wrong on top of that. An agent can name any
    // instant; the prompt is the cooperative layer, and a write to the
    // appointments table has to hold the invariant itself.
    //
    // `did` is the verb the agent repeats to the caller, so it has to match
    // what was actually refused: a booking that never happened, or a move that
    // did not take.
    const startRefusal = (
      startAt: number,
      did: "booked" | "moved",
    ): Record<string, unknown> | null => {
      // A date the model made up parses just as cleanly as one the caller
      // said. This booked 8 June 2024 off a live call — two years past, a
      // confirmation sent for it, and a slot in the salon's list nobody can
      // explain. Handing the miss back is the only safe answer: the agent can
      // ask again, and inventing a plausible date on the caller's behalf is
      // exactly what it must not do.
      const now = Date.now();
      if (startAt < now - 5 * 60_000) return { error: "start-is-in-the-past" };
      if (startAt > now + 400 * 24 * 60 * 60_000) {
        return { error: "start-is-too-far-ahead" };
      }
      // check_availability TELLS the agent the hours, but being told is not
      // being bound: on the call that exposed this, that tool failed its
      // signature check and answered nothing, so the model proposed 08:00 at a
      // salon opening at 09:00 and nothing here disagreed.
      //
      // Checked before cal.com too, and deliberately: businessHours is the
      // salon's own statement of when it is open, so a slot outside it is
      // wrong whichever calendar is holding the inventory — and refusing here
      // avoids creating a provider booking we would then have to undo.
      const openHours = org.businessHours;
      // The closure test stands on its OWN, outside the hasBusinessHours
      // conjunction. Inside it, an org that declared a holiday but never typed
      // its opening hours had that holiday silently skipped — and "we never
      // said when we open" is not a reason to book somebody on Bayram.
      const localAt = getLocalPartsSafe(startAt, org.timezone);
      const shut = closureBlocks(
        closures,
        localAt,
        localAt.minutesOfDay,
        localAt.minutesOfDay,
      );
      if (
        shut ||
        (openHours &&
          hasBusinessHours(openHours) &&
          !isWithinActiveWindow(startAt, org.timezone, openHours, closures))
      ) {
        // Speakable, not a bare code. An error the agent cannot act on becomes
        // "something went wrong" down the phone and ends a call that was one
        // sentence from booking; handed the hours, it counters with a time
        // that works.
        return {
          error: "outside-open-hours",
          attempted: spokenDateTime(startAt, org.timezone, org.language),
          ...openHoursForAgent(openHours, {
            closures,
            todayIso: todayInZone(org.timezone),
          }),
          note:
            `The salon is CLOSED then, so this was not ${did}. Tell the caller` +
            " and offer the nearest time inside open_hours, on a day that is not" +
            " in closed_days, avoiding closed_times and upcoming_closures. If" +
            " one of those names a reason, say it — \"we're closed for the" +
            " holiday that day\" is an answer; going quiet is not.",
        };
      }
      return null;
    };

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
        const openness = openHoursForAgent(hours, {
          closures,
          todayIso: today,
        });
        const suggested = suggestFreeSlots({
          dayIso,
          tz: org.timezone,
          hours,
          full: booked.full,
          closures,
          nowMs: Date.now(),
        });
        // The time the caller asked for, answered as a fact: the chat tool's
        // `time`, given to the phone too (2026-10-13). Without it the agent
        // read a list of booked times and worked out the answer itself, and
        // a taken time came back as a bare no.
        const asked =
          typeof args.time === "string"
            ? judgeRequestedTime({
                dayIso,
                time: args.time,
                tz: org.timezone,
                hours,
                full: booked.full,
                closures,
                nowMs: Date.now(),
              })
            : null;
        const requested = asked
          ? {
              requested_time: {
                time: spokenDateTime(asked.at, org.timezone, org.language),
                available: asked.available,
                ...(asked.reason ? { reason: asked.reason } : {}),
                ...(asked.available ? {} : await nearestFree({ at: asked.at })),
              },
            }
          : {};
        return respond({
          date: dayIso,
          ...requested,
          // Speakable ranges, not raw timestamps: this body goes to the LLM
          // verbatim and gets read down a phone line.
          // FULL times, not merely booked ones — a shop with four people
          // working can take four at once, so a single 14:00 booking is not a
          // reason to turn anybody away. bookedBetween does that arithmetic.
          booked_slots: booked.full.map((slot) => ({
            start: spokenDateTime(slot.startAt, org.timezone, org.language),
            duration_minutes: slot.durationMinutes ?? 30,
          })),
          ...(suggested.length > 0
            ? {
                suggested_slots: suggested.map((at) =>
                  spokenDateTime(at, org.timezone, org.language),
                ),
              }
            : {}),
          // open_hours says when the doors are open; closed_days says which
          // days they never open at all. The second used to be missing, so an
          // agent that knew "09:00-18:00" would offer 09:00 on a Sunday the
          // salon is shut.
          ...openness,
          note:
            (asked
              ? "requested_time answers the time the caller asked for; trust it." +
                (asked.available ? " " : ` ${NEAREST_FREE_NOTE} `)
              : "") +
            (suggested.length > 0
              ? "Offer two or three of suggested_slots as concrete times." +
                " Never answer by reciting the opening hours. "
              : "") +
            "These times are FULL — every person is already busy. Offer times" +
            " that avoid them" +
            (openness.open_hours ? ", stay inside open_hours" : "") +
            (openness.closed_days ? ", never offer a date on closed_days" : "") +
            // The exception list has to name EVERY exception. It used to end
            // "everything else is free", which flatly contradicted the
            // closed_times and upcoming_closures shipped in this same payload
            // — and an exhaustive-sounding sentence beats a field the model
            // has to notice on its own.
            (openness.closed_times ? ", never inside closed_times" : "") +
            (openness.upcoming_closures
              ? ", and never on a date in upcoming_closures"
              : "") +
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
          spoken: spokenDateTime(Date.parse(iso), org.timezone, org.language),
        })),
      });
    }

    if (name === "book_appointment") {
      // Wall time at the BUSINESS, not UTC — see parseLocalStart. An agent
      // writing down "five o'clock tomorrow" as a zone-less stamp used to
      // book two hours late in summer Vienna.
      const startAt = parseLocalStart(String(args.start ?? ""), org.timezone);
      // A placeholder ("Bilinmiyor", "Yok") is no name (lib/nonAnswer): it is
      // answered as a missing one, so the agent asks rather than filing a
      // booking, and a customer card, under it.
      const customerName = answerOrEmpty(String(args.name ?? "").trim(), "name");
      // Nudge's rule for a booking nobody can be identified for: refuse it and
      // say why. A number the caller reads out is exactly what must not be
      // booked against, so the agent is told not to ask for one.
      const callerPhone = (await callerOfCall()).phone;
      if (!callerPhone) return respond(NO_CALLER_NUMBER.book);
      if (Number.isNaN(startAt) || !customerName) {
        return respond({ error: "missing-name-or-start" });
      }
      // Whatever the caller called them. Matching against the org's own
      // list happens in voiceBook, not here and not in the agent's prompt.
      //
      // Both shapes accepted: template v4 sends `services`, and an agent
      // whose owner has not clicked the update banner still sends the
      // singular `service`. A model improvising a comma-separated string
      // into the array field is caught here too, because one entry of
      // "saç kesimi, sakal" would otherwise match nothing at all.
      const spokenServices = Array.isArray(args.services)
        ? args.services
            .flatMap((one) => String(one ?? "").split(","))
            .map((one) => one.trim())
            .filter(Boolean)
        : undefined;
      const spokenService = String(args.service ?? "").trim() || undefined;
      const asked = spokenServices ?? (spokenService ? [spokenService] : undefined);
      const refusal = startRefusal(startAt, "booked");
      if (refusal) {
        return respond({
          ...refusal,
          ...(refusal.error === "outside-open-hours"
            ? await nearestFree({ at: startAt, services: asked })
            : {}),
        });
      }
      let externalUid: string | undefined;
      if (org.calcomApiKey && org.calcomEventTypeId) {
        // Goods-only orders never touch cal.com: nothing zero-length exists
        // there, and an externalUid would make voiceBook skip its own guards
        // — the lead-time check included. Local book, local truth.
        const { goodsOnly } = (await ctx.runQuery(internal.retell.classifyServices, {
          orgId: org._id,
          spoken: spokenServices ?? (spokenService ? [spokenService] : []),
        })) as { goodsOnly: boolean };
        if (!goodsOnly) {
          const booking = await createBooking({
            apiKey: org.calcomApiKey,
            eventTypeId: org.calcomEventTypeId,
            startIso: new Date(startAt).toISOString(),
            name: customerName,
            phone: callerPhone,
            timeZone: org.timezone,
            language: org.language,
          });
          if (!booking.ok) return respond({ error: booking.reason });
          externalUid = booking.uid;
        }
      }
      // A refusal comes back as DATA (retell.BookRefusal): a code to branch
      // on and the sentence the agent reads. It used to be thrown, and a
      // message crossing runMutation arrives as "Uncaught Error: …" with a
      // stack, so the checks below never matched and the agent was handed
      // the stack (review, 2026-10-13). Only a genuine failure throws now.
      let booking: AgentBooking;
      try {
        booking = await ctx.runMutation(internal.retell.voiceBook, {
          orgId: org._id,
          name: customerName,
          phone: callerPhone,
          startAt,
          externalUid,
          services: spokenServices,
          service: spokenService,
        });
      } catch (err) {
        console.error("voice booking failed", cleanError(err));
        booking = {
          ok: false,
          code: "book-failed",
          note: "The booking could not be saved just now.",
        };
      }
      if (!booking.ok) {
        // Past the day's change cap, or the booking failing outright: the
        // agent says a colleague will be in touch, and the team is emailed
        // so that promise has an owner.
        if (booking.code === "too-many-changes" || booking.code === "book-failed") {
          await queueOrgAlert(ctx, {
            orgId: org._id,
            template: "bookNeedsPerson",
            who: customerName || callerPhone,
            detail: formatAppointmentTime(startAt, org.timezone, org.language),
          });
          return respond({
            booked: false,
            error: booking.code,
            note:
              booking.code === "too-many-changes"
                ? changeRefusalNote("too-many-changes", "booked", "voice")
                : `${booking.note} Tell the caller a colleague will be in touch about it, and carry on.`,
          });
        }
        // A taken time or the caller's own clash: the nearest free times
        // either side, so the agent counters instead of stalling.
        const near =
          booking.code === "slot-taken" || booking.code === "customer-busy"
            ? await nearestFree({ at: startAt, services: asked })
            : {};
        return respond({
          booked: false,
          error: booking.code,
          ...near,
          note: booking.note + (near.nearest_free ? ` ${NEAREST_FREE_NOTE}` : ""),
        });
      }
      return respond({
        booked: true,
        spoken_time: spokenDateTime(startAt, org.timezone, org.language),
        // Absent means the spoken service matched nothing the salon offers.
        // The booking still stands; the agent can read this back to confirm,
        // and its absence is the cue to ask again rather than assume.
        service: booking.serviceName,
        // Every service on the visit, so the agent confirms the whole thing
        // rather than the first line of it. Shorter than what was asked for
        // means the rest matched nothing.
        services: booking.serviceNames,
        // A retried call or a repeated yes: they already held exactly this.
        ...(booking.existing ? { already_booked: true, note: ALREADY_BOOKED_NOTE } : {}),
        // The business's own confirmation is on its way, so the agent can
        // say a message will follow only when one will.
        ...(booking.notified ? { confirmation_sent: true } : {}),
      });
    }

    // Set org-defined contact properties mid-call. The org decides which
    // properties exist (Settings → contact fields); this endpoint only fills
    // in the ones already there.
    //
    // Two names for one write: save_customer_details is what every agent
    // prompt teaches — it arrived here from the runtime MCP surface (template
    // v10), where Retell's round trip cost ~12 seconds of dead air per save.
    if (name === "update_contact" || name === "save_customer_details") {
      const callerPhone = (await callerOfCall()).phone;
      if (!callerPhone) return respond(NO_CALLER_NUMBER.save);
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

    // Everything below addresses an appointment the caller already has: WHO
    // from the call leg (callerOfCall), WHICH from the start the agent read
    // back (`appointment_start`, as find_appointment gave it). No tool here
    // takes a customer, a phone or an appointment id from the model. The
    // write acts only on the caller's own open appointment at exactly that
    // minute, re-runs the booking page's calendar rules for a move at the
    // moment of the change, and stops at six changes a day (lib/agentChange).
    // A repeat (a provider retry, a second "yes") finds the appointment
    // already cancelled or already moved and answers so, rather than acting
    // on the one after it.
    //
    // cal.com is told BEFORE our status moves (agentAppointments
    // .writeOwnChange): it owns the slot inventory, the salon's Google
    // Calendar and the notification emails. A walk-in typed in by hand has no
    // externalUid and so has nothing on cal.com to move.
    if (
      name === "find_appointment" ||
      name === "cancel_appointment" ||
      name === "reschedule_appointment"
    ) {
      const who = await callerOfCall();
      if (!who.phone) return respond(NO_CALLER_NUMBER.appointments);
      // A number nobody is filed under has nothing booked.
      const own = who.customerId
        ? await ctx.runQuery(internal.agentAppointments.ownNext, {
            orgId: org._id,
            customerId: who.customerId,
          })
        : null;
      const next = own?.next ?? null;
      const spokenOf = (at: number) =>
        spokenDateTime(at, org.timezone, org.language);
      // Whether this agent's tools carry appointment_start (template v14 on).
      // Tool answers reach every engine, so nothing here may tell an older
      // one to pass a parameter its tools do not have.
      const namesStart = (context.agent.templateVersion ?? 0) >= 14;

      // Lets the agent name the appointment before acting on it, instead of
      // cancelling whatever happens to be next for a caller with two bookings.
      if (name === "find_appointment") {
        if (!own || !next) return respond({ found: false });
        const later =
          own.later > 0
            ? `They have ${own.later} more appointment${own.later === 1 ? "" : "s"} after this one. Only this one can be moved or cancelled on this call.`
            : "";
        return respond({
          found: true,
          spoken_time: spokenOf(next.startAt),
          ...(namesStart
            ? { appointment_start: localMinuteIso(next.startAt, org.timezone) }
            : {}),
          ...(next.services.length > 0 ? { services: next.services } : {}),
          ...(own.later > 0 ? { later_appointments: own.later } : {}),
          ...(namesStart || later
            ? {
                note: [
                  later,
                  namesStart
                    ? "To move or cancel it, pass appointment_start exactly as given here."
                    : "",
                ]
                  .filter(Boolean)
                  .join(" "),
              }
            : {}),
        });
      }
      if (!own || !who.customerId) {
        return respond({ error: "no-upcoming-appointment" });
      }

      // WHICH appointment. The one the agent read back, by its start. An
      // engine published before appointment_start (template < 14) can only
      // mean "the next one", so it gets that, but never straight after a
      // change: a provider retry or a second "yes" would otherwise land on
      // the appointment after the one just changed (review, same day).
      const named =
        typeof args.appointment_start === "string"
          ? parseLocalStart(args.appointment_start, org.timezone)
          : Number.NaN;
      let from: number;
      if (Number.isFinite(named)) {
        from = named;
      } else if (namesStart) {
        return respond({
          error: "missing-appointment-start",
          note: "Call find_appointment, name the appointment it returns, get a clear yes, then call this again with its appointment_start.",
        });
      } else {
        if (!next) return respond({ error: "no-upcoming-appointment" });
        if (own.lastChangeAt !== null && Date.now() - own.lastChangeAt < LEGACY_REPEAT_MS) {
          return respond({
            error: "just-changed",
            note: "Something was just changed for this caller, so nothing more is changed on this call. If they need another change, tell them a colleague will be in touch about it.",
          });
        }
        from = next.startAt;
      }
      const target = { orgId: org._id, customerId: who.customerId, from };
      const did = name === "cancel_appointment" ? "cancelled" : "moved";
      const outcome = did === "cancelled" ? "cancelled" : "rescheduled";
      // A change the agent cannot make, answered so it can say what happens
      // next. When that is "a colleague will be in touch" (the cap, or the
      // calendar failing), the team is emailed in the same breath: nobody is
      // reading a live call, and a promise with no owner is worse than none.
      const refuse = async (reason: string, providerError?: string, at?: number) => {
        const known = isChangeRefusal(reason) ? reason : "calendar-error";
        const near =
          at !== undefined && isTimeRefusal(known)
            ? await nearestFree({ at, moving: from })
            : {};
        if (known === "too-many-changes" || known === "calendar-error") {
          await queueOrgAlert(ctx, {
            orgId: org._id,
            template: did === "cancelled" ? "cancelNeedsPerson" : "moveNeedsPerson",
            who: own.customerName,
            detail: formatAppointmentTime(from, org.timezone, org.language),
          });
        }
        return respond({
          [outcome]: false,
          error: known,
          // A move that would leave the day's hours: hand back the hours, so
          // the agent can counter with a time that fits.
          ...(known === "outside-open-hours"
            ? openHoursForAgent(org.businessHours ?? null, {
                closures,
                todayIso: todayInZone(org.timezone),
              })
            : {}),
          ...(providerError ? { provider_error: providerError } : {}),
          ...near,
          note:
            changeRefusalNote(known, did, "voice") +
            (near.nearest_free ? ` ${NEAREST_FREE_NOTE}` : ""),
        });
      };
      // The cap answers first, before cal.com is asked anything.
      if (own.changesToday >= CHANGES_PER_DAY) return await refuse("too-many-changes");
      const write = (change: { kind: "cancel" } | { kind: "move"; to: number }) =>
        writeOwnChange(ctx, {
          target,
          calcomApiKey: org.calcomApiKey ?? undefined,
          change,
          via: "phone",
        });

      if (name === "cancel_appointment") {
        const done = await write({ kind: "cancel" });
        if (!done.ok) return await refuse(done.reason, done.providerError);
        return respond({
          cancelled: true,
          spoken_time: spokenOf(from),
          ...(done.noop
            ? {
                already_cancelled: true,
                note: "It was already cancelled; nothing else was changed. Tell the caller it is cancelled, once.",
              }
            : {}),
          ...(done.notified ? { confirmation_sent: true } : {}),
        });
      }

      // Wall time at the BUSINESS, not UTC — the same parse book_appointment
      // uses, and for the same reason. Date.parse read the agent's zone-less
      // stamp as UTC on a runtime whose zone IS UTC, so an Istanbul caller
      // asking to move to five o'clock had it written at eight: cal.com moved
      // with it, every reminder recomputed off the wrong instant, and the tool
      // then read "eight o'clock" back down the phone to someone who said five.
      const startAt = parseLocalStart(String(args.start ?? ""), org.timezone);
      if (Number.isNaN(startAt)) return respond({ error: "missing-or-bad-start" });
      // The start instant first, for the rich refusal (the hours, the
      // closures, the reason). moveOwn then judges the whole span, capacity
      // and the caller's other bookings in the transaction that writes.
      const refusal = startRefusal(startAt, "moved");
      if (refusal) {
        return respond({
          ...refusal,
          ...(refusal.error === "outside-open-hours"
            ? await nearestFree({ at: startAt, moving: from })
            : {}),
        });
      }
      const done = await write({ kind: "move", to: startAt });
      if (!done.ok) return await refuse(done.reason, done.providerError, startAt);
      return respond({
        rescheduled: true,
        spoken_time: spokenOf(startAt),
        ...(done.noop
          ? {
              already_moved: true,
              note: "It is already booked at that time; nothing else was changed. Tell the caller, once.",
            }
          : {}),
        ...(done.notified ? { confirmation_sent: true } : {}),
      });
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

// Stripe's side of a wallet top-up (wallet.ts owns the session; this lands
// the money). Signature-verified against the endpoint secret before the body
// is trusted, like every other webhook here. Only checkout.session.completed
// matters; every other event type is acknowledged and dropped, so the Stripe
// dashboard can send whatever event set it likes. The credit is idempotent
// on the session id inside creditTopup, so Stripe's retries are welcome —
// which is also why an unpaid or malformed session returns 200 rather than
// an error: a response Stripe retries forever should be reserved for "we
// could not process a real credit", not "this event was not for us".
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const secret = await ctx.runQuery(internal.wallet.stripeWebhookSecret, {});
    if (!secret) return new Response("not configured", { status: 503 });
    const valid = await verifyStripeSignature(
      secret,
      rawBody,
      request.headers.get("stripe-signature"),
    );
    if (!valid) return new Response("bad signature", { status: 401 });
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (String(event.type ?? "") === "checkout.session.completed") {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const session = (data.object ?? {}) as Record<string, unknown>;
      const orgId = String(session.client_reference_id ?? "");
      const sessionId = String(session.id ?? "");
      const amountCents = Number(session.amount_total);
      if (
        orgId &&
        sessionId &&
        String(session.payment_status ?? "") === "paid" &&
        Number.isFinite(amountCents) &&
        amountCents > 0
      ) {
        // Normalised inside the mutation rather than cast with `as never`
        // here: this reference came off a Stripe account the whole deployment
        // shares, so it is not necessarily one of ours, and an id that fails
        // argument validation used to throw straight out of this httpAction —
        // a 500 that Stripe retries for days before disabling the endpoint,
        // with real top-ups stuck behind it.
        const ours = await ctx.runMutation(internal.wallet.creditStripeSession, {
          clientReferenceId: orgId,
          amountMicroUsd: Math.round(amountCents * 10_000),
          stripeSessionId: sessionId,
        });
        // Deliberately not thrown. A reference that is not ours is exactly the
        // "this event was not for us" case the header reserves a 200 for; a
        // real credit that fails still throws from the mutation and earns the
        // retry.
        if (!ours) {
          console.warn(
            `stripe session ${sessionId} referenced "${orgId}", which is not an org on this deployment — ignored`,
          );
        }
      }
    }
    return Response.json({ received: true });
  }),
});

// JSON-RPC endpoint, not a REST tree. GET is routed so the handler can explain
// itself to a client probing for the deprecated SSE transport.
for (const method of ["GET", "POST"] as const) {
  http.route({ path: "/mcp", method, handler: mcpHandler });
  http.route({ path: "/retell/mcp", method, handler: voiceMcpHandler });
}

export default http;
