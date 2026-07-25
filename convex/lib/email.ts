// Email delivery via the shared n8n send-email workflow (same infra as
// Nudge's "Shared - Send Email": custom From routes to SMTP, else Gmail).
// The webhook URL is deployment-level (N8N_EMAIL_WEBHOOK_URL); the From
// address is per-org (orgs.emailFrom).

export type EmailSendResult = { ok: true } | { ok: false; reason: string };

export async function sendEmailViaN8n(args: {
  webhookUrl: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<EmailSendResult> {
  try {
    const res = await fetch(args.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
      }),
    });
    if (!res.ok) return { ok: false, reason: `n8n-email-http-${res.status}` };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "n8n-email-failed",
    };
  }
}
