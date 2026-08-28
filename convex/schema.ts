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
    // A booking nobody in the salon typed in — the booking page, the voice
    // agent, the chat agent. The email carries a real calendar invite
    // (lib/ics.ts), so Gmail puts the appointment on the reader's own
    // calendar; a cancellation retracts it under the same UID. Same
    // system-only rule as notifyNewContact: appointments.source gates it in
    // scheduleLifecycleMessages, so the grid never echoes your own typing.
    notifyNewBooking: v.optional(v.boolean()),
    // The retraction half rides its own switch — and only fires for
    // cancellations the customer caused; in-app cancels never email the
    // person who typed them (lib/alerts.ts bookingCancelled).
    notifyCancelledBooking: v.optional(v.boolean()),
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

  // MY pins — the green half of an inbox row's dot. Manual, sticky, and per
  // PERSON, which is exactly why it cannot live on the customer the way
  // attentionClearedAt does: a pin is one member of staff saying "I am coming
  // back to this", and pushing that onto a colleague's screen is the thing the
  // shared dot got wrong.
  //
  // Unpinning DELETES the row, so this table is the size of what is pinned
  // right now rather than of everything ever pinned, and the inbox can read a
  // person's pins whole without an index scan over history.
  inboxPins: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    customerId: v.id("customers"),
    pinnedAt: v.number(),
  })
    .index("by_org_user", ["orgId", "userId"])
    .index("by_org_user_customer", ["orgId", "userId", "customerId"]),

  // FROZEN BASELINE. These were the whole unread model: seenAt was "I have the
  // tab open" and leftAt was "I walked away", and a row counted as new when its
  // latest inbound landed after leftAt. That boundary could only answer "have
  // you been to the Inbox lately", so switching tabs marked everything read —
  // markers went out with nobody having opened a single conversation, and an
  // Unread filter over it would empty itself every time you navigated away.
  //
  // Unread is per-CONVERSATION now (inboxReads below). Nothing writes this any
  // more; it survives as the FLOOR under that model, so the day the switch
  // shipped nobody woke up to their whole history lit green. Never write it
  // again — a moving floor silently marks things read, which is the bug this
  // replaced.
  //
  // Its own table rather than two columns on `memberships`, which is where
  // this started: a platform operator working inside a tenant resolves an org
  // through actingAsOrgId and has NO membership row (see lib/orgAuth for why
  // that is deliberate and not going to change). Hanging the stamps off
  // membership therefore made both markers permanently invisible in the exact
  // mode the product is demoed and debugged in. Keyed by org + user like
  // inboxPins beside it, so both surfaces work for anyone who can open the
  // Inbox at all.
  inboxVisits: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    seenAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
  }).index("by_org_user", ["orgId", "userId"]),

  // "I opened this conversation, at this moment." PER-USER, one row per
  // conversation anyone has ever opened, and the whole of the unread model: a
  // conversation is NEW when its latest inbound is newer than my stamp for it,
  // floored by inboxVisits above for the rows I never opened.
  //
  // Per user and not per org-wide-customer on purpose, the same reasoning as
  // inboxPins: a colleague reading a message does not mean I have. That is a
  // real difference from attentionClearedAt, which is shared and stays shared.
  //
  // Rows are never pruned. Readers look a stamp up by (org, user, customer)
  // rather than reading the set, so the table's SIZE costs a query nothing. If
  // that ever changes, compact — advance the floor to the newest fully-read
  // conversation and delete underneath it — rather than reading it whole.
  inboxReads: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    customerId: v.id("customers"),
    readAt: v.number(),
  }).index("by_org_user_customer", ["orgId", "userId", "customerId"]),

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
    // The secret that actually grants the membership, and the only thing that
    // does. This used to be matched on `email` alone at first sign-in, with no
    // token, no expiry and no acceptance step — so anyone could found an org,
    // invite an address they did not control, and wait: when that person signed
    // in with Google for the first time they landed inside the inviter's
    // workspace, reading and writing a stranger's salon, and with no org of
    // their own because the founding path only ran when no invite matched.
    //
    // Optional because rows predating this exist; team.acceptInvite refuses a
    // tokenless row, so those are inert rather than dangerous.
    token: v.optional(v.string()),
    // An invite that sits open forever is a trap that ages into a breach. 14
    // days from issue; acceptInvite checks it.
    expiresAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_org", ["orgId"])
    .index("by_token", ["token"]),

  orgs: defineTable({
    name: v.string(),
    // IANA zone; appointment times store UTC ms and format through this.
    timezone: v.string(),
    // BCP 47-ish short code driving template language + date formatting ("tr").
    language: v.string(),
    // What kind of business this is (lib/industryPresets IndustryKey),
    // answered in onboarding. Drives which starter services/fields a preset
    // application seeds and nothing else at runtime — verticalization stays
    // org data, and this is only the remembered answer that lets Business
    // settings offer "reset to industry defaults" later. A plain string so a
    // retired industry key never wedges the schema.
    industry: v.optional(v.string()),
    // The org's public handle, used in its request-form URL (/r/<slug>).
    // Generated from the name on first enable rather than asked for: one more
    // thing to invent is one more reason a salon owner stops halfway through
    // setup. Separate from inboundAddress on purpose — an org changing the
    // address customers email must not break every form link it has shared.
    publicSlug: v.optional(v.string()),
    // Off until switched on. A form URL that answers before anyone has looked
    // at what it asks is worse than a 404.
    // DEAD (2026-08-19). Gated the public request form at /r/<slug> — a
    // second public page asking a stranger for their name and a service,
    // which then landed as a message for staff to book by hand. It and
    // /book/<slug> were two channels for one job; the booking page, which
    // actually writes the appointment, is the one that stayed. Nothing reads
    // or writes this any more, and Convex cannot drop a field while documents
    // still carry values. `publicSlug` below is LIVE — the booking page uses
    // the same slug.
    formEnabled: v.optional(v.boolean()),
    // The native booking page (/book/<slug>) — services, live slots, a real
    // appointment at the end. Shares publicSlug with the request form; its own
    // switch because publishing "ask us" and publishing "book yourself" are
    // different amounts of trust in the calendar.
    bookingEnabled: v.optional(v.boolean()),
    // Whether prices are written with their decimal part. Off by default
    // (2026-08-20): a Türkiye salon prices in whole lira and "₺350,00" is two
    // characters of noise on every row of a page a stranger is reading to
    // decide whether to book. It only ever removes ZEROES — lib/money never
    // rounds, so a price that genuinely carries kuruş still shows them.
    //
    // Lives next to currency in Business → General because it is the same
    // question: currency picks the symbol, language picks the separators,
    // this picks how much of the number to write.
    priceDecimals: v.optional(v.boolean()),
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
    // unset) offers only agents carrying this org's tag — the ones Resepta
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
    // always have, and Resepta still sees every word of it — which Cloud
    // cannot do at any price (see convex/webhook.ts handleEvolutionEvent).
    //
    // There is deliberately no lane SELECTOR. Which lanes an org has is read
    // off what is configured: a waAccounts row means Cloud, an instance name
    // here means Evolution, both means both. A selector would have been a
    // third source of truth able to disagree with the two real ones.
    evolutionInstance: v.optional(v.string()),
    // Authenticates the Evolution inbound webhook, exactly the job
    // calcomWebhookToken does for cal.com. Evolution posts a bare JSON body
    // with no HMAC and no shared secret, so the org used to be resolved from
    // the instance NAME in the payload — a string nothing in this codebase
    // generates, with no length or charset rule, which made the endpoint
    // genuinely unauthenticated. An anonymous POST naming an instance and a
    // customer's number could cancel that customer's next booking, push the
    // cancellation to cal.com, and spend the org's LLM budget on a reply.
    //
    // Now the token in the URL identifies the org and the instance name is
    // just a label. Set it from Settings → WhatsApp; until it is set the
    // route refuses, because "no token configured" must not read as "any
    // caller welcome".
    evolutionWebhookToken: v.optional(v.string()),
    // From-address for customer emails; delivery goes straight to the email
    // provider (env RESEND_API_KEY, see lib/email.ts). The domain has to be
    // verified there or sends are rejected. Unset = email off.
    emailFrom: v.optional(v.string()),
    // The salon's logo, shown wherever a CUSTOMER meets the business — the
    // public booking page's header, the manage page. Uploaded from Settings
    // by the owner (orgs.setLogo); unset renders the name alone, which is
    // what every org did before this existed.
    logoStorageId: v.optional(v.id("_storage")),
    // Which channel the appointment rules (confirmation, reminder, winback)
    // send on. Unset = "both", which is what every org did before the choice
    // existed: attempt WhatsApp, and email rides alongside when configured.
    // This is a PREFERENCE, unlike the lane selector deliberately absent
    // above: WhatsApp-vs-email is a real decision the salon owns, whereas
    // cloud-vs-shop-phone is plumbing read off what is configured.
    // Identity columns the voice agent may NOT write, chosen in Business →
    // Fields. Phone is not listed because it is not a choice: callers are
    // matched by it. Unset means none locked — a receptionist that can
    // correct a misspelt name is the default, not the upgrade.
    voiceLockedIdentity: v.optional(
      v.array(
        v.union(v.literal("firstname"), v.literal("lastname"), v.literal("email")),
      ),
    ),
    // The identity columns' extraction instructions, the same job
    // contactFields.voiceDescription does for org fields. On the org because
    // the identity columns have no contactFields row to carry it. Unset keys
    // fall back to deriveCaptureRows' stock wording.
    voiceIdentityDescriptions: v.optional(
      v.object({
        firstname: v.optional(v.string()),
        lastname: v.optional(v.string()),
        email: v.optional(v.string()),
      }),
    ),
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
    // ── LEGACY away-reply fields ───────────────────────────────────────────
    // Superseded by the out_of_hours messageRules row (and its waTemplates
    // wording) once messageRules:migrateOutOfHoursAll has run. Kept readable
    // for the same reason as the legacy rule trio above; never the source of
    // truth for an org that has the rule row.
    autoReplyEnabled: v.optional(v.boolean()),
    autoReplyText: v.optional(v.string()),
    // The org's public booking link — the [booking_link] template token, what
    // the out-of-hours reply and the voice agent hand to customers. Once the
    // native /book page exists for this org it auto-fills from there; until
    // then it is whatever external page the org pasted (historically cal.com).
    bookingUrl: v.optional(v.string()),
    // LEGACY (2026-08-19). The [phone] token resolves at send time from the
    // enabled voice agent's inbound line (lib/publicPhone) — the settings
    // field that wrote this duplicated that picker and went. Kept because a
    // pre-agent org may have typed a front-desk number here; it is the
    // resolver's fallback and nothing writes it any more.
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
    // Suspension (docs/chat-agent.md §8). Unset = active. Suspended stops
    // SPEND and OUTBOUND — reminders, campaigns, composer sends, the chat
    // agent — at the send chokepoints, each failing permanent with
    // "org-suspended" so the stop is visible rather than silent. Inbound keeps
    // recording on purpose: un-suspending must restore a complete world, and
    // losing a customer's messages during a billing dispute is how a late
    // payer becomes an ex-customer. Operator-set from /admin only.
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"))),
    // Set the moment an operator confirms a deletion, and the row is on its
    // way out from then on: it leaves the fleet list, and a scheduled job is
    // walking every org-scoped table in batches behind it (platform.deleteOrg).
    //
    // A column rather than deleting the org row first, because every one of
    // those tables is keyed BY this row — remove it up front and the purge has
    // nothing to find the leftovers with. It also makes the in-between state
    // legible instead of a fleet that mysteriously still lists a business
    // whose data is half gone.
    //
    // Nothing reads this to gate access: the same mutation suspends the org,
    // and suspension is the switch every send path already respects.
    deletingAt: v.optional(v.number()),
    // Chat agent lifecycle (docs/chat-agent.md §5). Unset = off. "shadow"
    // runs the full agent on real inbound and records the turn WITHOUT
    // sending — the pre-launch QA state, the owner trust ramp and the canary
    // in one value. "live" sends. Operator-set from /admin; going live
    // without a week of shadow is possible and inadvisable.
    chatAgentMode: v.optional(
      v.union(v.literal("off"), v.literal("shadow"), v.literal("live")),
    ),
    // Per-org monthly LLM budget override, in micro-USD. Unset = the code
    // default (lib/llm.ts). A hard cap, not advisory: the turn that would
    // cross it is skipped with a "budget-exhausted" turn row and the agent
    // pauses politely. Protects the platform key from a runaway loop and one
    // org from becoming everyone's bill.
    chatAgentMonthlyBudgetMicroUsd: v.optional(v.number()),
    // What THIS org pays per called minute, micro-USD, billed per second.
    // Operator-set from /admin only. Unset or 0 = metered at rate zero: the
    // meter still counts seconds and Retell cost so an unpriced org's burn
    // stays visible, the bill is just 0. The rate is read once per call at
    // stamp time (retell.recordCall) and frozen onto the row — changing it
    // never rewrites a past call.
    voiceRateMicroUsdPerMinute: v.optional(v.number()),
    // What THIS org pays per AI chat reply, micro-USD — the chat lane's
    // voiceRateMicroUsdPerMinute. Same resolution (org ?? platform default ??
    // 0, read at stamp time in chatAgent.recordTurn and frozen onto the turn
    // row), same "unset meters at zero" semantics, same operator-only /admin
    // surface. Priced per SENT reply, not per token: tokens are the cost
    // side (chatAgentTurns.costMicroUsd, never the org's business), replies
    // are what the product sells.
    chatRateMicroUsdPerTurn: v.optional(v.number()),
    // Per-org override of the platform waMarkupPercent — what this org pays
    // on top of Meta's own per-message rate for Cloud template sends. Unset =
    // the platform default; an explicit 0 means pass-through, which is what
    // an override means (the voiceRate rule).
    waMarkupPercent: v.optional(v.number()),
    // Which phone lines this tenant may use, E.164, operator-set from /admin
    // only. Every tenant shares one Retell account and therefore one phone
    // number namespace (voiceProvisioning.stampDefaultRetellKey copies the
    // platform key onto each org), so without this a connector could name ANY
    // number in that namespace and bind another salon's line to its own agent —
    // their callers reaching the wrong agent, their customers' names landing in
    // the wrong table.
    //
    // Unset means "not restricted yet", which keeps existing orgs working on
    // deploy; the cross-org claim check in retellAgent.assertLineUsable runs
    // either way, so the theft is closed even for an org with no list. Set it
    // per tenant to make the allowlist authoritative for inbound AND outbound.
    allowedPhoneNumbers: v.optional(v.array(v.string())),
    // The one OWNER-set number on the voice meter: a soft monthly budget for
    // the billed side, in micro-USD. Crossing 80% and 100% emails the org's
    // owner once per threshold per month. An alert, deliberately not a cap:
    // the chat lane's hard cap protects OUR platform LLM key from a runaway
    // loop, but a voice call is the salon's own customer on the line, and
    // hanging up on them mid-month is worse than any bill. Suspension stays
    // the operator's lever for the org that will not pay.
    voiceMonthlyBudgetMicroUsd: v.optional(v.number()),
    // How this org settles the meter. Unset = "invoice": the meter counts,
    // the bill is settled outside the product and nothing enforces — every
    // org predating the wallet. "prepaid" is the self-serve model: a wallet
    // balance topped up in-app through Stripe, drawn down by every metered
    // charge, and a balance at or below zero declines NEW inbound calls at
    // ring time (retell.beforeCallContext). An in-flight call always
    // finishes; the overdraft that allows is bounded by one call and is the
    // price of never hanging up on the salon's own customer. Operator-set
    // from /admin.
    billingMode: v.optional(v.union(v.literal("invoice"), v.literal("prepaid"))),
    // The prepaid wallet, micro-USD like every meter field, and deliberately
    // lane-agnostic: voice draws it down today, and any future metered lane
    // draws the same number rather than growing a wallet of its own.
    // Credited only by wallet.creditTopup (Stripe webhook, operator
    // adjustment); debited only inside retell.meterCall, in the same
    // mutation that stamps the call — the usageMonthly rule applied to
    // money out. May sit slightly negative: a call's length is known only
    // after it ends.
    walletBalanceMicroUsd: v.optional(v.number()),
    // Low/empty alert stamps, re-armed by a top-up rather than by the
    // calendar: running low is a fact about the balance, not the month.
    // (usageMonthly's voiceBudgetAlert* stamps re-arm monthly because a
    // budget is monthly; these clear when money arrives.)
    walletAlertLowAt: v.optional(v.number()),
    walletAlertEmptyAt: v.optional(v.number()),
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
    .index("by_evolution_instance", ["evolutionInstance"])
    .index("by_evolution_token", ["evolutionWebhookToken"])
    // Both were resolved by collecting the WHOLE table and running Array.find,
    // on the grounds that orgs is "one row per paying business, read once per
    // page". The read count was the smaller half of the problem: a full
    // .collect() puts every org document into the subscription's read set, so
    // any org editing any setting invalidated and re-ran every open public
    // booking page on the deployment — a fan-out that grows as orgs ×
    // concurrent visitors, for orgs that have nothing to do with each other.
    // Both fields are already documented as globally unique handles.
    .index("by_public_slug", ["publicSlug"])
    .index("by_inbound_address", ["inboundAddress"]),

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

  // The operator's edits to the onboarding verticals (lib/industryPresets).
  //
  // An OVERRIDE table, not the source of truth. A vertical with no row here is
  // served straight from the code module, so a catalogue improvement shipped in
  // a commit still reaches every vertical nobody has touched, and "revert to
  // code" is deleting a row rather than restoring a backup. The point is not to
  // move the catalogue into the database (Serdar, 2026-08-22: Claude still owns
  // it) — it is that a vertical can be READ, corrected in a hurry, or drafted
  // for later without a deploy, and that the drift is visible while it lasts.
  //
  // No orgId, and that is not a hole in the one invariant: a preset is
  // deployment-wide seed data, identical for every business, and it becomes org
  // data only when onboarding copies it into `services` and `contactFields`
  // rows. Nothing here is ever read on a per-org path.
  industryPresets: defineTable({
    // Matches lib/industryPresets IndustryKey where the vertical exists in
    // code. A key that does not is an operator-coined vertical, which is why
    // this is a plain string: adding one must not need a schema change, and a
    // retired key must not wedge the schema (same reasoning as orgs.industry).
    key: v.string(),
    name: v.object({ tr: v.string(), en: v.string(), de: v.string() }),
    services: v.array(
      v.object({
        name: v.object({ tr: v.string(), en: v.string(), de: v.string() }),
        durationMinutes: v.number(),
      }),
    ),
    // No price, matching the code module: an invented price is a claim about
    // the business. No `source` either — every preset field is voice-sourced by
    // definition (the whole reason to seed one is that the agent collects it),
    // so storing the constant would only let an operator set it wrong.
    fields: v.array(
      v.object({
        key: v.string(),
        label: v.object({ tr: v.string(), en: v.string(), de: v.string() }),
        type: v.union(
          v.literal("text"),
          v.literal("select"),
          v.literal("number"),
          v.literal("date"),
        ),
        options: v.optional(
          v.object({
            tr: v.array(v.string()),
            en: v.array(v.string()),
            de: v.array(v.string()),
          }),
        ),
      }),
    ),
    // Off hides the vertical from the onboarding picker without breaking the
    // businesses already on it: a retired vertical still resolves, so their
    // "reset to industry defaults" keeps working. It is also where a vertical
    // drafted for later waits until somebody is ready to offer it.
    active: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_key", ["key"]),

  // The operator's edits to what a NEW phone agent is born saying
  // (lib/voiceAgentTemplate GENERAL_PROMPTS / BEGIN_MESSAGES).
  //
  // Same override shape as industryPresets above, and the same argument: the
  // prompt is prose curated in three languages, which wants review and a
  // revert, so the code module stays the source of truth and a row here lays
  // over one language until somebody ports it back.
  //
  // ⚠️ THIS REACHES NEW AGENTS ONLY, and that is not a limitation of the
  // implementation — it is the template's standing rule (see the header of
  // lib/voiceAgentTemplate). An agent that exists owns its prompt: the owner
  // edits it in their own editor, and retellAgent.syncTemplate deliberately
  // PATCHes tools and engine settings while never sending general_prompt or
  // begin_message. Only the provisioning path resolves an override, so there
  // is no code path by which editing a row here changes a live agent.
  voicePrompts: defineTable({
    // One row per agent language. Not per vertical: the prompt is the same for
    // a dentist and a barber ON PURPOSE — what differs is the services and
    // contact fields injected at ring time, which is what industryPresets
    // seeds. A per-vertical prompt would be 24 pieces of prose maintained to
    // say what the context block already says.
    language: v.union(v.literal("tr-TR"), v.literal("en-US"), v.literal("de-DE")),
    // The whole prompt as one string. The module holds it as an array of lines
    // for readability and joins with newlines; a textarea is the same thing.
    general: v.string(),
    // The greeting for an agent with no persona name, and the one for an agent
    // that has one — the second carrying a {name} placeholder substituted at
    // provisioning. Two strings rather than one with a conditional, because an
    // unnamed agent greeting with "ben ." is what the split exists to prevent.
    beginMessage: v.string(),
    beginMessageNamed: v.string(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_language", ["language"]),

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
    // What the agent calls itself to a caller — "ben Deniz". Resepta's, not
    // the provider's: agent_name at Retell is the label the OWNER picks a row
    // by in a list ("Bella Randevu Asistanı"), and reading that down a phone
    // line is not a greeting. Injected as {{agent_name}} at ring time, so
    // renaming her takes effect on the next call with no republish.
    personaName: v.optional(v.string()),
    // True on the ONE agent whose Talimat the WhatsApp chat lane composes
    // over (chatAgent.loadTurnContext). At most one per org — chat is a
    // single conversation surface and two agents answering it is not a thing
    // — enforced as a radio in retell.update: switching an agent on switches
    // every other row off in the same mutation. Stored as true-or-absent,
    // never false, so there is one spelling of "not the chat agent".
    // Independent of `enabled` above, which is the VOICE switch: a salon may
    // run chat while the phone is off for holidays.
    chatEnabled: v.optional(v.boolean()),
    // Whether the agent may hang up. Unset reads as ON, matching the template
    // default and what a new agent is provisioned with. Stored here so the
    // toggle can render without a provider round trip and so syncTemplate does
    // not hand the tool back to a salon that turned it off, but the tool
    // ITSELF lives at the provider — see setEndCallEnabled.
    canEndCall: v.optional(v.boolean()),
    // Operator's per-agent model override, one of lib/voiceModels. Unset means
    // the platform default (the template's model), which is what every agent
    // starts as — so the common case stays one string in code rather than a
    // thousand rows all saying "haiku". Written by platform.setAgentModel only
    // after the provider publish succeeds, and read back by syncTemplate so an
    // operator's choice survives the owner clicking the template-update
    // banner — same contract as canEndCall above.
    llmModel: v.optional(v.string()),
    // Operator's per-agent fast-tier override (Retell's model_high_priority).
    // Unset means the fleet default from /admin, and an unset fleet row means
    // the template constant — same three-step fall-through as llmModel above,
    // and stored for the same reason: syncTemplate reads it back so clicking
    // the owner's update banner cannot silently repoint a tier the operator
    // chose. Only meaningful on a text-pipeline model; a realtime agent has
    // no such knob and enginePatchFor drops it.
    llmHighPriority: v.optional(v.boolean()),
    // Which Resepta template generation last touched this agent's voice
    // engineering — stamped at creation and by syncTemplate, compared against
    // VOICE_AGENT_TEMPLATE_VERSION to offer the update. Absent on agents from
    // before stamping existed and on externally-built agents the org merely
    // connected; both read as "behind", which is honest — neither carries the
    // current template's tuning.
    templateVersion: v.optional(v.number()),
    // The general_prompt Resepta last PUBLISHED to this agent — a mirror of
    // the provider's copy, not a second truth: the provider still holds what
    // the live agent actually says. Stamped by every path that sends prompt
    // text (publishPrompt, publishPromptForOrg, provisioning), because until
    // this existed the only copy of a salon's edited Talimat lived at the
    // provider, two HTTP hops away — and the CHAT lane composes its system
    // prompt from this text on every inbound message (docs/agent-core.md),
    // which cannot afford a provider round trip per turn. Absent on agents
    // that were connected rather than born here and have not been published
    // since; chat falls back to the code template until they are.
    generalPrompt: v.optional(v.string()),
    // The provider agent version that publish produced (the "v73" the editor
    // shows), stamped beside the text so a chat turn can name the exact
    // prompt generation it ran under.
    promptVersion: v.optional(v.number()),
    promptMirroredAt: v.optional(v.number()),
    // Set only after a variable publication succeeds at Retell. This separate
    // marker matters because an intentionally empty registry is still a real,
    // managed configuration and must not re-import deleted provider fields.
    variablesSyncedAt: v.optional(v.number()),
    variablesRetellVersion: v.optional(v.number()),
    // Runtime credentials are one-way hashes. The clear token is written to
    // the provider once and never stored in Resepta.
    runtimeTokenHash: v.optional(v.string()),
    // The hash this agent answered to BEFORE the current rotation, still
    // accepted.
    //
    // runtimeMcpConfig mints a fresh token and commits its hash as an argument
    // to the publish chain — so the write lands first, and any non-2xx in
    // create-agent-version / update-retell-llm / update-agent /
    // publish-agent-version (a 429 is enough) leaves Retell's published agent
    // holding the OLD bearer token while we hold only the new hash. Every
    // save_customer_details on every subsequent call then 401s, permanently,
    // until somebody happens to republish successfully — and nothing alerts.
    //
    // Keeping one generation back closes that without restructuring four call
    // sites. It is not a new exposure: the previous token is one Retell was
    // already given. It ages out on the next successful rotation.
    runtimeTokenHashPrevious: v.optional(v.string()),
    runtimeConnectedAt: v.optional(v.number()),
    // Customer-facing health is derived from these stamps. Provider detail
    // remains in the event inbox for the platform operator.
    lastCallEventAt: v.optional(v.number()),
    lastAnalyzedEventAt: v.optional(v.number()),
    lastEventErrorAt: v.optional(v.number()),
    lastEventError: v.optional(v.string()),
    // A webhook arrived for this agent and its signature did not verify, which
    // in practice means the org holds a key from the right workspace that is
    // not that workspace's signing key. Kept separate from lastEventError
    // because that one describes OUR code failing on an event we accepted;
    // this one is a credential the operator has to change, and it is the only
    // failure that never reaches voiceEvents at all — the request is turned
    // away at the door, so without this stamp the app has no record it
    // happened. Cleared by the next signature that does verify.
    signatureRejectedAt: v.optional(v.number()),
    signatureRejectedRoute: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_agent", ["retellAgentId"])
    // The inbound webhook's fallback: Retell's weighted inbound_agents
    // binding sends call_inbound without an agent_id, so the handler resolves
    // the agent from the line that was dialled.
    .index("by_inbound_number", ["inboundNumber"]),

  // One provider phone line and which agent it rings (inbound) or dials as
  // (outbound). The multi-number generalization of retellAgents.inboundNumber,
  // which could only remember ONE line per agent — an agent may hold several
  // of each. Retell owns the routing (a number's inbound_agents /
  // outbound_agents); these rows are our indexed copy, written by the same
  // attach/detach actions that change the provider and reconciled on every
  // clean roster read (retell.reconcileLines). Only lines bound to one of
  // THIS org's agents get a row: the account may be shared across orgs, and
  // an unbound number rings nobody.
  agentLines: defineTable({
    orgId: v.id("orgs"),
    number: v.string(),
    nickname: v.optional(v.string()),
    inboundAgentId: v.optional(v.string()),
    outboundAgentId: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    // The inbound webhook resolves the dialled number to its agent here.
    .index("by_number", ["number"]),

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

  // Resepta's provider-neutral definition of the information a phone agent
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
    // The CUSTOMER'S number, despite the name: caller for inbound, callee for
    // outbound (retell.recordCall picks by direction — Retell puts the agent's
    // own line in from_number on outbound legs). E.164 when readable, the raw
    // trunk string when not. Rows from before 18 Aug 2026 may hold either.
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
    // Call metering — stamped ONCE each, in recordCall, idempotent on the
    // field being unset so the call_ended/call_analyzed double-fire (and any
    // webhook retry) can never double-bill. billedMicroUsd is FROZEN at the
    // org's voiceRateMicroUsdPerMinute the moment the duration first lands:
    // the month's bill is a sum of immutable line items, and a later price
    // change never rewrites history. retellCostMicroUsd is what Retell
    // charged US (call_cost.combined_cost, arrives on call_analyzed) —
    // operator margin data, never shown to the org.
    billedMicroUsd: v.optional(v.number()),
    retellCostMicroUsd: v.optional(v.number()),
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
    // The newest inbound wamid we have told Meta was read — the blue ticks on
    // the CUSTOMER's phone.
    //
    // A high-water mark rather than a per-message flag, because that is what
    // Meta's call is: marking one message read marks every message before it
    // in the same conversation. So one field answers the only question the
    // send path asks — "is the newest thing they sent already ticked" — and it
    // answers it truthfully, which a per-row `readReceiptAt` stamped on the
    // newest row alone would not.
    lastReadReceiptWamid: v.optional(v.string()),
    // Last out-of-hours away-reply. One per session window, or a customer
    // sending four messages in a row collects four identical bot replies.
    lastAutoReplyAt: v.optional(v.number()),
    // Same throttle for the email lane's out-of-hours reply. Its own field
    // because the two channels reply independently: a WhatsApp away-reply at
    // 23:00 must not silence the answer to an email sent at 23:05.
    lastEmailAutoReplyAt: v.optional(v.number()),
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
    // Chat-agent takeover (docs/chat-agent.md §5). Stamped when a human sends
    // a manual reply in this conversation (wa.sendSession) or when the agent
    // escalates itself; while set, the agent is silent for this customer and
    // a human owns the thread. Cleared from the conversation header to hand
    // the thread back. Per CUSTOMER, not per org: taking over one
    // conversation must not silence the agent for every other customer.
    agentPausedAt: v.optional(v.number()),
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
    // Voice capture metadata, ON THE FIELD since 2026-08-25. It lived on
    // per-agent voiceAgentVariables rows, which meant the same field could
    // carry different instructions per agent — a flexibility nobody used and
    // a second registry everybody had to keep in step. The field IS the
    // capture config now; publish derives the per-agent Retell lists from it.
    //
    // voiceDescription is the instruction the extraction and analysis models
    // follow ("The caller's plate number, letters and digits"). Unset falls
    // back to a generic wording built from the label.
    voiceDescription: v.optional(v.string()),
    // Confirm-first: the agent may only store this after the caller
    // explicitly confirms it, rather than the moment it is heard.
    voiceConfirm: v.optional(v.boolean()),
    // "Agent sees" without "agent fills": the value rides in the ring-time
    // contact card so the agent can read it back, but the field is never
    // asked about and never written. A voice-source field is always seen —
    // this flag exists for staff-curated fields (VIP notes, a warning) the
    // agent should know and must not touch. Read at call time, so flipping
    // it needs no republish.
    voiceVisible: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  services: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    // Drag-reorder position (contactFields.order's pattern). Unset rows sort
    // after ordered ones, alphabetically, so nothing needs migrating.
    order: v.optional(v.number()),
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
    // Unset means this service is a GOOD, not time: a chocolate cake, a
    // delivery, a one-time purchase. A good is handed over at a moment but
    // occupies nobody — it never blocks the calendar, never collides with
    // anything, and any number of them can be due at the same minute. On the
    // appointment itself the sentinel is durationMinutes: 0, not unset,
    // because legacy appointment rows already use unset to mean "assume 30".
    durationMinutes: v.optional(v.number()),
    // Goods only: minimum notice in minutes ("order a day ahead" = 1440).
    // A wedding cake cannot be promised in twenty minutes. Enforced on the
    // customer-facing paths (booking page, voice, chat) and deliberately NOT
    // on the owner's own calendar — the baker may accept a rush job herself.
    leadMinutes: v.optional(v.number()),
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
  // multiply onboarding. Assignment stays Resepta-side until that is worth it;
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
          // 0 on a line whose service is a good — goods add no time.
          durationMinutes: v.number(),
          // How many of this line. Unset means 1, and time-bound services
          // always leave it unset — "two haircuts" is two visits, but "two
          // chocolate cakes" is one handover. price stays PER UNIT; the
          // line's worth is price × quantity, so a discount still works the
          // same way (edit the unit price).
          quantity: v.optional(v.number()),
        }),
      ),
    ),
    // How a goods-only order reaches its customer. Only ever set when every
    // line is a good (durationMinutes 0 on the row): a haircut is fulfilled
    // in the chair and needs no word for it. asap means startAt records the
    // moment the order was PLACED, not a promised minute — the customer said
    // "as soon as you can" and the flag carries that promise. address is a
    // snapshot on this order, not a field on the customer: it is where THIS
    // delivery goes, and the customer record deliberately has no address.
    fulfillment: v.optional(
      v.object({
        kind: v.union(v.literal("pickup"), v.literal("delivery")),
        asap: v.optional(v.boolean()),
        address: v.optional(v.string()),
      }),
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
    // How many times this appointment's TIME has changed, for the calendar
    // invites (lib/ics.ts). RFC 5546 makes a mail client compare SEQUENCE to
    // decide whether an invite with a UID it already holds is an update or a
    // stale duplicate — a reschedule that re-sends SEQUENCE:0 leaves Outlook
    // and Apple Mail showing the old time. Unset reads as 0; every patch that
    // moves startAt bumps it. CANCEL derives its own value (stored + 1) at
    // build time, per §3.8.7.4's "must outrank the REQUEST it retracts".
    icsSequence: v.optional(v.number()),
    // Intake: unset = typed into Resepta; "calcom" = arrived via the cal.com
    // webhook. externalUid is cal.com's booking uid — how RESCHEDULED and
    // CANCELLED events find the row they refer to.
    source: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("calcom"),
        v.literal("voice"),
        v.literal("booking_page"),
        // Booked by the WhatsApp chat agent (docs/chat-agent.md). Same
        // machinery as voice (retell.voiceBook with a source override) —
        // recorded honestly rather than wearing voice's label.
        v.literal("chat"),
      ),
    ),
    externalUid: v.optional(v.string()),
    // The self-serve capability: whoever holds this token may view, reschedule
    // and cancel THIS appointment from the public manage page (/appt/<token>).
    // A random UUID, minted when the appointment first earns a confirmation
    // (appointments.scheduleLifecycleMessages) or on booking-page creation —
    // so [manage_link] resolves for every booking the customer actually hears
    // about, whichever door it came in through.
    manageToken: v.optional(v.string()),
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
    .index("by_next_message", ["nextMessageAt"])
    // The public manage page's only key. The token is the capability.
    .index("by_manage_token", ["manageToken"]),

  // One WhatsApp Cloud API number per org (Meta Business number, not personal).
  waAccounts: defineTable({
    orgId: v.id("orgs"),
    phoneNumberId: v.string(),
    wabaId: v.optional(v.string()),
    // Unset = the platform token (lib/platformConfig resolveWaAccount): the
    // Tech Provider shape, where this row carries only routing facts and one
    // deployment-wide token authenticates every hosted number. Set only for
    // an org on its own Meta app; the row's own value always wins.
    accessToken: v.optional(v.string()),
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
      // A customer WROTE while the salon was closed — the only trigger whose
      // anchor is an inbound message, not an appointment. WhatsApp inbound
      // (webhook.ts) and email inbound (email.recordInbound) both fire it,
      // throttled to one reply per session window per channel. Replaces
      // orgs.autoReplyEnabled/autoReplyText, which are legacy once an org has
      // this row.
      v.literal("out_of_hours"),
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
      // The out-of-hours auto-reply — the one kind whose send is a REPLY to an
      // inbound message rather than an appointment-lifecycle send. Session
      // text on WhatsApp (the customer just wrote, so the window is open);
      // never a Meta template, so metaName/status never gate it.
      v.literal("out_of_hours"),
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
    // What each [token] prints for a customer whose value is blank, authored
    // beside the sentence it repairs (Nudge's variableDefaults). A token that
    // resolves to nothing leaves a hole — renderTokens tidies the punctuation
    // around it, so the message still reads, but "your [staff] will see you"
    // quietly loses its point. The fallback is EDITORIAL, which is why it
    // lives on the template and not on the field: the right word depends on
    // the sentence, and on this row's language.
    //
    // Only ever consulted for a token the renderer already knows and that
    // resolved to empty. An unrecognised token stays literal so a typo stays
    // visible instead of being quietly answered by a default.
    variableDefaults: v.optional(
      v.array(v.object({ key: v.string(), value: v.string() })),
    ),
    // ---- Cloud API lane only, plumbing below this line -----------------------
    // The name approved in Meta Business Manager. Optional: an org on the shop
    // phone or email alone never registers anything with Meta, and a required
    // metaName would force a fake value into every such row.
    metaName: v.optional(v.string()),
    language: v.string(),
    // Meta's approval state. Moves on its own now: submitting sets pending,
    // the message_template_status_update webhook and waTemplates.syncFromMeta
    // both write the outcome. Still editable by hand, because a template
    // registered in Business Manager before this existed has no other way to
    // be told about. Gates the Cloud send only — the same row's body still
    // emails and sends via Evolution while this says "draft".
    //
    // Four values, where Meta has nine. lib/metaTemplate.normalizeMetaStatus
    // does the mapping; `status === "approved"` gates every Cloud send, and a
    // fifth value here would have to be handled correctly at each read or a
    // template would quietly become unsendable.
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
    // ---- Submission to Meta (convex/waTemplates.ts) -------------------------
    //
    // Meta's own id for the registered template. The join key for the status
    // webhook, and the address the edit endpoint needs — an approved template
    // cannot be re-created, only edited on its own id.
    metaTemplateId: v.optional(v.string()),
    // Which WABA it is registered on. A number can move between WABAs, and a
    // template approved on the old one does not exist on the new: without this
    // the app would keep sending a name the current WABA has never heard of.
    metaWabaId: v.optional(v.string()),
    // The canonical token key behind each {{n}}, IN ORDER — the contract the
    // send path replays. Before this the app hardcoded {{1}}=first name,
    // {{2}}=business, {{3}}=date+time everywhere, so a salon could only ever
    // have the one sentence Meta had approved for them. With it, the words
    // they wrote are what gets submitted, and the parameters follow.
    //
    // Unset on every row registered by hand, which is exactly the old fixed
    // triple — so the send path falls back to it and nothing that works today
    // stops working.
    metaParams: v.optional(v.array(v.string())),
    // Meta's raw status word (IN_APPEAL, PENDING_DELETION, PAUSED…), kept
    // beside the normalised one because "rejected" is four different
    // situations and the owner needs to know which.
    metaStatusDetail: v.optional(v.string()),
    // The category Meta says the template LANDED as ("utility"/"marketing"),
    // from the submit response and the sync pull. Stored beside what we
    // intended (lib/metaTemplate categoryFor) because review recategorises
    // what it disagrees with, the landed category is what every send is
    // billed at, and Business Manager is the only other place to learn it.
    metaCategory: v.optional(v.string()),
    // Why review said no, verbatim. The single most useful thing on this row
    // when it is red, and there is nowhere else to read it without opening
    // Business Manager.
    metaRejectionReason: v.optional(v.string()),
    // When it last went for review. Distinct from _creationTime: a rejected
    // template is fixed and resubmitted, and "waiting since when" is what the
    // owner is actually asking.
    submittedAt: v.optional(v.number()),
    // The named-token body the last submission actually sent (the resolved
    // platform wording; the campaign wrapper for campaign rows). Exists so
    // "has the wording changed since this went to Meta" is answerable — the
    // fleet desk greys Submit on a row whose resubmission would push
    // IDENTICAL text, because that click costs an edit-cap slot and buys
    // nothing. Unset on rows submitted before this existed, which reads as
    // "unknown" and leaves the button live.
    submittedBody: v.optional(v.string()),
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
    // ── Unsaved-changes buffer (EDITOR ONLY; no send path may read this) ────
    //
    // Ported from Nudge's templates.draft. Reminder wording used to save
    // straight onto the live fields on blur, and reminders go out on a cron —
    // so a body caught mid-sentence was a body a customer could receive. The
    // live fields keep serving sends untouched until orgs.commitTemplateDraft
    // copies this blob onto them; discardTemplateDraft just clears it.
    //
    // Present ⇔ the "Unsaved" pill. Stored as v.any() on purpose: it mirrors
    // updateTemplate's arg set, but nothing reads it structurally — it is
    // validated against the real typed fields at commit time.
    draft: v.optional(v.any()),
    draftUpdatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    // The status webhook names a template by Meta's id, not by ours, so
    // resolving it must be an indexed point read rather than a scan of every
    // template on the deployment.
    .index("by_meta_template_id", ["metaTemplateId"]),

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
    // What KIND of file landed, as Meta declared it. Not derivable from the
    // storage id — a Convex storage URL is extensionless — and it is the
    // single fact that decides whether the bubble paints a picture, draws a
    // voice player, or offers a file to open. Rows predating attachments
    // other than images carry none, and those were all images.
    mediaContentType: v.optional(v.string()),
    // Document-only, and only when the sender's own file had a name. A voice
    // note has none (Meta sends none, because a recording is not a file
    // somebody named), which is exactly how the renderer tells a recorded
    // note from an audio file someone picked off their phone.
    mediaFileName: v.optional(v.string()),
    // The emoji reacted to THIS message, if any. Direction says who put it
    // there: a reaction on an outbound row is the customer's, one on an
    // inbound row is ours. One emoji, last one wins — WhatsApp allows a
    // person only one reaction per message, and replacing it sends a fresh
    // event. UNSET means no reaction, which is also what taking one back
    // writes (an empty emoji arrives, and patching to undefined deletes the
    // field).
    reactionEmoji: v.optional(v.string()),
    // The message this one QUOTED (WhatsApp's swipe-reply). Meta's webhook
    // carries context.id, the wamid of the quoted message; without these a
    // reply to a specific question rendered as a free-standing message and
    // the thread lost the thing that made it an answer. The body is a
    // SNAPSHOT taken at arrival, not a live join: what the customer saw
    // themselves quoting is a fact about that moment, and a feed render must
    // not pay a lookup per bubble for it. replyToWamid is kept beside it for
    // a future scroll-to-original.
    replyToWamid: v.optional(v.string()),
    replyToBody: v.optional(v.string()),
    replyToDirection: v.optional(v.union(v.literal("in"), v.literal("out"))),
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
    // When this actually happened, for a row that RECORDS history rather than
    // making it (agentTools.logActivity). _creationTime is the moment of the
    // import, so a year of WhatsApp brought in from a salon's old phone would
    // otherwise stack on the afternoon it was uploaded, in upload order. Unset
    // on everything the product itself sends, which is the overwhelming
    // majority — those rows happened when they were created, and the feed
    // falls back to _creationTime for them. Deliberately not `sentAt`: that
    // one means "the provider accepted the send" and is read by the open-pixel
    // prefetch guard, which has nothing to do with a message from 2024.
    occurredAt: v.optional(v.number()),
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
    // The messaging meter's line items (lib/waPricing.ts), stamped where the
    // send is confirmed (applySendResult) and only on Cloud TEMPLATE sends —
    // the one kind of message Meta bills. Cost is Meta's per-message rate for
    // the recipient's country and the template's landed category; billed is
    // that plus the operator's markup, what the org actually pays. Frozen at
    // send time like calls.billedMicroUsd: a rate-card edit never rewrites a
    // sent message. Cost is margin data and never shown to the org, the
    // calls.retellCostMicroUsd rule.
    waCostMicroUsd: v.optional(v.number()),
    billedMicroUsd: v.optional(v.number()),
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
    // Status ACROSS orgs, newest first — Convex appends _creationTime to every
    // index, so this is really (status, _creationTime). Exists for the fleet
    // page, which needs "what failed lately, everywhere". Reading that per org
    // meant 200 rows × every org in a single query, which is how that page
    // acquired a hard ceiling around 25-45 businesses. One bounded fleet-wide
    // read costs what is BROKEN rather than what exists, and failures are rare.
    .index("by_status_creation", ["status"])
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

  // A business asking the platform to provision it a phone number, with the
  // company registration document regulators require (mandatory in Türkiye,
  // same flow for DACH and the UK). One live request per org: submitting
  // again replaces a pending or denied row, and the promise on the tin is
  // "a number within 24 hours of the document arriving".
  //
  // The decision is the OPERATOR's signal to go buy the number at the
  // provider — the app itself never purchases anything (retellAgent doctrine:
  // it may assign an already-provisioned line, never buy one). status/note
  // are salon-visible; decidedBy never is.
  // The operator's runtime overrides of CLOUD_TEMPLATE_TEXTS, one row per
  // (kind, language) that has been edited away from the code default. The
  // registered Cloud wording resolves override-first (waTemplates
  // resolvePlatformBody); no row means the code constant stands, and saving
  // a body identical to the default deletes the row rather than storing a
  // copy that would go stale when the constant moves.
  //
  // Platform-wide on purpose, no orgId: identical wording across the fleet is
  // what lets one WABA's approval serve every hosted number. A per-org
  // override would quietly fork that and put approval back to per-client.
  platformTemplateTexts: defineTable({
    kind: v.string(),
    language: v.string(),
    body: v.string(),
    updatedAt: v.number(),
  }).index("by_kind_language", ["kind", "language"]),

  // The email/session sibling of platformTemplateTexts: the operator's
  // override of DEFAULT_TEMPLATE_TEXTS for the locked kinds, one row per
  // (kind, language), absent while the code default stands. Unlike the Cloud
  // text, which waits at Meta for review, saving one of these propagates
  // straight onto every org's template rows — no approval gates an email.
  platformRichTexts: defineTable({
    kind: v.string(),
    language: v.string(),
    subject: v.string(),
    body: v.string(),
    // The authored HTML when the operator used the WYSIWYG — what the email
    // actually sends (the send path prefers bodyHtml over body). body stays
    // the plain projection the session lane sends, derived on save.
    bodyHtml: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_kind_language", ["kind", "language"]),

  numberRequests: defineTable({
    orgId: v.id("orgs"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
    ),
    // The operator's word to the business — a denial without a reason is a
    // dead end, and an approval may carry the assigned number's ETA.
    note: v.optional(v.string()),
    // The operator filed this document, not the business. Set when a client
    // sends the registration some other way (email, a sales visit) and the
    // operator puts it in for them, which is most of them: the self-serve
    // upload is the tidy path, not the common one. Unset reads as "the
    // business uploaded it", so every row written before this keeps its
    // meaning. Same line, same name, as activityLog.viaOperator.
    viaOperator: v.optional(v.boolean()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("users")),
  })
    .index("by_org", ["orgId"])
    .index("by_status", ["status"]),

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
    // Minted by the platform operator while working inside this business, so
    // there is no membership row behind it and never will be. verify() accepts
    // it on the allowlist instead — the same authority that let them in, and a
    // stronger one than membership: it evaporates the moment the address comes
    // off PLATFORM_ADMIN_EMAILS.
    //
    // Stamped at mint rather than derived at call time, because acting-as is
    // SESSION state and this key outlives the session. Without the stamp,
    // verify could not tell an operator's key from a member's whose membership
    // had just been revoked, and would have to guess which one to keep alive.
    //
    // It also carries the feed's manners: writes through this connection are
    // "Autotakt did this", never the operator's own name (see lib/activity).
    viaOperator: v.optional(v.boolean()),
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

  // What the business knows, in the owner's own words — policies, parking,
  // "do you do balayage" answers. Prose ONLY: services, prices, hours and
  // staff live in their structured tables and the chat agent reads those
  // directly, so a knowledge block can never contradict the calendar. One
  // block per topic keeps the editor scannable and lets the agent's context
  // name its sources.
  knowledge: defineTable({
    orgId: v.id("orgs"),
    // Short topic label ("Otopark", "İptal politikası"). Shown in the editor
    // list and used as the section header in the agent's context.
    title: v.string(),
    body: v.string(),
    order: v.number(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_org", ["orgId"]),

  // The chat agent's flight recorder (docs/chat-agent.md §5) and the raw LLM
  // usage ledger (§6) in one row: every turn — sent, shadowed, skipped or
  // failed — with what the model was shown, what tools it called, what it
  // cost and what came out. This is the replay surface for "why did it say
  // that" and the audit trail no prompt can fake after the fact.
  //
  // Retention: rows carry customer text, so they are org data — pruned from
  // platform admin and deleted with the org, never kept aside.
  chatAgentTurns: defineTable({
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    // The inbound message that triggered this turn, when one did.
    inboundMessageId: v.optional(v.id("messages")),
    // The outbound row the reply landed as. Unset for shadow/skipped/error.
    sentMessageId: v.optional(v.id("messages")),
    status: v.union(
      // Reply generated and sent.
      v.literal("sent"),
      // Reply generated, deliberately not sent (org in shadow mode).
      v.literal("shadow"),
      // Turn refused before the model ran; `error` names the guard that
      // stopped it (rate-limited, budget-exhausted, llm-not-configured…).
      v.literal("skipped"),
      // The model or a tool failed; `error` carries the reason.
      v.literal("error"),
    ),
    // The reply text as generated (shadow keeps it too — that is the point).
    reply: v.optional(v.string()),
    // JSON array of {name, args, result} — every tool round in order. A
    // string rather than v.any() so the row stays greppable and the shape is
    // documented here instead of drifting.
    toolCalls: v.optional(v.string()),
    model: v.string(),
    templateVersion: v.number(),
    // A turn is the product of TWO documents once the chat lane composes over
    // the voice Talimat: the chat adapter (templateVersion above) and the
    // salon's published prompt. This is the provider version of that prompt
    // (retellAgents.promptVersion at compose time); absent means the turn ran
    // on the code template — no mirror existed, or the org has no voice agent.
    voicePromptVersion: v.optional(v.number()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    // What this turn cost in micro-USD, at the price table version current
    // when it ran. Snapshotted so a later price change never rewrites history.
    costMicroUsd: v.number(),
    // What the ORG pays for this turn: its per-reply rate
    // (orgs.chatRateMicroUsdPerTurn ?? platform default), frozen at stamp
    // time. Only SENT turns carry one — shadow, skipped and error turns cost
    // the platform tokens but sell the org nothing. costMicroUsd above stays
    // the margin side and is never the org's business.
    billedMicroUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_org_at", ["orgId", "at"])
    .index("by_customer_at", ["customerId", "at"]),

  // Money INTO a prepaid org's wallet (orgs.walletBalanceMicroUsd — money
  // out is the meter's own stamp on each call, so it needs no rows here).
  // One row per credit: "stripe" rows are written by the checkout webhook,
  // idempotent on stripeSessionId, because Stripe retries webhooks and a
  // paid session must credit exactly once; "manual" rows are operator
  // corrections and goodwill from /admin and may be negative. The balance
  // on orgs is bumped in the same mutation that inserts the row, so the
  // wallet and its trail cannot disagree.
  walletTopups: defineTable({
    orgId: v.id("orgs"),
    amountMicroUsd: v.number(),
    // "trial" is the welcome credit stamped at founding sign-in when the
    // platform's defaultBillingMode is prepaid (lib/platformConfig).
    source: v.union(
      v.literal("stripe"),
      v.literal("manual"),
      v.literal("trial"),
    ),
    stripeSessionId: v.optional(v.string()),
    at: v.number(),
    // The operator who keyed a manual row; stripe rows carry none.
    by: v.optional(v.id("users")),
  })
    .index("by_org_at", ["orgId", "at"])
    .index("by_stripe_session", ["stripeSessionId"]),

  // Per-org, per-month cost rollup — the admin panel's "what does this org
  // cost" read, one document instead of a scan over turns. Incremented in the
  // same mutation that writes the turn row, so the two cannot drift. Keyed
  // per org per month deliberately: counters shared wider than one org would
  // serialize every org's agent traffic through one document's write lock.
  //
  // The SHAPE is the org cost ledger, not an LLM artifact: WhatsApp fees can
  // join later as their own counters on the same row.
  usageMonthly: defineTable({
    orgId: v.id("orgs"),
    // "2026-08" in the ORG's timezone, from the turn's own clock.
    month: v.string(),
    llmTurns: v.number(),
    llmInputTokens: v.number(),
    llmOutputTokens: v.number(),
    llmCostMicroUsd: v.number(),
    // The voice lane's counters on the same ledger row (the shape doing what
    // its comment promised). Bumped in retell.recordCall, in the same
    // mutation that stamps the call row, keyed to the month of the call's
    // startedAt: a call analysed after midnight bills into the month it was
    // made. Optional because rows written before the meter existed carry
    // none. calls/seconds/billed move together when a duration first lands;
    // cost lands separately when call_analyzed brings Retell's price.
    voiceCalls: v.optional(v.number()),
    voiceSeconds: v.optional(v.number()),
    voiceBilledMicroUsd: v.optional(v.number()),
    voiceCostMicroUsd: v.optional(v.number()),
    // Budget-alert stamps: set when the month's billed spend crossed 80% /
    // 100% of orgs.voiceMonthlyBudgetMicroUsd, so each alert fires once per
    // threshold per month. On the month row rather than the org so a new
    // month re-arms both by existing.
    voiceBudgetAlert80At: v.optional(v.number()),
    voiceBudgetAlert100At: v.optional(v.number()),
    // Sends that a provider actually took, by channel, on the same ledger row.
    // These answer "who is using this" on the fleet table, and they live here
    // rather than being counted off `messages` for the reason that table's own
    // comments give at length: a per-org scan of messages is proportional to
    // history, so the fleet page stops working somewhere around thirty
    // businesses. A counter is proportional to nothing.
    //
    // Fed from ONE place (messages.applySendResult, the single site every send
    // path already reports to) and only on the attempt that landed, so retries
    // cannot inflate them. A staff reply typed on the salon's own phone and
    // echoed back by Evolution is deliberately NOT counted: nothing was sent
    // from this product, and the question is who uses the product.
    //
    // Optional because rows written before the meter existed carry none.
    // migrations.backfillSendCounts fills those in.
    emailSent: v.optional(v.number()),
    waSent: v.optional(v.number()),
    // The priced side of the two AI/messaging lanes above, in micro-USD —
    // what the org PAYS, next to what the platform spent. llmBilled is turns
    // × the org's per-reply rate (chatAgent.recordTurn, sent turns only);
    // waBilled/waCost are Cloud template sends at Meta's per-country card
    // plus markup (messages.applySendResult via lib/waPricing). All optional
    // because months predating the price book carry none, which reads as 0.
    llmBilledMicroUsd: v.optional(v.number()),
    waBilledMicroUsd: v.optional(v.number()),
    waCostMicroUsd: v.optional(v.number()),
    // How many units the billed amounts above bought — SENT AI replies and
    // priced template sends. Kept apart from llmTurns/waSent deliberately:
    // those count everything (shadow turns, free session replies), and a
    // bill whose count × rate does not equal its amount is a support ticket.
    llmBilledTurns: v.optional(v.number()),
    waBilledCount: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_org_month", ["orgId", "month"]),

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
    //
    // OPTIONAL since 2026-08-20, and unset means the CUSTOMER wrote it — the
    // booking page lets them leave one, and a stranger on a public page is not
    // a row in `users`. Nothing else may leave it blank: an unattributed staff
    // note on a shared record is the thing the byline exists to prevent, and
    // the feed resolves an author-less note to the customer's own name rather
    // than to "System".
    authorId: v.optional(v.id("users")),
    // Set on the first edit. Unset means the note still says what it said when
    // it was written, which is the whole reason anyone trusts a note.
    editedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_customer", ["customerId"]),
});
