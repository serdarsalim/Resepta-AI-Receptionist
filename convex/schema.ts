import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Multi-org invariant (see AGENTS.md): every app table carries orgId and every
// index used by app queries starts with it. `orgs` and the auth tables are the
// only exceptions. There is no cross-org read path.

export const appointmentStatus = v.union(
  v.literal("scheduled"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("no_show"),
);

export default defineSchema({
  ...authTables,

  // Overrides authTables.users: same auth-owned fields plus org membership.
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    orgId: v.optional(v.id("orgs")),
    role: v.optional(v.union(v.literal("owner"), v.literal("staff"))),
    themePreference: v.optional(
      v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
    ),
    // Per-person alerts, set in the account menu. Unset means on for inbound
    // (a reply nobody sees is the whole failure mode this product exists to
    // prevent) and on for failed sends (a salon going quiet without anyone
    // noticing). Both are per USER, not per org: the owner and a stylist want
    // different noise.
    notifyInbound: v.optional(v.boolean()),
    notifyFailedSend: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("by_org", ["orgId"]),

  // Workspace memberships (Retell-style, decided 2026-07-25): one login can
  // belong to MANY orgs; users.orgId is merely the ACTIVE workspace. Role
  // lives here, per workspace — never on the user row.
  memberships: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    role: v.union(v.literal("owner"), v.literal("staff")),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_user_org", ["userId", "orgId"]),

  // Team invites. No token is mailed and none is checked (Nudge's model):
  // Google has already proven the signer-in controls the address, so matching
  // on the address IS the verification. An open invite = acceptedAt unset.
  invites: defineTable({
    orgId: v.id("orgs"),
    email: v.string(),
    role: v.union(v.literal("owner"), v.literal("staff")),
    invitedBy: v.id("users"),
    acceptedAt: v.optional(v.number()),
    acceptedUserId: v.optional(v.id("users")),
  })
    .index("by_email", ["email"])
    .index("by_org", ["orgId"]),

  orgs: defineTable({
    name: v.string(),
    // IANA zone; appointment times store UTC ms and format through this.
    timezone: v.string(),
    // BCP 47-ish short code driving template language + date formatting ("tr").
    language: v.string(),
    // The org's public handle, used in its request-form URL (/r/<slug>).
    // Generated from the name on first enable rather than asked for: one more
    // thing to invent is one more reason a salon owner stops halfway through
    // setup. Separate from inboundAddress on purpose — an org changing the
    // address customers email must not break every form link it has shared.
    publicSlug: v.optional(v.string()),
    // Off until switched on. A form URL that answers before anyone has looked
    // at what it asks is worse than a 404.
    formEnabled: v.optional(v.boolean()),
    // Whether the takings tab exists at all. Off by default: an org that
    // never fills in prices would otherwise get a nav item leading to three
    // zeroes, which reads as the app being broken rather than unused.
    revenueEnabled: v.optional(v.boolean()),
    // The local part of this org's address on the shared inbound domain
    // (RESEND_INBOUND_DOMAIN): "guzellik" becomes guzellik@mail.example.com.
    // Routing an inbound email to an ORG happens on this, not on the domain,
    // which is the whole reason one verified domain serves every customer
    // instead of one domain slot each. Same job orgs.calcomWebhookToken does
    // for cal.com. Unset = this org has no inbound address yet.
    inboundAddress: v.optional(v.string()),
    // ISO 4217 ("TRY"). The unit every price in the org is stored and rendered
    // in — services, appointments, anything that gets summed. Optional so orgs
    // created before money existed keep working; code defaults it (lib/money).
    // Deliberately its own field rather than derived from a country: the
    // Eurozone alone breaks country → currency, and an org that bills in a
    // currency other than the one on its address is not an error to correct.
    currency: v.optional(v.string()),
    // Hours before startAt to send a reminder. Default [24, 2] applied in code
    // when unset so existing orgs pick up default changes.
    reminderOffsetsHours: v.optional(v.array(v.number())),
    // Send a confirmation template immediately when an appointment is booked.
    sendBookingConfirmation: v.optional(v.boolean()),
    // Org-scoped secret in the cal.com webhook URL (?token=...) — how an
    // inbound booking event resolves to its org. Generated in Settings.
    calcomWebhookToken: v.optional(v.string()),
    // cal.com API (cal.com IS the scheduler — spec §Phase C/D): per-org key +
    // event type drive slot checks and voice-agent bookings.
    calcomApiKey: v.optional(v.string()),
    calcomEventTypeId: v.optional(v.string()),
    // Reminder send window in the org's timezone (defaults 9–21 in code).
    quietHoursStart: v.optional(v.number()),
    quietHoursEnd: v.optional(v.number()),
    // No-show winback: template send N days after a no_show.
    winbackEnabled: v.optional(v.boolean()),
    winbackDaysAfter: v.optional(v.number()),
    // From-address for customer emails; delivery goes straight to the email
    // provider (env RESEND_API_KEY, see lib/email.ts). The domain has to be
    // verified there or sends are rejected. Unset = email off.
    emailFrom: v.optional(v.string()),

    // When the salon is OPEN — a different question from quietHours, which is
    // when it is polite to message a customer. Drives the WhatsApp away-reply
    // only. No defaults applied in code: a Turkish barber routinely opens
    // Saturday and closes Monday, so a guessed default would announce "we're
    // closed" on the busiest day. Unset = no away-reply (lib/businessHours.ts).
    businessHours: v.optional(
      v.object({
        // 0=Sunday .. 6=Saturday. Empty/unset = every day.
        activeDays: v.optional(v.array(v.number())),
        // Minutes from local midnight.
        startMinute: v.optional(v.number()),
        endMinute: v.optional(v.number()),
      }),
    ),
    // Reply once to an out-of-hours inbound that isn't a confirm/cancel, so a
    // customer messaging at 23:00 gets the booking link instead of silence.
    // Inside opening hours the staff answer it themselves — an auto-reply on
    // top of a human who replies in five minutes reads like a robot on the one
    // channel where the customer thinks they are talking to the salon.
    autoReplyEnabled: v.optional(v.boolean()),
    // Org's own wording, used verbatim when set. Single-language by nature, so
    // an org serving mixed-language customers should leave it blank and take
    // the per-language default instead.
    autoReplyText: v.optional(v.string()),
    // The org's PUBLIC cal.com page — what the away-reply sends people to. The
    // spec cut the idea of hosting our own booking page; this is that link.
    bookingUrl: v.optional(v.string()),
    // Number to tell a customer to call. Offered second, after the link: a
    // phone number is a dead end at 23:00, which is when people message.
    publicPhone: v.optional(v.string()),
    // What this business calls the person delivering the appointment —
    // "Stylist", "Berber", "Techniker", "Hekim". Display only; the app never
    // branches on the value. Unset falls back to the generic word already in
    // the dictionary ("Personel"/"Staff"/"Mitarbeiter"), which is correct for
    // most verticals and merely bland for the rest.
    staffLabel: v.optional(v.string()),
  }).index("by_calcom_token", ["calcomWebhookToken"]),

  // Voice lane (spec Phase C): one Retell agent per org; function calls and
  // the post-call webhook resolve the org by retellAgentId.
  retellAgents: defineTable({
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    inboundNumber: v.optional(v.string()),
    transferNumber: v.optional(v.string()),
    enabled: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_agent", ["retellAgentId"]),

  calls: defineTable({
    orgId: v.id("orgs"),
    customerId: v.optional(v.id("customers")),
    appointmentId: v.optional(v.id("appointments")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    fromNumber: v.optional(v.string()),
    startedAt: v.number(),
    durationSec: v.optional(v.number()),
    outcome: v.optional(v.string()),
    summary: v.optional(v.string()),
    transcript: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    retellCallId: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_customer", ["customerId"])
    .index("by_retell_call", ["retellCallId"]),

  customers: defineTable({
    orgId: v.id("orgs"),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    // E.164 with dial code, or the row doesn't exist (assertE164 gates writes).
    phone: v.string(),
    email: v.optional(v.string()),
    language: v.optional(v.string()),
    notes: v.optional(v.string()),
    // KVKK: when the customer consented to WhatsApp messages. Unset = no
    // consent recorded; sends are blocked until it's stamped.
    consentAt: v.optional(v.number()),
    // Last inbound WhatsApp message — opens Meta's 24h session window.
    lastInboundAt: v.optional(v.number()),
    // Last out-of-hours away-reply. One per session window, or a customer
    // sending four messages in a row collects four identical bot replies.
    lastAutoReplyAt: v.optional(v.number()),
    // Values for the org-defined contact fields, keyed by contactFields.key.
    // Stored as strings; the field's type drives the editor, not the storage.
    custom: v.optional(v.record(v.string(), v.string())),
    // Inbox attention, cleared by hand. The dot on a conversation row means
    // "someone still has to look at this"; tapping it stamps the moment it was
    // dismissed, and anything that arrives afterwards lights it again. Stored
    // on the customer rather than per user because a salon shares one inbox:
    // once Hülya has handled it, the owner should not still see it waiting.
    attentionClearedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_phone", ["orgId", "phone"]),

  // Org-defined contact fields (the SMALL core of Nudge's Fields registry —
  // no value maps, no variable keys, no sync scoping). Per-vertical custom
  // properties: hair type for a salon, allergy notes for a dentist.
  contactFields: defineTable({
    orgId: v.id("orgs"),
    key: v.string(),
    label: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("select"),
      v.literal("number"),
      v.literal("date"),
    ),
    options: v.optional(v.array(v.string())),
    order: v.number(),
    // Where the value comes from. "manual" is typed by staff on the contact
    // page; "voice" is collected by the Retell agent during a call and written
    // back through the update_contact function. Unset reads as "manual".
    //
    // This pair is how one deployment serves a salon, a dentist and a garage:
    // the vertical's own vocabulary (plate number, last cleaning, insurance)
    // is org data, not a schema change.
    source: v.optional(v.union(v.literal("manual"), v.literal("voice"))),
  }).index("by_org", ["orgId"]),

  services: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    durationMinutes: v.number(),
    active: v.boolean(),
    // LIST price, in integer minor units of orgs.currency (40000 = ₺400,00).
    // What this costs today — editable forever, and editing it must never
    // change what a past appointment recorded. That is why appointments carry
    // their own copy rather than a pointer here.
    price: v.optional(v.number()),
  }).index("by_org", ["orgId"]),

  // Who delivers the appointment. A real row rather than free text on the
  // appointment: the week view builds its columns by grouping on the stylist,
  // so "Hülya" and "Hülya " were two different people with two different
  // lanes, and nothing could rename someone without editing every appointment
  // they had.
  //
  // Same reasoning as contactFields, applied to a relation instead of a
  // property: the vertical's own vocabulary is org data. What this row is
  // CALLED comes from orgs.staffLabel — stylist, berber, Techniker, mechanic,
  // hekim — so one deployment serves a salon and a garage without a schema
  // change. The label is a display string only; nothing branches on it.
  //
  // calcomHostId is deliberately unused for now. cal.com models people as
  // hosts PER EVENT TYPE, so honouring staff assignment on their side means
  // either one event type per person or round-robin config, which would
  // multiply onboarding. Assignment stays Randevu-side until that is worth it;
  // the column exists so the day it is, no migration is needed.
  staff: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    active: v.boolean(),
    order: v.number(),
    calcomHostId: v.optional(v.string()),
    // The login this bookable person signs in as, when they have one. Optional
    // in both directions on purpose: a barber can be bookable and never log in,
    // and a bookkeeper can log in and never be booked. Before this existed the
    // two facts lived in unrelated tables and the UI showed them as two lists
    // that both called themselves "Ekip".
    userId: v.optional(v.id("users")),
  }).index("by_org", ["orgId"]),

  appointments: defineTable({
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    // What was delivered in this session, as LINE ITEMS. A haircut plus a
    // beard trim is ONE appointment with two lines — one calendar block, one
    // reminder, one visit — not two bookings stacked on each other.
    //
    // Every line SNAPSHOTS its name, price and duration. Raising a service's
    // list price in September must not rewrite what March recorded, and that
    // is the whole reason these aren't just ids pointing at `services`.
    // serviceId on a line is kept for reference only, and stays optional
    // because a salon can stop offering a service without erasing the visit.
    //
    // A discount is a line whose price differs from the service's — there is
    // no separate override field, and no total on the appointment. The total
    // is the sum, always, so the two can never disagree.
    items: v.optional(
      v.array(
        v.object({
          serviceId: v.optional(v.id("services")),
          name: v.string(),
          price: v.optional(v.number()),
          durationMinutes: v.number(),
        }),
      ),
    ),
    staffId: v.optional(v.id("staff")),
    startAt: v.number(),
    durationMinutes: v.optional(v.number()),
    status: appointmentStatus,
    notes: v.optional(v.string()),
    // Reminder offsets (hours) already dispatched for this appointment. The
    // cron stamps an offset here BEFORE scheduling the send — that ordering is
    // the double-send guard across overlapping ticks.
    reminderSentOffsets: v.optional(v.array(v.number())),
    confirmationSentAt: v.optional(v.number()),
    winbackSentAt: v.optional(v.number()),
    // Intake: unset = typed into Randevu; "calcom" = arrived via the cal.com
    // webhook. externalUid is cal.com's booking uid — how RESCHEDULED and
    // CANCELLED events find the row they refer to.
    source: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("calcom"),
        v.literal("voice"),
        v.literal("booking_page"),
      ),
    ),
    externalUid: v.optional(v.string()),
  })
    .index("by_org_start", ["orgId", "startAt"])
    .index("by_start", ["startAt"])
    .index("by_customer", ["customerId"])
    .index("by_org_external", ["orgId", "externalUid"]),

  // One WhatsApp Cloud API number per org (Meta Business number, not personal).
  waAccounts: defineTable({
    orgId: v.id("orgs"),
    phoneNumberId: v.string(),
    wabaId: v.optional(v.string()),
    accessToken: v.string(),
    displayNumber: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    // Webhook resolution: metadata.phone_number_id → org.
    .index("by_phone_number_id", ["phoneNumberId"]),

  // Meta-approved template registrations. metaName is the name approved in
  // Meta Business Manager; body convention: {{1}} customer first name,
  // {{2}} business name, {{3}} appointment date+time.
  waTemplates: defineTable({
    orgId: v.id("orgs"),
    kind: v.union(
      v.literal("confirmation"),
      v.literal("reminder"),
      v.literal("winback"),
    ),
    metaName: v.string(),
    language: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    bodyPreview: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  messages: defineTable({
    orgId: v.id("orgs"),
    customerId: v.optional(v.id("customers")),
    appointmentId: v.optional(v.id("appointments")),
    direction: v.union(v.literal("out"), v.literal("in")),
    // out: confirmation | reminder; in: reply
    kind: v.string(),
    body: v.optional(v.string()),
    templateName: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("received"),
    ),
    wamid: v.optional(v.string()),
    // An image the customer sent — a photo of the colour they want is the
    // single most common attachment a salon receives. Stored in Convex file
    // storage rather than linked: Meta's media URLs are short-lived and
    // token-gated, so a link would be a broken image by the next morning.
    mediaStorageId: v.optional(v.id("_storage")),
    // Set the moment the webhook sees an image and cleared when the download
    // lands. A row that is waiting shows a placeholder instead of nothing,
    // which is the difference between "loading" and "we lost it".
    mediaPending: v.optional(v.boolean()),
    // When this should go out. Unset = send now. A row that carries one sits
    // at status "queued" until the cron reaches it, and can be cancelled up
    // to the moment it does.
    scheduledFor: v.optional(v.number()),
    // Email lane. Subject is what the thread groups on, from-address is who
    // actually wrote (a customer may reply from a different address than the
    // one on their record), and emailId is Resend's own id for the message.
    emailSubject: v.optional(v.string()),
    emailFrom: v.optional(v.string()),
    // Dedupe key, indexed. Webhooks retry — Resend will resend an event it
    // did not get a 2xx for, and a retried delivery must not become a second
    // copy of the same reply in the customer's timeline.
    emailId: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_customer", ["customerId"])
    .index("by_appointment", ["appointmentId"])
    .index("by_email_id", ["emailId"])
    // Due scheduled sends. Status first so the scan skips everything already
    // sent, which is nearly the whole table.
    .index("by_status_scheduled", ["status", "scheduledFor"])
    .index("by_wamid", ["wamid"]),

  // Staff-written notes on a customer — "allergic to ammonia", "always late,
  // book the 10:30". Their own table, NOT a row in `messages`: a note has no
  // direction, no delivery status, no wamid. Sharing that table would mean
  // either stamping a fake "sent" on every note or making `status` optional
  // and losing the guarantee that every real message carries one.
  //
  // The feed merges the two on read, exactly the way `calls` already does.
  notes: defineTable({
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    body: v.string(),
    // Who wrote it, by reference. The display name is resolved at read time,
    // so someone changing their name doesn't leave stale attribution frozen
    // into every note they ever wrote.
    authorId: v.id("users"),
    // Set on the first edit. Unset means the note still says what it said when
    // it was written, which is the whole reason anyone trusts a note.
    editedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_customer", ["customerId"]),
});
