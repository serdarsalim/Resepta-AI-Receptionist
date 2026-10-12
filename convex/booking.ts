import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertE164, requireOwner } from "./lib/orgAuth";
import { splitName } from "./lib/emailInbound";
import { hasNoteText } from "./lib/noteBody";
import { resolvePublicPhone } from "./lib/publicPhone";
import { liveCustomer } from "./lib/customerDeletion";
import { recordCustomerCreated } from "./lib/newCustomer";
import {
  closureBlocks,
  getLocalPartsSafe,
  hasBusinessHours,
  isWithinActiveWindow,
  localWallTimeToUtcMs,
  windowForWeekday,
  type Closure,
} from "./lib/businessHours";
import { loadClosures } from "./lib/closureRows";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { assignPublicSlug, slugMatchesName } from "./lib/publicSlug";
import { MAX_LINES_PER_BOOKING, MAX_UPCOMING_PER_PHONE } from "./lib/bookingLimits";
import { CHANGES_PER_DAY, changesToday, withChange } from "./lib/agentChange";
import {
  scheduleConfirmationIfConfigured,
  scheduleLifecycleMessages,
} from "./appointments";

import { customerConflict } from "./lib/overlap";
import { DEFAULT_CURRENCY } from "./lib/money";


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
// One phone number holds at most MAX_UPCOMING_PER_PHONE open bookings
// (lib/bookingLimits, shared with the assistants' booking path since
// 2026-10-13).

// Queries and mutations both call the helpers below, so they ask for the
// read half of the db only — the same narrowing messageRules.rulesForOrg does.
type ReadCtx = { db: Pick<MutationCtx["db"], "query" | "get"> };

// One visit can hold SEVERAL lines — appointments.items' own doctrine, written
// into the schema long before this page could express it: "a haircut plus a
// beard trim is ONE appointment with two lines — one calendar block, one
// reminder, one visit — not two bookings stacked on each other." The staff
// side has always written multiple lines; the public page took a single
// serviceId and made a customer who wanted both come back and book twice.
//
// MAX_LINES_PER_BOOKING lives in lib/bookingLimits, not here: the page enforces
// the same cap and cannot import a value from a file that defines Convex
// functions without dragging this module's whole import graph into the browser.

// Resolves what was picked into the numbers every guard downstream needs.
// Both the slot grid and the write go through here so they cannot disagree
// about how long the visit is — the grid offering a 30-minute gap for a
// 105-minute booking is exactly the kind of drift a second implementation
// buys.
//
// Duration SUMS and lead time takes the MAX: three services run back to back
// in one chair, but a colour needing a day's notice needs it whatever else
// rides along with it.
async function resolveLines(
  ctx: ReadCtx,
  orgId: Id<"orgs">,
  picked: { serviceId: Id<"services">; quantity?: number }[],
): Promise<
  | {
      duration: number;
      leadMs: number;
      items: {
        serviceId: Id<"services">;
        name: string;
        price?: number;
        durationMinutes: number;
        quantity?: number;
      }[];
    }
  | null
> {
  if (picked.length === 0 || picked.length > MAX_LINES_PER_BOOKING) return null;
  // First occurrence wins rather than refusing the whole booking: a double tap
  // is not an error worth a red message, and a time-bound service twice is not
  // a thing this page can express anyway (two haircuts is two visits — the
  // schema says so, and quantity is goods-only for that reason).
  const seen = new Set<string>();
  let duration = 0;
  let leadMs = 0;
  const items: {
    serviceId: Id<"services">;
    name: string;
    price?: number;
    durationMinutes: number;
    quantity?: number;
  }[] = [];
  for (const line of picked) {
    if (seen.has(line.serviceId)) continue;
    seen.add(line.serviceId);
    const service = await ctx.db.get(line.serviceId);
    // One bad id fails the whole booking. A customer who picked three things
    // and silently got two would find out at the salon.
    if (!service || service.orgId !== orgId || !service.active) return null;
    // A good books as duration 0: it holds no chair and no colleague's hour,
    // so the capacity guards fall through by construction.
    const minutes = service.durationMinutes ?? 0;
    duration += minutes;
    leadMs = Math.max(leadMs, (service.leadMinutes ?? 0) * 60_000);
    const isGood = service.durationMinutes === undefined;
    const quantity =
      isGood && line.quantity !== undefined
        ? Math.min(99, Math.max(1, Math.round(line.quantity)))
        : 1;
    items.push({
      // Snapshot, never a pointer — appointments.items' own doctrine.
      serviceId: service._id,
      name: service.name,
      ...(service.price !== undefined ? { price: service.price } : {}),
      durationMinutes: minutes,
      ...(quantity > 1 ? { quantity } : {}),
    });
  }
  return { duration, leadMs, items };
}

async function orgBySlug(ctx: ReadCtx, rawSlug: string): Promise<Doc<"orgs"> | null> {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug) return null;
  // Indexed. This used to collect the whole orgs table and Array.find — which
  // also put every org row in this page's subscription read set, so one salon
  // saving a setting re-ran every open booking page on the deployment.
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
    .unique();
  // Disabled and nonexistent look identical, deliberately (forms.publicForm).
  if (!org || !org.bookingEnabled) return null;
  return org;
}

// How many can be worked at once — active roster, floor 1. The same number
// retell.voiceBook and retell.bookedBetween compute, for the same reason.
export async function orgCapacity(
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
export async function activeRowsAround(
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

export function overlapCount(
  rows: Doc<"appointments">[],
  startMs: number,
  durationMinutes: number,
  ignoreId?: Id<"appointments">,
): number {
  // Goods (duration 0) occupy nobody, in either direction: a candidate order
  // needs no chair, and an existing order holds none. The !== 0 check is
  // deliberate — unset duration means a legacy row (assume 30), only an
  // explicit 0 means goods.
  if (durationMinutes === 0) return 0;
  const endMs = startMs + durationMinutes * 60_000;
  return rows.filter(
    (row) =>
      row._id !== ignoreId &&
      row.durationMinutes !== 0 &&
      row.startAt < endMs &&
      startMs < row.startAt + (row.durationMinutes ?? 30) * 60_000,
  ).length;
}

// Does [startMs, +duration] sit inside the salon's open window? The voice lane
// checks only the start; a page that draws a slot grid can do better, and a
// 50-minute treatment offered at 17:45 against an 18:00 close is a booking
// the salon has to phone someone about.
// A CLOSURE is checked here too, and on the whole span rather than the start:
// a 60-minute service at 12:30 runs into a 13:00 lunch break, and the start
// instant alone would wave it through.
export function fitsOpenHours(
  org: Doc<"orgs">,
  startMs: number,
  durationMinutes: number,
  closures: Closure[],
): boolean {
  const hours = org.businessHours;
  if (!hours || !hasBusinessHours(hours)) return false;
  if (!isWithinActiveWindow(startMs, org.timezone, hours)) return false;
  const parts = getLocalPartsSafe(startMs, org.timezone);
  // The tail fit, against THIS weekday's close rather than one window for the
  // whole week — a Saturday closing at 16:00 used to be measured against the
  // weekday's 18:00 and let a 15:30 hour-long booking through.
  const win = windowForWeekday(hours, parts.weekday);
  if (!win) return false;
  if (parts.minutesOfDay + durationMinutes > win.endMinute) return false;
  // Goods (duration 0) are checked too. They occupy nobody, so the CAPACITY
  // guards skip them — but a closure is not capacity, it is the shop being
  // shut, and nobody hands over a cake through a locked door. Opening hours
  // already refuse a good at 19:00 against an 18:00 close (isWithinActiveWindow
  // above, which is duration-blind); a closure has to agree with that or the
  // lunch hour becomes the one shut hour you can still order into.
  // closureBlocks reads a zero-length range as the start instant, so 13:00
  // collides with a 13:00-14:00 break and 12:00 does not.
  if (closureBlocks(closures, parts, parts.minutesOfDay, parts.minutesOfDay + durationMinutes)) {
    return false;
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
      // Minor-units prices render in this (lib/money formatMoney).
      currency: v.string(),
      // orgs.priceDecimals — whether those prices are written with their
      // decimal part. Published because it is how the salon writes money and
      // the page has to agree with the reminder the customer gets next.
      priceDecimals: v.optional(v.boolean()),
      // The salon's logo, resolved to a URL — null when never uploaded.
      logoUrl: v.union(v.string(), v.null()),
      services: v.array(
        v.object({
          _id: v.id("services"),
          name: v.string(),
          // Unset = a good: ordered for a moment, blocks nothing. The page
          // offers every in-hours time instead of a scarcity-carved grid.
          durationMinutes: v.optional(v.number()),
          leadMinutes: v.optional(v.number()),
          // Minor units. Unset = the salon never priced it; the row then
          // shows duration alone rather than a made-up zero.
          price: v.optional(v.number()),
        }),
      ),
      // False when the org never set opening hours — the page says "call us"
      // instead of drawing a slot grid it cannot honestly fill.
      hasHours: v.boolean(),
      // How a goods order may reach its customer here. Published because the
      // page must not offer delivery a business does not do, and because a
      // business offering only ONE of them should never see a step asking to
      // pick between one option. Resolved server-side (unset means on) so the
      // page reads two plain booleans.
      fulfillment: v.object({ pickup: v.boolean(), delivery: v.boolean() }),
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
      currency: org.currency ?? DEFAULT_CURRENCY,
      priceDecimals: org.priceDecimals,
      logoUrl: org.logoStorageId
        ? await ctx.storage.getUrl(org.logoStorageId)
        : null,
      // Duration AND price are published (Serdar, 2026-08-20, reversing the
      // old forms.ts-era doctrine): a customer picking a slot needs to know
      // what they are blocking and what it costs — every salon-booking
      // product prints the price, and hiding it just moves the question to
      // the phone.
      services: services
        .filter((service) => service.active)
        .map((service) => ({
          _id: service._id,
          name: service.name,
          ...(service.durationMinutes !== undefined
            ? { durationMinutes: service.durationMinutes }
            : {}),
          ...(service.leadMinutes !== undefined
            ? { leadMinutes: service.leadMinutes }
            : {}),
          ...(service.price !== undefined ? { price: service.price } : {}),
        })),
      hasHours: hasBusinessHours(org.businessHours ?? {}),
      fulfillment: {
        pickup: org.pickupEnabled ?? true,
        delivery: org.deliveryEnabled ?? true,
      },
    };
  },
});

// Free starts for one org, one local day, one duration. Extracted from the
// public slots query so the manage page can ask the same question through an
// appointment token instead of a public slug — see slotsForToken.
//
// ignoreId keeps an appointment from blocking the slot it already occupies;
// customerId keeps the grid from offering a time the caller is already busy
// at, which the write would then refuse. A picker that offers what the
// mutation rejects is worse than one that offers less.
export async function freeStarts(
  ctx: ReadCtx,
  org: Doc<"orgs">,
  date: string,
  duration: number,
  opts?: {
    ignoreId?: Id<"appointments">;
    customerId?: Id<"customers">;
    // Goods lead time, ms. Folded into the notice floor so a cake that needs
    // a day's warning never shows tomorrow-morning times.
    leadMs?: number;
  },
): Promise<number[]> {
  {
    const hours = org.businessHours;
    if (!hours || !hasBusinessHours(hours)) return [];

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (!match) return [];
    const [, y, m, d] = match;
    const civil = { y: Number(y), m0: Number(m) - 1, d: Number(d) };
    // Weekday of a civil date is timezone-free arithmetic.
    const weekday = new Date(Date.UTC(civil.y, civil.m0, civil.d)).getUTCDay();

    // THIS weekday's window, through the one normaliser, so a legacy org and a
    // per-weekday org walk the same loop and a closed day yields no slots at
    // all rather than falling back to one window for the whole week.
    const win = windowForWeekday(hours, weekday);
    if (!win) return [];
    const openFrom = win.startMinute;
    const openTo = win.endMinute;
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
    // Once per day, not once per candidate slot: the read is org-wide and the
    // loop below runs it against every grid line.
    const closures = await loadClosures(ctx, org._id);
    const civilParts = { y: civil.y, m0: civil.m0, d: civil.d, weekday };

    const starts: number[] = [];
    // First grid line at or after opening — 09:15 opening offers 09:30, not
    // a 09:15 the rest of the day's grid would sit crooked on.
    const firstStep = Math.ceil(openFrom / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
    // `minute < openTo` as well as the duration fit. For a time-bound service
    // the duration term already implies it, but a GOOD has duration 0, so
    // `minute + 0 <= openTo` admitted a slot at exactly the closing minute —
    // and nothing downstream filtered it, because overlapCount and
    // customerConflict both return early on duration 0. The page offered 18:00
    // at a salon closing at 18:00, and `book` then refused it through
    // isWithinActiveWindow's `minutesOfDay >= endMinute` with reason
    // "slot-taken": a slot nothing had taken.
    for (
      let minute = firstStep;
      minute < openTo && minute + duration <= openTo;
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
      if (startMs < now + Math.max(MIN_NOTICE_MS, opts?.leadMs ?? 0)) continue;
      // Checked on the SPAN, so a 60-minute service at 12:30 is withheld from
      // a 13:00 lunch break rather than offered and then refused by the write
      // guard — the grid and fitsOpenHours must agree, or the page offers a
      // time that fails on submit. Unlike the two capacity guards below this
      // one DOES bite a good: a closure is the shop being shut, not the chair
      // being taken.
      if (closureBlocks(closures, civilParts, minute, minute + duration)) continue;
      // Both guards are no-ops for goods (duration 0): overlapCount returns 0
      // and customerConflict returns null. A good is never crowded out and
      // never crowds — every in-hours grid line stays offerable.
      if (overlapCount(rows, startMs, duration, opts?.ignoreId) >= capacity) continue;
      if (
        opts?.customerId &&
        customerConflict(rows, opts.customerId, startMs, duration, opts.ignoreId)
      ) {
        continue;
      }
      starts.push(startMs);
    }
    return starts;
  }
}

// Free starts as UTC ms. The client formats them in the org's timezone — a
// Vienna customer booking an Istanbul salon is choosing among Istanbul wall
// times, and the label must say what the salon's clock will say.
export const slots = query({
  args: {
    slug: v.string(),
    date: v.string(),
    // The WHOLE selection, because the grid has to offer gaps long enough for
    // all of it. Asking per service and intersecting the answers would be a
    // different, wrong question: two 30-minute services need one 60-minute
    // gap, not two 30-minute gaps that happen to both exist.
    serviceIds: v.array(v.id("services")),
  },
  returns: v.array(v.number()),
  handler: async (ctx, args) => {
    const org = await orgBySlug(ctx, args.slug);
    if (!org) return [];
    const picked = await resolveLines(
      ctx,
      org._id,
      args.serviceIds.map((serviceId) => ({ serviceId })),
    );
    if (!picked) return [];
    return await freeStarts(ctx, org, args.date, picked.duration, {
      leadMs: picked.leadMs,
    });
  },
});

// The same grid, reached with an appointment's manage token instead of a
// public slug.
//
// This exists because the manage page could only offer Reschedule when the
// org had a PUBLIC BOOKING PAGE switched on, since the picker needed a slug.
// Those are different permissions: letting strangers book yourself is a
// business decision, letting a customer move the appointment they already
// hold is what the confirmation message promises them ("randevunuzu
// değiştirmek veya iptal etmek için"). A salon with the public page off was
// sending that promise and then showing only Cancel.
//
// The token is the whole capability, same as manage/reschedule/cancel, and
// this returns nothing but a list of times — no org, no services, no names.
export const slotsForToken = query({
  args: { token: v.string(), date: v.string() },
  returns: v.array(v.number()),
  handler: async (ctx, args) => {
    const found = await appointmentByToken(ctx, args.token);
    if (!found) return [];
    const { appointment, org } = found;
    if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
      return [];
    }
    // Provider-owned bookings are cal.com's inventory to offer, not ours.
    if (appointment.externalUid && org.calcomApiKey && org.calcomEventTypeId) {
      return [];
    }
    // The appointment's own length, which survives a service the salon has
    // since renamed or stopped offering — the reason this does not go looking
    // for a serviceId the way the public picker does.
    const duration =
      appointment.durationMinutes ??
      appointment.items?.reduce((sum, item) => sum + item.durationMinutes, 0) ??
      30;
    return await freeStarts(ctx, org, args.date, duration, {
      ignoreId: appointment._id,
      customerId: appointment.customerId,
      leadMs: await goodsLeadMs(ctx, appointment),
    });
  },
});

// The lead time a goods order carries into a move. Zero for anything
// time-bound: lead time is a promise about making the thing, and a haircut
// is made in the chair. Read from the live service rather than snapshotted,
// because "how much warning does the baker need" is a fact about the baker
// today, not about the order's history.
export async function goodsLeadMs(
  ctx: ReadCtx,
  appointment: Doc<"appointments">,
): Promise<number> {
  if (appointment.durationMinutes !== 0) return 0;
  let leadMs = 0;
  for (const item of appointment.items ?? []) {
    if (!item.serviceId) continue;
    const service = await ctx.db.get(item.serviceId);
    if (service?.leadMinutes) {
      leadMs = Math.max(leadMs, service.leadMinutes * 60_000);
    }
  }
  return leadMs;
}

export const book = mutation({
  args: {
    slug: v.string(),
    // One visit, several lines — see resolveLines. Order is the customer's
    // selection order, which is what the confirmation reads back to them.
    lines: v.array(
      v.object({
        serviceId: v.id("services"),
        // Goods only ("3 chocolate cakes"). Ignored for time-bound services —
        // two haircuts is two visits, not one line with a 2 on it.
        quantity: v.optional(v.number()),
      }),
    ),
    // Absent only for an ASAP goods order — every timed booking sends it.
    startMs: v.optional(v.number()),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    // Anything the customer wants the salon to know — an allergy, a parking
    // question, "my daughter is coming too". Lands as a NOTE on their record,
    // where the salon already reads everything else about them, rather than as
    // a field on the appointment that only the booking sheet would show.
    note: v.optional(v.string()),
    // Goods-only baskets say how the order reaches them: picked up or
    // delivered, now or at a chosen time. Dropped for any basket holding a
    // time-bound service — the visit IS the fulfillment.
    fulfillment: v.optional(
      v.object({
        kind: v.union(v.literal("pickup"), v.literal("delivery")),
        asap: v.optional(v.boolean()),
        address: v.optional(v.string()),
      }),
    ),
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
    const picked = await resolveLines(ctx, org._id, args.lines);
    if (!picked) return { ok: false, reason: "not-found" };
    const name = args.name.trim();
    if (!name) return { ok: false, reason: "name-required" };
    let phone: string;
    try {
      phone = assertE164(args.phone);
    } catch {
      return { ok: false, reason: "bad-phone" };
    }

    // Summed across every line, and a booking of goods alone is duration 0 —
    // it holds no chair and no colleague's hour, so the capacity guards below
    // fall through by construction exactly as they did for one good.
    const duration = picked.duration;
    // A fulfillment only sticks to a goods-only basket. Dropped silently
    // otherwise rather than refused: only a hand-crafted request can send one
    // alongside a service, and the booking is still valid without it.
    const fulfillment = duration === 0 ? args.fulfillment : undefined;
    // The write holds the business's own answer, exactly as it holds opening
    // hours: being offered by the page is not being bound by it, and this one
    // is a promise in the business's voice — a delivery it does not do.
    if (fulfillment?.kind === "pickup" && org.pickupEnabled === false) {
      return { ok: false, reason: "not-offered" };
    }
    if (fulfillment?.kind === "delivery" && org.deliveryEnabled === false) {
      return { ok: false, reason: "not-offered" };
    }
    const asap = Boolean(fulfillment?.asap);

    const now = Date.now();
    // ASAP books AT the moment of ordering: startAt records when the order
    // was placed and the flag carries the promise, so the notice floor and
    // the open-hours fit do not apply — "as soon as you can" at 8pm is an
    // order the salon reads in the morning, not a refusal. Lead time still
    // binds: asap on a cake that needs a day's notice is a promise nobody
    // can keep, and the page never offers it.
    if (asap && picked.leadMs > 0) return { ok: false, reason: "lead-time" };
    const startMs = asap ? now : args.startMs;
    if (startMs === undefined) return { ok: false, reason: "not-found" };
    if (!asap) {
      const noticeMs = Math.max(MIN_NOTICE_MS, picked.leadMs);
      if (startMs < now + noticeMs - 60_000) {
        // The minute of slack forgives a slot picked just before the boundary
        // crossed it — refusing a booking the page offered seconds ago reads
        // as the product breaking. lead-time is its own reason so the page can
        // say "order a day ahead" instead of pretending the slot filled up.
        return {
          ok: false,
          reason: startMs < now + MIN_NOTICE_MS - 60_000 ? "slot-taken" : "lead-time",
        };
      }
      if (startMs > now + MAX_AHEAD_MS) return { ok: false, reason: "not-found" };
      // The write holds the invariant itself, exactly like the voice lane:
      // being offered by the slots query is not being bound by it.
      if (!fitsOpenHours(org, startMs, duration, await loadClosures(ctx, org._id))) {
        return { ok: false, reason: "slot-taken" };
      }
    }
    // Skipped for ASAP because every term below is a no-op at duration 0
    // anyway — an ASAP order should not pay for a read that cannot refuse it.
    const rows = asap
      ? []
      : await activeRowsAround(ctx, org._id, startMs, startMs + duration * 60_000);
    if (!asap) {
      const capacity = await orgCapacity(ctx, org._id);
      if (overlapCount(rows, startMs, duration) >= capacity) {
        return { ok: false, reason: "slot-taken" };
      }
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
        // An open ASAP order counts even though its startAt is already in the
        // past (it records placement, not a promise) — without this the brake
        // never sees ASAP orders and one phone could stack them unbounded.
        (row.startAt > now || row.fulfillment?.asap) &&
        (row.status === "scheduled" || row.status === "confirmed"),
    );
    if (allUpcoming.length >= MAX_UPCOMING_PER_PHONE) {
      return { ok: false, reason: "too-many" };
    }
    // Checked here rather than beside the capacity guard above, because until
    // the block just above it we did not know WHO was booking — the form
    // resolves the customer by phone after the slot is validated. Reads from
    // `rows`, not allUpcoming: this window's rows include an appointment that
    // started before now and is still running, which is precisely the one a
    // caller can collide with.
    if (customerConflict(rows, customerId, startMs, duration)) {
      return { ok: false, reason: "customer-busy" };
    }

    // Capped like the note below, and for the same reason: public free text.
    const address =
      fulfillment?.kind === "delivery"
        ? fulfillment.address?.trim().slice(0, 500)
        : undefined;
    const manageToken = crypto.randomUUID();
    const appointmentId = await ctx.db.insert("appointments", {
      orgId: org._id,
      customerId,
      startAt: startMs,
      durationMinutes: duration,
      items: picked.items,
      ...(fulfillment
        ? {
            fulfillment: {
              kind: fulfillment.kind,
              ...(asap ? { asap: true } : {}),
              ...(address ? { address } : {}),
            },
          }
        : {}),
      status: "scheduled",
      source: "booking_page",
      manageToken,
    });
    await syncAppointmentSchedule(ctx, appointmentId);
    await scheduleConfirmationIfConfigured(ctx, org._id, appointmentId);

    // Written LAST, and never fatal. A note is the least important thing this
    // mutation does — the appointment is the point — so nothing about it may
    // cost the customer their slot. hasNoteText is the same emptiness test
    // notes.add uses, so a box the customer tabbed through does not become a
    // blank note on their record.
    //
    // No authorId: they are not a user (schema notes.authorId). Capped because
    // this is a public page and the field is free text; a booking note is a
    // sentence, and the cap is a brake rather than a rule about length.
    const note = args.note?.trim().slice(0, 1000) ?? "";
    if (hasNoteText(note)) {
      await ctx.db.insert("notes", {
        orgId: org._id,
        customerId,
        body: note,
      });
    }
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
  // The link dies with its customer. Their appointments are deleted with
  // them, but between the request and the sweep the token still resolves.
  if (!liveCustomer(await ctx.db.get(appointment.customerId))) return null;
  const org = await ctx.db.get(appointment.orgId);
  if (!org) return null;
  return { appointment, org };
}

export const manage = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      orgName: v.string(),
      // The salon's logo, resolved to a URL — null when never uploaded. Not
      // drawn on this page: it is the FAVICON. A customer reaches here from a
      // link inside a message, and a browser tab wearing our mark tells them
      // nothing about whose appointment they are looking at.
      logoUrl: v.union(v.string(), v.null()),
      timezone: v.string(),
      language: v.string(),
      startAt: v.number(),
      durationMinutes: v.number(),
      status: v.string(),
      services: v.array(v.string()),
      // Present on goods-only orders. The page swaps its appointment words
      // for order words on this alone, and an asap order shows the promise
      // ("as soon as possible") rather than the minute it was placed.
      fulfillment: v.optional(
        v.object({
          kind: v.union(v.literal("pickup"), v.literal("delivery")),
          asap: v.optional(v.boolean()),
          address: v.optional(v.string()),
        }),
      ),
      // The org's public slug and the line's serviceId used to ride along for
      // the reschedule picker. slotsForToken made both unnecessary, and this
      // is an unauthenticated endpoint: what it stops needing, it stops
      // returning (the forms.ts doctrine).
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
    return {
      orgName: org.name,
      logoUrl: org.logoStorageId
        ? await ctx.storage.getUrl(org.logoStorageId)
        : null,
      timezone: org.timezone,
      language: org.language,
      startAt: appointment.startAt,
      durationMinutes:
        appointment.durationMinutes ??
        appointment.items?.reduce((sum, item) => sum + item.durationMinutes, 0) ??
        30,
      status: appointment.status,
      services: (appointment.items ?? []).map((item) => item.name),
      ...(appointment.fulfillment ? { fulfillment: appointment.fulfillment } : {}),
      canModify: !providerOwned,
      // The number the salon answers on, for the "call us" fallback.
      phone: (await resolvePublicPhone(ctx, org)) ?? null,
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
    // The assistants' daily cap counts this door too (lib/agentChange.ts,
    // 2026-10-13): every move re-sends the confirmation below, so a page left
    // open under an idle finger would otherwise message the customer as often
    // as it is tapped. One person changing one diary, whichever door.
    const customer = await ctx.db.get(appointment.customerId);
    const now = Date.now();
    if (customer && changesToday(customer.agentChangesAt, now) >= CHANGES_PER_DAY) {
      return { ok: false, reason: "too-many-changes" };
    }
    const duration =
      appointment.durationMinutes ??
      appointment.items?.reduce((sum, item) => sum + item.durationMinutes, 0) ??
      30;
    const noticeMs = Math.max(MIN_NOTICE_MS, await goodsLeadMs(ctx, appointment));
    if (args.startMs < now + noticeMs - 60_000) {
      return {
        ok: false,
        reason: args.startMs < now + MIN_NOTICE_MS - 60_000 ? "slot-taken" : "lead-time",
      };
    }
    if (args.startMs > now + MAX_AHEAD_MS) return { ok: false, reason: "not-found" };
    if (!fitsOpenHours(org, args.startMs, duration, await loadClosures(ctx, org._id))) {
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
    // Nor may it land on top of this customer's OTHER appointment. Capacity
    // would allow it in any salon with a second chair, and the person cannot
    // be in both.
    if (
      customerConflict(
        rows,
        appointment.customerId,
        args.startMs,
        duration,
        appointment._id,
      )
    ) {
      return { ok: false, reason: "customer-busy" };
    }
    await ctx.db.patch(appointment._id, {
      startAt: args.startMs,
      // Choosing a minute retires the ASAP promise: the order is now FOR that
      // time, and startAt goes back to meaning what it means everywhere else.
      ...(appointment.fulfillment?.asap
        ? {
            fulfillment: {
              kind: appointment.fulfillment.kind,
              ...(appointment.fulfillment.address
                ? { address: appointment.fulfillment.address }
                : {}),
            },
          }
        : {}),
      icsSequence: (appointment.icsSequence ?? 0) + 1,
    });
    await syncAppointmentSchedule(ctx, appointment._id);
    if (customer) {
      await ctx.db.patch(customer._id, {
        agentChangesAt: withChange(customer.agentChangesAt, now),
      });
    }
    // The confirmation goes again with the new time. Its ICS rides the same
    // UID (the appointment id) at a bumped SEQUENCE, so the customer's
    // calendar entry MOVES rather than gaining a twin or keeping the old slot.
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
    // Counted like a move (see reschedule above), but NEVER refused: a
    // customer's own cancel is always theirs to make, past the cap or not
    // (2026-10-13). The count still stops a cancel-and-rebook loop, because
    // the assistants refuse the rebooking once it is spent.
    const customer = await ctx.db.get(appointment.customerId);
    const now = Date.now();
    if (customer) {
      await ctx.db.patch(customer._id, {
        agentChangesAt: withChange(customer.agentChangesAt, now),
      });
    }
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

// Just the two facts a browser tab needs. Separate from `page` because it is
// read by generateMetadata on the SERVER, once per page load, before anything
// renders — dragging the service list, the prices and the opening hours
// through that round trip to print a title would put the whole booking
// payload on the critical path twice.
//
// Answers for an org whose booking page is switched OFF, unlike `page`. The
// tab title is not a booking; refusing to name the salon on the page that
// tells their customer to call instead is a worse answer than saying nothing.
export const brand = query({
  args: { slug: v.string() },
  returns: v.union(
    v.object({
      orgName: v.string(),
      logoUrl: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    if (!slug) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .unique();
    if (!org) return null;
    return {
      orgName: org.name,
      logoUrl: org.logoStorageId ? await ctx.storage.getUrl(org.logoStorageId) : null,
    };
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
    // Normally already settled: orgs.update keeps the slug derived from the
    // business name, so by the time anyone flips this switch the page has an
    // address that matches the sign above the door. This is the legacy path —
    // an org with no slug at all, or one still carrying the name it had the
    // day the switch first went on. It fills or corrects a blank; it does not
    // decide anything, which is why it suffixes on a clash rather than
    // refusing a switch the owner is entitled to flip.
    const current = org.publicSlug;
    const slug =
      current && slugMatchesName(current, org.name)
        ? current
        : await assignPublicSlug(ctx, orgId, org.name);
    await ctx.db.patch(orgId, { bookingEnabled: true, publicSlug: slug });
    return slug;
  },
});
