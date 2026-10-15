// Operator-configured copies of one number's events. Never forward a mixed
// Meta batch: it can contain customers belonging to other businesses.
export type WaWebhookMirror = { phoneNumberId: string; wabaId: string; url: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function webhookMirrors(raw: string | undefined): WaWebhookMirror[] {
  if (!raw) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 10) throw new Error("invalid-wa-webhook-mirrors");
  return values.map((value) => {
    const row = record(value);
    if (!row || typeof row.phoneNumberId !== "string" || !/^\d+$/.test(row.phoneNumberId)
      || typeof row.wabaId !== "string" || !/^\d+$/.test(row.wabaId)
      || typeof row.url !== "string") throw new Error("invalid-wa-webhook-mirror");
    const url = new URL(row.url);
    // Only our hosted Nudge receiver; an env typo cannot send customer data
    // to another service, a query-string credential or this webhook itself.
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.convex\.site$/.test(url.hostname)
      || url.pathname !== "/whatsapp/cloud-webhook" || url.search || url.hash
      || url.username || url.password || url.port) throw new Error("invalid-wa-webhook-mirror-url");
    return { phoneNumberId: row.phoneNumberId, wabaId: row.wabaId, url: url.href };
  });
}

export function payloadForMirror(payload: unknown, mirror: WaWebhookMirror): object | null {
  const body = record(payload);
  if (body?.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return null;
  const entry = body.entry.flatMap((item: unknown) => {
    const row = record(item);
    if (row?.id !== mirror.wabaId || !Array.isArray(row.changes)) return [];
    const changes = row.changes.filter((item: unknown) => {
      const change = record(item);
      const value = record(change?.value);
      if (!value) return false;
      if (change?.field === "message_template_status_update") return true;
      return change?.field === "messages"
        && record(value.metadata)?.phone_number_id === mirror.phoneNumberId;
    });
    return changes.length ? [{ id: row.id, changes }] : [];
  });
  return entry.length ? { object: body.object, entry } : null;
}
