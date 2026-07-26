import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Dev-only demo data: 20 Turkish salon customers, services, a week of
// appointments in both directions, and a believable message history. Run
// against the dev deployment with:
//
//   npx convex run devSeed:seed
//
// Never wired to a cron or deploy — seeds are DATA (Nudge convention). Targets
// the first org unless orgId is passed. Refuses to run twice unless force.

const FIRST_NAMES = [
  "Ayşe", "Fatma", "Zeynep", "Elif", "Meryem", "Emine", "Hatice", "Merve",
  "Selin", "Deniz", "Mehmet", "Mustafa", "Ahmet", "Emre", "Burak", "Can",
  "Cem", "Kerem", "Serkan", "Tolga",
];
const LAST_NAMES = [
  "Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Öztürk", "Aydın", "Arslan",
  "Doğan", "Kılıç", "Aslan", "Çetin", "Koç", "Kurt", "Özdemir", "Şimşek",
  "Polat", "Erdoğan", "Yıldız", "Güneş",
];
// Prices in minor units — 35000 is ₺350,00, the same integer the real app
// stores. Seeding round floats here would hide exactly the bug the integer
// choice exists to prevent.
const SERVICES: { name: string; durationMinutes: number; price: number }[] = [
  { name: "Saç kesimi", durationMinutes: 30, price: 35000 },
  { name: "Sakal tıraşı", durationMinutes: 15, price: 15000 },
  { name: "Saç boyama", durationMinutes: 90, price: 120000 },
  { name: "Manikür", durationMinutes: 45, price: 50000 },
  { name: "Cilt bakımı", durationMinutes: 60, price: 80000 },
];
const STAFF = ["Hülya", "Murat", "Ebru"];

// Voice calls. Seeded because the call lane is otherwise the one channel with
// no sample data, which meant its UI could only ever be checked against an
// empty state. Shapes match what the Retell webhook writes.
const CALLS = [
  {
    outcome: "Randevu alındı",
    summary:
      "Müşteri cumartesi için saç kesimi randevusu istedi. 14:00 uygun bulundu ve onaylandı.",
    transcript:
      "Ajan: Merhaba, Autotakt. Size nasıl yardımcı olabilirim?\nMüşteri: Cumartesi saç kesimi için yer var mı?\nAjan: 14:00 uygun görünüyor, ayarlayayım mı?\nMüşteri: Olur, teşekkürler.",
    durationSec: 95,
  },
  {
    outcome: "Cevapsız",
    summary: "Müşteri açmadı, sesli mesaj bırakıldı.",
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
      for (const row of [...messages, ...calls, ...appointments, ...olderCustomers]) {
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
      const phone = `+9053${String(20000000 + i * 1234567).slice(0, 8)}`;
      const consented = i % 5 !== 4; // 4 of 20 without consent — the pill shows
      const customerId = await ctx.db.insert("customers", {
        orgId: org._id,
        firstName,
        lastName,
        phone,
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
        appointmentCount++;

        // Message history for consented customers.
        if (consented) {
          await ctx.db.insert("messages", {
            orgId: org._id,
            customerId,
            appointmentId,
            direction: "out",
            kind: "confirmation",
            templateName: "randevu_onay",
            body: `Merhaba ${firstName}! ${org.name || "Salon"} randevunuz oluşturuldu.`,
            status: i % 6 === 5 ? "failed" : i % 2 === 0 ? "read" : "delivered",
            error: i % 6 === 5 ? "wa-not-configured" : undefined,
            wamid: `wamid.seed.${i}.${r}.conf`,
          });
          messageCount++;
          if (reminded) {
            await ctx.db.insert("messages", {
              orgId: org._id,
              customerId,
              appointmentId,
              direction: "out",
              kind: "reminder_24h",
              templateName: "randevu_hatirlatma",
              body: `Merhaba ${firstName}! Yarınki randevunuzu hatırlatırız.`,
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
              body: "Evet, onaylıyorum 👍",
              status: "received",
              wamid: `wamid.seed.${i}.${r}.in`,
            });
            messageCount++;
          }
        }
      }

      // Every fifth customer also rang. Enough to populate the call tab for a
      // handful of records without making voice look like the main channel,
      // which it isn't.
      if (i % 5 === 0) {
        for (const [index, call] of CALLS.entries()) {
          await ctx.db.insert("calls", {
            orgId: org._id,
            customerId,
            direction: index === 0 ? "inbound" : "outbound",
            fromNumber: phone,
            startedAt: now - (i + index + 1) * HOUR,
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
