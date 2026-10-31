import { v } from "convex/values";
import { syncCustomerSearch } from "./lib/customerSearch";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recomputeThread } from "./lib/thread";
import {
  DEMO_AGENTS,
  DEMO_CALLS,
  DEMO_INBOUND_LINE,
  DEMO_OUTBOUND_LINE,
  DEMO_TESTS,
  demoAgentId,
  type DemoAgentKey,
} from "./lib/demoVoice";

// Demo data for Real Estate Co. (the public showroom, 2026-10-27): 20 English
// customers, the agency's appointment types, a week of viewings and
// valuations in both directions, a believable message history, and the phone
// side: two agents on two lines, their calls, test results and reviews
// (lib/demoVoice). Run against the dev deployment with:
//
//   npx convex run devSeed:seed
//
// Internal rather than app-facing — seeds are DATA (Nudge convention). The
// public demo reset calls it explicitly; CLI use targets the first org unless
// orgId is passed. Refuses to run twice unless force.

// demoVoice's calls and tests name customers by index into this list.
const FIRST_NAMES = [
  "Emily", "Olivia", "Sophia", "Amelia", "Charlotte", "Daniel", "Mia", "Lily",
  "Grace", "Chloe", "Leo", "Oliver", "Lucas", "Noah", "Henry", "Hannah",
  "James", "Jack", "Ethan", "Benjamin",
];
const LAST_NAMES = [
  "Carter", "Wilson", "Bennett", "Hughes", "Parker", "Collins", "Reed", "Morgan",
  "Foster", "Bailey", "Turner", "Cooper", "Ward", "Murphy", "Brooks", "Hayes",
  "Price", "Graham", "Bell", "Adams",
];
// An agency charges commission on the sale, not per visit, so these carry no
// price: the takings column stays empty rather than inventing a fee.
const SERVICES: { name: string; durationMinutes: number; price?: number }[] = [
  { name: "Property viewing", durationMinutes: 30 },
  { name: "Second viewing", durationMinutes: 30 },
  { name: "Market valuation", durationMinutes: 60 },
  { name: "Mortgage consultation", durationMinutes: 45 },
  { name: "Tenancy signing", durationMinutes: 45 },
];
const STAFF = ["Sophie Bennett", "Marcus Reid", "Priya Shah"];

export const seed = internalMutation({
  args: { orgId: v.optional(v.id("orgs")), force: v.optional(v.boolean()) },
  returns: v.object({
    customers: v.number(),
    appointments: v.number(),
    messages: v.number(),
    calls: v.number(),
  }),
  handler: async (ctx, args) => {
    const org = args.orgId
      ? await ctx.db.get(args.orgId)
      : await ctx.db.query("orgs").first();
    if (!org) throw new Error("no-org — sign in once first");

    const existing = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .first();
    if (existing && !args.force) throw new Error("already-seeded (pass force:true)");

    // force means RESEED, not "seed again on top". Without this it stacked a
    // second copy of every customer and appointment onto the first, which is
    // never what anyone passing the flag wanted.
    if (args.force) {
      // Listed one by one rather than looped over a table-name array: Convex
      // types each index per table, so the loop version loses the type and
      // would happily accept a table that has no by_org.
      const orgId = org._id;
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      const calls = await ctx.db
        .query("calls")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      // appointments indexes on (orgId, startAt) rather than orgId alone —
      // an org-only index would duplicate the prefix of this one.
      const appointments = await ctx.db
        .query("appointments")
        .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
        .collect();
      const olderCustomers = await ctx.db
        .query("customers")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      const olderServices = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      const olderStaff = await ctx.db
        .query("staff")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      for (const row of [...messages, ...calls, ...appointments, ...olderCustomers]) {
        await ctx.db.delete(row._id);
      }
      await clearDemoVoice(ctx, orgId);
      // Appointments are gone first, so their service and staff references no
      // longer point at rows we are about to replace with the canonical demo.
      for (const row of [...olderServices, ...olderStaff]) {
        await ctx.db.delete(row._id);
      }
    }

    // Services (idempotent-ish: only when none exist)
    const hasServices = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .first();
    const serviceIds: Id<"services">[] = [];
    if (!hasServices) {
      for (const service of SERVICES) {
        serviceIds.push(
          await ctx.db.insert("services", { orgId: org._id, ...service, active: true }),
        );
      }
    } else {
      // Load what is already there. Without this branch a reseed onto an org
      // that already had services left every appointment with an EMPTY line
      // set — no service name on the calendar, and nothing for the takings to
      // add up. Same shape as the staff branch below.
      const existingServices = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      serviceIds.push(...existingServices.map((service) => service._id));
    }

    // Staff rows, same idempotent shape as services. Seeded as real rows
    // rather than names on the appointment: the week view lanes on staffId,
    // and a seed that wrote free text would be seeding a bug.
    const hasStaff = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .first();
    const staffIds: Id<"staff">[] = [];
    if (!hasStaff) {
      for (const [order, name] of STAFF.entries()) {
        staffIds.push(
          await ctx.db.insert("staff", { orgId: org._id, name, order, active: true }),
        );
      }
    } else {
      const existing = await ctx.db
        .query("staff")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      staffIds.push(...existing.map((person) => person._id));
    }

    // Snapshot lines from the live service rows where they exist, falling
    // back to the fixture when this is a fresh org. Reading the constant
    // unconditionally would stamp fixture prices onto an org that has since
    // repriced its own services.
    const liveServices = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const seedItemsFor = (index: number) => {
      const id = serviceIds[index];
      if (!id) return [];
      const live = liveServices.find((service) => service._id === id);
      const fixture = SERVICES[index];
      return [
        {
          serviceId: id,
          name: live?.name ?? fixture.name,
          ...(live
            ? live.price !== undefined
              ? { price: live.price }
              : {}
            : fixture.price !== undefined
              ? { price: fixture.price }
              : {}),
          durationMinutes: live?.durationMinutes ?? fixture.durationMinutes,
        },
      ];
    };

    const now = Date.now();
    const HOUR = 3600_000;
    let callCount = 0;
    const DAY = 24 * HOUR;
    let appointmentCount = 0;
    let messageCount = 0;

    const customerIds: Id<"customers">[] = [];
    const phones: string[] = [];
    for (let i = 0; i < 20; i++) {
      const firstName = FIRST_NAMES[i];
      const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length];
      // Ofcom reserves +44 7700 900xxx for fictional use.
      const phone = `+447700900${String(100 + i).slice(-3)}`;
      // 4 of 20 unsubscribed from marketing, so the record's switch shows
      // on somebody. They still get every booking message.
      const unsubscribed = i % 5 === 4;
      const customerId = await ctx.db.insert("customers", {
        orgId: org._id,
        firstName,
        lastName,
        phone,
        // RFC 2606 reserves example.com, so nothing here can reach a real
        // inbox even if a seeded row somehow reached a send path. Two of the
        // twenty stay without one: an email lane with no address is a state
        // the contact card has to draw, and a seed where everybody is
        // reachable never shows it.
        ...(i % 10 === 9 ? {} : { email: `${firstName}.${lastName}@example.com`.toLowerCase() }),
        marketingEmailOptOutAt: unsubscribed ? now - (i + 1) * DAY : undefined,
        lastInboundAt: i % 3 === 0 ? now - (i % 5) * HOUR : undefined,
      });
      await syncCustomerSearch(ctx, customerId);
      customerIds.push(customerId);
      phones.push(phone);

      // 1–2 appointments per customer: mostly upcoming week, some history.
      const rounds = i % 3 === 0 ? 2 : 1;
      for (let r = 0; r < rounds; r++) {
        const upcoming = (i + r) % 4 !== 3;
        // Business hours: 10:00–19:00-ish slots on the org's day grid.
        const dayOffset = upcoming ? (i % 6) + (r === 1 ? 1 : 0) : -((i % 5) + 1);
        const slotHour = 10 + ((i * 3 + r * 5) % 9);
        const dayStart = new Date(now + dayOffset * DAY);
        dayStart.setHours(slotHour, (i % 2) * 30, 0, 0);
        const startAt = dayStart.getTime();
        const serviceIdx = (i + r) % SERVICES.length;
        const status = upcoming
          ? i % 3 === 0
            ? ("confirmed" as const)
            : ("scheduled" as const)
          : i % 4 === 0
            ? ("no_show" as const)
            : i % 4 === 1
              ? ("cancelled" as const)
              : ("completed" as const);
        const reminded = upcoming && startAt - now < DAY;
        const appointmentId = await ctx.db.insert("appointments", {
          orgId: org._id,
          customerId,
          items: seedItemsFor(serviceIdx),
          ...(staffIds.length
            ? { staffId: staffIds[i % staffIds.length] }
            : {}),
          startAt,
          durationMinutes: SERVICES[serviceIdx].durationMinutes,
          status,
          // One in four came in through the phone agent, so the calendar
          // shows where its bookings land.
          source: i % 4 === 0 ? "voice" : "manual",
          reminderSentOffsets: reminded ? [24] : undefined,
          confirmationSentAt: startAt - 2 * DAY,
        });
        await syncAppointmentSchedule(ctx, appointmentId);
        appointmentCount++;

        // Message history: every customer got their confirmation.
        await ctx.db.insert("messages", {
          orgId: org._id,
          customerId,
          appointmentId,
          direction: "out",
          kind: "confirmation",
          templateName: "appointment_confirmation",
          body: `Hi ${firstName}, your ${SERVICES[serviceIdx].name.toLowerCase()} with ${org.name || "us"} is booked.`,
          // WITHOUT this every seeded row shares one _creationTime — the
          // whole seed lands in a single transaction — so the inbox had no
          // order to sort by and drew twenty conversations all stamped the
          // same minute. Clamped below `now` because an appointment two
          // weeks out would otherwise stamp its confirmation in the future.
          occurredAt: Math.min(startAt - 2 * DAY, now - (i + 3) * HOUR),
          status: i % 6 === 5 ? "failed" : i % 2 === 0 ? "read" : "delivered",
          error: i % 6 === 5 ? "wa-not-configured" : undefined,
          wamid: `wamid.seed.${i}.${r}.conf`,
          // Some customers answer a confirmation with an emoji instead of a
          // word. Seeded because the reaction pill hangs off a bubble corner
          // and overlaps its neighbours' spacing — a state you cannot check
          // by reading the JSX, only by looking at a thread that has one.
          ...(i % 3 === 0 ? { reactionEmoji: "👍" } : {}),
        });
        messageCount++;
        if (reminded) {
          await ctx.db.insert("messages", {
            orgId: org._id,
            customerId,
            appointmentId,
            direction: "out",
            kind: "reminder_24h",
            templateName: "appointment_reminder",
            body: `Hi ${firstName}, a reminder about your ${SERVICES[serviceIdx].name.toLowerCase()} tomorrow. Reply here if you need to move it.`,
            occurredAt: Math.min(startAt - DAY, now - (i + 2) * HOUR),
            status: "delivered",
            wamid: `wamid.seed.${i}.${r}.rem`,
          });
          messageCount++;
        }
        if (status === "confirmed") {
          await ctx.db.insert("messages", {
            orgId: org._id,
            customerId,
            direction: "in",
            kind: "reply",
            body: "Yes, I’ll be there 👍",
            occurredAt: Math.min(startAt - DAY + HOUR, now - (i + 1) * HOUR),
            status: "received",
            wamid: `wamid.seed.${i}.${r}.in`,
            // The other direction: the salon acknowledging with an emoji
            // rather than spending a message on "great, see you then".
            ...(i % 4 === 1 ? { reactionEmoji: "❤️" } : {}),
          });
          messageCount++;
        }
      }

      // Email, both ways. The seed had none, so the whole email lane — the
      // thread view, the inbox row, the subject line, the reply attribution —
      // could only ever be looked at against an empty state. `email_` IS the
      // channel marker (messages.channelOfMessage); rename the kind and these
      // rows move to WhatsApp.
      //
      // The TIMES are the point, not the volume. Which channel spoke last is
      // what the inbox row draws, so they are placed to give the list a mix
      // rather than twenty identical WhatsApp lines: one customer in three has
      // email as their newest entry, and a couple carry a failed send as the
      // newest thing of all, which is the one case that draws the red ✕.
      if (i % 10 !== 9) {
        const address = `${firstName}.${lastName}@example.com`.toLowerCase();
        await ctx.db.insert("messages", {
          orgId: org._id,
          customerId,
          direction: "out",
          kind: "email_confirmation",
          body: `Hi ${firstName},\n\nYou're booked in with ${org.name || "us"}. Reply to this email if you need to move it.\n\nSee you soon.`,
          emailSubject: "You're booked in",
          emailFrom: `hello@${(org.publicSlug || "agency")}.example.com`,
          emailId: `seed-email-${i}-out`,
          occurredAt: now - (i + 8) * HOUR,
          status: i % 4 === 0 ? "read" : "delivered",
        });
        messageCount++;

        await ctx.db.insert("messages", {
          orgId: org._id,
          customerId,
          direction: "in",
          kind: "email_reply",
          body:
            i % 2 === 0
              ? "Thanks. Could we do Friday afternoon instead?"
              : "Perfect, see you there.",
          emailSubject: "Re: You're booked in",
          emailFrom: address,
          emailId: `seed-email-${i}-in`,
          // Newest thing this customer did, for one in three — so the inbox
          // has email rows to draw and not only WhatsApp.
          occurredAt:
            i % 3 === 0
              ? now - ((i % 4) * 20 + 30) * 60_000
              : now - (i + 6) * HOUR,
          status: "received",
        });
        messageCount++;

        // A send that did not go out, as the NEWEST entry. This is the only
        // shape that renders the row's red ✕, and without one in the seed that
        // marker has nothing to appear on.
        if (i % 6 === 3) {
          await ctx.db.insert("messages", {
            orgId: org._id,
            customerId,
            direction: "out",
            kind: "email_reminder_24h",
            body: `Hi ${firstName}, a reminder about your appointment with us tomorrow.`,
            emailSubject: "Reminder: see you tomorrow",
            emailFrom: `hello@${(org.publicSlug || "agency")}.example.com`,
            occurredAt: now - ((i % 5) * 15 + 5) * 60_000,
            status: "failed",
            error: "smtp-bounce",
          });
          messageCount++;
        }
      }

      // Seeds write rows directly, so the summary the inbox reads is rebuilt
      // here rather than by each insert (lib/thread.ts).
      await recomputeThread(ctx, customerId);
    }

    // Two callers who rang and never said their name: the list, the record
    // and the Inbox show their number where the name goes. Their only trace
    // is a call (demoVoice, indices 20 and 21), so no appointments.
    for (const phone of ["+447700900140", "+447700900141"]) {
      const customerId = await ctx.db.insert("customers", {
        orgId: org._id,
        firstName: "",
        phone,
        lastInboundAt: now - HOUR,
      });
      await syncCustomerSearch(ctx, customerId);
      customerIds.push(customerId);
      phones.push(phone);
    }

    callCount = await seedDemoVoice(ctx, org._id, customerIds, phones, now);

    return {
      customers: customerIds.length,
      appointments: appointmentCount,
      messages: messageCount,
      calls: callCount,
    };
  },
});

// Two WhatsApp conversations worth LOOKING at, on a named org — every bubble
// state the thread can draw, in Turkish, so the chat pane can be judged
// against real-looking traffic instead of an empty state (Serdar,
// 2026-08-31). Dedicated preview customers rather than rows on real ones, so
// clearing them is deleting two contacts. Idempotent per customer: a thread
// already seeded is left alone. Run with:
//
//   npx convex run devSeed:seedWhatsappThreads '{"orgId":"<org id>"}'
export const seedWhatsappThreads = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    let inserted = 0;

    type Spec = {
      dir: "in" | "out";
      kind: string;
      body: string;
      at: number;
      status: "sent" | "delivered" | "read" | "received";
      templateName?: string;
      reactionEmoji?: string;
      quoteOf?: number; // index of the earlier spec this one swipe-replies to
    };

    const seedThread = async (
      person: { firstName: string; lastName: string; phone: string },
      specs: Spec[],
    ) => {
      let customer = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) =>
          q.eq("orgId", args.orgId).eq("phone", person.phone),
        )
        .unique();
      if (!customer) {
        const id = await ctx.db.insert("customers", {
          orgId: args.orgId,
          firstName: person.firstName,
          lastName: person.lastName,
          phone: person.phone,
          language: "tr",
        });
        await syncCustomerSearch(ctx, id);
        customer = await ctx.db.get(id);
      }
      if (!customer) return;
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_customer", (q) => q.eq("customerId", customer!._id))
        .take(50);
      if (existing.some((m) => m.wamid?.startsWith("wamid.wa-seed"))) return;

      const wamids: string[] = [];
      let lastInboundAt = customer.lastInboundAt;
      for (const [index, spec] of specs.entries()) {
        const wamid = `wamid.wa-seed.${person.phone}.${index}`;
        wamids.push(wamid);
        const quoted = spec.quoteOf !== undefined ? specs[spec.quoteOf] : null;
        await ctx.db.insert("messages", {
          orgId: args.orgId,
          customerId: customer._id,
          direction: spec.dir,
          kind: spec.kind,
          body: spec.body,
          templateName: spec.templateName,
          occurredAt: spec.at,
          status: spec.status,
          wamid,
          lane: "cloud",
          ...(spec.reactionEmoji ? { reactionEmoji: spec.reactionEmoji } : {}),
          ...(quoted
            ? {
                replyToWamid: wamids[spec.quoteOf!],
                replyToBody: quoted.body.slice(0, 200),
                replyToDirection: quoted.dir,
              }
            : {}),
        });
        inserted++;
        if (spec.dir === "in") lastInboundAt = spec.at;
      }
      // The window the newest inbound opened, so the composer is LIVE on the
      // seeded thread rather than parked on "24h window closed".
      await ctx.db.patch(customer._id, {
        lastInboundAt,
        lastInboundLane: "cloud",
      });
      await recomputeThread(ctx, customer._id);
    };

    // Elif: the long thread — questions both ways, a template confirmation,
    // a button-label reply quoting it, an agent bubble, reactions on both
    // sides, an emoji-only message, and read/delivered ticks throughout.
    await seedThread(
      { firstName: "Elif", lastName: "Yılmaz", phone: "+905301118292" },
      [
        { dir: "in", kind: "reply", body: "Merhaba, saç boyası ve kesim için fiyat alabilir miyim?", at: now - 2 * DAY - 3 * HOUR, status: "received" },
        { dir: "out", kind: "session", body: "Merhaba Elif Hanım! Boya ve kesim birlikte 1.450 TL. Cumartesi için yerimiz var, ister misiniz?", at: now - 2 * DAY - 3 * HOUR + 2 * 60_000, status: "read" },
        { dir: "in", kind: "reply", body: "Cumartesi 14:00 olur mu?", at: now - 2 * DAY - 3 * HOUR + 5 * 60_000, status: "received", reactionEmoji: "👍" },
        { dir: "out", kind: "session", body: "Ayarladım! Cumartesi 14.00'te bekliyoruz 💇‍♀️", at: now - 2 * DAY - 3 * HOUR + 6 * 60_000, status: "read" },
        { dir: "out", kind: "confirmation", templateName: "appointment_confirmation", body: "Merhaba Elif! Bella randevunuzu hatırlatır: Cumartesi 14:00 · Saç boyası + kesim. Gelemeyecekseniz bu mesajı yanıtlamanız yeterli.", at: now - DAY - 8 * HOUR, status: "delivered" },
        { dir: "in", kind: "reply", body: "Onayla", at: now - DAY - 7 * HOUR, status: "received", quoteOf: 4 },
        { dir: "out", kind: "chat_agent", body: "Teşekkürler Elif Hanım, randevunuz onaylandı. Değişiklik olursa yazmanız yeterli 😊", at: now - DAY - 7 * HOUR + 60_000, status: "read" },
        { dir: "in", kind: "reply", body: "Bir de kaş alımı ekleyebilir miyiz?", at: now - 25 * 60_000, status: "received" },
        { dir: "out", kind: "session", body: "Tabii, not ettim. Süre 15 dakika uzayacak, uygun mudur?", at: now - 24 * 60_000, status: "read", reactionEmoji: "👍" },
        { dir: "in", kind: "reply", body: "🙏", at: now - 20 * 60_000, status: "received" },
      ],
    );

    // Murat: the short thread — a reminder, the İptal button, a rebook, and
    // a just-sent reply still on its single grey tick.
    await seedThread(
      { firstName: "Murat", lastName: "Aydın", phone: "+905327764311" },
      [
        { dir: "out", kind: "reminder_24h", templateName: "appointment_reminder", body: "Merhaba Murat! Yarın 11:00 saç + sakal randevunuzu hatırlatırız.", at: now - 3 * DAY - 2 * HOUR, status: "delivered" },
        { dir: "in", kind: "reply", body: "İptal", at: now - 3 * DAY - HOUR, status: "received", quoteOf: 0 },
        { dir: "out", kind: "session", body: "Anladım, iptal ettim. Yeni bir gün isterseniz buradayım.", at: now - 3 * DAY - HOUR + 2 * 60_000, status: "delivered" },
        { dir: "in", kind: "reply", body: "Merhaba, yarın öğleden sonra boş var mı?", at: now - 2 * HOUR, status: "received" },
        { dir: "out", kind: "session", body: "Yarın 15:30 uygun, ayırayım mı?", at: now - 2 * HOUR + 3 * 60_000, status: "sent" },
      ],
    );

    return inserted;
  },
});

// Dev housekeeping. wa.ts used to write a failed row for EVERY send while
// WhatsApp was unconfigured, so a deployment that has been running unconnected
// accumulates one red line per reminder per customer — a conversation history
// made entirely of the org's own setup state. The logging is fixed; this
// clears what the old behaviour left behind.
//
// Scoped to that one cause on purpose. unsubscribed rows (and the no-consent
// rows from before 2026-10-21) are the record that we correctly did not
// message somebody and must survive; delivered and received messages are the
// actual history.
export const clearSetupFailures = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("messages").take(2000);
    let removed = 0;
    for (const row of rows) {
      if (row.status !== "failed") continue;
      const reason = row.error ?? "";
      if (reason !== "wa-not-configured" && !reason.startsWith("no-approved-template")) {
        continue;
      }
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return removed;
  },
});

// Walk the onboarding wizard again. Blanks the org's name — the gate
// condition, so the app renders the wizard on next load — and clears the
// stored industry answer. Internal, so only a deploy key reaches it; meant
// for dev.
//
//   npx convex run devSeed:resetOnboarding '{}'
//
// Leaves everything else alone by default. Pass wipe:true to also clear the
// catalog and knowledge (services, contact fields, knowledge blocks, number
// requests) so the prefilled path can be watched seeding a clean slate.
export const resetOnboarding = internalMutation({
  args: { orgId: v.optional(v.id("orgs")), wipe: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = args.orgId
      ? await ctx.db.get(args.orgId)
      : await ctx.db.query("orgs").first();
    if (!org) throw new Error("no-org — sign in once first");
    await ctx.db.patch(org._id, { name: "", industry: undefined });
    if (args.wipe) {
      const services = await ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const row of services) await ctx.db.delete(row._id);
      const fields = await ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const row of fields) await ctx.db.delete(row._id);
      const knowledge = await ctx.db
        .query("knowledge")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const row of knowledge) await ctx.db.delete(row._id);
      const requests = await ctx.db
        .query("numberRequests")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const row of requests) {
        await ctx.storage.delete(row.storageId);
        await ctx.db.delete(row._id);
      }
    }
    return null;
  },
});

// Undo resetOnboarding without walking the wizard: put the name back, and
// with it the app. Internal, dev tooling.
//   npx convex run devSeed:setOrgName '{"orgId":"...","name":"Barberio"}'
export const setOrgName = internalMutation({
  args: { orgId: v.id("orgs"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orgId, { name: args.name.trim() });
    return null;
  },
});

// The phone side of the showroom. Removes what the last seed left first, so a
// reseed never stacks a second copy of an agent.
async function clearDemoVoice(ctx: MutationCtx, orgId: Id<"orgs">) {
  const agents = await ctx.db
    .query("retellAgents")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const lines = await ctx.db
    .query("agentLines")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  for (const row of [...agents, ...lines]) await ctx.db.delete(row._id);
  for (const agent of agents) {
    const tests = await ctx.db
      .query("agentTests")
      .withIndex("by_org_agent_started", (q) =>
        q.eq("orgId", orgId).eq("retellAgentId", agent.retellAgentId),
      )
      .collect();
    for (const row of tests) await ctx.db.delete(row._id);
  }
}

// Two agents on two lines, then their calls, tests and reviews, all as the
// webhook and the Testing tab would have written them. Returns the call
// count. Only ever reached for a demo org: every id here is fake and the
// provider has never heard of it.
async function seedDemoVoice(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  customerIds: Id<"customers">[],
  phones: string[],
  now: number,
): Promise<number> {
  const org = await ctx.db.get(orgId);
  if (org?.demoMode !== true) return 0;
  await clearDemoVoice(ctx, orgId);

  const MINUTE = 60_000;
  const keys: DemoAgentKey[] = ["frontDesk", "followUp"];
  for (const key of keys) {
    const agent = DEMO_AGENTS[key];
    const id = demoAgentId(orgId, key);
    const calls = DEMO_CALLS.filter((call) => call.agent === key);
    await ctx.db.insert("retellAgents", {
      orgId,
      retellAgentId: id,
      name: agent.name,
      ...(key === "frontDesk" ? { inboundNumber: DEMO_INBOUND_LINE } : {}),
      enabled: true,
      personaName: agent.persona,
      openers: agent.openers,
      canEndCall: true,
      // What a real agent gets when its tools are wired. Without it the
      // agents table flags the row "not fully connected".
      runtimeConnectedAt: now,
      // Counters as recordCall keeps them, plus a history before the seed.
      callCount: calls.length + (key === "frontDesk" ? 214 : 87),
      lastCallStartedAt: Math.max(...calls.map((call) => now - call.minutesAgo * MINUTE)),
    });
  }
  await ctx.db.insert("agentLines", {
    orgId,
    number: DEMO_INBOUND_LINE,
    nickname: "Office line",
    inboundAgentId: demoAgentId(orgId, "frontDesk"),
  });
  await ctx.db.insert("agentLines", {
    orgId,
    number: DEMO_OUTBOUND_LINE,
    nickname: "Follow-up line",
    outboundAgentId: demoAgentId(orgId, "followUp"),
  });

  const touched = new Set<Id<"customers">>();
  for (const [index, call] of DEMO_CALLS.entries()) {
    const customerId = customerIds[call.customer];
    if (!customerId) continue;
    const startedAt = now - call.minutesAgo * MINUTE;
    const reviewedAt = startedAt + call.durationSec * 1000 + 20 * MINUTE;
    await ctx.db.insert("calls", {
      orgId,
      customerId,
      direction: call.direction,
      fromNumber: phones[call.customer],
      startedAt,
      durationSec: call.durationSec,
      outcome: call.successful ? "true" : "false",
      summary: call.summary,
      ...(call.transcript ? { transcript: call.transcript } : {}),
      retellCallId: `demo-call-${orgId}-${index}`,
      retellAgentId: demoAgentId(orgId, call.agent),
      ...(call.collected ? { collected: call.collected } : {}),
      disconnectionReason: call.disconnectionReason,
      ...(call.review
        ? {
            note: call.review.note,
            verdict: call.review.verdict,
            noteUpdatedAt: Math.min(reviewedAt, now),
            ...(call.review.action
              ? { action: call.review.action, actionUpdatedAt: Math.min(reviewedAt, now) }
              : {}),
            ...(call.review.done ? { doneAt: Math.min(reviewedAt + MINUTE, now) } : {}),
          }
        : {}),
    });
    touched.add(customerId);
  }
  for (const customerId of touched) await recomputeThread(ctx, customerId);

  for (const [index, test] of DEMO_TESTS.entries()) {
    const startedAt = now - test.hoursAgo * 3600_000;
    const endedAt = startedAt + test.durationSec * 1000;
    const reviewedAt = Math.min(endedAt + 10 * MINUTE, now);
    await ctx.db.insert("agentTests", {
      orgId,
      retellAgentId: demoAgentId(orgId, test.agent),
      callId: `demo-test-${orgId}-${index}`,
      direction: test.direction,
      agentVersion: test.version,
      draft: test.draft,
      ...(test.customer !== undefined && customerIds[test.customer]
        ? { customerId: customerIds[test.customer] }
        : {}),
      startedAt,
      endedAt,
      durationSec: test.durationSec,
      outcome: test.successful ? "true" : "false",
      summary: test.summary,
      ...(test.collected ? { collected: test.collected } : {}),
      disconnectionReason: test.disconnectionReason,
      ...(test.actions
        ? {
            actions: test.actions.map((action, step) => ({
              ...action,
              at: startedAt + (step + 1) * 20_000,
            })),
          }
        : {}),
      ...(test.review
        ? {
            note: test.review.note,
            verdict: test.review.verdict,
            noteUpdatedAt: reviewedAt,
            ...(test.review.action
              ? { action: test.review.action, actionUpdatedAt: reviewedAt }
              : {}),
            ...(test.review.done ? { doneAt: reviewedAt } : {}),
          }
        : {}),
    });
  }
  return DEMO_CALLS.length;
}
