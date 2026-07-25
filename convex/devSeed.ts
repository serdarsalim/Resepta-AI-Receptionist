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
const SERVICES: { name: string; durationMinutes: number }[] = [
  { name: "Saç kesimi", durationMinutes: 30 },
  { name: "Sakal tıraşı", durationMinutes: 15 },
  { name: "Saç boyama", durationMinutes: 90 },
  { name: "Manikür", durationMinutes: 45 },
  { name: "Cilt bakımı", durationMinutes: 60 },
];
const STAFF = ["Hülya", "Murat", "Ebru"];

export const seed = internalMutation({
  args: { orgId: v.optional(v.id("orgs")), force: v.optional(v.boolean()) },
  returns: v.object({
    customers: v.number(),
    appointments: v.number(),
    messages: v.number(),
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
    }

    const now = Date.now();
    const HOUR = 3600_000;
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
          serviceId: serviceIds[serviceIdx],
          staffName: STAFF[i % STAFF.length],
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
    }

    return { customers: 20, appointments: appointmentCount, messages: messageCount };
  },
});
