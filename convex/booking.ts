import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertE164, requireOwner } from "./lib/orgAuth";
import { splitName } from "./lib/emailInbound";
import { recordCustomerCreated } from "./lib/newCustomer";
import {
  getLocalPartsSafe,
  hasBusinessHours,
  isWithinActiveWindow,
  localWallTimeToUtcMs,
} from "./lib/businessHours";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import {
  scheduleConfirmationIfConfigured,
  scheduleLifecycleMessages,
} from "./appointments";
import { slugify } from "./forms";

// The native booking page: /book/<slug>. The fifth intake, and the first one
// that writes an APPOINTMENT — the form (forms.ts) lands a message for staff
// to act on; this books the slot itself, which is why every write here holds
// the same invariants the voice lane holds (business hours, capacity), not a
// polite subset of them.
//
// EVERY public function here is unauthenticated on purpose — the whole point
// is a stranger with a link. The org slug is the only key on the way in, and
// the appointment's manageToken is the only key back to it. Nothing here may
// read or return anything the org has not chosen to publish: no prices (the
// forms.ts doctrine), no customer data, no counts.
//
// No staff picker, deliberately. The native engine books CAPACITY, not Elif's
// afternoon — the same decision retell.voiceBook records at length. A public
// page that assigns people is the bigger conversation both call sites are
// pointing at; until it happens, which chair the customer gets stays the
// salon's morning-coffee decision.

// Half-hour grid, the granularity every salon's paper book already uses.
const SLOT_STEP_MINUTES = 30;
// A stranger booking themselves gets no closer than an hour out: someone has
// to be able to see it coming. The voice lane has a human (the agent) in the
// loop and books tighter; this page does not.
const MIN_NOTICE_MS = 60 * 60_000;
// Same far-future guard as the voice lane.
const MAX_AHEAD_MS = 400 * 24 * 60 * 60_000;
// One phone number holds at most this many open bookings. Not a business
// rule — a brake on a bored teenager with the link. A real family books four;
// nobody real books six.
const MAX_UPCOMING_PER_PHONE = 5;

// Queries and mutations both call the helpers below, so they ask for the
// read half of the db only — the same narrowing messageRules.rulesForOrg does.
type ReadCtx = { db: Pick<MutationCtx["db"], "query" | "get"> };

async function orgBySlug(ctx: ReadCtx, rawSlug: string): Promise<Doc<"orgs"> | null> {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug) return null;
  // Scanned, not indexed — same reasoning as email.orgByInboundAddress: one
  // row per paying business, read once per page.
  const orgs = await ctx.db.query("orgs").collect();
  const org = orgs.find((candidate) => candidate.publicSlug === slug);
  // Disabled and nonexistent look identical, deliberately (forms.publicForm).
  if (!org || !org.bookingEnabled) return null;
  return org;
}

// How many can be worked at once — active roster, floor 1. The same number
// retell.voiceBook and retell.bookedBetween compute, for the same reason.
async function orgCapacity(
  ctx: ReadCtx,
  orgId: Id<"orgs">,
): Promise<number> {
  const staff = await ctx.db
    .query("staff")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return Math.max(1, staff.filter((row) => row.active).length);
}

// Bookings that could overlap a candidate window. Reaches a day back because
// an appointment STARTS in the index range but a long one from yesterday can
// still be running — the same one-day margin voiceBook uses.
async function activeRowsAround(
  ctx: ReadCtx,
  orgId: Id<"orgs">,
  fromMs: number,
  toMs: number,
): Promise<Doc<"appointments">[]> {
  const rows = await ctx.db
    .query("appointments")
    .withIndex("by_org_start", (q) =>
      q
        .eq("orgId", orgId)
        .gte("startAt", fromMs - 24 * 60 * 60_000)
        .lt("startAt", toMs),
    )
    .collect();
  return rows.filter(
    (row) => row.status === "scheduled" || row.status === "confirmed",
  );
}

function overlapCount(
  rows: Doc<"appointments">[],
  startMs: number,
  durationMinutes: number,
  ignoreId?: Id<"appointments">,
): number {
  const endMs = startMs + durationMinutes * 60_000;
  return rows.filter(
    (row) =>
      row._id !== ignoreId &&
      row.startAt < endMs &&
      startMs < row.startAt + (row.durationMinutes ?? 30) * 60_000,
  ).length;
}

// Does [startMs, +duration] sit inside the salon's open window? The voice lane
// checks only the start; a page that draws a slot grid can do better, and a
// 50-minute treatment offered at 17:45 against an 18:00 close is a booking
// the salon has to phone someone about.
function fitsOpenHours(
  org: Doc<"orgs">,
  startMs: number,
  durationMinutes: number,
): boolean {
  const hours = org.businessHours;
  if (!hours || !hasBusinessHours(hours)) return false;
  if (!isWithinActiveWindow(startMs, org.timezone, hours)) return false;
  if (hours.endMinute != null) {
    const parts = getLocalPartsSafe(startMs, org.timezone);
    if (parts.minutesOfDay + durationMinutes > hours.endMinute) return false;
  }
  return true;
}

// ── The public page ─────────────────────────────────────────────────────────

export const page = query({
  args: { slug: v.string() },
  returns: v.union(
    v.object({
      orgName: v.string(),
      timezone: v.string(),
      language: v.string(),
      services: v.array(
        v.object({
          _id: v.id("services"),
          name: v.string(),
          durationMinutes: v.number(),
        }),
      ),
      // False when the org never set opening hours — the page says "call us"
      // instead of drawing a slot grid it cannot honestly fill.
      hasHours: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const org = await orgBySlug(ctx, args.slug);
    if (!org) return null;
    const services = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    return {
      orgName: org.name,
      timezone: org.timezone,
      language: org.language,
      // Duration IS published — a customer picking a slot needs to know what
      // they are blocking. Price is not, per the forms.ts doctrine.
      services: services
        .filter((service) => service.active)
        .map((service) => ({
          _id: service._id,
          name: service.name,
          durationMinutes: service.durationMinutes,
        })),
      hasHours: hasBusinessHours(org.businessHours ?? {}),
    };
  },
});

// Free starts for one service on one local calendar day, as UTC ms. The
// client formats them in the org's timezone — a Vienna customer booking an
// Istanbul salon is choosing among Istanbul wall times, and the label must
// say what the salon's clock will say.
export const slots = query({
  args: { slug: v.string(), date: v.string(), serviceId: v.id("services") },
  returns: v.array(v.number()),
  handler: async (ctx, args) => {
    const org = await orgBySlug(ctx, args.slug);
    if (!org) return [];
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.orgId !== org._id || !service.active) return [];
    const hours = org.businessHours;
    if (!hours || !hasBusinessHours(hours)) return [];

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(args.date.trim());
    if (!match) return [];
    const [, y, m, d] = match;
    const civil = { y: Number(y), m0: Number(m) - 1, d: Number(d) };
    // Weekday of a civil date is timezone-free arithmetic.
    const weekday = new Date(Date.UTC(civil.y, civil.m0, civil.d)).getUTCDay();
    if (
      hours.activeDays &&
      hours.activeDays.length > 0 &&
      !hours.activeDays.includes(weekday)
    ) {
      return [];
    }

    const openFrom = hours.startMinute ?? 0;
    const openTo = hours.endMinute ?? 24 * 60;
    const duration = service.durationMinutes;
    const now = Date.now();

    // The day's UTC bounds, for the overlap read.
    let dayStartMs: number;
    let dayEndMs: number;
    try {
      dayStartMs = localWallTimeToUtcMs(civil.y, civil.m0, civil.d, 0, 0, org.timezone);
      dayEndMs = dayStartMs + 26 * 60 * 60_000;
    } catch {
      return [];
    }
    if (dayStartMs > now + MAX_AHEAD_MS) return [];
    const rows = await activeRowsAround(ctx, org._id, dayStartMs, dayEndMs);
    const capacity = await orgCapacity(ctx, org._id);

    const starts: number[] = [];
    // First grid line at or after opening — 09:15 opening offers 09:30, not
    // a 09:15 the rest of the day's grid would sit crooked on.
    const firstStep = Math.ceil(openFrom / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
    for (
      let minute = firstStep;
      minute + duration <= openTo;
      minute += SLOT_STEP_MINUTES
    ) {
      let startMs: number;
      try {
        startMs = localWallTimeToUtcMs(
          civil.y,
          civil.m0,
          civil.d,
          Math.floor(minute / 60),
          minute % 60,
          org.timezone,
        );
      } catch {
        continue;
      }
      if (startMs < now + MIN_NOTICE_MS) continue;
      if (overlapCount(rows, startMs, duration) >= capacity) continue;
      starts.push(startMs);
    }
    return starts;
  },
});

export const book = mutation({
  args: {
    slug: v.string(),
    serviceId: v.id("services"),
    startMs: v.number(),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    // The self-serve key, for the confirmation screen's manage link.
    token: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const org = await orgBySlug(ctx, args.slug);
    if (!org) return { ok: false, reason: "not-found" };
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.orgId !== org._id || !service.active) {
      return { ok: false, reason: "not-found" };
    }
    const name = args.name.trim();
    if (!name) return { ok: false, reason: "name-required" };
    let phone: string;
    try {
      phone = assertE164(args.phone);
    } catch {
      return { ok: false, reason: "bad-phone" };
    }

    const now = Date.now();
    if (args.startMs < now + MIN_NOTICE_MS - 60_000) {
      // The minute of slack forgives a slot picked just before the boundary
      // crossed it — refusing a booking the page offered seconds ago reads
      // as the product breaking.
      return { ok: false, reason: "slot-taken" };
    }
    if (args.startMs > now + MAX_AHEAD_MS) return { ok: false, reason: "not-found" };
    // The write holds the invariant itself, exactly like the voice lane:
    // being offered by the slots query is not being bound by it.
    if (!fitsOpenHours(org, args.startMs, service.durationMinutes)) {
      return { ok: false, reason: "slot-taken" };
    }
    const rows = await activeRowsAround(
      ctx,
      org._id,
      args.startMs,
      args.startMs + service.durationMinutes * 60_000,
    );
    const capacity = await orgCapacity(ctx, org._id);
    if (overlapCount(rows, args.startMs, service.durationMinutes) >= capacity) {
      return { ok: false, reason: "slot-taken" };
    }

    // Same phone, same person — the forms.ts rule.
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", org._id).eq("phone", phone))
      .unique();
    const named = splitName(name);
    const email = args.email?.trim().toLowerCase() || undefined;
    let customerId = existing?._id;
    if (!customerId) {
      customerId = await ctx.db.insert("customers", {
        orgId: org._id,
        firstName: named.firstName,
        ...(named.lastName ? { lastName: named.lastName } : {}),
        phone,
        ...(email ? { email } : {}),
        // Booking an appointment and asking to hear about it IS consent,
        // dated — the same reasoning as the request form.
        consentAt: Date.now(),
      });
      await recordCustomerCreated(ctx, {
        orgId: org._id,
        customerId,
        source: "booking",
      });
    } else if (email && !existing?.email) {
      // Fill a blank, never overwrite: the record's address may be the one
      // the salon actually corresponds on.
      await ctx.db.patch(customerId, { email });
    }

    const allUpcoming = (
      await ctx.db
        .query("appointments")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect()
    ).filter(
      (row) =>
        row.startAt > now &&
        (row.status === "scheduled" || row.status === "confirmed"),
    );
    if (allUpcoming.length >= MAX_UPCOMING_PER_PHONE) {
      return { ok: false, reason: "too-many" };
    }

    const manageToken = crypto.randomUUID();
    const appointmentId = await ctx.db.insert("appointments", {
      orgId: org._id,
      customerId,
      startAt: args.startMs,
      durationMinutes: service.durationMinutes,
      // Snapshot, never a pointer — appointments.items' own doctrine.
      items: [
        {
          serviceId: service._id,
          name: service.name,
          price: service.price,
          durationMinutes: service.durationMinutes,
        },
      ],
      status: "scheduled",
      source: "booking_page",
      manageToken,
    });
    await syncAppointmentSchedule(ctx, appointmentId);
    await scheduleConfirmationIfConfigured(ctx, org._id, appointmentId);
    return { ok: true, token: manageToken };
  },
});

// ── Self-serve manage: /appt/<token> ────────────────────────────────────────

async function appointmentByToken(
  ctx: ReadCtx,
  token: string,
): Promise<{ appointment: Doc<"appointments">; org: Doc<"orgs"> } | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const appointment = await ctx.db
    .query("appointments")
    .withIndex("by_manage_token", (q) => q.eq("manageToken", trimmed))
    .unique();
  if (!appointment) return null;
  const org = await ctx.db.get(appointment.orgId);
  if (!org) return null;
  return { appointment, org };
}

export const manage = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      orgName: v.string(),
      timezone: v.string(),
      language: v.string(),
      startAt: v.number(),
      durationMinutes: v.number(),
      status: v.string(),
      services: v.array(v.string()),
      // What the reschedule picker needs to ask for slots. Null when the org
      // has no booking page — then the page offers cancel only.
      slug: v.union(v.string(), v.null()),
      serviceId: v.union(v.id("services"), v.null()),
      // False for provider-owned bookings (cal.com holds the inventory) —
      // then the page says "call the salon" instead of half-working buttons.
      canModify: v.boolean(),
      phone: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const found = await appointmentByToken(ctx, args.token);
    if (!found) return null;
    const { appointment, org } = found;
    const providerOwned = Boolean(
      appointment.externalUid && org.calcomApiKey && org.calcomEventTypeId,
    );
    const line = appointment.items?.[0];
    return {
      orgName: org.name,
      timezone: org.timezone,
      language: org.language,
      startAt: appointment.startAt,
      durationMinutes:
        appointment.durationMinutes ??
        appointment.items?.reduce((sum, item) => sum + item.durationMinutes, 0) ??
        30,
      status: appointment.status,
      services: (appointment.items ?? []).map((item) => item.name),
      slug: org.bookingEnabled ? (org.publicSlug ?? null) : null,
      serviceId: line?.serviceId ?? null,
      canModify: !providerOwned,
      // The number the salon answers on, for the "call us" fallback.
      phone: org.publicPhone ?? null,
    };
  },
});

export const reschedule = mutation({
  args: { token: v.string(), startMs: v.number() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const found = await appointmentByToken(ctx, args.token);
    if (!found) return { ok: false, reason: "not-found" };
    const { appointment, org } = found;
    if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
      return { ok: false, reason: "not-open" };
    }
    if (appointment.externalUid && org.calcomApiKey && org.calcomEventTypeId) {
      // cal.com owns the slot inventory for this booking; moving it here
      // would fork the truth. The manage page never offers the button, so
      // this answers only a hand-crafted request.
      return { ok: false, reason: "provider-managed" };
    }
    const duration =
      appointment.durationMinutes ??
      appointment.items?.reduce((sum, item) => sum + item.durationMinutes, 0) ??
      30;
    const now = Date.now();
    if (args.startMs < now + MIN_NOTICE_MS - 60_000) {
      return { ok: false, reason: "slot-taken" };
    }
    if (args.startMs > now + MAX_AHEAD_MS) return { ok: false, reason: "not-found" };
    if (!fitsOpenHours(org, args.startMs, duration)) {
      return { ok: false, reason: "slot-taken" };
    }
    const rows = await activeRowsAround(
      ctx,
      org._id,
      args.startMs,
      args.startMs + duration * 60_000,
    );
    const capacity = await orgCapacity(ctx, org._id);
    // The appointment being moved must not block its own new slot.
    if (
      overlapCount(rows, args.startMs, duration, appointment._id) >= capacity
    ) {
      return { ok: false, reason: "slot-taken" };
    }
    await ctx.db.patch(appointment._id, { startAt: args.startMs });
    await syncAppointmentSchedule(ctx, appointment._id);
    // The confirmation goes again with the new time. Its ICS rides the same
    // UID (the appointment id), so the customer's calendar entry MOVES
    // rather than gaining a twin.
    await scheduleConfirmationIfConfigured(ctx, org._id, appointment._id);
    return { ok: true };
  },
});

export const cancel = mutation({
  args: { token: v.string() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const found = await appointmentByToken(ctx, args.token);
    if (!found) return { ok: false, reason: "not-found" };
    const { appointment, org } = found;
    if (appointment.status === "cancelled") return { ok: true };
    if (appointment.status === "completed") return { ok: false, reason: "not-open" };
    // Provider-owned goes through cal.com first — the same route the WhatsApp
    // İPTAL reply takes, for the same reason (webhook.ts).
    if (appointment.externalUid && org.calcomApiKey && org.calcomEventTypeId) {
      const customer = await ctx.db.get(appointment.customerId);
      await ctx.scheduler.runAfter(0, internal.calcom.pushCancelToCalcom, {
        appointmentId: appointment._id,
        orgId: org._id,
        externalUid: appointment.externalUid,
        who: customer ? `${customer.firstName} ${customer.lastName ?? ""}`.trim() : "",
      });
      return { ok: true };
    }
    await ctx.db.patch(appointment._id, { status: "cancelled" });
    await syncAppointmentSchedule(ctx, appointment._id);
    await scheduleLifecycleMessages(ctx, org._id, appointment._id, "cancellation");
    return { ok: true };
  },
});

// ── Owner side: the switch, and the link it mints ───────────────────────────

export const enable = mutation({
  args: { enabled: v.boolean() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    if (!args.enabled) {
      // The slug survives being switched off — forms.enable's reasoning.
      await ctx.db.patch(orgId, { bookingEnabled: false });
      return org.publicSlug ?? null;
    }
    let slug = org.publicSlug;
    if (!slug) {
      const base = slugify(org.name) || "resepta";
      const taken = new Set(
        (await ctx.db.query("orgs").collect())
          .filter((other) => other._id !== orgId)
          .map((other) => other.publicSlug),
      );
      slug = base;
      let n = 2;
      while (taken.has(slug)) slug = `${base}-${n++}`;
    }
    await ctx.db.patch(orgId, { bookingEnabled: true, publicSlug: slug });
    return slug;
  },
});
