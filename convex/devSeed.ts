import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";

// Dev-only demo data: 20 English salon customers, services, a week of
// appointments in both directions, and a believable message history. Run
// against the dev deployment with:
//
//   npx convex run devSeed:seed
//
// Internal rather than app-facing — seeds are DATA (Nudge convention). The
// public demo reset calls it explicitly; CLI use targets the first org unless
// orgId is passed. Refuses to run twice unless force.

const FIRST_NAMES = [
  "Emily", "Olivia", "Sophia", "Amelia", "Charlotte", "Ava", "Mia", "Lily",
  "Grace", "Chloe", "James", "Oliver", "Henry", "Noah", "Jack", "Daniel",
  "Leo", "Ethan", "Lucas", "Benjamin",
];
const LAST_NAMES = [
  "Carter", "Wilson", "Bennett", "Hughes", "Parker", "Collins", "Reed", "Morgan",
  "Foster", "Bailey", "Turner", "Cooper", "Ward", "Murphy", "Brooks", "Hayes",
  "Price", "Graham", "Bell", "Adams",
];
// Prices in minor units — 5500 is £55.00, the same integer the real app
// stores. Seeding round floats here would hide exactly the bug the integer
// choice exists to prevent.
const SERVICES: { name: string; durationMinutes: number; price: number }[] = [
  { name: "Haircut", durationMinutes: 45, price: 5500 },
  { name: "Blow-dry", durationMinutes: 45, price: 4500 },
  { name: "Hair colour", durationMinutes: 120, price: 14500 },
  { name: "Manicure", durationMinutes: 45, price: 4000 },
  { name: "Facial", durationMinutes: 60, price: 8500 },
];
const STAFF = ["Sophie Bennett", "Mia Collins", "Daniel Brooks"];

// Voice calls. Seeded because the call lane is otherwise the one channel with
// no sample data, which meant its UI could only ever be checked against an
// empty state. Shapes match what the Retell webhook writes.
const CALLS = [
  {
    outcome: "Appointment booked",
    summary:
      "The customer asked for a Saturday haircut. The 2:00 PM slot was available and confirmed.",
    transcript:
      "Agent: Hello, Moda Hair Salon. How can I help?\nCustomer: Do you have any time for a haircut on Saturday?\nAgent: We have 2:00 PM available. Shall I book that for you?\nCustomer: Yes, please. Thank you.",
    durationSec: 95,
  },
  {
    outcome: "No answer",
    summary: "The customer did not answer, so a voicemail was left.",
    transcript: undefined,
    durationSec: 18,
  },
];

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
            : { price: fixture.price }),
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

    for (let i = 0; i < 20; i++) {
      const firstName = FIRST_NAMES[i];
      const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length];
      // Ofcom reserves +44 7700 900xxx for fictional use.
      const phone = `+447700900${String(100 + i).slice(-3)}`;
      const consented = i % 5 !== 4; // 4 of 20 without consent — the pill shows
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
        consentAt: consented ? now - (i + 1) * DAY : undefined,
        lastInboundAt: i % 3 === 0 ? now - (i % 5) * HOUR : undefined,
      });

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
        const reminded = upcoming && startAt - now < DAY && consented;
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
          source: i % 4 === 0 ? "calcom" : "manual",
          reminderSentOffsets: reminded ? [24] : undefined,
          confirmationSentAt: consented ? startAt - 2 * DAY : undefined,
        });
        await syncAppointmentSchedule(ctx, appointmentId);
        appointmentCount++;

        // Message history for consented customers.
        if (consented) {
          await ctx.db.insert("messages", {
            orgId: org._id,
            customerId,
            appointmentId,
            direction: "out",
            kind: "confirmation",
            templateName: "appointment_confirmation",
            body: `Hello ${firstName}! Your appointment at ${org.name || "the salon"} is booked.`,
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
              body: `Hello ${firstName}! Just a reminder about your appointment tomorrow.`,
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
          body: `Hello ${firstName},\n\nYour appointment at ${org.name || "the salon"} is confirmed. Reply to this email if you need to move it.\n\nSee you soon.`,
          emailSubject: "Your appointment is confirmed",
          emailFrom: `hello@${(org.publicSlug || "salon")}.example.com`,
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
              ? "Thanks — could I move it to Friday afternoon instead?"
              : "Perfect, see you then.",
          emailSubject: "Re: Your appointment is confirmed",
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
            body: `Hello ${firstName}, a reminder about your appointment tomorrow.`,
            emailSubject: "Reminder: your appointment tomorrow",
            emailFrom: `hello@${(org.publicSlug || "salon")}.example.com`,
            occurredAt: now - ((i % 5) * 15 + 5) * 60_000,
            status: "failed",
            error: "smtp-bounce",
          });
          messageCount++;
        }
      }

      // Every fifth customer also rang. Enough to populate the call tab for a
      // handful of records without making voice look like the main channel,
      // which it isn't.
      //
      // Placed in the last half hour, and NEWER than that customer's messages,
      // because the inbox row draws only the newest entry — an hours-old call
      // behind a minutes-old email is invisible there, so the call lane could
      // be seeded and still leave the list with nothing to show for it. Which
      // of the pair is newer alternates, so the list carries both an inbound
      // and an outbound call rather than four of the same arrow.
      if (i % 5 === 0) {
        for (const [index, call] of CALLS.entries()) {
          await ctx.db.insert("calls", {
            orgId: org._id,
            customerId,
            direction: index === 0 ? "inbound" : "outbound",
            fromNumber: phone,
            startedAt:
              now - ((i % 10 === 0 ? index : 1 - index) * 7 + 7 + i) * 60_000,
            durationSec: call.durationSec,
            outcome: call.outcome,
            summary: call.summary,
            ...(call.transcript ? { transcript: call.transcript } : {}),
            retellCallId: `seed-call-${i}-${index}`,
          });
          callCount++;
        }
      }
    }

    return {
      customers: 20,
      appointments: appointmentCount,
      messages: messageCount,
      calls: callCount,
    };
  },
});

// Dev housekeeping. wa.ts used to write a failed row for EVERY send while
// WhatsApp was unconfigured, so a deployment that has been running unconnected
// accumulates one red line per reminder per customer — a conversation history
// made entirely of the org's own setup state. The logging is fixed; this
// clears what the old behaviour left behind.
//
// Scoped to that one cause on purpose. no-consent rows are the KVKK record
// that we correctly did not message somebody and must survive; delivered and
// received messages are the actual history.
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
