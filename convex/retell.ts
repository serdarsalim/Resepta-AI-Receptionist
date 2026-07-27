import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrg, requireOwner, assertE164 } from "./lib/orgAuth";
import { nextUpcomingOf, scheduleConfirmationIfConfigured } from "./appointments";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";

// Voice lane (spec Phase C): one Retell agent per org. Function calls and the
// post-call webhook resolve the org by retellAgentId — never by caller number.

export const config = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("retellAgents"),
      retellAgentId: v.string(),
      inboundNumber: v.optional(v.string()),
      transferNumber: v.optional(v.string()),
      enabled: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    if (!agent) return null;
    return {
      _id: agent._id,
      retellAgentId: agent.retellAgentId,
      inboundNumber: agent.inboundNumber,
      transferNumber: agent.transferNumber,
      enabled: agent.enabled,
    };
  },
});

export const setConfig = mutation({
  args: {
    retellAgentId: v.string(),
    inboundNumber: v.optional(v.string()),
    transferNumber: v.optional(v.string()),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const retellAgentId = args.retellAgentId.trim();
    if (!retellAgentId) throw new Error("agent-id-required");
    // Agent ids are globally unique at Retell; refuse one another org claimed.
    const claimed = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (claimed && claimed.orgId !== orgId) throw new Error("agent-already-connected");
    const existing = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    const patch = {
      retellAgentId,
      inboundNumber: args.inboundNumber?.trim() || undefined,
      transferNumber: args.transferNumber?.trim() || undefined,
      enabled: args.enabled,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("retellAgents", { orgId, ...patch });
    return null;
  },
});

// ---- Internal plumbing for the HTTP endpoints ----

// Org + scheduling config for a function call, resolved by agent id.
export const loadVoiceContext = internalQuery({
  args: { retellAgentId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || !agent.enabled) return null;
    const org = await ctx.db.get(agent.orgId);
    if (!org) return null;
    return { agent, org };
  },
});

// What the caller asked for, matched against what the salon actually sells.
//
// The caller says "manikur", "Manikür" or "manikür yaptıracaktım"; the org's
// list says "Manikür". Folded exact match first, then containment either way,
// longest name first so "Saç boyama" wins over a bare "Saç". Only active
// services: a service the salon has switched off is not something the phone
// should be able to book.
//
// A miss is NOT a booking failure. cal.com already holds the slot by the time
// this runs, so refusing here would strand a reservation, and an appointment
// missing its service name is a great deal better than a caller told "sorry"
// because the agent improvised a synonym. The salon sees an unnamed block and
// fixes it in one click; the customer keeps their slot.
async function matchService(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  spoken: string,
): Promise<{
  serviceId: Id<"services">;
  name: string;
  price?: number;
  durationMinutes: number;
} | undefined> {
  const wanted = foldForMatch(spoken);
  if (!wanted) return undefined;
  const services = (
    await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  ).filter((service) => service.active);
  const folded = services
    .map((service) => ({ service, name: foldForMatch(service.name) }))
    .sort((a, b) => b.name.length - a.name.length);
  const hit =
    folded.find((row) => row.name === wanted) ??
    // Two-character names would match almost any sentence, so containment
    // only applies once a name is long enough to mean something.
    folded.find(
      (row) =>
        row.name.length >= 3 &&
        (row.name.includes(wanted) || wanted.includes(row.name)),
    );
  if (!hit) return undefined;
  // Snapshotted, not referenced: raising the price in September must not
  // rewrite what this booking recorded. See the items comment in schema.ts.
  return {
    serviceId: hit.service._id,
    name: hit.service.name,
    price: hit.service.price,
    durationMinutes: hit.service.durationMinutes,
  };
}

// Voice booking: find/create the customer by phone, insert the appointment.
// externalUid (cal.com's uid when the booking went through cal.com) is what
// dedupes the webhook echo via by_org_external.
export const voiceBook = internalMutation({
  args: {
    orgId: v.id("orgs"),
    name: v.string(),
    phone: v.string(),
    startAt: v.number(),
    externalUid: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
    // What the caller asked for, in their own words. Matched below rather
    // than by the agent, so a salon renaming a service does not mean editing
    // a prompt in Retell.
    service: v.optional(v.string()),
  },
  // The matched name goes back to the agent so it can read the booking back
  // to the caller in the salon's own vocabulary — and so a miss is visible to
  // whoever is reading the call rather than silent.
  returns: v.object({
    appointmentId: v.id("appointments"),
    serviceName: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const phone = assertE164(args.phone);
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
      .unique();
    if (!customer) {
      const [firstName, ...rest] = args.name.trim().split(/\s+/).filter(Boolean);
      const customerId = await ctx.db.insert("customers", {
        orgId: args.orgId,
        firstName: firstName || phone,
        lastName: rest.join(" ") || undefined,
        phone,
        // Booking by calling the salon IS the opt-in moment (same reasoning
        // as the cal.com page).
        consentAt: Date.now(),
      });
      customer = await ctx.db.get(customerId);
    }
    if (!customer) throw new Error("customer-failed");
    const line = args.service
      ? await matchService(ctx, args.orgId, args.service)
      : undefined;
    const appointmentId = await ctx.db.insert("appointments", {
      orgId: args.orgId,
      customerId: customer._id,
      startAt: args.startAt,
      // The service's own duration wins over anything the call reported: it is
      // what the salon says the work takes, and the block staff read.
      durationMinutes: line?.durationMinutes ?? args.durationMinutes,
      items: line ? [line] : undefined,
      status: "scheduled",
      source: "voice",
      externalUid: args.externalUid,
    });
    await syncAppointmentSchedule(ctx, appointmentId);
    await scheduleConfirmationIfConfigured(ctx, args.orgId, appointmentId);
    return { appointmentId, serviceName: line?.name };
  },
});

// Cancel and reschedule are split into a lookup and a write because a Convex
// mutation cannot reach the network, and cal.com has to be told first: it owns
// the slot inventory, the salon's Google Calendar and the notification emails.
// The old single mutation patched status locally and stopped, so Randevu said
// cancelled while cal.com kept the slot blocked for a customer who was not
// coming. http.ts calls this, then cal.com, then the write below.
export const nextAppointmentForPhone = internalQuery({
  args: { orgId: v.id("orgs"), phone: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      appointmentId: v.id("appointments"),
      externalUid: v.optional(v.string()),
      startAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const phone = toE164(args.phone);
    if (!phone) return null;
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
      .unique();
    if (!customer) return null;
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const next = nextUpcomingOf(appointments, Date.now(), ["scheduled", "confirmed"]);
    if (!next) return null;
    return {
      appointmentId: next._id,
      externalUid: next.externalUid,
      startAt: next.startAt,
    };
  },
});

// The writes themselves live in appointments.ts (markCancelled,
// markRescheduled) — the WhatsApp lane cancels through the same pair, and an
// appointment state transition does not belong in the voice module.

// ---- Contact properties written by the voice agent ----
//
// The vertical's own vocabulary (plate number for a garage, last cleaning for
// a dentist, insurance for a clinic) lives in contactFields as ORG DATA. The
// agent writes values by key; the fact that a contactFields row exists in this
// org is the entire permission model. An agent that invents a variable name
// changes nothing, which is what keeps this flexible without being clever.

// Built-in columns are off limits to this path. A phone number misheard
// mid-call must never overwrite the number we dialled, and consent is a KVKK
// record with its own moment, not a value an agent infers from a chat.
const RESERVED_CONTACT_KEYS = new Set([
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "phone",
  "phonenumber",
  "phone_number",
  "email",
  "consent",
  "consentat",
  "consent_at",
]);

const contactUpdateResult = v.object({
  ok: v.boolean(),
  reason: v.optional(v.string()),
  // Keys actually written, the matching labels (for anything spoken), and
  // three separate rejection buckets so the agent's transcript shows WHY
  // something did not stick rather than just that it did not.
  updated: v.array(v.string()),
  updatedLabels: v.array(v.string()),
  // Keys this org has no field for, plus the built-in columns. Machine keys,
  // because no label exists for a key nobody defined.
  ignored: v.array(v.string()),
  // Fields that exist but are marked staff-filled. Labels, because these are
  // real columns a person named.
  notForVoice: v.array(v.string()),
  // Fields the agent may write, whose value did not survive its type.
  rejected: v.array(v.string()),
});

type ContactUpdateResult = {
  ok: boolean;
  reason?: string;
  updated: string[];
  updatedLabels: string[];
  ignored: string[];
  notForVoice: string[];
  rejected: string[];
};

function contactUpdateFailure(reason: string): ContactUpdateResult {
  return {
    ok: false,
    reason,
    updated: [],
    updatedLabels: [],
    ignored: [],
    notForVoice: [],
    rejected: [],
  };
}

// ---- Type coercion for values a model spoke ---------------------------------
//
// Retell hands every collected variable over as a string, whatever the field's
// type is. Storing "14 March" raw on a date field is how a value looks LOST:
// the contact page renders it into <input type="date">, the browser cannot
// read it, and the input shows blank. So a value either fits its type or it
// comes back as rejected; nothing lands raw.
//
// Pure on purpose. Both voice write paths (the mid-call function and the
// post-call webhook) reach the customer through applyVoiceContactValues, and
// this is the single place that decides what a spoken value means.

export type VoiceFieldSpec = {
  type: "text" | "select" | "number" | "date";
  options?: string[];
};

export type CoercedContactValue =
  // value null means "clear this property" — blank beats an empty string on
  // the record.
  { ok: true; value: string | null } | { ok: false };

// Match-only folding for select options: a caller who says "renkli" should hit
// the option "Renkli", and "grosse" should hit "Große". Turkish dotted/dotless
// i is folded the same way contactFields derives its keys.
function foldForMatch(raw: string): string {
  return raw
    .trim()
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[äÄ]/g, "a")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one, leap years included.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string | null {
  if (!isRealDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The formats a person actually dictates or a model actually emits. Day-first
// for the separated forms because both Turkey and the DACH market write
// 14.03.2026; there is no market on this deployment that writes month first,
// so accepting mm/dd would only make 03/04 ambiguous. A relative phrase
// ("next Tuesday") is deliberately NOT resolved: guessing a date onto a
// customer record is worse than handing the miss back to the agent.
function toIsoDate(text: string): string | null {
  const isoish = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (isoish) return iso(+isoish[1], +isoish[2], +isoish[3]);
  const yearFirst = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(text);
  if (yearFirst) return iso(+yearFirst[1], +yearFirst[2], +yearFirst[3]);
  const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
  if (dayFirst) {
    const rawYear = +dayFirst[3];
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return iso(year, +dayFirst[2], +dayFirst[1]);
  }
  return null;
}

// "42", "3,5", "2 kişi" all mean a number to a salon. Comma is the decimal
// point in both Turkish and German, so it normalises to a dot on the way in.
function toNumberString(text: string): string | null {
  const match = /-?\d+(?:[.,]\d+)?/.exec(text.replace(/\s/g, ""));
  if (!match) return null;
  return match[0].replace(",", ".");
}

export function coerceContactValue(
  field: VoiceFieldSpec,
  raw: unknown,
): CoercedContactValue {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (field.type === "number") {
    const value = toNumberString(text);
    return value === null ? { ok: false } : { ok: true, value };
  }
  if (field.type === "date") {
    const value = toIsoDate(text);
    return value === null ? { ok: false } : { ok: true, value };
  }
  if (field.type === "select") {
    // Only a defined option, never a near miss: the record page renders this
    // through a select, so a value outside the list has nothing to show.
    const wanted = foldForMatch(text);
    const match = (field.options ?? []).find((o) => foldForMatch(o) === wanted);
    return match === undefined ? { ok: false } : { ok: true, value: match };
  }
  return { ok: true, value: text };
}

// Lenient sibling of assertE164: the voice lane must never throw at Retell,
// so a number we cannot read comes back as a reason instead of a 500.
function toE164(raw: string): string | null {
  const trimmed = raw.replace(/[\s().-]/g, "");
  const phone = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}

// The single mapping both voice write paths share: the mid-call function and
// the post-call webhook. Two copies of this guard would drift.
export async function applyVoiceContactValues(
  ctx: MutationCtx,
  args: { orgId: Id<"orgs">; phone: string; values: Record<string, string> },
): Promise<ContactUpdateResult> {
  const phone = toE164(args.phone);
  if (!phone) return contactUpdateFailure("phone-not-recognised");
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
    .unique();
  if (!customer) return contactUpdateFailure("no-contact-with-that-number");
  const fields = await ctx.db
    .query("contactFields")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .collect();
  const byKey = new Map(fields.map((field) => [field.key, field]));

  const custom = { ...(customer.custom ?? {}) };
  const updated: string[] = [];
  const updatedLabels: string[] = [];
  const ignored: string[] = [];
  const notForVoice: string[] = [];
  const rejected: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(args.values)) {
    const key = rawKey.trim();
    if (!key) continue;
    const field = byKey.get(key);
    if (!field || RESERVED_CONTACT_KEYS.has(key.toLowerCase())) {
      ignored.push(key);
      continue;
    }
    // "Filled by" is a two-state contract the business chose in settings, not
    // a hint: a field marked staff-filled belongs to a human, and an agent
    // that mishears is exactly who must not overwrite it. Unset reads as
    // staff, the same way it reads everywhere else.
    if (field.source !== "voice") {
      notForVoice.push(field.label);
      continue;
    }
    const coerced = coerceContactValue(field, rawValue);
    if (!coerced.ok) {
      rejected.push(field.label);
      continue;
    }
    // Storage stays a string; what changed is that the string now fits the
    // type the record page renders it with.
    if (coerced.value === null) delete custom[key];
    else custom[key] = coerced.value;
    updated.push(key);
    updatedLabels.push(field.label);
  }
  if (updated.length > 0) await ctx.db.patch(customer._id, { custom });
  return { ok: true, updated, updatedLabels, ignored, notForVoice, rejected };
}

// Org comes from the agent id on the signed payload, exactly like every other
// voice entry point. A payload that names an org is a payload we ignore.
export const updateContactFromVoice = internalMutation({
  args: {
    retellAgentId: v.string(),
    phone: v.string(),
    values: v.record(v.string(), v.string()),
  },
  returns: contactUpdateResult,
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || !agent.enabled) return contactUpdateFailure("agent-not-configured");
    return await applyVoiceContactValues(ctx, {
      orgId: agent.orgId,
      phone: args.phone,
      values: args.values,
    });
  },
});

// Post-call webhook: one row per Retell call, idempotent by retellCallId.
export const recordCall = internalMutation({
  args: {
    retellAgentId: v.string(),
    retellCallId: v.string(),
    fromNumber: v.optional(v.string()),
    startedAt: v.number(),
    durationSec: v.optional(v.number()),
    outcome: v.optional(v.string()),
    summary: v.optional(v.string()),
    transcript: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent) return null;
    const existing = await ctx.db
      .query("calls")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", args.retellCallId))
      .unique();
    if (existing) return null; // Retell retries webhooks; first write wins
    // A caller the salon has never seen is the normal case, not the edge: it is
    // every first-time caller, and it is every demo. This row used to be
    // written with customerId undefined, and the inbox groups by customer (the
    // `push` guard in messages.ts), so the call landed nowhere — the agent
    // booked correctly and the screen stayed empty. Create the contact, the
    // same way an unknown inbound WhatsApp does, with the phone standing in
    // until a human types a name. Consent stays unset: them ringing us is not
    // KVKK consent for us to start messaging them.
    // A withheld or unreadable caller ID still leaves this undefined, because
    // there is no number to build a contact from.
    let customerId: Id<"customers"> | undefined;
    const callerPhone = args.fromNumber ? toE164(args.fromNumber) : null;
    if (callerPhone) {
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) =>
          q.eq("orgId", agent.orgId).eq("phone", callerPhone),
        )
        .unique();
      customerId =
        customer?._id ??
        (await ctx.db.insert("customers", {
          orgId: agent.orgId,
          firstName: "",
          phone: callerPhone,
        }));
    }
    await ctx.db.insert("calls", {
      orgId: agent.orgId,
      customerId,
      direction: "inbound",
      fromNumber: args.fromNumber,
      startedAt: args.startedAt,
      durationSec: args.durationSec,
      outcome: args.outcome,
      summary: args.summary,
      transcript: args.transcript,
      recordingUrl: args.recordingUrl,
      retellCallId: args.retellCallId,
    });
    return null;
  },
});
