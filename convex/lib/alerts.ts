// Staff alerts: the two per-user switches (users.notifyInbound,
// users.notifyFailedSend) turned into actual email.
//
// ── SIGNATURE FOR CALL SITES (convex/webhook.ts, convex/wa.ts) ───────────────
//
//   import { queueOrgAlert } from "./lib/alerts";
//
//   await queueOrgAlert(ctx, {
//     orgId,                                  // Id<"orgs">
//     kind: "inbound",                        // "inbound" | "failed-send"
//     subject: "New WhatsApp reply",
//     body: "Ayse Yilmaz replied on WhatsApp.",
//   });
//
// `ctx` may be a mutation ctx OR an action ctx: only `ctx.scheduler` is
// touched, so the inbound webhook (an internalMutation) and the send path (an
// internalAction) both call it the same way.
//
// It never throws. The alert is SCHEDULED, not sent inline, which is the whole
// point: from a mutation, runAfter only survives if the transaction commits,
// and the delivery failing later cannot roll back the message row that
// triggered it. A salon losing an alert email is bad; a salon losing the
// customer's actual message because the alert broke is unforgivable.
//
// Delivery rides the same n8n webhook as customer email (lib/email.ts), from
// the org's own From address. No emailFrom set, or no N8N_EMAIL_WEBHOOK_URL on
// the deployment, means the org has no email lane at all and the alert is
// dropped silently.
//
// COPY: these strings are staff-facing operational English written at the call
// site. Once alerts get a real template, the salon-facing wording belongs in
// the i18n dictionary (src/lib/i18n.ts) and should resolve per org language,
// same as every other customer-visible surface.

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Scheduler } from "convex/server";
import { internalAction, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { sendEmailViaN8n } from "./email";

export type AlertKind = "inbound" | "failed-send";

export const alertKindValidator = v.union(
  v.literal("inbound"),
  v.literal("failed-send"),
);

// THE default that matters: unset reads as ON. A customer reply nobody sees is
// the exact failure this product exists to prevent, so silence has to be opted
// into, never defaulted into. users.myProfile resolves the same way — keep the
// two reading through this one function so they can never drift apart.
export function alertEnabled(
  prefs: { notifyInbound?: boolean; notifyFailedSend?: boolean },
  kind: AlertKind,
): boolean {
  const stored = kind === "inbound" ? prefs.notifyInbound : prefs.notifyFailedSend;
  return stored ?? true;
}

// Customer text (a WhatsApp reply, a Meta error string) reaches the body, so it
// gets escaped before it lands in an HTML email.
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Who hears about this alert: every member of the org with the switch on and an
// address to send to. Org-scoped by construction (memberships by_org); there is
// no path here that reads another salon's people.
export const alertRecipients = internalQuery({
  args: { orgId: v.id("orgs"), kind: alertKindValidator },
  returns: v.object({
    from: v.optional(v.string()),
    emails: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { from: undefined, emails: [] };
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const emails: string[] = [];
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      // No address, nothing to send to. Not an error: a member can exist
      // before their profile carries an email.
      if (!user?.email) continue;
      if (!alertEnabled(user, args.kind)) continue;
      if (!emails.includes(user.email)) emails.push(user.email);
    }
    return { from: org.emailFrom, emails };
  },
});

// Fan-out. Registered internal, but referenced through makeFunctionReference
// below rather than `internal.lib.alerts` because convex/_generated is checked
// in and does not yet list this module. Once someone runs `npx convex dev` the
// generated api picks up "lib/alerts" and these two refs can become plain
// `internal["lib/alerts"].*` lookups.
export const deliverOrgAlert = internalAction({
  args: {
    orgId: v.id("orgs"),
    kind: alertKindValidator,
    subject: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const webhookUrl = process.env.N8N_EMAIL_WEBHOOK_URL;
      if (!webhookUrl) return null;
      const { from, emails } = await ctx.runQuery(alertRecipientsRef, {
        orgId: args.orgId,
        kind: args.kind,
      });
      if (!from || emails.length === 0) return null;
      const html = `<p>${escapeHtml(args.body).replace(/\n/g, "<br/>")}</p>`;
      // sendEmailViaN8n reports failure rather than throwing, and one bad
      // address must not cost the rest of the team their alert.
      for (const to of emails) {
        await sendEmailViaN8n({ webhookUrl, from, to, subject: args.subject, html });
      }
    } catch {
      // Swallowed on purpose. This runs detached from the write that triggered
      // it and has nobody to report to; throwing would only burn retries.
    }
    return null;
  },
});

const alertRecipientsRef = makeFunctionReference<
  "query",
  { orgId: Id<"orgs">; kind: AlertKind },
  { from?: string; emails: string[] }
>("lib/alerts:alertRecipients");

const deliverOrgAlertRef = makeFunctionReference<
  "action",
  { orgId: Id<"orgs">; kind: AlertKind; subject: string; body: string },
  null
>("lib/alerts:deliverOrgAlert");

// The call sites' entry point. See the header for usage.
export async function queueOrgAlert(
  ctx: { scheduler: Scheduler },
  args: { orgId: Id<"orgs">; kind: AlertKind; subject: string; body: string },
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(0, deliverOrgAlertRef, args);
  } catch {
    // Never throw into the caller. See the header.
  }
}
