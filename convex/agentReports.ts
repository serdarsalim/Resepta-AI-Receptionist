// Reports for the MCP surface: counted in the database, never by the model.
//
// The whole reason these exist is that a model asked "how did last week go"
// will otherwise reach for search_customers, get a truncated page, and tally
// it. The number it produces looks like an answer and is wrong — quietly, and
// differently every time it is asked. Every count here is computed over the
// full window server-side, and anything that could not be fully scanned says
// so in the payload rather than rounding itself off.
//
// Same door as agentTools.ts, same rule: orgId comes off the key, and every
// read is scoped to it.

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { channelOfMessage } from "./messages";

const DAY = 86_400_000;

function fullName(c: Doc<"customers">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.phone;
}

// messages has no (orgId, time) index — it does not need one, because every
// Convex index is tiebroken by _creationTime, so by_org read newest-first IS
// the time order. What it lacks is a lower bound, hence the cap: read down
// until the window closes or the cap runs out, and say which happened.
const MESSAGE_CAP = 4000;

export const activityReport = internalQuery({
  args: { orgId: v.id("orgs"), days: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, days }) => {
    const span = Math.min(Math.max(days ?? 7, 1), 90);
    const now = Date.now();
    const since = now - span * DAY;

    // ── Appointments, by when they were due ──────────────────────────────────
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", since).lte("startAt", now),
      )
      .collect();
    const apptByStatus: Record<string, number> = {};
    const apptBySource: Record<string, number> = {};
    for (const a of appointments) {
      apptByStatus[a.status] = (apptByStatus[a.status] ?? 0) + 1;
      const src = a.source ?? "manual";
      apptBySource[src] = (apptBySource[src] ?? 0) + 1;
    }
    const finished =
      (apptByStatus.completed ?? 0) + (apptByStatus.no_show ?? 0);

    // ── Calls ────────────────────────────────────────────────────────────────
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_org_started", (q) =>
        q.eq("orgId", orgId).gte("startedAt", since).lte("startedAt", now),
      )
      .collect();
    let inboundCalls = 0;
    let answeredCalls = 0;
    let callSeconds = 0;
    for (const c of calls) {
      if (c.direction === "inbound") inboundCalls += 1;
      // Duration is the only honest answer to "was it a real call": an
      // unanswered leg lands with no duration at all, and disconnectionReason
      // is only stamped on rows written since it landed.
      if ((c.durationSec ?? 0) > 0) answeredCalls += 1;
      callSeconds += c.durationSec ?? 0;
    }

    // ── Messages ─────────────────────────────────────────────────────────────
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(MESSAGE_CAP);
    const messages = recent.filter((m) => (m.occurredAt ?? m._creationTime) >= since);
    // The cap only lies if it ran out BEFORE the window did. If the oldest row
    // read is still inside the window there may be more behind it; if it is
    // already older, the window was fully covered.
    const messagesTruncated =
      recent.length === MESSAGE_CAP &&
      (recent[recent.length - 1]?._creationTime ?? 0) >= since;

    let sent = 0;
    let failed = 0;
    let received = 0;
    const byChannel: Record<string, number> = {};
    for (const m of messages) {
      const ch = channelOfMessage(m.kind);
      byChannel[ch] = (byChannel[ch] ?? 0) + 1;
      if (m.direction === "in") {
        received += 1;
        continue;
      }
      if (m.status === "failed") failed += 1;
      else if (m.status !== "queued") sent += 1;
    }

    // ── New customers ────────────────────────────────────────────────────────
    const newCustomers = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(1000);
    const arrived = newCustomers.filter((c) => c._creationTime >= since).length;

    const pct = (n: number, d: number) =>
      d === 0 ? null : Math.round((n / d) * 1000) / 10;

    return {
      window: {
        days: span,
        from: new Date(since).toISOString(),
        to: new Date(now).toISOString(),
      },
      appointments: {
        total: appointments.length,
        byStatus: apptByStatus,
        bySource: apptBySource,
        // Of the ones that have actually resolved. Counting no-shows against
        // every booking in the window would fold in appointments that simply
        // have not happened yet and make the rate look better every time it is
        // asked earlier in the week.
        noShowRatePct: pct(apptByStatus.no_show ?? 0, finished),
        confirmedRatePct: pct(apptByStatus.confirmed ?? 0, appointments.length),
      },
      calls: {
        total: calls.length,
        inbound: inboundCalls,
        outbound: calls.length - inboundCalls,
        answered: answeredCalls,
        answeredRatePct: pct(answeredCalls, calls.length),
        totalMinutes: Math.round(callSeconds / 60),
      },
      messages: {
        outbound: sent,
        failed: failed,
        inbound: received,
        byChannel,
        // Replies per delivered outbound. Not a per-customer figure, and it
        // counts every inbound including the ones nobody prompted.
        replyRatePct: pct(received, sent),
        ...(messagesTruncated
          ? {
              truncated: `More than ${MESSAGE_CAP} messages in this window; counts cover the most recent ${MESSAGE_CAP}. Ask for fewer days for an exact figure.`,
            }
          : {}),
      },
      newCustomers: arrived,
    };
  },
});

export const customerHistory = internalQuery({
  args: {
    orgId: v.id("orgs"),
    customerId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, customerId, limit }) => {
    // Fetch by id and THEN compare the org, exactly as customerInOrg does. The
    // other order would happily answer questions about another salon's
    // customer.
    const customer = await ctx.db
      .get(customerId as Id<"customers">)
      .catch(() => null);
    if (!customer || customer.orgId !== orgId) throw new Error("No customer with that id.");
    const cap = Math.min(Math.max(limit ?? 50, 1), 200);

    const [messages, calls, notes, appointments] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .order("desc")
        .take(cap),
      ctx.db
        .query("calls")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .order("desc")
        .take(cap),
      ctx.db
        .query("notes")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .order("desc")
        .take(cap),
      ctx.db
        .query("appointments")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .order("desc")
        .take(cap),
    ]);

    const items = [
      ...messages.map((m) => ({
        at: m.occurredAt ?? m._creationTime,
        type: channelOfMessage(m.kind) as string,
        direction: m.direction === "in" ? "inbound" : "outbound",
        body: m.body,
        subject: m.emailSubject,
        status: m.status,
        error: m.error,
      })),
      ...calls.map((c) => ({
        at: c.startedAt,
        type: "call",
        direction: c.direction,
        body: c.summary,
        durationSec: c.durationSec,
        outcome: c.outcome,
      })),
      ...notes.map((n) => ({
        at: n._creationTime,
        type: "note",
        body: n.body,
      })),
      ...appointments.map((a) => ({
        at: a.startAt,
        type: "appointment",
        status: a.status,
        services: (a.items ?? []).map((i) => i.name),
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, cap)
      .map((i) => ({ ...i, at: new Date(i.at).toISOString() }));

    return {
      customer: {
        id: customer._id,
        name: fullName(customer),
        phone: customer.phone,
        email: customer.email ?? null,
      },
      count: items.length,
      timeline: items,
    };
  },
});
