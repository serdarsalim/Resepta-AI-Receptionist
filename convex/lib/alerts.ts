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
// Delivery rides the same provider as customer email (lib/email.ts), from
// the org's own From address. No emailFrom set, or no RESEND_API_KEY on
// the deployment, means the org has no email lane at all. That case used to
// return silently while the account switches still promised email; it now logs
// and is readable from the `alertHealth` query below so the UI can say so.

import { v } from "convex/values";
import type { Scheduler } from "convex/server";
import { internal } from "../_generated/api";
import { internalAction, internalQuery, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOrg } from "./orgAuth";
import { emailLaneConfigured, sendEmail } from "./email";
import { MAX_ATTEMPTS } from "./sendFailure";

export type AlertKind = "inbound" | "failed-send" | "new-contact";

export const alertKindValidator = v.union(
  v.literal("inbound"),
  v.literal("failed-send"),
  v.literal("new-contact"),
);

// THE default that matters: unset reads as ON. A customer reply nobody sees is
// the exact failure this product exists to prevent, so silence has to be opted
// into, never defaulted into. users.myProfile resolves the same way — keep the
// two reading through this one function so they can never drift apart.
export function alertEnabled(
  prefs: {
    notifyInbound?: boolean;
    notifyFailedSend?: boolean;
    notifyNewContact?: boolean;
  },
  kind: AlertKind,
): boolean {
  const stored =
    kind === "inbound"
      ? prefs.notifyInbound
      : kind === "failed-send"
        ? prefs.notifyFailedSend
        : prefs.notifyNewContact;
  return stored ?? true;
}

// ---- Copy ------------------------------------------------------------------
//
// These strings live here rather than in src/lib/i18n.ts because Convex cannot
// import the frontend bundle. Same house rules as that dictionary: Turkish is
// siz-form with real diacritics, German is Sie-form and says DSGVO where the
// Turkish says KVKK. {who} is the customer, {detail} is whatever the template
// needs (the message text, the provider's error).

export type AlertLanguage = "tr" | "en" | "de";

export type AlertTemplate =
  | "inboundText"
  | "inboundPlain"
  | "inboundConfirmed"
  | "inboundCancelled"
  | "failedNoTemplate"
  | "failedNoText"
  | "failedOther"
  | "failedCalendarCancel"
  | "newContact";

export const alertTemplateValidator = v.union(
  v.literal("inboundText"),
  v.literal("inboundPlain"),
  v.literal("inboundConfirmed"),
  v.literal("inboundCancelled"),
  v.literal("failedNoTemplate"),
  v.literal("failedNoText"),
  v.literal("failedOther"),
  v.literal("failedCalendarCancel"),
  v.literal("newContact"),
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
  // The shop-phone sibling of failedNoTemplate: the lane needs no approval,
  // but it does need the owner to have written the message text.
  failedNoText: {
    kind: "failed-send",
    subject: {
      tr: "{who} kişisine mesaj gitmedi",
      en: "The message to {who} did not send",
      de: "Die Nachricht an {who} ging nicht raus",
    },
    body: {
      tr: "Kişinin dilinde yazılmış bir mesaj metni yok, bu yüzden hiçbir şey gönderilmedi. Metni Hatırlatmalar sayfasından yazabilirsiniz.",
      en: "There is no message text written in the contact's language, so nothing went out. You can write it on the Reminders page.",
      de: "In der Sprache des Kunden ist kein Nachrichtentext hinterlegt, deshalb ging nichts raus. Den Text können Sie auf der Seite Erinnerungen schreiben.",
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
  // Not failedOther: that one says a message did not send, and this is the
  // opposite shape — the customer reached us, we could not reach the calendar.
  // Rides the failed-send toggle rather than introducing a third AlertKind,
  // because it is the same question for the owner: something did not land.
  // The slot is the actionable part, so the body leads with it.
  // Somebody the salon had never heard of is now in the book, and no member of
  // staff put them there. The interesting part is HOW they arrived, so the
  // detail carries the door they came through — a caller the voice agent
  // handled is a very different Monday morning from a website form.
  newContact: {
    kind: "new-contact",
    subject: {
      tr: "Yeni kişi: {who}",
      en: "New contact: {who}",
      de: "Neuer Kontakt: {who}",
    },
    body: {
      tr: "{who} kayıtlara eklendi ({detail}). Kişi kartından geçmişi ve iletişim bilgileri görülebilir.",
      en: "{who} was added to your contacts ({detail}). Their record has the history and contact details.",
      de: "{who} wurde zu Ihren Kontakten hinzugefügt ({detail}). Der Datensatz enthält Verlauf und Kontaktdaten.",
    },
  },
  failedCalendarCancel: {
    kind: "failed-send",
    subject: {
      tr: "{who} iptal etti, takvime işlenmedi",
      en: "{who} cancelled, but your calendar did not update",
      de: "{who} hat storniert, Ihr Kalender wurde nicht aktualisiert",
    },
    body: {
      tr: "{who} randevusunu WhatsApp'tan iptal etti, ancak iptal cal.com takviminize işlenemedi. Saat hâlâ dolu görünüyor — takvimden elle silmeniz gerekiyor. Bildirilen hata: {detail}",
      en: "{who} cancelled their appointment on WhatsApp, but the cancellation did not reach your cal.com calendar. The slot still looks booked — remove it by hand. The error was: {detail}",
      de: "{who} hat den Termin über WhatsApp storniert, die Stornierung hat Ihren cal.com-Kalender aber nicht erreicht. Der Termin gilt weiter als gebucht — bitte manuell löschen. Fehlermeldung: {detail}",
    },
  },
};

// orgs.language is a free-form short code; anything outside the three columns
// falls back to English rather than shipping a missing string.
export function resolveAlertLanguage(raw: string | undefined): AlertLanguage {
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
    const laneConfigured = emailLaneConfigured();
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
      if (!emailLaneConfigured()) {
        // Not silent any more: the account switches promise email, so a
        // deployment with no email lane has to be findable in the logs.
        console.warn(
          `alert dropped (${args.template}, org ${args.orgId}): RESEND_API_KEY is unset, this deployment has no email lane`,
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
      // sendEmail reports failure rather than throwing, and one bad address
      // must not cost the rest of the team their alert.
      for (const to of recipients.emails) {
        await sendEmail({
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

// ── Failed-send alerts ──────────────────────────────────────────────────────
//
// Not every failed row is an incident. These three reasons are the steady
// state of a normally-working account, and emailing about them is how a salon
// learns to ignore the alert that actually matters:
//
//   no-consent            every contact who never opted in fails this way,
//                         every time, forever. It is a KVKK record, not a bug.
//   wa-not-configured     true for every send until the org connects a number,
//                         so a brand new org would get one email per send on
//                         day one.
//   session-window-closed normal WhatsApp behaviour. Meta closes the 24h
//                         window; nothing is broken and nothing is fixable.
//
// Everything else is either the org's own missing template or the provider
// refusing a send, and both are broken AND actionable. The failed row still
// gets written in all cases: the Messages tab is where the steady-state ones
// belong.
const STEADY_STATE_FAILURES = new Set([
  "no-consent",
  "wa-not-configured",
  "session-window-closed",
]);

// A narrower set: failures that say nothing about the customer or the message,
// only that the ORG has not finished setting up. These get ONE row and then go
// quiet, because otherwise every reminder for every customer writes another
// red line into a conversation that is supposed to show what that person was
// told. Settings already reports this state, in one place, loudly.
//
// no-consent is deliberately NOT in here even though it repeats forever: it is
// a KVKK record that we correctly did not message somebody, and evidence is
// the one kind of row worth keeping duplicated. session-window-closed stays
// too — it depends on when THAT customer last wrote, so it belongs in THAT
// thread.
export function isOrgSetupFailure(reason: string): boolean {
  return (
    reason === "wa-not-configured" ||
    reason.startsWith("no-approved-template") ||
    reason.startsWith("no-template-text")
  );
}

// Called ONLY when a send has terminally failed — never on a transient failure
// that is about to be retried. A provider hiccup that the backoff recovers
// from is not something to email a salon owner about at 06:00; the whole point
// of the retry queue is that they never hear about it.
export async function alertFailedSend(
  ctx: { scheduler: Scheduler },
  args: { orgId: Id<"orgs">; name: string; reason: string; deadLettered?: boolean },
) {
  if (STEADY_STATE_FAILURES.has(args.reason)) return;
  const missingTemplate = args.reason.startsWith("no-approved-template");
  const missingText = args.reason.startsWith("no-template-text");
  await queueOrgAlert(ctx, {
    orgId: args.orgId,
    template: missingTemplate
      ? "failedNoTemplate"
      : missingText
        ? "failedNoText"
        : "failedOther",
    who: args.name,
    // The provider's own text only reaches the reader on the generic template;
    // the two missing-content cases have a sentence that says what to do
    // instead. A dead letter says so explicitly — "we tried and gave up" is a
    // different thing to be told than "this was refused".
    detail:
      missingTemplate || missingText
        ? undefined
        : args.deadLettered
          ? `${args.reason} (${MAX_ATTEMPTS} attempts)`
          : args.reason,
  });
}
