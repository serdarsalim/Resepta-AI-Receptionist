// Staff alerts: the two per-user switches (users.notifyInbound,
// users.notifyFailedSend) turned into actual email.
//
// ── SIGNATURE FOR CALL SITES (convex/webhook.ts, convex/wa.ts) ───────────────
//
//   import { queueOrgAlert } from "./lib/alerts";
//
//   await queueOrgAlert(ctx, {
//     orgId,                       // Id<"orgs">
//     template: "inboundText",     // a key of ALERT_COPY below
//     who: "Ayse Yilmaz",          // the person the alert is about
//     detail: message,             // optional, fills {detail}
//   });
//
// Call sites pass a template id and the two substitutions, NEVER a finished
// sentence. The wording resolves at delivery time from the ORG's language, so
// a Turkish salon gets Turkish and a German one gets German without every
// caller carrying three strings around.
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
// the deployment, means the org has no email lane at all. That case used to
// return silently while the account switches still promised email; it now logs
// and is readable from the `alertHealth` query below so the UI can say so.

import { v } from "convex/values";
import type { Scheduler } from "convex/server";
import { internal } from "../_generated/api";
import { internalAction, internalQuery, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOrg } from "./orgAuth";
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

// ---- Copy ------------------------------------------------------------------
//
// These strings live here rather than in src/lib/i18n.ts because Convex cannot
// import the frontend bundle. Same house rules as that dictionary: Turkish is
// siz-form with real diacritics, German is Sie-form and says DSGVO where the
// Turkish says KVKK. {who} is the customer, {detail} is whatever the template
// needs (the message text, the provider's error).

type AlertLanguage = "tr" | "en" | "de";

export type AlertTemplate =
  | "inboundText"
  | "inboundPlain"
  | "inboundConfirmed"
  | "inboundCancelled"
  | "failedNoTemplate"
  | "failedOther";

export const alertTemplateValidator = v.union(
  v.literal("inboundText"),
  v.literal("inboundPlain"),
  v.literal("inboundConfirmed"),
  v.literal("inboundCancelled"),
  v.literal("failedNoTemplate"),
  v.literal("failedOther"),
);

// One row per alert a salon can receive. `kind` is on the row, not on the call
// site, so the template and the switch it obeys can never drift apart.
const ALERT_COPY: Record<
  AlertTemplate,
  { kind: AlertKind; subject: Record<AlertLanguage, string>; body: Record<AlertLanguage, string> }
> = {
  inboundText: {
    kind: "inbound",
    subject: {
      tr: "{who} WhatsApp'tan yazdı",
      en: "{who} replied on WhatsApp",
      de: "{who} hat über WhatsApp geantwortet",
    },
    body: {
      tr: "{who} şunu yazdı:\n\n{detail}",
      en: "{who} wrote:\n\n{detail}",
      de: "{who} hat geschrieben:\n\n{detail}",
    },
  },
  inboundPlain: {
    kind: "inbound",
    subject: {
      tr: "{who} WhatsApp'tan yazdı",
      en: "{who} replied on WhatsApp",
      de: "{who} hat über WhatsApp geantwortet",
    },
    body: {
      tr: "{who} bir mesaj gönderdi. Gelen kutusundan okuyabilirsiniz.",
      en: "{who} sent a message. You can read it in the inbox.",
      de: "{who} hat eine Nachricht geschickt. Sie können sie im Posteingang lesen.",
    },
  },
  inboundConfirmed: {
    kind: "inbound",
    subject: {
      tr: "{who} randevusunu onayladı",
      en: "{who} confirmed their appointment",
      de: "{who} hat den Termin bestätigt",
    },
    body: {
      tr: "{who} randevusunu onayladı. Yapmanız gereken bir şey yok.",
      en: "{who} confirmed their appointment. Nothing for you to do.",
      de: "{who} hat den Termin bestätigt. Sie müssen nichts weiter tun.",
    },
  },
  inboundCancelled: {
    kind: "inbound",
    subject: {
      tr: "{who} randevusunu iptal etti",
      en: "{who} cancelled their appointment",
      de: "{who} hat den Termin abgesagt",
    },
    body: {
      tr: "{who} randevusunu iptal etti. Saat yeniden boşta, takviminize bakmakta fayda var.",
      en: "{who} cancelled. The slot is free again, so it is worth a look at your calendar.",
      de: "{who} hat abgesagt. Der Termin ist wieder frei, ein Blick in Ihren Kalender lohnt sich.",
    },
  },
  failedNoTemplate: {
    kind: "failed-send",
    subject: {
      tr: "{who} kişisine mesaj gitmedi",
      en: "The message to {who} did not send",
      de: "Die Nachricht an {who} ging nicht raus",
    },
    body: {
      tr: "Kişinin dilinde onaylı bir şablon yok, bu yüzden hiçbir şey gönderilmedi. Şablonu ayarlardan ekleyip Meta onayına gönderin.",
      en: "There is no approved template in the contact's language, so nothing went out. Add the template in settings and send it to Meta for approval.",
      de: "In der Sprache des Kunden gibt es keine freigegebene Vorlage, deshalb ging nichts raus. Legen Sie die Vorlage in den Einstellungen an und reichen Sie sie bei Meta zur Freigabe ein.",
    },
  },
  failedOther: {
    kind: "failed-send",
    subject: {
      tr: "{who} kişisine mesaj gitmedi",
      en: "The message to {who} did not send",
      de: "Die Nachricht an {who} ging nicht raus",
    },
    body: {
      tr: "{who} kişisine gönderim başarısız oldu. Sağlayıcının bildirdiği hata: {detail}",
      en: "The send to {who} failed. The provider reported: {detail}",
      de: "Der Versand an {who} ist fehlgeschlagen. Der Anbieter meldet: {detail}",
    },
  },
};

// orgs.language is a free-form short code; anything outside the three columns
// falls back to English rather than shipping a missing string.
function resolveAlertLanguage(raw: string | undefined): AlertLanguage {
  const code = (raw ?? "").slice(0, 2).toLowerCase();
  return code === "tr" || code === "de" ? code : "en";
}

function fill(template: string, who: string, detail: string): string {
  return template.replace(/\{who\}/g, who).replace(/\{detail\}/g, detail);
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
    language: v.string(),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { from: undefined, emails: [], language: "en" };
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
    return { from: org.emailFrom, emails, language: org.language };
  },
});

// Can an alert queued right now actually land anywhere? AccountView ships two
// switches that default to ON and promise email; when the org has no send lane
// those switches are on and do nothing, which reads worse than off. This is the
// query that surface reads to say so. Nothing here is org-crossing: requireOrg
// pins it to the caller's workspace.
export const alertHealth = query({
  args: {},
  returns: v.object({
    // True when the lane, the From address and at least one opted-in member are
    // all in place. False means every alert this org produces is dropped.
    deliverable: v.boolean(),
    // The first thing missing, so the UI can name it instead of guessing.
    blocker: v.optional(
      v.union(
        v.literal("no-email-lane"),
        v.literal("no-from-address"),
        v.literal("no-recipients"),
      ),
    ),
    emailFrom: v.optional(v.string()),
    // Members with that switch on and an address on file, counted separately:
    // a salon can have inbound alerts working and failed-send alerts going
    // nowhere.
    recipients: v.object({ inbound: v.number(), failedSend: v.number() }),
  }),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const inbound = new Set<string>();
    const failedSend = new Set<string>();
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user?.email) continue;
      if (alertEnabled(user, "inbound")) inbound.add(user.email);
      if (alertEnabled(user, "failed-send")) failedSend.add(user.email);
    }
    const laneConfigured = Boolean(process.env.N8N_EMAIL_WEBHOOK_URL);
    const emailFrom = org?.emailFrom;
    const blocker = !laneConfigured
      ? ("no-email-lane" as const)
      : !emailFrom
        ? ("no-from-address" as const)
        : inbound.size === 0 && failedSend.size === 0
          ? ("no-recipients" as const)
          : undefined;
    return {
      deliverable: blocker === undefined,
      blocker,
      emailFrom,
      recipients: { inbound: inbound.size, failedSend: failedSend.size },
    };
  },
});

// Fan-out. Runs detached from the write that triggered it.
export const deliverOrgAlert = internalAction({
  args: {
    orgId: v.id("orgs"),
    template: alertTemplateValidator,
    who: v.string(),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  // Annotated on purpose: referencing a sibling function in this same module
  // through `internal` is circular for inference, and the annotation breaks it.
  handler: async (ctx, args): Promise<null> => {
    try {
      const copy = ALERT_COPY[args.template];
      const webhookUrl = process.env.N8N_EMAIL_WEBHOOK_URL;
      if (!webhookUrl) {
        // Not silent any more: the account switches promise email, so a
        // deployment with no email lane has to be findable in the logs.
        console.warn(
          `alert dropped (${args.template}, org ${args.orgId}): N8N_EMAIL_WEBHOOK_URL is unset, this deployment has no email lane`,
        );
        return null;
      }
      const recipients: {
        from: string | undefined;
        emails: string[];
        language: string;
      } = await ctx.runQuery(internal.lib.alerts.alertRecipients, {
        orgId: args.orgId,
        kind: copy.kind,
      });
      if (!recipients.from) {
        console.warn(
          `alert dropped (${args.template}, org ${args.orgId}): the org has no from address, so alert email cannot be sent`,
        );
        return null;
      }
      if (recipients.emails.length === 0) {
        console.warn(
          `alert dropped (${args.template}, org ${args.orgId}): no member has the ${copy.kind} switch on with an email address on file`,
        );
        return null;
      }
      const language = resolveAlertLanguage(recipients.language);
      const subject = fill(copy.subject[language], args.who, args.detail ?? "");
      const body = fill(copy.body[language], args.who, args.detail ?? "");
      const html = `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`;
      // sendEmailViaN8n reports failure rather than throwing, and one bad
      // address must not cost the rest of the team their alert.
      for (const to of recipients.emails) {
        await sendEmailViaN8n({
          webhookUrl,
          from: recipients.from,
          to,
          subject,
          html,
        });
      }
    } catch {
      // Swallowed on purpose. This runs detached from the write that triggered
      // it and has nobody to report to; throwing would only burn retries.
    }
    return null;
  },
});

// The call sites' entry point. See the header for usage.
export async function queueOrgAlert(
  ctx: { scheduler: Scheduler },
  args: {
    orgId: Id<"orgs">;
    template: AlertTemplate;
    who: string;
    detail?: string;
  },
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(0, internal.lib.alerts.deliverOrgAlert, args);
  } catch {
    // Never throw into the caller. See the header.
  }
}
