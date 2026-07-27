// A customer row appearing for the first time.
//
// Nine places in this codebase insert into `customers`, and until now exactly
// ONE of them — the manual create in customers.ts — bothered to write the
// `customer_created` activity row. So the feed quietly claimed the salon had
// gained no customers on the days its voice agent, its request form and its
// WhatsApp number were doing all the work. Anything added here has to land on
// all of them at once, which is what this file is for: one call, every door.
//
// ── WHO GETS EMAILED, AND WHY NOT ALWAYS ────────────────────────────────────
//
// The alert only fires for contacts the SYSTEM created. Emailing somebody to
// tell them about a contact they just typed in themselves is not a
// notification, it is an echo — and the fastest way to teach a salon owner to
// filter this sender into a folder they never open.
//
// `source` decides, and nothing second-guesses it.
//
// The tempting shortcut is to ask whether anyone is authenticated and call
// that "the system". It is wrong, and testing caught it being wrong: the
// request form is a PUBLIC endpoint, so when the owner opens their own form in
// the browser they are already signed into, the customer's submission arrives
// carrying the owner's cookie — no alert, and an activity row crediting the
// owner with a stranger's enquiry. The door a write came through is a property
// of the call site, not of whoever happens to hold a session.

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { recordActivity } from "./activity";
import { queueOrgAlert, resolveAlertLanguage, type AlertLanguage } from "./alerts";

// Where the contact came from. "staff" is the in-app paths — the booking sheet
// and the customers list — and is the one value that never emails anybody.
export type CustomerSource =
  | "staff"
  | "voice"
  | "form"
  | "whatsapp"
  | "email"
  | "calcom";

// Localised here rather than passed in as text: the alert renders in the
// recipients' language, so a call site handing over an English phrase would
// put "voice call" in the middle of a Turkish sentence.
const SOURCE_LABEL: Record<
  Exclude<CustomerSource, "staff">,
  Record<AlertLanguage, string>
> = {
  voice: {
    tr: "telefonda sesli asistan üzerinden",
    en: "by phone, through the voice agent",
    de: "telefonisch über den Sprachagenten",
  },
  form: {
    tr: "web sitesindeki talep formundan",
    en: "from the request form on your website",
    de: "über das Anfrageformular auf Ihrer Website",
  },
  whatsapp: {
    tr: "WhatsApp'tan yazarak",
    en: "by writing to you on WhatsApp",
    de: "per Nachricht über WhatsApp",
  },
  email: {
    tr: "e-posta göndererek",
    en: "by emailing you",
    de: "per E-Mail",
  },
  calcom: {
    tr: "cal.com üzerinden randevu alarak",
    en: "by booking through cal.com",
    de: "über eine Buchung bei cal.com",
  },
};

// What to call somebody whose record may be almost empty. A WhatsApp contact
// starts as a bare phone number and an email contact can arrive with no
// display name at all, so this walks down to whatever identifies them.
function displayName(customer: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}): string {
  const named = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim();
  return named || customer.phone || customer.email || "";
}

export async function recordCustomerCreated(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    customerId: Id<"customers">;
    source: CustomerSource;
  },
): Promise<void> {
  // Always logged, whoever did it: the feed's job is who-did-what, and "a
  // human added this one" is exactly the fact it exists to record — as is
  // "nobody did, they arrived on their own".
  await recordActivity(ctx, {
    orgId: args.orgId,
    kind: "customer_created",
    customerId: args.customerId,
    system: args.source !== "staff",
  });
  if (args.source === "staff") return;

  const customer = await ctx.db.get(args.customerId);
  if (!customer) return;
  const org = await ctx.db.get(args.orgId);
  // A demo org exists to be clicked through by strangers; mailing the owner
  // about every one of them is not the demo working, it is the demo leaking.
  if (org?.demoMode) return;
  const language = resolveAlertLanguage(org?.language);
  await queueOrgAlert(ctx, {
    orgId: args.orgId,
    template: "newContact",
    who: displayName(customer),
    detail: SOURCE_LABEL[args.source][language],
  });
}
