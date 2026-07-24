import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

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

// Always 200: Meta retries non-2xx for hours and disables the webhook after
// repeated failures, so a payload we can't use is still an acknowledged one.
http.route({
  path: "/whatsapp/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let payload: unknown;
    try {
      payload = await request.json();
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

export default http;
