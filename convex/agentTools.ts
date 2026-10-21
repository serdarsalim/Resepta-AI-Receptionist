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

import { syncCustomerSearch } from "./lib/customerSearch";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { recordActivity } from "./lib/activity";
import { foundOrg } from "./lib/foundOrg";
import { connectionField } from "./lib/connections";
import { RESERVED_CONTACT_KEYS, keyFromLabel, normaliseKey, uniqueKey } from "./lib/keys";
import { dialCodeForTimezone, normalisePhone } from "./lib/phone";
import { parseLocalStart } from "./lib/businessHours";
import { loadOrgRules, syncAppointmentSchedule } from "./lib/reminderSchedule";
import { clampOffset, sortRules } from "./messageRules";
import { serviceKey } from "./services";
import { spokenDuration, spokenPrice } from "./lib/speech";
import { noteCall, noteMessageById, recomputeThread } from "./lib/thread";
import { isDeleting, liveCustomer } from "./lib/customerDeletion";
import {
  beginCustomerDeletion,
  customerFootprint,
  deleteConfirmExpiry,
  deleteConfirmToken,
  DELETE_CONFIRM_TTL_MS,
  footprintSignature,
  footprintValidator,
} from "./customerDeletion";

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
  // A customer being deleted is gone for every tool: nothing may be written
  // onto a record the sweep is emptying.
  if (!row || row.orgId !== orgId || isDeleting(row)) {
    throw new Error("No customer with that id.");
  }
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
    const live = rows.filter((c) => !isDeleting(c));
    const needle = query?.trim().toLowerCase();
    // Diacritics fold, because a salon's book is full of names a phone keyboard
    // will not reproduce exactly — searching "gul" has to find "Gül".
    const fold = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const matched = needle
      ? live.filter((c) => {
          const hay = fold(`${c.firstName} ${c.lastName ?? ""} ${c.phone} ${c.email ?? ""}`);
          return hay.includes(fold(needle));
        })
      : live;
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
    if (!c || c.orgId !== orgId || isDeleting(c)) throw new Error("No customer with that id.");
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
        liveCustomer(c) ? [[c._id, fullName(c)] as const] : [],
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
    await ctx.db.patch(customer._id, {
      ...(after as Partial<Doc<"customers">>),
      // A language a person asked for is theirs, no longer learned from a
      // reply (lib/customerLanguage).
      ...("language" in after ? { languageLearnedAt: undefined } : {}),
    });
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
          await ctx.db.patch(existing._id, {
            ...(patch as Partial<Doc<"customers">>),
            // The import's language is the business's word, not a guess.
            ...(patch.language ? { languageLearnedAt: undefined } : {}),
          });
          await syncCustomerSearch(ctx, existing._id);
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
      });
      await syncCustomerSearch(ctx, customerId);
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

// What create_appointments wrote on one row, as its journal records it. The
// undo compares against this to tell "still as imported" from "the business
// has changed it since".
type WrittenAppointment = {
  startAt: number;
  durationMinutes: number | null;
  status: string;
  staffId: string | null;
  items: string;
  notes: string | null;
};

// The services on a booking as one comparable string: which, at what price,
// how many, how long.
function itemsFingerprint(items: Doc<"appointments">["items"]): string {
  return (items ?? [])
    .map(
      (item) =>
        `${item.serviceId ?? ""}:${item.name}:${item.price ?? ""}:${item.quantity ?? 1}:${item.durationMinutes}`,
    )
    .join("|");
}

// Why an imported appointment must survive the undo of its import, or null
// when it is still exactly what the import wrote and nothing hangs off it.
async function importDrift(
  ctx: MutationCtx,
  appointment: Doc<"appointments">,
  was: WrittenAppointment | undefined,
  importedAt: number,
): Promise<"moved" | "changed" | "messaged" | null> {
  // The customer has been told about it: their thread points at this row.
  const message = await ctx.db
    .query("messages")
    .withIndex("by_appointment", (q) => q.eq("appointmentId", appointment._id))
    .first();
  if (message) return "messaged";
  // What a person did to it since the import, as the activity feed recorded
  // it. A move always writes a row; a status change does when a person made
  // it, and the hourly completePast never does.
  const since = (
    await ctx.db
      .query("activityLog")
      .withIndex("by_customer", (q) => q.eq("customerId", appointment.customerId))
      .order("desc")
      .take(200)
  ).filter((row) => row.appointmentId === appointment._id && row._creationTime > importedAt);
  const personMoved = since.some((row) => row.kind === "appointment_moved");
  const personSetStatus = since.some((row) => row.kind === "appointment_status");
  // Journalled before rows were recorded: the feed is the only witness, and a
  // change nobody logged (a customer cancelling on their own) cannot be seen.
  if (!was) return personMoved ? "moved" : personSetStatus ? "changed" : null;
  if (
    personMoved ||
    appointment.startAt !== was.startAt ||
    (appointment.durationMinutes ?? null) !== was.durationMinutes
  ) {
    return "moved";
  }
  if (appointment.status !== was.status) {
    // The one change that is nobody's decision: a booking whose time passed,
    // completed by the hourly sweep.
    const completedByTheClock =
      appointment.status === "completed" &&
      (was.status === "scheduled" || was.status === "confirmed") &&
      !personSetStatus;
    if (!completedByTheClock) return "changed";
  }
  if (
    (appointment.staffId ?? null) !== was.staffId ||
    itemsFingerprint(appointment.items) !== was.items ||
    (appointment.notes ?? null) !== was.notes
  ) {
    return "changed";
  }
  return null;
}

// Seed the calendar: appointments a business already has, brought in from
// whatever it kept the book in before.
//
// THE HAZARD THIS TOOL IS BUILT AROUND. An appointment is not an inert row —
// it is an anchor the reminder cron reads. lib/reminderSchedule computes a due
// time on write and the cron treats "due in the past" as "DUE NOW", which is
// correct for a booking taken two hours before it starts and catastrophic for
// an import: seed six months of history and every no-show in it is a winback
// that goes out tonight, to real customers, about appointments they missed in
// March. The no_show trigger deliberately has no backward guard (switching
// winback on has always meant "including recent no-shows"), so nothing
// upstream stops this.
//
// The rule here, and it generalises to any future bulk writer: A SEED MUST NOT
// CAUSE A SEND THAT WAS DUE BEFORE THE SEED EXISTED. Every rule whose due time
// for a row has already passed is stamped into sentRuleIds at insert, which is
// the same double-send guard the cron itself stamps. Rules that fall genuinely
// in the future stay armed, because a salon seeding next week's book DOES want
// tomorrow's reminders. It is the same reasoning after_end already encodes
// with its `at < rule._creationTime` check; this applies it to every trigger.
//
// Two more things it deliberately does not do. It never fires the booking
// confirmation (scheduleConfirmationIfConfigured) — these appointments already
// exist and the customer already knows. And it never touches cal.com: seeding
// is Resepta's own book, three hundred rows are not three hundred provider
// calls, and externalUid stays unset, which every downstream reader already
// treats as "we hold this one alone".
export const createAppointments = internalMutation({
  args: {
    ...scope,
    appointments: v.array(
      v.object({
        customerId: v.optional(v.string()),
        phone: v.optional(v.string()),
        start: v.string(),
        serviceKeys: v.optional(v.array(v.string())),
        durationMinutes: v.optional(v.number()),
        status: v.optional(v.string()),
        staffName: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, appointments }) => {
    if (appointments.length === 0) throw new Error("appointments is empty");
    // Lower than create_customers' 100: each row costs a customer lookup, a
    // service match, an insert, a schedule recompute (which re-reads the org
    // and its rules) and an activity row. Chunking is the caller's job and the
    // message says so, rather than the mutation dying halfway.
    if (appointments.length > 50) {
      throw new Error(
        `max 50 appointments per call (got ${appointments.length}) — send them in batches of 50`,
      );
    }

    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const dialCode = dialCodeForTimezone(org.timezone);
    // Read once, outside the loop: none of these change underneath fifty
    // inserts, and per-row reads would multiply the whole table scan.
    const [services, staffRows, rules] = await Promise.all([
      ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("staff")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
      loadOrgRules(ctx, orgId),
    ]);
    // Services match on the KEY the agent books by, falling back to the folded
    // name for rows that predate keys — the same two-way match list_services
    // documents, so a seeding client can use either.
    const serviceByKey = new Map<string, Doc<"services">>();
    for (const service of services) {
      // serviceKey() already falls back to the folded name for rows that
      // predate keys, so this is the one address list_services publishes.
      const key = serviceKey(service);
      if (key && !serviceByKey.has(key)) serviceByKey.set(key, service);
      const folded = keyFromLabel(service.name);
      if (folded && !serviceByKey.has(folded)) serviceByKey.set(folded, service);
    }
    const staffByName = new Map(
      staffRows.map((row) => [row.name.trim().toLocaleLowerCase(), row]),
    );

    const now = Date.now();
    const HOUR_MS = 3600_000;
    const STATUSES = new Set([
      "scheduled",
      "confirmed",
      "cancelled",
      "completed",
      "no_show",
    ]);

    const created: { id: string; when: number; customer: string }[] = [];
    // What each row was written as, journalled so an undo can tell an
    // appointment the business has since changed from one still as imported.
    const written: Record<string, WrittenAppointment> = {};
    const skipped: { row: number; why: string }[] = [];

    for (const [index, row] of appointments.entries()) {
      // ── Who ──────────────────────────────────────────────────────────────
      let customer: Doc<"customers"> | null = null;
      if (row.customerId) {
        customer = await ctx.db.get(row.customerId as Id<"customers">).catch(() => null);
        if (!customer || customer.orgId !== orgId || isDeleting(customer)) customer = null;
      } else if (row.phone) {
        const phone = normalisePhone(row.phone, dialCode);
        if (phone) {
          customer = await ctx.db
            .query("customers")
            .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
            .unique();
        }
      }
      // Deliberately NOT created here. create_customers is the door for that,
      // and it is the one that takes a name and dedupes; minting a nameless row
      // from a phone number to hang an appointment on is how a customer list
      // rots. Reported, never dropped silently — the same contract
      // create_customers makes about a number it cannot read.
      if (!customer) {
        skipped.push({
          row: index + 1,
          why: row.customerId
            ? "no customer with that id in this business"
            : "no customer on file with that number — run create_customers first",
        });
        continue;
      }

      // ── When ─────────────────────────────────────────────────────────────
      // Wall time AT THE BUSINESS unless the string carries a zone, which is
      // the same reading the voice and chat agents take (lib/businessHours).
      // A spreadsheet says "14:30" and means half past two in the salon.
      const startAt = parseLocalStart(row.start, org.timezone);
      if (!Number.isFinite(startAt)) {
        skipped.push({
          row: index + 1,
          why: `could not read "${row.start}" as a date and time — use 2026-03-14 14:30`,
        });
        continue;
      }

      // ── What ─────────────────────────────────────────────────────────────
      const items: {
        serviceId: Id<"services">;
        name: string;
        price?: number;
        durationMinutes: number;
        quantity?: number;
      }[] = [];
      let unknownService: string | null = null;
      for (const raw of row.serviceKeys ?? []) {
        // Matched on the key, or on what the raw string folds to, so
        // "Saç kesimi" and "sac_kesimi" both land.
        const service =
          serviceByKey.get(raw.trim()) ?? serviceByKey.get(keyFromLabel(raw));
        if (!service) {
          unknownService = raw;
          break;
        }
        // Snapshotted, exactly as the booking sheet does it: what March
        // charged must not be rewritten by September's price list.
        items.push({
          serviceId: service._id,
          name: service.name,
          ...(service.price !== undefined ? { price: service.price } : {}),
          durationMinutes: service.durationMinutes ?? 0,
        });
      }
      if (unknownService !== null) {
        skipped.push({
          row: index + 1,
          why: `no service keyed "${unknownService}" — list_services shows the keys`,
        });
        continue;
      }

      const summed = items.reduce((total, item) => total + item.durationMinutes, 0);
      const durationMinutes =
        row.durationMinutes !== undefined
          ? Math.max(0, Math.round(row.durationMinutes))
          : items.length > 0
            ? summed
            : undefined;

      // Unsaid status reads off the clock: a past visit happened, a future one
      // is booked. Guessing "completed" for the future would put revenue on
      // the books for work nobody has done.
      const status = row.status?.trim() || (startAt < now ? "completed" : "scheduled");
      if (!STATUSES.has(status)) {
        skipped.push({
          row: index + 1,
          why: `"${status}" is not a status — use scheduled, confirmed, completed, cancelled or no_show`,
        });
        continue;
      }

      const staff = row.staffName
        ? staffByName.get(row.staffName.trim().toLocaleLowerCase())
        : undefined;
      if (row.staffName && !staff) {
        skipped.push({ row: index + 1, why: `nobody on the team is called "${row.staffName}"` });
        continue;
      }

      // ── The guard ────────────────────────────────────────────────────────
      // Every rule already overdue for this row, stamped as sent. See the
      // header: a seed must not cause a send that was due before it existed.
      //
      // Stamped regardless of status, which is broader than the cron's own
      // reading (a cancelled row wants no reminder anyway, a follow-up needs
      // completed) and deliberately so: an extra id in here can only ever
      // suppress. The one cost, worth knowing: if the salon later MOVES a
      // seeded appointment far enough out that a stamped reminder would fall
      // in the future again, it stays suppressed — the same way a reminder
      // that genuinely fired before a reschedule does not fire twice.
      const endsAt = startAt + (durationMinutes ?? 0) * 60_000;
      const alreadyDue: Id<"messageRules">[] = [];
      for (const rule of rules) {
        if (rule.paused) continue;
        let due: number | null = null;
        if (rule.trigger === "before_start") due = startAt - rule.offsetHours * HOUR_MS;
        else if (rule.trigger === "after_end") due = endsAt + rule.offsetHours * HOUR_MS;
        else if (rule.trigger === "no_show") due = startAt + rule.offsetHours * HOUR_MS;
        if (due !== null && due <= now) alreadyDue.push(rule._id);
      }

      const appointmentId = await ctx.db.insert("appointments", {
        orgId,
        customerId: customer._id,
        items,
        ...(staff ? { staffId: staff._id } : {}),
        startAt,
        durationMinutes,
        status: status as Doc<"appointments">["status"],
        notes: row.notes?.trim() || undefined,
        // "manual" is honest: a person is importing their own book. The absent
        // externalUid is what says cal.com does not hold this one.
        source: "manual",
        imported: true,
        ...(alreadyDue.length > 0 ? { sentRuleIds: alreadyDue } : {}),
      });
      // Arms whatever is genuinely still ahead. Idempotent and cheap, and the
      // house rule is that every write which moves startAt or status calls it.
      await syncAppointmentSchedule(ctx, appointmentId);
      await recordActivity(ctx, {
        orgId,
        kind: "appointment_created",
        customerId: customer._id,
        appointmentId,
        agent: { actorId: userId, connectionId, agentActionId: undefined },
      });
      created.push({ id: appointmentId, when: startAt, customer: fullName(customer) });
      written[appointmentId] = {
        startAt,
        durationMinutes: durationMinutes ?? null,
        status,
        staffId: staff?._id ?? null,
        items: itemsFingerprint(items),
        notes: row.notes?.trim() || null,
      };
    }

    if (created.length === 0) {
      return { created, skipped, actionId: null };
    }

    // One journal row for the call, like create_customers: the undoable unit
    // is the import, and a fifty-row seed leaving fifty entries buries every
    // other action in recent_actions.
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_appointments",
      args: { count: appointments.length },
      targetTable: "appointments",
      targetId: created[0]?.id ?? "",
      before: null,
      after: { createdIds: created.map((row) => row.id), written },
      reversible: true,
    });

    return { created, skipped, actionId };
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
        const call = await ctx.db.get(id);
        if (call) await noteCall(ctx, call);
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
      await noteMessageById(ctx, id);
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

// ── Deleting a customer ──────────────────────────────────────────────────────
//
// A data-removal request (KVKK), done from the assistant: "delete Ayşe and
// everything you have on her". Two calls, Nudge's preview_delete_contacts
// shape. The preview names the person and counts what would go, and hands
// back a confirm token bound to those counts and to a ten-minute window; the
// delete recounts and refuses a token that no longer matches. A message that
// lands in between changes the count, so the person always approves what
// actually goes. Owners only, both steps, as in the app (customers.remove):
// the role is re-derived from memberships on every call, like every other
// owner-gated tool here, so a staff member's connector cannot delete a
// customer the app would not let them delete.

export const previewDeleteCustomer = internalQuery({
  args: { orgId: v.id("orgs"), userId: v.id("users"), customerId: v.string() },
  returns: v.object({
    customer: v.object({
      id: v.id("customers"),
      name: v.string(),
      phone: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
    }),
    footprint: footprintValidator,
    signature: v.string(),
  }),
  handler: async (ctx, { orgId, userId, customerId }) => {
    await assertOwner(ctx, orgId, userId, "delete a customer");
    const customer = await ctx.db.get(customerId as Id<"customers">).catch(() => null);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("No customer with that id.");
    }
    const footprint = await customerFootprint(ctx, customer);
    return {
      customer: {
        id: customer._id,
        name: fullName(customer),
        phone: customer.phone || null,
        email: customer.email ?? null,
      },
      footprint,
      signature: footprintSignature(footprint),
    };
  },
});

export const deleteCustomer = internalMutation({
  args: { ...scope, customerId: v.string(), confirmToken: v.string() },
  returns: v.object({
    name: v.string(),
    footprint: footprintValidator,
    actionId: v.id("agentActions"),
  }),
  handler: async (ctx, { orgId, userId, connectionId, customerId, confirmToken }) => {
    await assertOwner(ctx, orgId, userId, "delete a customer");
    const customer = await customerInOrg(ctx, orgId, customerId);
    const expiresAt = deleteConfirmExpiry(confirmToken);
    const now = Date.now();
    if (expiresAt === null || expiresAt < now || expiresAt > now + DELETE_CONFIRM_TTL_MS) {
      throw new Error(
        "That confirmToken has expired, or preview_delete_customer did not issue it. Run preview_delete_customer again and show the person what would go.",
      );
    }
    const footprint = await customerFootprint(ctx, customer);
    if (confirmToken !== deleteConfirmToken(customer._id, footprintSignature(footprint), expiresAt)) {
      throw new Error(
        "That confirmToken does not match a fresh preview of this customer: something changed since (a message arrived, a note was added), or it was issued for someone else. Run preview_delete_customer again and show the person the new counts before deleting.",
      );
    }
    const name = fullName(customer);
    // Journalled as irreversible, and holding counts and the id only. Nudge
    // keeps the names and phones here as the record of who went; under KVKK
    // that record is exactly what was asked to go, so this one says that a
    // customer was deleted, by whom and how much, and never whom.
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "delete_customer",
      args: { customerId: customer._id },
      targetTable: "customers",
      targetId: customer._id,
      before: { counts: footprint.counts, capped: footprint.capped },
      after: null,
      reversible: false,
    });
    await beginCustomerDeletion(ctx, customer, {
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { name, footprint, actionId };
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
  ctx: QueryCtx,
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

// "Add business" through the MCP door — the same birth as users.foundWorkspace
// (lib/foundOrg, no trial credit, owner membership for the human behind the
// key), with two deliberate differences. The active org is NOT switched: the
// key's owner may be working inside the app right now, and yanking their web
// session into a fresh onboarding wizard because Claude finished a tool call
// is not a switch they made. And the journal row lands in the PINNED org's
// feed even though the target is the new org — this connection did it, and the
// pinned org's feed is where this connection's actions are read.
export const createWorkspace = internalMutation({
  args: { ...scope },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId }) => {
    const user = await ctx.db.get(userId);
    // The demo walk-in browses one salon; it does not get to mint real orgs
    // on the deployment (same guard as users.foundWorkspace).
    if (!user || user.isAnonymous) {
      throw new Error("This connection cannot found a workspace.");
    }
    const newOrgId = await foundOrg(ctx, { grantTrialCredit: false });
    // Stamped: they asked for this business by name, through their own
    // connector. There is nothing to announce.
    await ctx.db.insert("memberships", {
      userId,
      orgId: newOrgId,
      role: "owner",
      seenAt: Date.now(),
    });
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_workspace",
      args: {},
      targetTable: "orgs",
      targetId: newOrgId,
      before: null,
      after: { orgId: newOrgId },
      // No org deletion exists, and building one to make this undoable would
      // be the tail wagging the dog. The journal still answers "what did this
      // connection do"; undo refuses rather than pretending.
      reversible: false,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: "Founded a new workspace",
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { orgId: newOrgId, actionId };
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
        `"${key}" is reserved. Name, phone and email already exist, and consent keys are kept out of custom fields.`,
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

// ── The automation itself ────────────────────────────────────────────────────
//
// What the salon sends without anyone pressing anything: the confirmation, the
// reminders, the cancellation note, the winback, the out-of-hours reply. Rules
// hold the WHEN and the channel; waTemplates rows hold the WORDS.
//
// Owner-gated throughout, matching messageRules.add/update which take
// requireOwner. And every rule write schedules reminders.backfillOrg for the
// same reason the app's own mutations do: timing and pause state are baked
// into each appointment's nextMessageAt, so a rule changed without the sweep
// is a change the salon can see and the cron cannot.

export const listMessageRules = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    const rules = await ctx.db
      .query("messageRules")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const templates = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      // An org between the deploy and the migration run has no rows, and an
      // empty list there means "not migrated yet", not "sends nothing".
      migrated: org?.rulesMigratedAt !== undefined,
      defaultChannel: org?.messageChannel ?? "both",
      rules: sortRules(rules).map((rule) => ({
        id: rule._id,
        trigger: rule.trigger,
        offsetHours: rule.offsetHours,
        channel: rule.channel,
        paused: rule.paused ?? false,
        wording: templates
          .filter((t) => t.ruleId === rule._id)
          .map((t) => ({ language: t.language, templateId: t._id })),
      })),
      // The kind-level rows every rule falls back to when it has no wording of
      // its own. Resolution at send time is (ruleId, language) first, then
      // (kind, language) with no ruleId.
      fallbackWording: templates
        .filter((t) => t.ruleId === undefined)
        .map((t) => ({ templateId: t._id, kind: t.kind, language: t.language })),
    };
  },
});

export const getTemplate = internalQuery({
  args: { orgId: v.id("orgs"), templateId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, templateId }) => {
    const row = await ctx.db.get(templateId as Id<"waTemplates">).catch(() => null);
    if (!row || row.orgId !== orgId) throw new Error("No template with that id.");
    return {
      id: row._id,
      kind: row.kind,
      language: row.language,
      ruleId: row.ruleId ?? null,
      body: row.body,
      subject: row.subject ?? null,
      // The fact that decides whether editing `body` changes anything on the
      // busiest lane. Meta approved an exact string; the Cloud API sends that
      // registered template, not what the salon typed.
      metaName: row.metaName ?? null,
      metaStatus: row.status,
    };
  },
});

export const upsertMessageRule = internalMutation({
  args: {
    ...scope,
    ruleId: v.optional(v.string()),
    trigger: v.optional(v.string()),
    offsetHours: v.optional(v.number()),
    channel: v.optional(v.string()),
    paused: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, ruleId, trigger, offsetHours, channel, paused }) => {
    await assertOwner(ctx, orgId, userId, "change what the business sends automatically");
    const CHANNELS = ["whatsapp", "email", "both"] as const;
    if (channel !== undefined && !CHANNELS.includes(channel as (typeof CHANNELS)[number])) {
      throw new Error(`channel must be one of ${CHANNELS.join(", ")}.`);
    }

    if (ruleId) {
      const rule = await ctx.db.get(ruleId as Id<"messageRules">).catch(() => null);
      if (!rule || rule.orgId !== orgId) throw new Error("No rule with that id.");
      const before: Record<string, string> = {};
      const after: Record<string, string> = {};
      const patch: Partial<Doc<"messageRules">> = {};
      if (offsetHours !== undefined) {
        const clamped = clampOffset(rule.trigger, offsetHours);
        before.offsetHours = String(rule.offsetHours);
        after.offsetHours = String(clamped);
        patch.offsetHours = clamped;
      }
      if (channel !== undefined) {
        before.channel = rule.channel;
        after.channel = channel;
        patch.channel = channel as Doc<"messageRules">["channel"];
      }
      if (paused !== undefined) {
        before.paused = String(rule.paused ?? false);
        after.paused = String(paused);
        patch.paused = paused;
      }
      if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
      await ctx.db.patch(rule._id, patch);
      const actionId = await journal(ctx, {
        orgId,
        connectionId,
        userId,
        tool: "set_message_rule",
        args: { ruleId, offsetHours, channel, paused },
        targetTable: "messageRules",
        targetId: rule._id,
        before,
        after,
        reversible: true,
      });
      await recordActivity(ctx, {
        orgId,
        kind: "settings_changed",
        detail: `message rule changed: ${rule.trigger} (${Object.keys(after).join(", ")})`,
        agent: { actorId: userId, connectionId, agentActionId: actionId },
      });
      await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
      return { ruleId: rule._id, trigger: rule.trigger, created: false, actionId };
    }

    const TRIGGERS = [
      "booking",
      "before_start",
      "after_end",
      "cancellation",
      "no_show",
      "out_of_hours",
    ] as const;
    if (!trigger || !TRIGGERS.includes(trigger as (typeof TRIGGERS)[number])) {
      throw new Error(
        `Creating a rule needs a trigger, one of ${TRIGGERS.join(", ")}. To change an existing one, pass its ruleId.`,
      );
    }
    const t = trigger as Doc<"messageRules">["trigger"];
    const org = await ctx.db.get(orgId);
    const newId = await ctx.db.insert("messageRules", {
      orgId,
      trigger: t,
      offsetHours: clampOffset(t, offsetHours ?? 0),
      channel: (channel as Doc<"messageRules">["channel"]) ?? org?.messageChannel ?? "both",
      ...(paused !== undefined ? { paused } : {}),
    });
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "set_message_rule",
      args: { trigger: t, offsetHours, channel, paused },
      targetTable: "messageRules",
      targetId: newId,
      before: null,
      after: { trigger: t },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `message rule added: ${t}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
    return { ruleId: newId, trigger: t, created: true, actionId };
  },
});

export const updateTemplateBody = internalMutation({
  args: {
    ...scope,
    templateId: v.string(),
    body: v.optional(v.string()),
    subject: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, templateId, body, subject }) => {
    await assertOwner(ctx, orgId, userId, "change the wording the business sends");
    const row = await ctx.db.get(templateId as Id<"waTemplates">).catch(() => null);
    if (!row || row.orgId !== orgId) throw new Error("No template with that id.");
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    const patch: Partial<Doc<"waTemplates">> = {};
    if (body !== undefined && body.trim() && body !== row.body) {
      // Optional on the row: a Meta-only template can carry an approved
      // registration and no authored body at all.
      before.body = row.body ?? "";
      after.body = body;
      patch.body = body;
      // The salon rewrote the words, so any cached flattening of the old ones
      // is now a lie. Cleared rather than recomputed: the render path rebuilds
      // it, and a stale preview is worse than an absent one.
      patch.bodyHtml = undefined;
      patch.bodyPreview = undefined;
    }
    if (subject !== undefined && subject !== (row.subject ?? "")) {
      before.subject = row.subject ?? "";
      after.subject = subject;
      patch.subject = subject.trim() || undefined;
    }
    if (Object.keys(after).length === 0) throw new Error("Nothing to change.");
    await ctx.db.patch(row._id, patch);
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "update_template",
      args: { templateId },
      targetTable: "waTemplates",
      targetId: row._id,
      before,
      after,
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `wording changed: ${row.kind} (${row.language})`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return {
      templateId: row._id,
      kind: row.kind,
      language: row.language,
      // metaName is untouched on purpose — a reword must never cost an approval
      // that took weeks, which is the same call resetToDefaults makes.
      metaApproved: !!row.metaName && row.status === "approved",
      actionId,
    };
  },
});

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
        // Gone already, or on its way out through a delete of its own.
        if (!customer || customer.orgId !== orgId || isDeleting(customer)) continue;
        // A customer who has DONE something since, or whom a person has
        // written about, is no longer just an imported row: a booking, a
        // message, a call or a note is the business's record, not the
        // import's. The import is unwound around them and they are named
        // back. Same rule as the other branches: undo takes back its own
        // change, it does not win races with the business.
        const since = await Promise.all(
          (["appointments", "messages", "calls", "notes"] as const).map((table) =>
            ctx.db
              .query(table)
              .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
              .first(),
          ),
        );
        if (since.some((row) => row !== null)) {
          kept.push(fullName(customer));
          continue;
        }
        // Through the one deletion path, so whatever else hangs off an
        // imported row (its activity line, a read mark, a run entry) goes
        // with it instead of pointing at nobody. Quiet: this undo's own feed
        // line is the record.
        await beginCustomerDeletion(ctx, customer, { quiet: true });
        removed += 1;
      }
      summary =
        `Removed ${removed} imported customer${removed === 1 ? "" : "s"}.` +
        (kept.length > 0
          ? ` Kept ${kept.length} who already have appointments, messages, calls or notes: ${kept.join(", ")}.`
          : "");
    } else if (action.tool === "create_appointments") {
      // Only what this call inserted, and only what is still as it wrote it.
      // An appointment the business has since MOVED, cancelled, marked
      // no-show, re-staffed or otherwise changed is theirs now, not the
      // import's: deleting it would take a real decision with it, and the
      // drift rule everywhere else in this file says undo takes back its own
      // change and does not win races. Anything with a message hanging off it
      // stays too: a customer who has been told about this appointment has an
      // appointmentId in their thread that every read path dereferences.
      //
      // This comment promised that before the journal could keep it: the row
      // recorded only the ids, so a moved or cancelled import was deleted
      // anyway. Since 2026-10-13 the journal records what each row was
      // written as (importDrift compares against it); a row journalled
      // earlier is judged by the activity feed alone.
      const recorded = after as unknown as {
        createdIds?: string[];
        written?: Record<string, WrittenAppointment>;
      };
      let removed = 0;
      const kept = { moved: 0, changed: 0, messaged: 0 };
      for (const id of recorded.createdIds ?? []) {
        const appointment = await ctx.db
          .get(id as Id<"appointments">)
          .catch(() => null);
        if (!appointment || appointment.orgId !== orgId) continue;
        const why = await importDrift(ctx, appointment, recorded.written?.[id], action.at);
        if (why) {
          kept[why] += 1;
          continue;
        }
        await ctx.db.delete(appointment._id);
        removed += 1;
      }
      const keptParts = [
        kept.moved > 0 ? `${kept.moved} moved since` : null,
        kept.changed > 0 ? `${kept.changed} cancelled or otherwise changed since` : null,
        kept.messaged > 0
          ? `${kept.messaged} the customer has been messaged about`
          : null,
      ].filter((part): part is string => part !== null);
      const keptTotal = kept.moved + kept.changed + kept.messaged;
      summary =
        `Removed ${removed} seeded appointment${removed === 1 ? "" : "s"}.` +
        (keptTotal > 0 ? ` Kept ${keptTotal}: ${keptParts.join(", ")}.` : "");
    } else if (action.tool === "log_activity") {
      const callIds = ((after as unknown as { callIds?: string[] }).callIds ?? []);
      const messageIds = ((after as unknown as { messageIds?: string[] }).messageIds ?? []);
      let removed = 0;
      // The inbox summary (customers.thread) still names the rows this
      // deletes until it is rebuilt: the bandwidth rule's recomputeThread,
      // which a delete owes like a failed send does (2026-10-13).
      const touched = new Set<Id<"customers">>();
      for (const id of callIds) {
        const row = await ctx.db.get(id as Id<"calls">).catch(() => null);
        if (!row || row.orgId !== orgId) continue;
        await ctx.db.delete(row._id);
        if (row.customerId) touched.add(row.customerId);
        removed += 1;
      }
      for (const id of messageIds) {
        const row = await ctx.db.get(id as Id<"messages">).catch(() => null);
        if (!row || row.orgId !== orgId) continue;
        await ctx.db.delete(row._id);
        if (row.customerId) touched.add(row.customerId);
        removed += 1;
      }
      for (const customerId of touched) await recomputeThread(ctx, customerId);
      summary = `Removed ${removed} logged entr${removed === 1 ? "y" : "ies"} from the timeline.`;
    } else if (action.tool === "set_message_rule") {
      const rule = await ctx.db.get(action.targetId as Id<"messageRules">).catch(() => null);
      if (!rule || rule.orgId !== orgId) throw new Error("That rule is already gone.");
      if (before === null) {
        // It did not exist before this action, so the inverse is removal —
        // along with any per-rule wording, which would otherwise be an orphan
        // row pointing at a deleted rule.
        const wording = await ctx.db
          .query("waTemplates")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();
        for (const t of wording) {
          if (t.ruleId === rule._id) await ctx.db.delete(t._id);
        }
        await ctx.db.delete(rule._id);
        summary = `Removed the ${rule.trigger} rule.`;
      } else {
        // Same drift rule as everywhere else: if the owner retimed it after the
        // agent did, restoring throws their change away. Refuse and name it.
        const current: Record<string, string> = {
          offsetHours: String(rule.offsetHours),
          channel: rule.channel,
          paused: String(rule.paused ?? false),
        };
        const drifted = Object.entries(after).filter(([k, wrote]) => current[k] !== wrote);
        if (drifted.length > 0) {
          throw new Error(
            `Refusing to undo: ${drifted
              .map(([k, wrote]) => `"${k}" now reads "${current[k]}", not "${wrote}"`)
              .join("; ")}. Someone changed it after this action.`,
          );
        }
        const restore: Partial<Doc<"messageRules">> = {};
        if (before.offsetHours != null) restore.offsetHours = Number(before.offsetHours);
        if (before.channel != null) {
          restore.channel = before.channel as Doc<"messageRules">["channel"];
        }
        if (before.paused != null) restore.paused = before.paused === "true";
        await ctx.db.patch(rule._id, restore);
        summary = `Put the ${rule.trigger} rule back.`;
      }
      // The same sweep the forward write schedules. Undoing a timing change
      // without it leaves every appointment carrying the nextMessageAt the
      // undone rule computed.
      await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
    } else if (action.tool === "update_template") {
      const row = await ctx.db.get(action.targetId as Id<"waTemplates">).catch(() => null);
      if (!row || row.orgId !== orgId) throw new Error("That wording is already gone.");
      const current: Record<string, string> = {
        body: row.body ?? "",
        subject: row.subject ?? "",
      };
      const drifted = Object.entries(after).filter(([k, wrote]) => current[k] !== wrote);
      if (drifted.length > 0) {
        throw new Error(
          `Refusing to undo: the ${drifted.map(([k]) => k).join(" and ")} has been rewritten since. Undoing would discard that.`,
        );
      }
      const restore: Partial<Doc<"waTemplates">> = {};
      if (before?.body != null) restore.body = before.body;
      if (before?.subject != null) restore.subject = before.subject || undefined;
      restore.bodyHtml = undefined;
      restore.bodyPreview = undefined;
      await ctx.db.patch(row._id, restore);
      summary = `Restored the ${row.kind} wording (${row.language}).`;
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
