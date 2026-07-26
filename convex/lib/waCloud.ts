// Meta WhatsApp Cloud API send helpers. The session-message half is ported
// from Nudge (convex/lib/waCloud.ts there); the template-message half is new —
// Randevu's core sends (confirmations, reminders) are business-initiated, so
// they ride pre-approved template messages and work outside the 24h window.

export const WA_CLOUD_GRAPH_BASE = "https://graph.facebook.com/v23.0";

export type WaCloudSendResult =
  | { ok: true; wamid?: string }
  | { ok: false; reason: string };

// One POST to /{phone_number_id}/messages. Non-2xx surfaces Meta's error code
// + message as the reason so failures (bad token, unapproved template, 131047)
// are readable straight off the message row.
async function postWaCloud(
  accessToken: string,
  phoneNumberId: string,
  payload: Record<string, unknown>,
): Promise<WaCloudSendResult> {
  try {
    const res = await fetch(
      `${WA_CLOUD_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      let detail = "";
      try {
        const err = (await res.json()) as {
          error?: { code?: number; message?: string };
        };
        if (err.error) detail = `-${err.error.code}: ${err.error.message}`;
      } catch {
        /* non-JSON error body — status alone is the reason */
      }
      return { ok: false, reason: `wa-cloud-http-${res.status}${detail}` };
    }
    const out = (await res.json()) as { messages?: { id?: string }[] };
    return { ok: true, wamid: out.messages?.[0]?.id };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "wa-cloud send failed",
    };
  }
}

// ---- Template messages (business-initiated; the Randevu send path) ----

// Body params fill {{1}}..{{n}} in order. Buttons attach payloads to the
// template's pre-registered quick-reply buttons by index; the payload comes
// back verbatim on the inbound webhook (button.payload), which is how a tap
// maps to an exact appointment.
export function waCloudTemplatePayload(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
  buttons?: { index: number; payload: string }[],
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    });
  }
  for (const button of buttons ?? []) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(button.index),
      parameters: [{ type: "payload", payload: button.payload }],
    });
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

export async function sendWaCloudTemplate(args: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  bodyParams: string[];
  buttons?: { index: number; payload: string }[];
}): Promise<WaCloudSendResult> {
  return postWaCloud(
    args.accessToken,
    args.phoneNumberId,
    waCloudTemplatePayload(
      args.to,
      args.templateName,
      args.languageCode,
      args.bodyParams,
      args.buttons,
    ),
  );
}

// ---- Session messages (free-form; only inside the 24h window a customer's
// inbound message opens). Kept for future two-way chat; sends outside the
// window fail loudly with Meta's 131047.  ----

export function waCloudTextPayload(
  to: string,
  body: string,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body },
  };
}

export async function sendWaCloudText(args: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  body: string;
}): Promise<WaCloudSendResult> {
  return postWaCloud(
    args.accessToken,
    args.phoneNumberId,
    waCloudTextPayload(args.to, args.body),
  );
}

// ---- Outbound images (session lane) ----
//
// Sent by LINK rather than by uploading to Meta's media endpoint first. Meta
// fetches the URL itself, which means one round trip instead of two and no
// media id to store and expire. The link has to be publicly reachable — a
// Convex storage URL is, which is why the library keeps blobs there.
//
// Session-only, like the text lane: an image cannot open a conversation. A
// template with a media header is a different payload and needs Meta approval,
// so it belongs with the template sends and not here.
export function waCloudImagePayload(
  to: string,
  link: string,
  caption?: string,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { link, ...(caption ? { caption } : {}) },
  };
}

export async function sendWaCloudImage(args: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  link: string;
  caption?: string;
}): Promise<WaCloudSendResult> {
  return postWaCloud(
    args.accessToken,
    args.phoneNumberId,
    waCloudImagePayload(args.to, args.link, args.caption),
  );
}

// ---- Inbound media ----
//
// Meta hands the webhook a media ID, not the bytes, and the download is TWO
// calls: the ID resolves to a short-lived URL, and that URL only serves to a
// request carrying the access token. Both are why the image has to be pulled
// into our own storage rather than linked — a Meta media URL is a broken
// image by the next morning, and the token can never reach a browser.
export async function fetchWaMedia(args: {
  accessToken: string;
  mediaId: string;
}): Promise<{ blob: Blob; contentType: string } | null> {
  try {
    const lookup = await fetch(`${WA_CLOUD_GRAPH_BASE}/${args.mediaId}`, {
      headers: { authorization: `Bearer ${args.accessToken}` },
    });
    if (!lookup.ok) return null;
    const meta = (await lookup.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;
    const file = await fetch(meta.url, {
      headers: { authorization: `Bearer ${args.accessToken}` },
    });
    if (!file.ok) return null;
    const blob = await file.blob();
    return {
      blob,
      contentType: meta.mime_type ?? blob.type ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}
