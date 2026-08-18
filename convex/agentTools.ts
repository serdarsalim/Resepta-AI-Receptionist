// The data layer behind the MCP surface. Every function here takes orgId and
// the acting person EXPLICITLY, because the MCP door has no session: the
// workspace and the user come off the key (see mcpKeys.verify, which re-checks
// membership), not from requireOrg.
//
// That is the one structural difference from the rest of the backend, and it is
// why these live apart from customers.ts / appointments.ts rather than being
// extra args on the mutations already there. Mixing "trust the cookie" and
// "trust the key" inside one function is how a scoping bug gets written.
//
// Two rules, same as the Nudge side:
//   1. before/after capture ONLY the keys a tool wrote. A whole-document
//      snapshot means an undo silently reverts a stylist's edit made in between.
//   2. Undo goes forward through the same write path, never a raw patch.

import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { recordActivity } from "./lib/activity";
import { connectionField } from "./lib/connections";
import { RESERVED_CONTACT_KEYS, keyFromLabel, normaliseKey, uniqueKey } from "./lib/keys";
import { dialCodeForTimezone, normalisePhone } from "./lib/phone";
import { serviceKey } from "./services";
import { spokenDuration, spokenPrice } from "./lib/speech";

const scope = {
  orgId: v.id("orgs"),
  userId: v.id("users"),
  connectionId: v.id("mcpConnections"),
} as const;

// Every read and write goes through this. Fetching by id and THEN comparing the
// org is the whole guard: without it a customer id from another salon would
// resolve happily, and the tool would answer questions about a business the
// caller has nothing to do with.
async function customerInOrg(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  customerId: string,
): Promise<Doc<"customers">> {
  const row = await ctx.db.get(customerId as Id<"customers">).catch(() => null);
  if (!row || row.orgId !== orgId) throw new Error("No customer with that id.");
  return row;
}

function fullName(c: Doc<"customers">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.phone;
}

async function journal(
  ctx: MutationCtx,
  a: {
    orgId: Id<"orgs">;
    connectionId: Id<"mcpConnections">;
    userId: Id<"users">;
    tool: string;
    args: unknown;
    targetTable: string;
    targetId: string;
    before: unknown;
    after: unknown;
    reversible: boolean;
  },
): Promise<Id<"agentActions">> {
  return await ctx.db.insert("agentActions", {
    orgId: a.orgId,
    connectionId: a.connectionId,
    userId: a.userId,
    tool: a.tool,
    args: JSON.stringify(a.args),
    targetTable: a.targetTable,
    targetId: a.targetId,
    before: JSON.stringify(a.before),
    after: JSON.stringify(a.after),
    at: Date.now(),
    reversible: a.reversible,
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const searchCustomers = internalQuery({
  args: { orgId: v.id("orgs"), query: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, query, limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const needle = query?.trim().toLowerCase();
    // Diacritics fold, because a salon's book is full of names a phone keyboard
    // will not reproduce exactly — searching "gul" has to find "Gül".
    const fold = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const matched = needle
      ? rows.filter((c) => {
          const hay = fold(`${c.firstName} ${c.lastName ?? ""} ${c.phone} ${c.email ?? ""}`);
          return hay.includes(fold(needle));
        })
      : rows;
    return {
      count: Math.min(matched.length, take),
      totalMatches: matched.length,
      customers: matched.slice(0, take).map((c) => ({
        id: c._id,
        name: fullName(c),
        phone: c.phone,
        email: c.email ?? null,
        muted: !!c.mutedAt,
      })),
    };
  },
});

export const getCustomer = internalQuery({
  args: { orgId: v.id("orgs"), customerId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, customerId }) => {
    const c = await ctx.db.get(customerId as Id<"customers">).catch(() => null);
    if (!c || c.orgId !== orgId) throw new Error("No customer with that id.");
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_customer", (q) => q.eq("customerId", c._id))
      .order("desc")
      .take(10);
    const appts = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", c._id))
      .order("desc")
      .take(10);
    // The org's, not c.language. This is the wording the agent SAYS, and the
    // agent speaks the language it was built in; the customer's own language
    // steers written follow-ups, which is a different decision made elsewhere.
    const orgLanguage = (await ctx.db.get(orgId))?.language ?? null;
    return {
      id: c._id,
      name: fullName(c),
      firstName: c.firstName,
      lastName: c.lastName ?? null,
      phone: c.phone,
      email: c.email ?? null,
      language: c.language ?? null,
      muted: !!c.mutedAt,
      custom: c.custom ?? {},
      notes: notes.map((n) => ({
        id: n._id,
        body: n.body,
        at: new Date(n._creationTime).toISOString(),
        edited: !!n.editedAt,
      })),
      appointments: appts.map((a) => ({
        id: a._id,
        startAt: new Date(a.startAt).toISOString(),
        status: a.status,
        durationMinutes: a.durationMinutes ?? null,
        durationSpoken: spokenDuration(a.durationMinutes ?? null, orgLanguage),
        services: (a.items ?? []).map((i) => i.name),
      })),
    };
  },
});

export const schedule = internalQuery({
  args: { orgId: v.id("orgs"), days: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, days }) => {
    const span = Math.min(Math.max(days ?? 7, 1), 60);
    const now = Date.now();
    const until = now + span * 86_400_000;
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", now).lte("startAt", until),
      )
      .collect();
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const names = new Map(
      (await Promise.all(customerIds.map((id) => ctx.db.get(id)))).flatMap((c) =>
        c ? [[c._id, fullName(c)] as const] : [],
      ),
    );
    // Counted here rather than handed over as rows to tally. Same reason as the
    // Nudge reports: a model asked to count a list it can only partly see will
    // produce a number, and the number will be wrong.
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
      from: new Date(now).toISOString(),
      days: span,
      total: rows.length,
      byStatus,
      appointments: rows
        .sort((a, b) => a.startAt - b.startAt)
        .slice(0, 100)
        .map((a) => ({
          id: a._id,
          customer: names.get(a.customerId) ?? "(deleted)",
          customerId: a.customerId,
          startAt: new Date(a.startAt).toISOString(),
          status: a.status,
          services: (a.items ?? []).map((i) => i.name),
        })),
      ...(rows.length > 100
        ? { truncated: `Showing the first 100 of ${rows.length}; narrow the window.` }
        : {}),
    };
  },
});

// ── Writes ───────────────────────────────────────────────────────────────────

export const addNote = internalMutation({
  args: { ...scope, customerId: v.string(), body: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, customerId, body }) => {
    const text = body.trim();
    if (!text) throw new Error("The note is empty.");
    const customer = await customerInOrg(ctx, orgId, customerId);
    const noteId = await ctx.db.insert("notes", {
      orgId,
      customerId: customer._id,
      body: text,
      authorId: userId,
    });
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "add_note",
      args: { customerId, body: text },
      targetTable: "notes",
      targetId: noteId,
      // The note did not exist. That is a real prior state, not a missing one.
      before: null,
      after: { body: text },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "note_added",
      customerId: customer._id,
      detail: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { noteId, actionId, customerName: fullName(customer) };
  },
});

const EDITABLE = ["firstName", "lastName", "phone", "email", "language"] as const;
type Editable = (typeof EDITABLE)[number];

export const updateCustomer = internalMutation({
  args: { ...scope, customerId: v.string(), fields: v.record(v.string(), v.string()) },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, customerId, fields }) => {
    const customer = await customerInOrg(ctx, orgId, customerId);
    const before: Record<string, string | null> = {};
    const after: Record<string, string> = {};
    for (const [rawKey, rawVal] of Object.entries(fields)) {
      const key = rawKey.trim() as Editable;
      if (!EDITABLE.includes(key)) {
        throw new Error(
          `"${rawKey}" is not editable here. Editable: ${EDITABLE.join(", ")}.`,
        );
      }
      const raw = rawVal.trim();
      // A customer with no phone cannot be messaged, and messaging is the whole
      // product. Refusing beats writing a row the reminder job will skip
      // forever without telling anyone.
      if (key === "phone" && !raw) throw new Error("A customer must keep a phone number.");
      if (key === "firstName" && !raw) throw new Error("A customer must keep a first name.");

      // The in-app form (customers.update) normalises the number and refuses one
      // another contact in this org already holds. This path did neither, and
      // by_org_phone is read with .unique() — so two rows sharing one number
      // made inbound WhatsApp, the voice agent's caller lookup, runtimeCallContext,
      // the public booking page and the request form throw for that number
      // permanently, with no screen anywhere to repair it. Writing a non-E.164
      // string was the quieter half of the same bug: nothing matches it again,
      // so that customer silently stops receiving anything.
      let value = raw;
      if (key === "phone") {
        // The forgiving parse, not assertE164, and WITH the org's dial code —
        // the same call cal.com's intake makes, for the same reason it gives:
        // "nobody types +90 in a booking form", and nobody types it when
        // telling their assistant a customer's number either. Without a dial
        // code a bare "5321234567" parses as an international number that lost
        // its plus, which for a Turkish local number is +53 — Cuba — and the
        // salon would never learn why messages to that contact stopped
        // arriving. (The voice lane deliberately passes none: a caller ID is
        // already international and a number spelled out mid-call is
        // transcribed speech. This is neither.)
        const org = await ctx.db.get(orgId);
        const normalised = normalisePhone(
          raw,
          org ? dialCodeForTimezone(org.timezone) : undefined,
        );
        if (!normalised) {
          throw new Error(
            `"${raw}" is not a phone number we can reach. Give it in full international form, e.g. +905321234567.`,
          );
        }
        value = normalised;
      }
      const prior = (customer[key] ?? "") as string;
      if (prior === value) continue;
      if (key === "phone") {
        const dupe = await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", value))
          .unique();
        if (dupe) {
          throw new Error(
            `Another contact in this business already has ${value}. Two contacts cannot share a number — every lookup by phone would stop working for both.`,
          );
        }
      }
      before[key] = prior || null;
      after[key] = value;
    }
    const changed = Object.keys(after);
    if (changed.length === 0) {
      throw new Error("Nothing to change — those are the values it already has.");
    }
    await ctx.db.patch(customer._id, after as Partial<Doc<"customers">>);
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "update_customer",
      args: { customerId, fields: after },
      targetTable: "customers",
      targetId: customer._id,
      before,
      after,
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "customer_updated",
      customerId: customer._id,
      detail: `Updated ${changed.join(", ")}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId, customerName: fullName(customer), changed };
  },
});

// ── Bringing history in ──────────────────────────────────────────────────────
//
// The tools above act on a salon that is already running. These two put an
// existing business's records INTO it: the customer list they arrive with, and
// the calls and messages that happened before Resepta existed or that happen
// somewhere it cannot see. Without them a salon's first day is an empty book
// and the connector's answer to "here are my 300 customers" is to open the app
// and type.

// Nothing here is a send. The distinction is the STATUS and the absence of the
// three scheduling stamps, not a flag somebody has to remember: `queued` +
// `scheduledFor` is what wa.ts picks up, `nextAttemptAt` is what delivery.ts
// retries, `sendingAt` is what the stuck-send reaper reads. A row written
// `sent` or `received` with none of them set is unreachable from every
// dispatch path in the codebase. There is no route from a logged row to a
// provider, and that is structural rather than promised.

export const createCustomers = internalMutation({
  args: {
    ...scope,
    customers: v.array(
      v.object({
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        phone: v.string(),
        email: v.optional(v.string()),
        language: v.optional(v.string()),
        notes: v.optional(v.string()),
        consentAt: v.optional(v.number()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, customers }) => {
    if (customers.length === 0) throw new Error("customers is empty");
    // A ceiling rather than a stream, because a Convex mutation has a write
    // cap and each row costs a dedup read plus an insert plus an activity row.
    // Chunking is the caller's job and the message says so, rather than the
    // mutation dying halfway with some of the list written.
    if (customers.length > 100) {
      throw new Error(
        `max 100 customers per call (got ${customers.length}) — send them in batches of 100`,
      );
    }

    const created: { id: string; name: string }[] = [];
    const updated: { id: string; name: string }[] = [];
    const skippedBadPhone: { name: string; phone: string; why: string }[] = [];

    // Read once, outside the loop: every row parses against the same dial code
    // and the org row does not change underneath a hundred inserts.
    const org = await ctx.db.get(orgId);
    const dialCode = org ? dialCodeForTimezone(org.timezone) : undefined;

    for (const row of customers) {
      const firstName = row.firstName?.trim() || "";
      const label =
        [firstName, row.lastName?.trim()].filter(Boolean).join(" ").trim() ||
        row.email?.trim() ||
        row.phone?.trim() ||
        "(no name)";

      // The phone IS the identity here — customers.phone is required, indexed
      // by_org_phone, and every WhatsApp path keys on it. Same forgiving parse
      // update_customer makes on this same door, and for the reason given
      // there: nobody types +90 when handing their assistant a customer list,
      // and a bare local number without a dial code would parse as +53, Cuba.
      // A row that still will not resolve is REPORTED, never dropped — a
      // seeding tool that quietly loses people is the failure this exists to
      // fix, and one bad cell in a spreadsheet must not lose the other 99.
      const phone = normalisePhone(row.phone, dialCode);
      if (!phone) {
        skippedBadPhone.push({
          name: label,
          phone: row.phone,
          why: "not a phone number we can reach — give it in full international form, e.g. +905321234567",
        });
        continue;
      }

      const existing = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
        .unique();

      if (existing) {
        // Dedup patches identity only, and only where this call actually says
        // something. Re-running the same list is safe, and a blank column in a
        // spreadsheet does not erase the email a stylist typed in by hand.
        const patch: Record<string, string> = {};
        if (firstName && firstName !== existing.firstName) patch.firstName = firstName;
        const lastName = row.lastName?.trim();
        if (lastName && lastName !== existing.lastName) patch.lastName = lastName;
        const email = row.email?.trim();
        if (email && email !== existing.email) patch.email = email;
        const language = row.language?.trim();
        if (language && language !== existing.language) patch.language = language;
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, patch as Partial<Doc<"customers">>);
        }
        updated.push({ id: existing._id, name: fullName({ ...existing, ...patch }) });
        continue;
      }

      const customerId = await ctx.db.insert("customers", {
        orgId,
        // customers.firstName is required. Falling back to the phone keeps the
        // row addressable in a list rather than rendering as a blank line.
        firstName: firstName || phone,
        lastName: row.lastName?.trim() || undefined,
        phone,
        email: row.email?.trim() || undefined,
        language: row.language?.trim() || undefined,
        notes: row.notes?.trim() || undefined,
        // KVKK consent is a legal fact about something the CUSTOMER did, and
        // sends are blocked until it is stamped. Never inferred from the act of
        // importing: the salon has to say when each person agreed, or the row
        // arrives without consent and the send path keeps refusing — which is
        // the correct failure.
        consentAt: row.consentAt,
      });
      // Composed here rather than read back: a hundred inserts would otherwise
      // cost a hundred extra reads to learn what we just wrote.
      created.push({
        id: customerId,
        name: [firstName, row.lastName?.trim()].filter(Boolean).join(" ").trim() || phone,
      });
    }

    if (created.length === 0 && updated.length === 0) {
      return { created, updated, skippedBadPhone, actionId: null };
    }

    // One journal row for the call, not one per customer: the undoable unit is
    // the import, and a 100-row seed leaving 100 entries buries every other
    // action in recent_actions. The created ids live in `after` — targetId
    // holds the first so the feed has a row to point at.
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_customers",
      args: { count: customers.length },
      targetTable: "customers",
      targetId: created[0]?.id ?? updated[0]?.id ?? "",
      before: null,
      // Only the CREATED ids are the inverse. The updated ones existed before
      // this call, and deleting them on undo would destroy the salon's own row.
      after: { createdIds: created.map((c) => c.id) },
      reversible: true,
    });

    // One feed line per created customer, unlike the Nudge side which writes
    // none. The reason it skipped does not apply here: `customer_created` is a
    // real kind in this union and hangs on exactly one customer, so the row is
    // what makes an imported person's timeline able to answer "how did they get
    // here". source is "staff" in spirit — a member of the salon is importing
    // their own list — so arrivedAt stays unset and 100 imported customers do
    // not light 100 attention dots for a human to clear by hand.
    for (const c of created) {
      await recordActivity(ctx, {
        orgId,
        kind: "customer_created",
        customerId: c.id as Id<"customers">,
        agent: { actorId: userId, connectionId, agentActionId: actionId },
      });
    }

    return { created, updated, skippedBadPhone, actionId };
  },
});

export const logActivity = internalMutation({
  args: {
    ...scope,
    entries: v.array(
      v.object({
        customerId: v.string(),
        channel: v.union(v.literal("call"), v.literal("whatsapp"), v.literal("email")),
        direction: v.union(v.literal("inbound"), v.literal("outbound")),
        at: v.number(),
        body: v.optional(v.string()),
        subject: v.optional(v.string()),
        from: v.optional(v.string()),
        durationSeconds: v.optional(v.number()),
        outcome: v.optional(v.string()),
        transcript: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, entries }) => {
    if (entries.length === 0) throw new Error("entries is empty");
    if (entries.length > 200) {
      throw new Error(
        `max 200 entries per call (got ${entries.length}) — send them in batches of 200`,
      );
    }

    const now = Date.now();
    // Resolved once per customer rather than per entry: a thread of forty
    // messages with one person is the normal shape, and customerInOrg is a
    // read apiece. The org check still happens for every id that appears.
    const seen = new Map<string, Doc<"customers">>();
    const calls: Id<"calls">[] = [];
    const messages: Id<"messages">[] = [];
    const skipped: { customerId: string; why: string }[] = [];

    for (const e of entries) {
      // A future timestamp is the one that matters. `at` in the future on a
      // logged row would put history in front of the appointments a salon is
      // reading the timeline for, and it is nearly always a seconds/millis
      // mix-up — worth naming rather than storing.
      if (!Number.isFinite(e.at) || e.at <= 0 || e.at > now) {
        skipped.push({
          customerId: e.customerId,
          why: `"at" must be epoch MILLISECONDS in the past (got ${e.at})`,
        });
        continue;
      }
      let customer = seen.get(e.customerId);
      if (!customer) {
        customer = await customerInOrg(ctx, orgId, e.customerId);
        seen.set(e.customerId, customer);
      }

      if (e.channel === "call") {
        const id = await ctx.db.insert("calls", {
          orgId,
          customerId: customer._id,
          direction: e.direction,
          // The CUSTOMER's number either way, which is what this column holds
          // despite its name (see the schema comment).
          fromNumber: customer.phone,
          startedAt: e.at,
          durationSec: e.durationSeconds,
          outcome: e.outcome,
          summary: e.body?.trim() || undefined,
          transcript: e.transcript?.trim() || undefined,
        });
        calls.push(id);
        continue;
      }

      // status is the safety property, not a flag: outbound lands `sent` and
      // inbound lands `received`, both terminal. Neither is `queued`, and none
      // of scheduledFor / nextAttemptAt / sendingAt is written — so no dispatch
      // path in the codebase can see this row.
      const id = await ctx.db.insert("messages", {
        orgId,
        customerId: customer._id,
        direction: e.direction === "outbound" ? "out" : "in",
        // The PREFIX is what says which lane carried this — channelOfMessage
        // reads `email_*` as email, `form_*` as the request form, and anything
        // else as WhatsApp. A logged email under a bare kind would render in
        // the WhatsApp column of the conversation it belongs to, so the prefix
        // is not decoration.
        kind:
          e.channel === "email"
            ? e.direction === "outbound"
              ? "email_logged"
              : "email_reply"
            : e.direction === "outbound"
              ? "logged"
              : "reply",
        body: e.body?.trim() || undefined,
        status: e.direction === "outbound" ? "sent" : "received",
        // What puts the row where it belongs in the timeline. Without it the
        // feed reads _creationTime and a year of imported history stacks on
        // the afternoon it was uploaded.
        occurredAt: e.at,
        ...(e.channel === "email"
          ? {
              emailSubject: e.subject?.trim() || undefined,
              emailFrom: e.from?.trim() || customer.email || undefined,
            }
          : {}),
      });
      messages.push(id);
    }

    if (calls.length === 0 && messages.length === 0) {
      return { calls: 0, messages: 0, skipped, actionId: null };
    }

    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "log_activity",
      args: { count: entries.length },
      targetTable: calls.length > 0 ? "calls" : "messages",
      targetId: calls[0] ?? messages[0] ?? "",
      before: null,
      after: { callIds: calls, messageIds: messages },
      reversible: true,
    });

    // No activityLog row. That feed records what somebody DID to the business —
    // and logging history is not the history happening. The entries show up
    // where they belong, on the customer's own timeline, and the journal plus
    // recent_actions is the audit surface for the import itself.
    return { calls: calls.length, messages: messages.length, skipped, actionId };
  },
});

// ── Configuration ────────────────────────────────────────────────────────────
// Setting the business up, rather than running it day to day. These exist
// because a connector that can read a salon's book but cannot give it a
// service list or a phone agent is a reporting tool, not a control surface —
// and the setup is exactly the part somebody wants done FOR them.
//
// The permission split mirrors the app exactly: services.create takes any
// member, contactFields.create and phone-agent provisioning take an owner.
// It is re-derived from `memberships` here rather than read off the key,
// because the connector must not become a way around the app's own rules.

async function assertOwner(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
  what: string,
): Promise<void> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
    .unique();
  if (!membership || membership.role !== "owner") {
    throw new Error(`Only an owner can ${what}.`);
  }
}

export const listServices = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    const rows = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const language = org?.language ?? null;
    const currency = org?.currency ?? null;
    return {
      // Prices are minor units OF THIS. A bare integer is not an amount
      // anybody can read back to a caller.
      currency: currency,
      // Said, not shown. The numeric fields stay because booking and
      // comparison need them, but a voice agent given only those writes the
      // price list it has read a million of — "90 dk için ₺3.000" — and the
      // caller hears the letters d and k. These two are the words for the
      // same values, and the tool description tells the agent to use them.
      services: rows.map((row) => ({
        id: row._id,
        name: row.name,
        key: serviceKey(row),
        durationMinutes: row.durationMinutes ?? null,
        durationSpoken: spokenDuration(row.durationMinutes ?? 0, language),
        leadMinutes: row.leadMinutes ?? null,
        active: row.active,
        price: row.price ?? null,
        priceSpoken: spokenPrice(row.price ?? null, currency, language),
      })),
    };
  },
});

export const listContactFields = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .sort((a, b) => a.order - b.order)
      .map((row) => ({
        id: row._id,
        key: row.key,
        label: row.label,
        type: row.type,
        options: row.options ?? null,
        filledBy: row.source === "voice" ? "voice agent" : "staff",
      }));
  },
});

export const listPhoneAgents = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.map((row) => ({
      id: row._id,
      name: row.name,
      enabled: row.enabled,
      inboundNumber: row.inboundNumber ?? null,
      // Whether Resepta's private runtime is published to it. An agent without
      // this can take a call but cannot read or write customer data.
      runtimeConnected: row.runtimeConnectedAt !== undefined,
      lastCallAt: row.lastCallEventAt ? new Date(row.lastCallEventAt).toISOString() : null,
    }));
  },
});

export const createService = internalMutation({
  args: {
    ...scope,
    name: v.string(),
    durationMinutes: v.optional(v.number()),
    leadMinutes: v.optional(v.number()),
    price: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, name, durationMinutes, leadMinutes, price }) => {
    const label = name.trim();
    if (!label) throw new Error("A service needs a name.");
    const rows = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    // Case-folded: "Saç kesimi" and "saç kesimi" are one service to a caller,
    // and two rows the voice agent would have to choose between.
    if (rows.some((row) => row.name.trim().toLowerCase() === label.toLowerCase())) {
      throw new Error(`"${label}" already exists.`);
    }
    const taken = new Set(rows.map(serviceKey));
    const base = keyFromLabel(label) || `service_${taken.size + 1}`;
    const key = uniqueKey(base, taken);
    const duration =
      durationMinutes === undefined ? undefined : Math.max(5, Math.round(durationMinutes));
    const lead = leadMinutes === undefined ? undefined : Math.max(0, Math.round(leadMinutes));
    const amount = price === undefined ? undefined : Math.max(0, Math.round(price));
    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: label,
      key,
      ...(duration !== undefined ? { durationMinutes: duration } : {}),
      ...(lead !== undefined ? { leadMinutes: lead } : {}),
      active: true,
      ...(amount !== undefined ? { price: amount } : {}),
    });
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_service",
      args: { name: label, durationMinutes: duration ?? null, leadMinutes: lead ?? null, price: amount ?? null },
      targetTable: "services",
      targetId: serviceId,
      before: null,
      after: { name: label, key },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail:
        duration !== undefined
          ? `Added the service "${label}" (${duration} min)`
          : `Added the good "${label}"`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { serviceId, key, name: label, actionId };
  },
});

export const createContactField = internalMutation({
  args: {
    ...scope,
    label: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("select"),
      v.literal("number"),
      v.literal("date"),
    ),
    options: v.optional(v.array(v.string())),
    source: v.optional(v.union(v.literal("manual"), v.literal("voice"))),
    key: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId, userId, connectionId } = args;
    await assertOwner(ctx, orgId, userId, "add contact fields");
    const label = args.label.trim();
    if (!label) throw new Error("A field needs a label.");
    const key = args.key?.trim() ? normaliseKey(args.key) : keyFromLabel(label);
    if (!key) throw new Error("That label does not produce a usable key.");
    if (RESERVED_CONTACT_KEYS.has(key)) {
      throw new Error(
        `"${key}" is reserved. Name, phone, email and consent already exist and cannot be redefined.`,
      );
    }
    const existing = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (existing.some((row) => row.key === key)) {
      throw new Error(`A field already addresses "${key}".`);
    }
    const options =
      args.type === "select"
        ? (args.options ?? []).map((o) => o.trim()).filter(Boolean)
        : undefined;
    // A select with no choices is a field the agent can never fill.
    if (args.type === "select" && (!options || options.length === 0)) {
      throw new Error("A select field needs at least one option.");
    }
    const fieldId = await ctx.db.insert("contactFields", {
      orgId,
      key,
      label,
      type: args.type,
      options,
      order: existing.length,
      source: args.source === "voice" ? "voice" : undefined,
    });
    const filledBy = args.source === "voice" ? "voice agent" : "staff";
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_contact_field",
      args: { label, type: args.type, source: args.source ?? "manual" },
      targetTable: "contactFields",
      targetId: fieldId,
      before: null,
      after: { key, label },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Added the contact field "${label}", filled by ${filledBy}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { fieldId, key, label, filledBy, actionId };
  },
});

// The org's provider credentials, for the action that provisions. Every other
// context query in retell.ts resolves the org from a session or from a
// globally unique agent id; this one is handed the org, because the connector
// already knows it and there is no agent yet to look one up from.
export const phoneAgentContext = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    demoMode: v.boolean(),
    apiKey: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    return {
      demoMode: org?.demoMode === true,
      apiKey: await connectionField(ctx, orgId, "retell", "apiKey"),
    };
  },
});

// Owner check for the phone-agent paths, which cannot use assertOwner: they run
// from an ACTION (the provider is talked to over the network), and an action
// has no database handle of its own.
export const assertCanProvision = internalQuery({
  args: { orgId: v.id("orgs"), userId: v.id("users"), what: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { orgId, userId, what }) => {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
      .unique();
    if (!membership || membership.role !== "owner") {
      throw new Error(`Only an owner can ${what ?? "create a phone agent"}.`);
    }
    return null;
  },
});

// Agents are addressed by their RANDEVU id, the one list_phone_agents returns.
// The provider's id is deliberately not the handle: "Retell is an
// implementation detail" is a product rule, and a connector that made owners
// pass provider ids around would be the loudest possible violation of it.
export const resolvePhoneAgent = internalQuery({
  args: { orgId: v.id("orgs"), agentId: v.string() },
  returns: v.object({ retellAgentId: v.string(), name: v.string() }),
  handler: async (ctx, { orgId, agentId }) => {
    const row = await ctx.db.get(agentId as Id<"retellAgents">).catch(() => null);
    if (!row || row.orgId !== orgId) {
      throw new Error("No phone agent with that id. Use list_phone_agents to get one.");
    }
    // `name` is optional on the row: an agent adopted through Connect existing
    // carries the provider's name only once something has read it back.
    return { retellAgentId: row.retellAgentId, name: row.name ?? "this agent" };
  },
});

export const listAgentVariables = internalQuery({
  args: { orgId: v.id("orgs"), agentId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, agentId }) => {
    const agent = await ctx.db.get(agentId as Id<"retellAgents">).catch(() => null);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("No phone agent with that id. Use list_phone_agents to get one.");
    }
    const rows = await ctx.db
      .query("voiceAgentVariables")
      .withIndex("by_org_agent", (q) =>
        q.eq("orgId", orgId).eq("retellAgentId", agent.retellAgentId),
      )
      .collect();
    return {
      agent: agent.name,
      publishedAt: agent.variablesSyncedAt
        ? new Date(agent.variablesSyncedAt).toISOString()
        : null,
      variables: rows
        .sort((a, b) => a.order - b.order)
        .map((row) => ({
          key: row.key,
          label: row.label,
          // Where the answer goes. "contact" writes it to a property on the
          // customer card, "customer" to the card's own name or email, and
          // "call" keeps it on the call record only.
          destination: row.destination,
          ...(row.customerField ? { customerField: row.customerField } : {}),
          asks:
            row.duringMode === "confirm"
              ? "confirms the current value"
              : row.duringMode === "if_missing"
                ? "asks when missing"
                : "does not ask",
        })),
    };
  },
});

// Turning a list of field keys into a valid variable set. The caller names
// fields; everything validateVariables insists on — the contactFieldId link,
// the key matching the field's, enum choices coming from the field's options —
// is derived here rather than asked for, because every one of those is a
// publish error waiting to happen and none of them is a decision.
//
// business_name is ALWAYS included and that is not decoration: publishing
// rebuilds the provider's default dynamic variables from this set alone, so a
// set without it silently blanks {{business_name}} and the agent opens by
// greeting nobody.
export const buildAgentVariables = internalQuery({
  args: {
    orgId: v.id("orgs"),
    fieldKeys: v.array(v.string()),
    // Field key → the instruction the agent follows for that one value. Left
    // out, publishing substitutes "Capture <label> when the caller provides
    // it", which is enough to work and not enough to be good: it is the only
    // place to say "map what they describe onto these options, do not read the
    // list aloud", and an enum without that gets read aloud.
    descriptions: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, fieldKeys, descriptions }) => {
    const fields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const byKey = new Map(fields.map((field) => [field.key, field]));

    const variables: Record<string, unknown>[] = [
      {
        key: "business_name",
        label: "Business name",
        description: "",
        type: "string",
        required: false,
        beforeSource: "business_name",
        duringMode: "none",
        afterCall: false,
        destination: "call",
      },
      // Two rows, not one "caller name": these are the customer's own First
      // name and Last name columns, and the agent decides where the spoken
      // name divides. Onto the customer, not the call — every agent built
      // through this tool used to ask a first-time caller their name and drop
      // it, leaving a record with a phone number and nothing else on it.
      {
        key: "customer_first_name",
        label: "First name",
        description: "",
        type: "string",
        required: false,
        beforeSource: "customer_first_name",
        duringMode: "if_missing",
        afterCall: true,
        destination: "customer",
        customerField: "firstName",
      },
      {
        key: "customer_last_name",
        label: "Last name",
        description: "",
        type: "string",
        required: false,
        beforeSource: "customer_last_name",
        duringMode: "if_missing",
        afterCall: true,
        destination: "customer",
        customerField: "lastName",
      },
    ];

    const missing: string[] = [];
    const notVoice: string[] = [];
    for (const key of fieldKeys) {
      if (
        key === "business_name" ||
        key === "customer_first_name" ||
        key === "customer_last_name"
      ) {
        continue;
      }
      const field = byKey.get(key);
      if (!field) {
        missing.push(key);
        continue;
      }
      // A field staff fill in is not one the agent may write. The runtime
      // refuses it too; refusing here says why while it can still be fixed.
      if (field.source !== "voice") {
        notVoice.push(key);
        continue;
      }
      variables.push({
        key: field.key,
        label: field.label,
        description: (descriptions?.[field.key] ?? "").trim(),
        type:
          field.type === "select" ? "enum" : field.type === "number" ? "number" : "string",
        ...(field.type === "select" ? { choices: field.options ?? [] } : {}),
        required: false,
        // The repeat-caller path the picker wires by hand in the app: read the
        // stored value before the call, only ask when it is missing, write the
        // answer back to the same field.
        beforeSource: "contact_field",
        beforeFieldId: field._id,
        duringMode: "if_missing",
        afterCall: true,
        destination: "contact",
        contactFieldId: field._id,
      });
    }
    if (missing.length > 0) {
      throw new Error(
        `No contact field with key: ${missing.join(", ")}. Use list_contact_fields to see them.`,
      );
    }
    if (notVoice.length > 0) {
      throw new Error(
        `These fields are filled by staff, not the phone agent: ${notVoice.join(", ")}. Create them with filledBy "voice" to have the agent collect them.`,
      );
    }
    return variables;
  },
});

// reversible:false for the same reason as every other provider write: putting
// the line back is another routing change, not an undo of this one. The feed
// still names both agents so it is obvious what moved.
export const recordLineAssigned = internalMutation({
  args: {
    ...scope,
    retellAgentId: v.string(),
    agentName: v.string(),
    number: v.union(v.string(), v.null()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, retellAgentId, agentName, number }) => {
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "assign_phone_number",
      args: { retellAgentId, number },
      targetTable: "retellAgents",
      targetId: retellAgentId,
      before: null,
      after: { number: number ?? "" },
      reversible: false,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: number
        ? `${number} now rings "${agentName}"`
        : `"${agentName}" no longer answers an inbound line`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId };
  },
});

// Journalled reversible:false. The publish already created a version at the
// provider; putting the old set back means publishing ANOTHER version, which
// is a new action rather than an undo of this one.
export const recordVariablesPublished = internalMutation({
  args: { ...scope, retellAgentId: v.string(), agentName: v.string(), keys: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, retellAgentId, agentName, keys }) => {
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "set_agent_variables",
      args: { retellAgentId, keys },
      targetTable: "voiceAgentVariables",
      targetId: retellAgentId,
      before: null,
      after: { keys: keys.join(", ") },
      reversible: false,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Set what "${agentName}" collects: ${keys.join(", ")}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId };
  },
});

// Journalled AFTER the provider call, never before: the agent is an external
// resource, so the only honest moment to record it is once it exists.
// reversible:false because nothing here can un-create it — `undo` says so in
// those words rather than failing on a missing branch.
// Reversible, unlike the variables lane above — the previous prompt is a
// string we hold, so putting it back is one more publish. What undo cannot
// take back is any call that came in while the new one was live, and the
// tool's own description says exactly that rather than implying a clean
// rewind.
export const recordPromptPublished = internalMutation({
  args: {
    ...scope,
    retellAgentId: v.string(),
    agentName: v.string(),
    previousPrompt: v.string(),
    newPrompt: v.string(),
  },
  returns: v.any(),
  handler: async (
    ctx,
    { orgId, userId, connectionId, retellAgentId, agentName, previousPrompt, newPrompt },
  ) => {
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "publish_agent_prompt",
      args: { retellAgentId },
      targetTable: "voiceAgents",
      targetId: retellAgentId,
      before: { prompt: previousPrompt },
      after: { prompt: newPrompt },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Published a new prompt to "${agentName}"`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId };
  },
});

export const recordAgentCreated = internalMutation({
  args: { ...scope, retellAgentId: v.string(), name: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, retellAgentId, name }) => {
    const row = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_phone_agent",
      args: { name },
      targetTable: "retellAgents",
      targetId: row?._id ?? retellAgentId,
      before: null,
      after: { name, retellAgentId },
      reversible: false,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Created the phone agent "${name}"`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId, agentRowId: row?._id ?? null };
  },
});

// ── Undo ─────────────────────────────────────────────────────────────────────

export const undo = internalMutation({
  args: { ...scope, actionId: v.string() },
  returns: v.object({ summary: v.string() }),
  handler: async (ctx, { orgId, userId, connectionId, actionId }) => {
    const action = await ctx.db.get(actionId as Id<"agentActions">).catch(() => null);
    if (!action || action.orgId !== orgId) throw new Error("No such action.");
    // Your own change, which is what the tool's own description promises and
    // what the drift check below is written around ("Undo takes back your own
    // change; it does not win races"). userId and connectionId were taken in
    // only to STAMP the reversal, never compared — so with recent_actions
    // widening to the whole org on {everyone: true}, one staff member's
    // connector could read another's action ids and revert their edits. The
    // create_contact_field branch is the sharpest case: creating one is
    // owner-gated, so reverting one without this check let a non-owner delete a
    // field the owner made, taking every customer's value under that key with
    // it.
    if (action.userId !== userId) {
      throw new Error("That action was somebody else's. You can only undo your own.");
    }
    if (action.undoneAt) throw new Error("That action was already undone.");
    if (!action.reversible) {
      throw new Error(
        `${action.tool} cannot be undone — it already left the building. Nothing was changed.`,
      );
    }

    const before = JSON.parse(action.before) as Record<string, string | null> | null;
    const after = JSON.parse(action.after) as Record<string, string>;
    let summary: string;

    if (action.tool === "add_note") {
      const note = await ctx.db.get(action.targetId as Id<"notes">).catch(() => null);
      if (!note || note.orgId !== orgId) throw new Error("That note is already gone.");
      await ctx.db.delete(note._id);
      summary = "Removed the note.";
    } else if (action.tool === "update_customer") {
      const customer = await customerInOrg(ctx, orgId, action.targetId);
      // The drift check. If a stylist edited the same field after the agent
      // did, restoring would throw THEIR work away — so refuse and name what
      // moved. Undo takes back your own change; it does not win races.
      const drifted = Object.entries(after).filter(
        ([k, wrote]) => ((customer[k as Editable] ?? "") as string) !== wrote,
      );
      if (drifted.length > 0) {
        throw new Error(
          `Refusing to undo: ${drifted
            .map(([k, wrote]) => `"${k}" now reads "${customer[k as Editable] ?? ""}", not "${wrote}"`)
            .join("; ")}. Someone changed it after this action, and undoing would discard their edit.`,
        );
      }
      // null in the journal means the field was UNSET, not empty. Restoring it
      // as "" would leave a customer whose email is an empty string rather than
      // absent — which reads the same in the UI and differently everywhere that
      // checks `if (customer.email)`. Patching undefined removes the field, so
      // undo puts the row back exactly as it was.
      const restore: Record<string, string | undefined> = {};
      for (const [k, prior] of Object.entries(before ?? {})) {
        restore[k] = prior === null ? undefined : prior;
      }
      await ctx.db.patch(customer._id, restore as Partial<Doc<"customers">>);
      summary = `Restored ${Object.keys(restore).join(", ")} on ${fullName(customer)}.`;
    } else if (action.tool === "create_service") {
      const service = await ctx.db.get(action.targetId as Id<"services">).catch(() => null);
      if (!service || service.orgId !== orgId) throw new Error("That service is already gone.");
      // Same drift rule as update_customer, for the same reason: if the salon
      // renamed or repriced it after the agent added it, deleting takes their
      // work with it. Undo takes back your own change; it does not win races.
      if (service.name !== after.name) {
        throw new Error(
          `Refusing to undo: the service now reads "${service.name}", not "${after.name}". Someone edited it after this action.`,
        );
      }
      await ctx.db.delete(service._id);
      summary = `Removed the service "${after.name}".`;
    } else if (action.tool === "create_contact_field") {
      const field = await ctx.db.get(action.targetId as Id<"contactFields">).catch(() => null);
      if (!field || field.orgId !== orgId) throw new Error("That field is already gone.");
      // The guard `contactFields.remove` applies, reached the same way: a field
      // an agent references leaves a dangling id in the variable registry, and
      // that agent's next publish dies on it.
      const variables = await ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      const inUse = variables.some(
        (row) => row.contactFieldId === field._id || row.beforeFieldId === field._id,
      );
      if (inUse) {
        throw new Error(
          `Refusing to undo: "${field.label}" is now referenced by a phone agent. Unlink it there first.`,
        );
      }
      await ctx.db.delete(field._id);
      summary = `Removed the contact field "${field.label}".`;
    } else if (action.tool === "create_customers") {
      // Only the rows this call CREATED. The ones it deduped into existed
      // before it ran, and deleting them would take the salon's own record —
      // and its appointments and messages — with them. `after.createdIds` is
      // written for exactly this reason.
      const ids = ((after as unknown as { createdIds?: string[] }).createdIds ?? []);
      let removed = 0;
      const kept: string[] = [];
      for (const id of ids) {
        const customer = await ctx.db.get(id as Id<"customers">).catch(() => null);
        if (!customer || customer.orgId !== orgId) continue;
        // A customer who has DONE something since is no longer just an
        // imported row. Deleting one with an appointment on the book leaves a
        // dangling customerId that every read path dereferences, so the import
        // is unwound around them and they are named back. Same rule as the
        // other branches: undo takes back its own change, it does not win
        // races with the business.
        const appointment = await ctx.db
          .query("appointments")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
          .first();
        const message = await ctx.db
          .query("messages")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
          .first();
        if (appointment || message) {
          kept.push(fullName(customer));
          continue;
        }
        await ctx.db.delete(customer._id);
        removed += 1;
      }
      summary =
        `Removed ${removed} imported customer${removed === 1 ? "" : "s"}.` +
        (kept.length > 0
          ? ` Kept ${kept.length} who already have appointments or messages: ${kept.join(", ")}.`
          : "");
    } else if (action.tool === "log_activity") {
      const callIds = ((after as unknown as { callIds?: string[] }).callIds ?? []);
      const messageIds = ((after as unknown as { messageIds?: string[] }).messageIds ?? []);
      let removed = 0;
      for (const id of callIds) {
        const row = await ctx.db.get(id as Id<"calls">).catch(() => null);
        if (!row || row.orgId !== orgId) continue;
        await ctx.db.delete(row._id);
        removed += 1;
      }
      for (const id of messageIds) {
        const row = await ctx.db.get(id as Id<"messages">).catch(() => null);
        if (!row || row.orgId !== orgId) continue;
        await ctx.db.delete(row._id);
        removed += 1;
      }
      summary = `Removed ${removed} logged entr${removed === 1 ? "y" : "ies"} from the timeline.`;
    } else {
      throw new Error(`No undo is implemented for ${action.tool}.`);
    }

    const undoActionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "undo",
      args: { actionId },
      targetTable: action.targetTable,
      targetId: action.targetId,
      before: after,
      after: before,
      reversible: false,
    });
    // Marked, never deleted: "changed, then put back" is the honest history,
    // and erasing half of it lies to whoever reads the feed next.
    await ctx.db.patch(action._id, {
      undoneAt: Date.now(),
      undoneByActionId: undoActionId,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "agent_undo",
      detail: summary,
      agent: { actorId: userId, connectionId, agentActionId: undoActionId },
    });
    return { summary };
  },
});

// The two halves of an undo whose reversal is a NETWORK call, not a database
// write. A Retell prompt lives behind HTTP, so restoring one is an action and
// cannot run inside the undo mutation. The MCP handler reads the action with
// this, republishes, and marks it with markUndone — rather than having the
// mutation schedule the restore, which would report "done" before it had been
// and leave nowhere to report a failure.
export const getAction = internalQuery({
  args: { orgId: v.id("orgs"), actionId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, actionId }) => {
    const action = await ctx.db.get(actionId as Id<"agentActions">).catch(() => null);
    if (!action || action.orgId !== orgId) return null;
    return {
      tool: action.tool,
      userId: action.userId,
      args: action.args,
      before: action.before,
      targetId: action.targetId,
      undone: !!action.undoneAt,
      reversible: action.reversible,
    };
  },
});

export const markUndone = internalMutation({
  args: { ...scope, actionId: v.string(), summary: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId, userId, connectionId, actionId, summary }) => {
    const action = await ctx.db.get(actionId as Id<"agentActions">).catch(() => null);
    if (!action || action.orgId !== orgId) throw new Error("No such action.");
    // Re-checked here and not only at the door. This is a second way into the
    // same state change, and the ownership rule undo enforces would otherwise
    // hold on one path and not the other — a staff member reading another's
    // action id out of recent_actions({everyone: true}) could revert their
    // prompt through this one.
    if (action.userId !== userId) {
      throw new Error("That action was somebody else's. You can only undo your own.");
    }
    if (action.undoneAt) throw new Error("That action was already undone.");
    const undoActionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "undo",
      args: { actionId },
      targetTable: action.targetTable,
      targetId: action.targetId,
      before: JSON.parse(action.after),
      after: JSON.parse(action.before),
      reversible: false,
    });
    await ctx.db.patch(action._id, {
      undoneAt: Date.now(),
      undoneByActionId: undoActionId,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "agent_undo",
      detail: summary,
      agent: { actorId: userId, connectionId, agentActionId: undoActionId },
    });
    return null;
  },
});

export const listRecent = internalQuery({
  args: {
    orgId: v.id("orgs"),
    connectionId: v.optional(v.id("mcpConnections")),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, connectionId, limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 100);
    const rows = connectionId
      ? await ctx.db
          .query("agentActions")
          .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
          .order("desc")
          .take(take)
      : await ctx.db
          .query("agentActions")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .order("desc")
          .take(take);
    return rows.map((r) => ({
      actionId: r._id,
      tool: r.tool,
      at: new Date(r.at).toISOString(),
      args: JSON.parse(r.args),
      canUndo: r.reversible && !r.undoneAt,
      undone: !!r.undoneAt,
    }));
  },
});
