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
// Delivery rides the same provider as customer email (lib/email.ts), from the
// PRODUCT's address (lib/email productSender) rather than the salon's own: an
// alert is Resepta writing to the owner, not the salon mailing anybody. It
// used to demand orgs.emailFrom, which silently cost every salon without one
// their alerts. What remains is deployment config — no RESEND_API_KEY or no
// RESEND_INBOUND_DOMAIN means nobody has an email lane — which logs, and is
// readable from the `alertHealth` query below so the UI can say so.

import { v } from "convex/values";
import type { Scheduler } from "convex/server";
import { internal } from "../_generated/api";
import { internalAction, internalQuery, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOrg } from "./orgAuth";
import { emailLaneConfigured, productSender, sendEmail } from "./email";
import { emailConfig } from "./platformConfig";
import { MAX_ATTEMPTS } from "./sendFailure";

export type AlertKind = "inbound" | "failed-send" | "new-contact" | "billing";

export const alertKindValidator = v.union(
  v.literal("inbound"),
  v.literal("failed-send"),
  v.literal("new-contact"),
  v.literal("billing"),
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
  // Billing has no per-user switch: the owner setting a budget IS the opt-in,
  // and clearing the budget is the mute. A toggle on top would be two places
  // for one intention.
  if (kind === "billing") return true;
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
  | "newContact"
  | "voiceBudget80"
  | "voiceBudget100"
  | "walletLow"
  | "walletEmpty";

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
  v.literal("voiceBudget80"),
  v.literal("voiceBudget100"),
  v.literal("walletLow"),
  v.literal("walletEmpty"),
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
  // The voice meter's budget alerts (schema: orgs.voiceMonthlyBudgetMicroUsd).
  // {detail} carries the figures ("$83.10 / $100.00"); {who} is the business
  // name. Both bodies say in-band that calls keep going: an owner reading
  // "budget exceeded" must not think their phone line just went dead.
  voiceBudget80: {
    kind: "billing",
    subject: {
      tr: "Arama harcaması bütçenin %80'ine ulaştı",
      en: "Call spend reached 80% of your budget",
      de: "Anrufkosten haben 80 % Ihres Budgets erreicht",
    },
    body: {
      tr: "Telefon asistanının bu ayki harcaması {detail}. Aramalar kesintisiz devam ediyor; bu bir uyarıdır, sınır değil. Bütçeyi Telefon sayfasındaki Kullanım bölümünden değiştirebilirsiniz.",
      en: "This month's phone agent spend is {detail}. Calls keep going; this is an alert, not a cutoff. You can change the budget in the Usage section of the Phone page.",
      de: "Die Kosten des Telefonassistenten liegen diesen Monat bei {detail}. Anrufe laufen unverändert weiter; dies ist ein Hinweis, keine Sperre. Das Budget können Sie im Bereich Nutzung auf der Telefonseite ändern.",
    },
  },
  voiceBudget100: {
    kind: "billing",
    subject: {
      tr: "Arama bütçesi aşıldı",
      en: "Call budget exceeded",
      de: "Anrufbudget überschritten",
    },
    body: {
      tr: "Telefon asistanının bu ayki harcaması {detail}, belirlediğiniz bütçenin üzerinde. Aramalar kesilmez, müşterileriniz aramaya devam edebilir. Bütçeyi Telefon sayfasındaki Kullanım bölümünden güncelleyebilirsiniz.",
      en: "This month's phone agent spend is {detail}, above the budget you set. Calls are not cut off; your customers can keep calling. You can update the budget in the Usage section of the Phone page.",
      de: "Die Kosten des Telefonassistenten liegen diesen Monat bei {detail}, über Ihrem festgelegten Budget. Anrufe werden nicht unterbrochen, Ihre Kunden können weiterhin anrufen. Das Budget können Sie im Bereich Nutzung auf der Telefonseite anpassen.",
    },
  },
  // The prepaid wallet's two mails (schema: orgs.walletAlertLowAt/EmptyAt).
  // {detail} is the remaining balance. Unlike the budget pair above, these
  // DO gate calls, so the body says exactly what stops, what finishes, and
  // that topping up resumes service immediately — an owner must never learn
  // their line went quiet from a customer.
  walletLow: {
    kind: "billing",
    subject: {
      tr: "Bakiyeniz azalıyor",
      en: "Your balance is running low",
      de: "Ihr Guthaben wird knapp",
    },
    body: {
      tr: "Kalan bakiyeniz {detail}. Bakiye bittiğinde telefon asistanı yeni aramaları yanıtlamayı durdurur. Bakiye sayfasından yükleme yapabilirsiniz.",
      en: "Your remaining balance is {detail}. When it runs out, the phone agent stops answering new calls. You can top up on the Balance page.",
      de: "Ihr verbleibendes Guthaben beträgt {detail}. Ist es aufgebraucht, nimmt der Telefonassistent keine neuen Anrufe mehr an. Aufladen können Sie auf der Seite Guthaben.",
    },
  },
  walletEmpty: {
    kind: "billing",
    subject: {
      tr: "Bakiyeniz bitti, telefon asistanı duraklatıldı",
      en: "Your balance ran out, the phone agent is paused",
      de: "Ihr Guthaben ist aufgebraucht, der Telefonassistent ist pausiert",
    },
    body: {
      tr: "Bakiyeniz {detail}. Telefon asistanı yeni aramaları yanıtlamıyor; devam eden bir arama varsa normal şekilde tamamlanır. Bakiye sayfasından yükleme yaptığınız anda aramalar kaldığı yerden devam eder.",
      en: "Your balance is {detail}. The phone agent is not answering new calls; a call already in progress finishes normally. Calls resume the moment you top up on the Balance page.",
      de: "Ihr Guthaben beträgt {detail}. Der Telefonassistent nimmt keine neuen Anrufe an; ein laufendes Gespräch wird normal beendet. Sobald Sie auf der Seite Guthaben aufladen, werden Anrufe sofort wieder angenommen.",
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
    emails: v.array(v.string()),
    language: v.string(),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { emails: [], language: "en" };
    // The demo workspace has no alert recipients, because anyone can walk into
    // it (convex/demo.ts) and this is the one alert path that reaches sendEmail
    // directly rather than through the delivery queue. Expressed as "nobody to
    // tell" rather than a refusal at the send site, so the existing
    // no-recipients branch logs it like any other empty list.
    if (org.demoMode === true) return { emails: [], language: org.language ?? "en" };
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const emails: string[] = [];
    for (const membership of memberships) {
      // Billing goes to owners only — the first owner-scoped kind. Spend is
      // the business's finances: staff can neither change the budget nor act
      // on the number. Every other kind stays all-members, as before.
      if (args.kind === "billing" && membership.role !== "owner") continue;
      const user = await ctx.db.get(membership.userId);
      // No address, nothing to send to. Not an error: a member can exist
      // before their profile carries an email.
      if (!user?.email) continue;
      if (!alertEnabled(user, args.kind)) continue;
      if (!emails.includes(user.email)) emails.push(user.email);
    }
    return { emails, language: org.language };
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
    const mailConfig = await emailConfig(ctx);
    const from = productSender(mailConfig);
    const blocker = !emailLaneConfigured(mailConfig)
      ? ("no-email-lane" as const)
      : !from
        ? ("no-from-address" as const)
        : inbound.size === 0 && failedSend.size === 0
          ? ("no-recipients" as const)
          : undefined;
    return {
      deliverable: blocker === undefined,
      blocker,
      emailFrom: from,
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
      const mailConfig = await ctx.runQuery(internal.platformConfig.forSend, {});
      if (!emailLaneConfigured(mailConfig)) {
        // Not silent any more: the account switches promise email, so a
        // deployment with no email lane has to be findable in the logs.
        console.warn(
          `alert dropped (${args.template}, org ${args.orgId}): RESEND_API_KEY is unset, this deployment has no email lane`,
        );
        return null;
      }
      const recipients: {
        emails: string[];
        language: string;
      } = await ctx.runQuery(internal.lib.alerts.alertRecipients, {
        orgId: args.orgId,
        kind: copy.kind,
      });
      // An alert is Resepta writing to the owner about their account, exactly
      // like an invite — so it goes out from the product, not wearing the
      // salon's own name. It used to require orgs.emailFrom, which meant a
      // salon that never set one got no failed-send alerts at all while the
      // switches in Account sat on, promising them.
      const from = productSender(mailConfig);
      if (!from) {
        console.warn(
          `alert dropped (${args.template}, org ${args.orgId}): RESEND_INBOUND_DOMAIN is unset, so there is no address to send from`,
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
          apiKey: mailConfig.apiKey,
          from,
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
// gets written in all cases — but it is not always SHOWN: no-consent is
// filtered out of the conversation feed (see neverLeftSilently in messages.ts)
// because the consent toggle on the card already says that fact once, and a
// thread is for what a customer was told.
const STEADY_STATE_FAILURES = new Set([
  "no-consent",
  "wa-not-configured",
  "session-window-closed",
  // Email-only org, customer without an address. Like no-consent this is a
  // per-customer fact whose row belongs in that customer's thread, not in the
  // owner's inbox at 06:00 for every reminder.
  "no-email-address",
  // Suspension is the operator's own deliberate act; a per-message alert
  // would mail the suspended org's owner once per blocked reminder.
  "org-suspended",
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
    reason === "email-not-configured" ||
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
