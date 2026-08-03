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
    // Set while a PLATFORM OPERATOR is working inside a tenant. It is not a
    // grant on its own: lib/orgAuth only honours it for an address on the
    // PLATFORM_ADMIN_EMAILS allowlist, so this column is inert for everyone
    // else and a write to it by any org-scoped bug buys nothing. That is the
    // whole reason the operator check stayed in an env var rather than moving
    // into the database. Writes recorded while it is set attribute to the
    // operator's brand, never to the person — see lib/activity.ts.
    actingAsOrgId: v.optional(v.id("orgs")),
    themePreference: v.optional(
      v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
    ),
    // What language this PERSON reads the app in — not what language the
    // business writes to its customers in. orgs.language is that one, and it
    // decides which approved WhatsApp template a send picks, so the two must
    // never be the same setting: the moment a salon has two staff it has two
    // readers, and a stylist preferring English is not an instruction to start
    // messaging customers in English.
    //
    // Unset falls back to the org's language, which is what every existing
    // account was already getting.
    language: v.optional(v.string()),
    // Per-person alerts, set in the account menu. Unset means on for inbound
    // (a reply nobody sees is the whole failure mode this product exists to
    // prevent) and on for failed sends (a salon going quiet without anyone
    // noticing). Both are per USER, not per org: the owner and a stylist want
    // different noise.
    notifyInbound: v.optional(v.boolean()),
    notifyFailedSend: v.optional(v.boolean()),
    // A contact nobody in the salon typed in — the voice agent took a call,
    // somebody filled the request form, a stranger wrote on WhatsApp. Only
    // system-created contacts alert; see lib/newCustomer.ts for why an echo of
    // your own typing is how a sender gets filtered into a folder.
    notifyNewContact: v.optional(v.boolean()),
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
    // When this person first knew the workspace existed. Unset means somebody
    // ELSE put them here and they have not been told: an owner adding them from
    // the team list, or an invite consumed at first sign-in. The app surfaces
    // exactly those and stamps the field once it has.
    //
    // Memberships you make for yourself are stamped at creation, because there
    // is nothing to announce to someone about the salon they just founded. Same
    // for a demo walk-in. Leaving those unset would greet every new owner with
    // a notice about their own business.
    seenAt: v.optional(v.number()),
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
    // The member this invite belongs to, when it was sent from their row.
    // Without it an accepted invite arrives as a SECOND row for a person who
    // is already on the list, and somebody has to notice and join them by
    // hand. Set at acceptance (convex/auth.ts), which is the first moment a
    // user id exists to link.
    staffId: v.optional(v.id("staff")),
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
    // ── LEGACY message-rule fields ─────────────────────────────────────────
    // Everything from here to removedRules is superseded by the messageRules
    // table once rulesMigratedAt below is stamped. Kept readable — not the
    // source of truth — so orgs keep sending between the deploy and the
    // migration run, and so the migration has something to read.
    //
    // Hours before startAt to send a reminder. Default [24, 2] applied in code
    // when unset so existing orgs pick up default changes.
    //
    // This array is PRESENCE: which reminder rows exist. Whether each one is
    // currently sending is `pausedReminderHours` below. The two were one thing
    // until a switch that "turned a reminder off" was actually deleting the
    // row, losing a schedule the salon had built.
    reminderOffsetsHours: v.optional(v.array(v.number())),
    // Reminder offsets that exist but are switched off. A subset of the array
    // above; an hour in here is skipped by lib/reminderSchedule but keeps its
    // row, its position and its wording.
    //
    // Kept as a second array rather than turning offsets into objects on
    // purpose: appointments.reminderSentOffsets keys the double-send guard on
    // the HOUR, so hours have to stay the identity of a reminder. Changing
    // that shape is the migration convex/lib/reminderSchedule warns about.
    pausedReminderHours: v.optional(v.array(v.number())),
    // Send a confirmation template immediately when an appointment is booked.
    // This is the PAUSE state for that rule, not its presence — see
    // removedRules for whether the row is on the table at all.
    sendBookingConfirmation: v.optional(v.boolean()),
    // Rules the salon has removed outright, by key: "confirmation",
    // "winback". Reminders are not listed here because dropping an offset
    // from the array above already removes that row.
    //
    // Exists so every row can be deleted, not only the reminders. Without it
    // the two singleton rules could be switched off but never taken off the
    // list, which made their column behave differently from every other row.
    removedRules: v.optional(v.array(v.string())),
    // When this org's message rules were lifted out of the legacy fields above
    // into messageRules rows. Set means the table is the source of truth;
    // unset means the legacy fields still drive sends. New orgs are stamped at
    // creation. The marker exists because "no rules rows" is ambiguous without
    // it — an owner who deleted every rule and an org the migration has not
    // reached yet would otherwise look identical.
    rulesMigratedAt: v.optional(v.number()),
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
    // Retell agent ids hidden from the connect picker. Old drafts and test
    // agents accumulate in a client's account; archiving keeps the picker to
    // agents that are real without touching anything in Retell.
    hiddenRetellAgentIds: v.optional(v.array(v.string())),
    // Which agents the connect picker may offer. "randevu" (the default when
    // unset) offers only agents carrying this org's tag — the ones Randevu
    // created for this business. "account" offers everything in the Retell
    // workspace the key opens.
    //
    // It exists because one workspace can serve several businesses, and then
    // the picker was showing each of them all the others' agents. Operator-set
    // from /admin rather than owner-set: a salon owner cannot know whether the
    // workspace behind their key is shared, and the honest default for someone
    // who cannot know is the narrow one.
    voiceAgentSource: v.optional(
      v.union(v.literal("randevu"), v.literal("account")),
    ),
    winbackDaysAfter: v.optional(v.number()),
    // Evolution instance name for this org, when it runs one. Credentials
    // (baseUrl, apiKey) live in `connections` like every other provider secret.
    //
    // THE TWO LANES RUN SIDE BY SIDE, and neither excludes the other, because
    // they are two different phone numbers doing two different jobs. A number
    // on Meta's Cloud API is deregistered from the consumer WhatsApp app, so
    // one number can never be both — but a salon can perfectly well have a
    // Cloud number that sends confirmations and reminders, and keep the shop
    // phone it already gives customers on Evolution.
    //
    // That split plays to what each lane is actually good at. Cloud sends
    // business-initiated templates without the silent Reachout Timelock drops
    // that make Evolution unfit for reminders. Evolution is a linked device,
    // so the shop phone stays an ordinary WhatsApp the staff use as they
    // always have, and Randevu still sees every word of it — which Cloud
    // cannot do at any price (see convex/webhook.ts handleEvolutionEvent).
    //
    // There is deliberately no lane SELECTOR. Which lanes an org has is read
    // off what is configured: a waAccounts row means Cloud, an instance name
    // here means Evolution, both means both. A selector would have been a
    // third source of truth able to disagree with the two real ones.
    evolutionInstance: v.optional(v.string()),
    // From-address for customer emails; delivery goes straight to the email
    // provider (env RESEND_API_KEY, see lib/email.ts). The domain has to be
    // verified there or sends are rejected. Unset = email off.
    emailFrom: v.optional(v.string()),
    // Which channel the appointment rules (confirmation, reminder, winback)
    // send on. Unset = "both", which is what every org did before the choice
    // existed: attempt WhatsApp, and email rides alongside when configured.
    // This is a PREFERENCE, unlike the lane selector deliberately absent
    // above: WhatsApp-vs-email is a real decision the salon owns, whereas
    // cloud-vs-shop-phone is plumbing read off what is configured.
    messageChannel: v.optional(
      v.union(v.literal("whatsapp"), v.literal("email"), v.literal("both")),
    ),

    // When the salon is OPEN — a different question from quietHours, which is
    // when it is polite to message a customer. Drives the WhatsApp away-reply
    // and the voice agent's availability answers (http.ts check_availability
    // hands these hours to the agent as open_hours). No defaults applied in
    // code: a Turkish barber routinely opens Saturday and closes Monday, so a
    // guessed default would announce "we're closed" on the busiest day.
    // Unset = no away-reply, and the agent only knows what is booked
    // (lib/businessHours.ts).
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
    // DEAD. Nothing reads or writes this any more (Serdar, 2026-08-02).
    //
    // It let a business rename the person delivering the appointment —
    // "Stylist", "Berber", "Techniker". One string, in one place: the field
    // label on the booking sheet. It bought that with the most prominent
    // control on the page you go to manage PEOPLE, so it went; everyone says
    // team member now, the way Fresha and Square do.
    //
    // The COLUMN stays because orgs still hold values and Convex rejects a
    // push whose schema cannot describe existing documents. Dropping it means
    // clearing every row first, then a second deploy — worth doing on a quiet
    // day, not worth breaking a running dev deployment for one dead string.
    staffLabel: v.optional(v.string()),
    // The showroom. An org with this set never reaches a provider: sends are
    // simulated, replies are invented, and a nightly cron wipes it back to a
    // fixed dataset (convex/demo.ts).
    //
    // ⚠️ Unlike Nudge — where the demo is its own deployment with no
    // credentials, so an empty env IS the safety boundary — this flag lives on
    // a deployment that also holds real salons' customers. The boundary here
    // is therefore the org scoping every query already does, plus the fact
    // that a demo visitor's membership is for THIS org and no other. Do not
    // set this on an org that has a waAccounts row.
    demoMode: v.optional(v.boolean()),
  })
    .index("by_calcom_token", ["calcomWebhookToken"])
    // Evolution's webhook payload names its instance and nothing else, so this
    // is how an inbound event finds its org — the same job phone_number_id
    // does on the Cloud lane.
    .index("by_evolution_instance", ["evolutionInstance"]),

  // Per-org integration credentials. One row per (org, provider, field), which
  // is Nudge's shape (convex/lib/connections.ts there) with the one change that
  // matters: Nudge is instance-per-tenant so its rows are deployment-wide,
  // while here every row carries orgId like everything else.
  //
  // Nudge falls back to an env var when a row is missing. THAT FALLBACK MUST
  // NOT BE COPIED. One deployment serves every salon, so a shared env key means
  // an org with no row of its own silently reads another business's provider
  // account — a cross-org leak wearing the costume of a convenience default.
  // Missing row = not configured. See lib/connections.ts.
  //
  // `label` is the operator's own note for the fleet console ("Kuafor Selin,
  // Retell"), because each client gets their own provider account and a key
  // fragment is not something a human can recognise.
  // Deployment-wide operator config — the settings that are one value for the
  // WHOLE fleet, not one per salon.
  //
  // ── WHY THIS IS NOT A HOLE IN THE CONNECTIONS DOCTRINE ──────────────────────
  //
  // lib/connections.ts refuses to fall back to an env var, because a provider
  // key shared across orgs means one salon reading another's account. That
  // reasoning turns on the credential being PER-TENANT: each salon has its own
  // Retell account, its own WhatsApp number.
  //
  // Resend is the opposite by design. There is one Resend account and one
  // verified domain, and every salon sends from it — that is the entire reason
  // a salon needs no DNS of its own (lib/email customerSender). Sharing is the
  // intent here, not the leak. What was wrong was only that the value lived in
  // an env var, so onboarding needed a terminal and the operator console could
  // not see, let alone fix, an email lane that was down.
  //
  // Rows are read through lib/platformConfig, which falls back to the matching
  // env var so a deployment configured the old way keeps working.
  platformConfig: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_key", ["key"]),

  connections: defineTable({
    orgId: v.id("orgs"),
    provider: v.string(),
    field: v.string(),
    value: v.string(),
    label: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  })
    .index("by_org_provider_field", ["orgId", "provider", "field"])
    .index("by_org", ["orgId"]),

  // Voice lane (spec Phase C): one Retell agent per org; function calls and
  // the post-call webhook resolve the org by retellAgentId.
  retellAgents: defineTable({
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    // The provider's display name, remembered at connect/create and refreshed
    // whenever the detail is read. Cosmetic cache: surfaces like "used by
    // Booking assistant" must not call the provider to render a name.
    name: v.optional(v.string()),
    inboundNumber: v.optional(v.string()),
    transferNumber: v.optional(v.string()),
    enabled: v.boolean(),
    // Set only after a variable publication succeeds at Retell. This separate
    // marker matters because an intentionally empty registry is still a real,
    // managed configuration and must not re-import deleted provider fields.
    variablesSyncedAt: v.optional(v.number()),
    variablesRetellVersion: v.optional(v.number()),
    // Runtime credentials are one-way hashes. The clear token is written to
    // the provider once and never stored in Randevu.
    runtimeTokenHash: v.optional(v.string()),
    runtimeConnectedAt: v.optional(v.number()),
    // Customer-facing health is derived from these stamps. Provider detail
    // remains in the event inbox for the platform operator.
    lastCallEventAt: v.optional(v.number()),
    lastAnalyzedEventAt: v.optional(v.number()),
    lastEventErrorAt: v.optional(v.number()),
    lastEventError: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_agent", ["retellAgentId"]),

  // Creating a provider agent spans several non-transactional API calls. This
  // row checkpoints each resource as soon as it exists, so a retry resumes the
  // same setup instead of deliberately creating another agent. A short lease
  // also makes two browser submissions serialize onto one job.
  voiceAgentProvisioning: defineTable({
    orgId: v.id("orgs"),
    requestId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("creating_engine"),
      v.literal("creating_agent"),
      v.literal("publishing"),
      v.literal("connecting"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    templateKey: v.string(),
    templateVersion: v.number(),
    name: v.string(),
    language: v.union(v.literal("tr-TR"), v.literal("en-US"), v.literal("de-DE")),
    voiceId: v.string(),
    inboundNumber: v.optional(v.string()),
    retellLlmId: v.optional(v.string()),
    retellAgentId: v.optional(v.string()),
    retellVersion: v.optional(v.number()),
    error: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_request", ["orgId", "requestId"])
    .index("by_org_updated", ["orgId", "updatedAt"]),

  // Randevu's provider-neutral definition of the information a phone agent
  // knows and collects. One row owns the whole lifecycle of one value: where
  // its pre-call value comes from, whether the caller is asked for it, whether
  // Retell should recover it from the transcript afterwards, and where the
  // final value belongs. Keeping those together prevents three Retell lists
  // from drifting into three slightly different meanings for the same key.
  voiceAgentVariables: defineTable({
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    key: v.string(),
    label: v.string(),
    description: v.string(),
    type: v.union(
      v.literal("string"),
      v.literal("number"),
      v.literal("boolean"),
      v.literal("enum"),
    ),
    choices: v.optional(v.array(v.string())),
    required: v.boolean(),
    beforeSource: v.union(
      v.literal("none"),
      v.literal("static"),
      v.literal("business_name"),
      v.literal("customer_name"),
      v.literal("customer_first_name"),
      v.literal("customer_last_name"),
      v.literal("customer_phone"),
      v.literal("customer_email"),
      v.literal("customer_language"),
      v.literal("next_appointment"),
      v.literal("contact_field"),
    ),
    beforeValue: v.optional(v.string()),
    beforeFieldId: v.optional(v.id("contactFields")),
    duringMode: v.union(
      v.literal("none"),
      v.literal("if_missing"),
      v.literal("confirm"),
    ),
    afterCall: v.boolean(),
    // "customer" is the third destination because first name, last name and
    // email are COLUMNS on a customer, not entries in its custom map, and so
    // unreachable through a contactFieldId. Without it a first-time caller was
    // created from their phone number and left permanently nameless: the agent
    // asked for the name, repeated it back, and had nowhere to put it.
    destination: v.union(v.literal("call"), v.literal("contact"), v.literal("customer")),
    contactFieldId: v.optional(v.id("contactFields")),
    customerField: v.optional(
      v.union(v.literal("firstName"), v.literal("lastName"), v.literal("email")),
    ),
    order: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_agent", ["orgId", "retellAgentId"]),

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
    // Which agent took it. The webhook resolves the org FROM this id and then
    // used to drop it, which made "calls per agent today" unanswerable. Only
    // stamped on rows written since this field landed.
    retellAgentId: v.optional(v.string()),
    // What the agent collected on THIS call, as Retell reported it. The values
    // also flow onto the customer record (coerced, gated by field config); this
    // copy is the raw per-call answer to "what did they say", kept with the
    // recording and transcript it belongs to.
    collected: v.optional(v.record(v.string(), v.any())),
    // Retell's raw disconnect code (agent_hangup, dial_no_answer, voicemail_
    // reached…). Kept raw rather than pre-humanized: the label is a UI concern
    // and this app speaks three languages. It is the only thing that explains a
    // call with no summary — an unanswered call has nothing else to show.
    disconnectionReason: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_started", ["orgId", "startedAt"])
    .index("by_customer", ["customerId"])
    .index("by_retell_call", ["retellCallId"]),

  // Durable inbox for phone-call lifecycle events. The HTTP request only
  // authenticates and stores the payload; processing and customer updates run
  // from this row with bounded retries. One event per call/type means provider
  // retries are harmless and call_ended/call_analyzed can arrive separately.
  voiceEvents: defineTable({
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    retellCallId: v.string(),
    eventType: v.union(
      v.literal("call_ended"),
      v.literal("call_analyzed"),
      v.literal("analysis_recovery"),
    ),
    eventKey: v.string(),
    payload: v.any(),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("retrying"),
      v.literal("processed"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    receivedAt: v.number(),
    processingAt: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_org_event_key", ["orgId", "eventKey"])
    .index("by_org_call", ["orgId", "retellCallId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_received", ["orgId", "receivedAt"]),

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
    // Which lane this customer last wrote in on. THE reply-routing fact: a
    // free-form answer goes back out the way their message came in, or it
    // arrives from a number they have never seen replying to a conversation
    // they had somewhere else. Unset = cloud.
    lastInboundLane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
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
    // When this person turned up ON THEIR OWN — a call the voice agent took,
    // the request form, a WhatsApp message from a number nobody knew. Unset
    // for anybody a member of staff typed in, because the person who typed
    // them has already looked at them.
    //
    // It exists so the attention dot can mean one thing in both places it
    // appears. A contact who arrived through the door wants a look whether or
    // not they also sent a message, and a voice booking sends none at all —
    // so keying the dot purely off conversation entries left exactly the
    // arrivals worth noticing invisible. Compared against
    // attentionClearedAt like every other attention source.
    arrivedAt: v.optional(v.number()),
    // Mute — the ATTENTION switch, and only that. A muted customer stays fully
    // live: you can send to them, they still appear in search, their timeline
    // still records everything. What changes is that they stop asking for a
    // look. No dot on the contact, no row in the inbox, nothing added to the
    // sidebar count. Set = muted; the timestamp is only when.
    //
    // It is not consent and it is not a block. Consent is a legal fact about
    // what the salon may send; mute is a working preference about what this
    // person may put in front of the salon. Conflating them would mean muting
    // someone silently revoked their consent, which is exactly the sort of
    // quiet state change KVKK punishes.
    mutedAt: v.optional(v.number()),
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
    // The address the voice agent books by, exactly the job contactFields.key
    // does for properties: derived from the name once, then fixed. A salon
    // renaming "Manikür" to "Manikür & pedikür" must not break an agent
    // configured last month, and matching on the display name means it would.
    //
    // Optional because services predate it. Unset rows fall back to the name
    // (folded) on both read and match, and take a real key the first time
    // anybody edits them — so nothing needs migrating and nothing stays
    // unstable once it has been touched.
    key: v.optional(v.string()),
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
    //
    // LEGACY key for that guard: rules are documents now and sentRuleIds below
    // is where new sends stamp. Still read as a fallback so an appointment
    // half-reminded under the hour key does not get the same reminder twice
    // from its migrated rule. Never written anymore.
    reminderSentOffsets: v.optional(v.array(v.number())),
    // Message rules already dispatched for this appointment — the double-send
    // guard, keyed by rule id now that a rule is a document rather than an
    // hour. Same stamping order as above: BEFORE scheduling the send.
    sentRuleIds: v.optional(v.array(v.id("messageRules"))),
    // When this appointment next wants to send the customer something —
    // the earliest unsent reminder while it is live, or the winback once it
    // ends as a no_show. ONE field for both because the cron's question is the
    // same either way ("who is due?") and the status on the row already says
    // which kind is owed.
    //
    // Denormalised on purpose: without it the cron has to scan every
    // appointment starting in the next week ACROSS ALL ORGS to find the
    // handful that are due, which is work proportional to how many salons
    // exist rather than to how much there is to do. Unset means nothing is
    // owed — cancelled, completed, already fully reminded — and unset rows are
    // excluded from the index range the cron reads, so they cost nothing.
    //
    // Every write that moves startAt, status, reminderSentOffsets or
    // winbackSentAt must call syncAppointmentSchedule (lib/reminderSchedule.ts)
    // after patching. It is idempotent and recomputes from scratch, so calling
    // it twice is free and reminders.reconcile repairs anything a future write
    // path forgets.
    nextMessageAt: v.optional(v.number()),
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
    // Answers one question: does this person appear on any appointment. That
    // is what decides whether a staff row may be deleted or only deactivated,
    // and asking it by scanning the org's whole history would get slower every
    // month for a check that runs on a button.
    .index("by_org_staff", ["orgId", "staffId"])
    .index("by_org_external", ["orgId", "externalUid"])
    // Cross-org cron reads. Status first so a sweep for the few appointments
    // in a given state skips the overwhelming majority that are already
    // settled: completePast wants only rows still live after their day ended.
    .index("by_status_start", ["status", "startAt"])
    // Due sends, cheapest read in the app: the cron asks for rows whose next
    // message has come due and gets back exactly those.
    .index("by_next_message", ["nextMessageAt"]),

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

  // One automated message the org sends, as a row: WHEN it fires (an anchor
  // plus an offset), on WHICH channel, and — via waTemplates.ruleId — what it
  // says. Confirmation, each reminder, the follow-up, the cancellation notice
  // and the win-back are all the same kind of thing here; how many rows hang
  // off each trigger is the salon's business, not the schema's.
  //
  // This replaces the org-field trio (sendBookingConfirmation,
  // reminderOffsetsHours + pausedReminderHours, winbackEnabled) for orgs with
  // rulesMigratedAt set. The old fields stay readable so an undeployed org
  // keeps sending during the rollout; they are never the source of truth once
  // the marker is stamped.
  messageRules: defineTable({
    orgId: v.id("orgs"),
    // The anchor. booking and cancellation fire on the event itself, from the
    // mutation that causes it; the other three are scheduled by the cron
    // through appointments.nextMessageAt (lib/reminderSchedule.ts).
    trigger: v.union(
      v.literal("booking"),
      v.literal("before_start"),
      v.literal("after_end"),
      v.literal("cancellation"),
      v.literal("no_show"),
    ),
    // Hours from the anchor: before startAt, after startAt+duration, after the
    // no-show. 0 for the two event triggers — they have no delay to express.
    offsetHours: v.number(),
    // Per RULE, not per org: the 24h reminder can ride WhatsApp while the
    // review ask goes by email. org.messageChannel survives only as the
    // default stamped onto new rules.
    channel: v.union(
      v.literal("whatsapp"),
      v.literal("email"),
      v.literal("both"),
    ),
    // Exists-but-off. Presence is the row itself; deleting the row is the
    // other control, and the two are never one switch again.
    paused: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  // The message a rule sends, one row per (kind, language). The row is the
  // content source for EVERY channel: `body` is what the salon wrote, and it
  // goes out as-is on the Evolution lane and by email. Only the Cloud API lane
  // adds a gate on top — Meta approved an exact string, so that lane sends the
  // registered template (metaName + positional params), never the authored
  // body. Ported from Nudge's template engine, cut down to what a rule needs:
  // no triggers, no audiences, no media library.
  waTemplates: defineTable({
    orgId: v.id("orgs"),
    kind: v.union(
      v.literal("confirmation"),
      v.literal("reminder"),
      v.literal("winback"),
      // After the appointment ends, on completed only: the review ask, the
      // rebooking nudge.
      v.literal("followup"),
      // When the appointment is cancelled.
      v.literal("cancellation"),
      // Campaigns. Its {{3}} is NOT an appointment time — it is whatever line
      // the salon types for that campaign, which is what makes one approved
      // template serve every campaign they will ever run. See convex/campaigns.ts.
      v.literal("campaign"),
    ),
    // The rule this row words, when it words one specifically. Content
    // resolution at send time is (ruleId, language) first, then (kind,
    // language) with no ruleId — so the generic reminder text is the fallback
    // for every reminder row the owner has not given its own wording, which is
    // exactly the "the 24h and 2h reminders say different things" feature.
    ruleId: v.optional(v.id("messageRules")),
    // What the salon wrote, in named tokens ([name], [business], [date] —
    // lib/renderTokens). Rendered at send time for the lanes Meta does not
    // constrain. Optional because rows predate it; the send path falls back to
    // bodyPreview's positional text until the owner writes one.
    //
    // When bodyHtml below exists, THIS is the plain-text projection of it —
    // derived by the editor on save, never authored separately. WhatsApp and
    // the has-words checks read it; email prefers the HTML.
    body: v.optional(v.string()),
    // The email body as authored in the WYSIWYG editor — real HTML, signature
    // tables and all, same token vocabulary. Email lane only: WhatsApp sends
    // `body`, the plain text the editor derives from this on every save.
    bodyHtml: v.optional(v.string()),
    // Email subject line, same token vocabulary. WhatsApp ignores it.
    subject: v.optional(v.string()),
    // ---- Cloud API lane only, plumbing below this line -----------------------
    // The name approved in Meta Business Manager. Optional: an org on the shop
    // phone or email alone never registers anything with Meta, and a required
    // metaName would force a fake value into every such row.
    metaName: v.optional(v.string()),
    language: v.string(),
    // Meta's approval state, hand-tracked by the operator. Gates the Cloud
    // send only — the same row's body still emails and sends via Evolution
    // while this says "draft".
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    // The approved string as registered with Meta ({{1}} first name, {{2}}
    // business, {{3}} date+time). Kept as the legacy content fallback for rows
    // whose owner has not authored a body yet.
    bodyPreview: v.optional(v.string()),
    // Email engagement, denormalised because the honest alternative is
    // scanning every message the org ever sent. Sent bumps in ONE place
    // (messages.applySendResult, where every path already reports), opened in
    // one place (messages.recordEmailOpen, first open per message) — a counter
    // fed from a single site cannot drift the way the campaign comment warns
    // about. Only the winback template renders these; open tracking is a rate
    // on bulk-ish mail, never a per-customer fact (Apple and Gmail prefetch
    // pixels, so an individual "opened" would be a guess dressed as a record).
    emailSentCount: v.optional(v.number()),
    emailOpenCount: v.optional(v.number()),
    // Replies attributed latest-outbound-wins (lib/emailInbound → email.ts):
    // an inbound email credits the newest outbound this customer got in the
    // last 30 days. Same contract as Nudge — inbound mail carries no reliable
    // In-Reply-To through the webhook, so newest-wins IS the attribution.
    emailReplyCount: v.optional(v.number()),
    // When this template last actually sent an email — the "Sent 3× · last
    // Aug 2" line in the editor, without scanning messages to answer it.
    emailLastSentAt: v.optional(v.number()),
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
    // The {{1}}..{{n}} values this send used, in order. Stored rather than
    // rebuilt: a retry has to put the SAME words in front of the customer, and
    // reconstructing them later from the appointment and the org means a
    // rename or a reschedule silently changes what the second attempt says.
    templateParams: v.optional(v.array(v.string())),
    // Set when this row belongs to a campaign, so a run can count its own
    // outcome without scanning every message the org ever sent.
    campaignId: v.optional(v.id("campaigns")),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("received"),
    ),
    wamid: v.optional(v.string()),
    // Which WhatsApp lane carried this. Unset = cloud, which every row
    // predating the second lane was. Recorded rather than derived because a
    // reply has to go back out the way the message came IN: a customer who
    // wrote to the shop phone and gets answered from the Cloud number sees a
    // stranger's number replying to a conversation they had somewhere else.
    lane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
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
    // The message as its sender wrote it. RAW and untrusted — every render
    // path sanitises (src/lib/sanitizeHtml). `body` keeps the flattened text
    // beside it, because a thread list and an index want words, not markup.
    emailHtml: v.optional(v.string()),
    // Dedupe key, indexed. Webhooks retry — Resend will resend an event it
    // did not get a 2xx for, and a retried delivery must not become a second
    // copy of the same reply in the customer's timeline.
    emailId: v.optional(v.string()),
    error: v.optional(v.string()),

    // ---- Delivery durability (lib/sendFailure.ts, delivery.ts) ------------
    //
    // A reminder that fails once used to stay failed forever: the send path
    // wrote the row and stopped. Meta returning a 500, a rate limit, or a
    // dropped connection meant that customer simply never heard from the
    // salon, which is the product not working.
    //
    // So a failure that could plausibly succeed later is RETRIED on a backoff,
    // and only a failure that cannot — no consent, no approved template, a
    // closed session window — goes straight to `failed`.

    // How many provider attempts this row has had. Retained after success as
    // well: "delivered on the third try" is worth being able to see.
    attempts: v.optional(v.number()),
    // When the next attempt is due. Set only while a row is waiting to retry;
    // the row keeps status "queued" throughout, because a message we are still
    // trying to deliver has not failed yet and telling the salon otherwise
    // would be a lie it acts on.
    nextAttemptAt: v.optional(v.number()),
    // Stamped when an attempt is claimed, cleared when it lands. A row holding
    // this for longer than the reaper's threshold had its action die mid-POST
    // — nothing will ever come back for it, so the reaper fails it rather than
    // leaving it in flight forever.
    sendingAt: v.optional(v.number()),
    // Set when the retry budget ran out. Distinct from a plain `failed`: this
    // one was tried properly and the provider never took it, which is the
    // failure worth waking someone for.
    deadLetteredAt: v.optional(v.number()),

    // ---- Email open tracking (messages.recordEmailOpen, http /e/o/) --------
    //
    // Winback and campaign emails only. The pixel measures a RATE across a
    // template or a run; it is never shown as "this customer opened it",
    // because relay prefetch (Apple MPP, Gmail image proxy) opens pixels no
    // human saw and a per-person badge would launder that guess into a fact.

    // Opaque token minted at dispatch; the open pixel resolves the row by it.
    trackingToken: v.optional(v.string()),
    // When the provider accepted the send. _creationTime cannot serve here: a
    // campaign row is created queued and dispatched minutes later, and the
    // prefetch guard in recordEmailOpen needs the moment the mail actually
    // left, not the moment it was planned.
    sentAt: v.optional(v.number()),
    // First tracked open + total hits. Hits inside the first 15s of dispatch
    // are dropped as prefetch, see recordEmailOpen.
    openedAt: v.optional(v.number()),
    openCount: v.optional(v.number()),
    // When an inbound email was attributed to this outbound (latest-outbound-
    // wins, email.ts recordInbound). One reply credits one send, and a row
    // already credited is skipped so a chatty customer is not a 400% rate.
    repliedAt: v.optional(v.number()),
    // Which template row's words this send carried, for the denormalised
    // sent/open counters on waTemplates. Email sends only; WhatsApp rows keep
    // identifying their template by templateName as they always have.
    templateId: v.optional(v.id("waTemplates")),
  })
    .index("by_org", ["orgId"])
    .index("by_customer", ["customerId"])
    .index("by_appointment", ["appointmentId"])
    .index("by_email_id", ["emailId"])
    // Due scheduled sends. Status first so the scan skips everything already
    // sent, which is nearly the whole table.
    .index("by_status_scheduled", ["status", "scheduledFor"])
    // Rows waiting on a retry. Unset sorts before every number, so the cron's
    // range starts above zero and reads only rows actually owed an attempt.
    .index("by_next_attempt", ["nextAttemptAt"])
    // In-flight rows, for the reaper. Same trick: unset means not in flight.
    .index("by_sending", ["sendingAt"])
    // Failure surfacing per org — the Messages tab badge and the platform
    // admin's per-org health both ask "what broke here lately".
    .index("by_org_status", ["orgId", "status"])
    // Which messages show a given image. Exists so deleting a library asset
    // can ask exactly that, rather than scanning recent messages and hoping
    // the one that would break is among them.
    .index("by_media", ["mediaStorageId"])
    .index("by_campaign", ["campaignId"])
    .index("by_wamid", ["wamid"])
    // Open-pixel hits. The token is the capability: the route carries no auth,
    // so resolving it must be an indexed point read, not a scan.
    .index("by_tracking_token", ["trackingToken"]),

  // A one-off message to a group of customers — "we're closed next Monday",
  // "20% off colour in March", "we've moved".
  //
  // ── THE CONSTRAINT THAT SHAPES ALL OF THIS ────────────────────────────────
  //
  // A campaign is business-INITIATED: the customer did not just message us, so
  // Meta's 24h session window is shut and free-form text is refused (131047).
  // Cold WhatsApp must be a pre-approved template. That is not a limitation to
  // engineer around; it is the rule that keeps the channel worth having.
  //
  // So the salon registers ONE approved campaign template whose third
  // parameter is a free line — "Merhaba {{1}}! {{2}} olarak {{3}}" — and each
  // campaign supplies that line. One approval, every campaign they will ever
  // run. Email has no such rule and takes the same line as free-form text.
  campaigns: defineTable({
    orgId: v.id("orgs"),
    // What the salon calls this run, for their own list. Never sent.
    name: v.string(),
    // The line that becomes {{3}} on WhatsApp and the body of the email.
    // Tokens (lib/renderTokens) resolve per recipient.
    body: v.string(),
    segment: v.object({
      // Nobody seen for this many days. The commonest campaign there is.
      notSeenForDays: v.optional(v.number()),
      // Customers with no completed appointment at all — enquired, never came.
      neverBooked: v.optional(v.boolean()),
      // Everyone who has had this service before.
      serviceId: v.optional(v.id("services")),
    }),
    status: v.union(
      v.literal("draft"),
      v.literal("sending"),
      v.literal("done"),
    ),
    // Snapshotted when the run starts. The segment is re-evaluated at send
    // time, so this is what it MEANT then, not a live count.
    recipientCount: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdBy: v.optional(v.id("users")),
  }).index("by_org", ["orgId"]),

  // Images the salon sends OUT — a price list, a before-and-after, the card
  // machine being broken today. Inbound images already land in Convex storage
  // (messages.mediaStorageId); this is the other direction, and it needs a
  // library rather than an upload-per-message because the same price list gets
  // sent forty times.
  //
  // The blob lives in Convex storage; this row is the name, the size and the
  // fact that this org owns it. Deleting a row is refused while any message
  // still shows the image — a thread that renders a broken image is a worse
  // outcome than an asset list with an old entry in it.
  mediaAssets: defineTable({
    orgId: v.id("orgs"),
    storageId: v.id("_storage"),
    // What the uploader called the file. Shown in the picker, so it is worth
    // keeping even though the blob has no idea what its name is.
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    uploadedBy: v.optional(v.id("users")),
  })
    .index("by_org", ["orgId"])
    .index("by_storage", ["storageId"]),

  // Who did what. Written for ONE question: a salon shares a login-per-person
  // and an inbox, so "who cancelled Ayşe's appointment?" and "who marked that
  // no-show?" currently have no answer at all — notes carry an author and
  // nothing else does.
  //
  // Deliberately narrow. Message sends are NOT logged here: the customer's
  // thread already shows every message with its time and status, and copying
  // that into a second feed would bury the handful of entries anyone actually
  // looks for. Nor is the hourly completePast sweep, which would write a row
  // per appointment per day to say the machine did the boring thing.
  //
  // actorId unset means the system acted — a cron, a webhook, the voice agent.
  // The display name resolves at read time (same as notes) so somebody
  // changing their name does not leave stale attribution frozen into history.
  activityLog: defineTable({
    orgId: v.id("orgs"),
    actorId: v.optional(v.id("users")),
    // Done by the platform operator working inside this business. actorId is
    // still stored, so there is an internal record of WHICH operator, but the
    // read path (convex/activity.ts) resolves the display name to the brand
    // and never sends the person's name or id to the salon's browser. The
    // salon is owed "Autotakt changed this", not an individual's name.
    viaOperator: v.optional(v.boolean()),
    // How this happened, not who. The same person is "user" when they click in
    // the app and "agent" when they ask Claude to do it from their phone.
    // Unset reads as "user", so every row written before this keeps its
    // meaning. Sits alongside viaOperator rather than inside it: an operator
    // acting through an agent is both, and collapsing them would hide one.
    actorKind: v.optional(
      v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    ),
    // Which MCP connection did it, so the feed can filter to one client and
    // offer a per-connector revoke.
    connectionId: v.optional(v.id("mcpConnections")),
    // The journal row backing an agent write, so a feed line can offer Undo
    // without re-deriving what changed.
    agentActionId: v.optional(v.id("agentActions")),
    kind: v.union(
      v.literal("appointment_created"),
      v.literal("appointment_status"),
      v.literal("appointment_moved"),
      v.literal("appointment_deleted"),
      v.literal("customer_created"),
      v.literal("customer_deleted"),
      v.literal("settings_changed"),
      v.literal("member_invited"),
      v.literal("member_removed"),
      v.literal("whatsapp_connected"),
      // A booking that reached us and could not be stored — today only from
      // cal.com, when the attendee's phone is not a number we can message.
      // The odd one out in this union: every other kind records what somebody
      // DID, and this one records what the product failed to do. It lives here
      // anyway because the feed is the only per-org surface a salon already
      // reads, and a failure nobody sees is the same as no failure at all.
      // `detail` carries the name, the time and the number as typed.
      v.literal("booking_dropped"),
      // A note written on a customer. Notes have existed since long before the
      // feed recorded them; an agent logging "she asked to move to Thursday"
      // from a phone is the first thing that needs it visible to the salon.
      v.literal("note_added"),
      // Customer details edited. customer_created and customer_deleted were
      // enough while only a human could type; an agent editing a phone number
      // is exactly the change an owner wants to see and be able to take back.
      v.literal("customer_updated"),
      // An agent action reversed. Its own row rather than deleting the
      // original: "changed, then put back" is the honest history, and erasing
      // half of it would be a lie told to whoever reads the feed next.
      v.literal("agent_undo"),
    ),
    customerId: v.optional(v.id("customers")),
    appointmentId: v.optional(v.id("appointments")),
    // The specifics, already rendered: "scheduled → no_show", a new time, a
    // settings field name. Free text because the alternative is a shape per
    // kind, and nothing reads this except a human scanning a list.
    detail: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_customer", ["customerId"]),

  // A chat client (Claude, ChatGPT) holding a key that lets it read and act on
  // ONE workspace as ONE person. The key pins both, because this product is a
  // single deployment where every row carries an orgId — a key that only knew
  // the person would have to guess which salon they meant, and guessing wrong
  // writes a stylist's note into someone else's business.
  //
  // Pinning the org is not the same as trusting it: `memberships` stays the
  // authority, exactly as in lib/orgAuth.ts, and is re-checked on every call.
  // An owner removing someone from the team has to kill that person's connector
  // too, and they will not think to. Re-checking is what makes the removal
  // enough on its own.
  mcpConnections: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    // The label a human chose, shown in the feed as "Ayşe · Claude".
    name: v.string(),
    key: v.string(),
    // The client's SELF-REPORTED identity. A label for reading the feed, never
    // a permission — anything can claim to be Claude during setup. Gate on this
    // row's own id if you ever need to restrict a client.
    client: v.union(
      v.literal("claude"),
      v.literal("chatgpt"),
      v.literal("other"),
    ),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    // Revoked rather than deleted, so lastUsedAt and the journal rows pointing
    // at this connection survive someone asking what it did.
    revoked: v.optional(v.boolean()),
  })
    .index("by_key", ["key"])
    .index("by_org", ["orgId", "createdAt"])
    .index("by_user", ["userId"]),

  // Every mutating tool call a connection makes, with enough prior state to
  // reverse it. Field-level, NOT whole-document: an undo that restored a
  // snapshot would quietly revert whatever a stylist edited in between, and the
  // person who lost their work would have no idea why.
  agentActions: defineTable({
    orgId: v.id("orgs"),
    connectionId: v.id("mcpConnections"),
    userId: v.id("users"),
    tool: v.string(),
    // JSON. What the model asked for, so the feed shows intent and not just
    // outcome.
    args: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    // JSON of ONLY the keys the tool wrote.
    before: v.string(),
    after: v.string(),
    at: v.number(),
    // Irreversible by nature — a sent WhatsApp, a placed call. Journaled all
    // the same, so one query answers "what did this connection do", and undo
    // refuses rather than pretending.
    reversible: v.boolean(),
    undoneAt: v.optional(v.number()),
    undoneByActionId: v.optional(v.id("agentActions")),
  })
    .index("by_org", ["orgId", "at"])
    .index("by_connection", ["connectionId", "at"])
    .index("by_target", ["targetTable", "targetId", "at"]),

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
