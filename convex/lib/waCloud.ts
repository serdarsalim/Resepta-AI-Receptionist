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
