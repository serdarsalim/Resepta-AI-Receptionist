import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { seedDefaultRules } from "../messageRules";
import { platformValue } from "./platformConfig";

// The one org-founding path, shared by the two doors an org is born through:
// the founding sign-in (auth.ts, a new login's automatic first business) and
// users.foundWorkspace (an existing login adding another business, Retell
// style). Membership and the active-org switch stay with the callers — the
// auth callback is also creating the user row, so it cannot be in here.
//
// Unnamed until onboarding — "" renders as the name prompt in the app, which
// is what drops the founder into the wizard for THIS org the moment it
// becomes their active one.
export async function foundOrg(
  ctx: MutationCtx,
  opts: {
    // True only for the founding sign-in. The welcome credit exists to let a
    // new business try their first calls, not to be minted again on every
    // "Add business" click — one login founding orgs in a loop would farm it.
    // First org keeps the trial credit; the rest start at zero (Serdar,
    // 2026-08-23).
    grantTrialCredit: boolean;
  },
): Promise<Id<"orgs">> {
  // Billing mode is STAMPED from the platform default rather than
  // resolved at read time, so changing the default later only reaches
  // orgs founded after the change — flipping existing tenants to prepaid
  // with a zero wallet would decline their calls at ring time.
  const billingMode =
    (await platformValue(ctx, "defaultBillingMode")) === "prepaid"
      ? ("prepaid" as const)
      : ("invoice" as const);
  const orgId = await ctx.db.insert("orgs", {
    name: "",
    timezone: "Europe/Istanbul",
    language: "tr",
    sendBookingConfirmation: true,
    billingMode,
  });
  // The welcome credit a prepaid birth carries. Scheduled rather than
  // applied inline so it runs through applyWalletCredit — the one credit
  // path — in a real mutation ctx with the alert lane available.
  if (opts.grantTrialCredit && billingMode === "prepaid") {
    const trialUsd = Number(await platformValue(ctx, "trialCreditUsd")) || 0;
    if (trialUsd > 0) {
      await ctx.scheduler.runAfter(0, internal.wallet.creditTopup, {
        orgId,
        amountMicroUsd: Math.round(trialUsd * 1_000_000),
        source: "trial",
      });
    }
  }
  // Confirmation + one 24h reminder, and the migrated marker — a new org
  // is born on the messageRules model, never on the legacy fields.
  await seedDefaultRules(ctx.db, orgId);

  // Seed the template rows every org needs, as drafts with suggested Meta
  // names and a starter body the owner can rewrite. The authored body
  // (named tokens) is what emails and the shop phone send from day one;
  // bodyPreview is the positional string to hand Meta if the org ever
  // takes a Cloud number. Neither body mentions buttons: the Cloud lane
  // has real ones and the shop-phone lane appends its own reply hint.
  await ctx.db.insert("waTemplates", {
    orgId,
    kind: "confirmation",
    metaName: "randevu_onay",
    language: "tr",
    status: "draft",
    body: "Merhaba [name]! [business] randevunuz [date] için oluşturuldu.",
    subject: "Randevunuz oluşturuldu",
    bodyPreview:
      "Merhaba {{1}}! {{2}} randevunuz {{3}} için oluşturuldu. Onaylamak için butona dokunun.",
  });
  await ctx.db.insert("waTemplates", {
    orgId,
    kind: "reminder",
    metaName: "randevu_hatirlatma",
    language: "tr",
    status: "draft",
    body: "Merhaba [name]! [business] randevunuzu hatırlatırız: [date].",
    subject: "Randevu hatırlatması",
    bodyPreview:
      "Merhaba {{1}}! {{2}} randevunuz {{3}}. Gelemeyecekseniz lütfen iptal butonunu kullanın.",
  });
  await ctx.db.insert("waTemplates", {
    orgId,
    kind: "winback",
    metaName: "randevu_telafi",
    language: "tr",
    status: "draft",
    body: "Merhaba [name]! [business] olarak sizi özledik. Yeni bir randevu için bu mesajı yanıtlamanız yeterli.",
    subject: "Sizi özledik!",
    bodyPreview:
      "Merhaba {{1}}! {{2}} olarak sizi özledik. Yeni bir randevu için bu mesajı yanıtlamanız yeterli.",
  });
  return orgId;
}
