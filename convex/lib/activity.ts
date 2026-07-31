// Recording who did what.
//
// One helper, called from the mutations worth recording. It never throws and
// never blocks: an audit row failing to write must not roll back the
// cancellation it was describing. The log is evidence, not a transaction
// participant.
//
// ── WHAT TO LOG, AND WHAT NOT TO ────────────────────────────────────────────
//
// The test is whether somebody would ever ask "who did that?" about it.
// Cancelling an appointment, marking a no-show, deleting a customer, changing
// the business settings, removing a colleague — yes. A message send — no, the
// customer's thread already shows it with a time and a delivery status, and
// duplicating it here would bury the handful of rows anyone came looking for.
// The hourly completePast sweep — no: a row per appointment per day saying the
// machine did the boring thing is how a feed becomes unreadable.
//
// If you are adding a call site and cannot name the person who would ask, that
// is the answer.

import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { actingAsOrg } from "./orgAuth";

// What a salon sees when the platform operator changed something in their
// business. A brand, never a person: the client bought a service, and the
// name of whoever happened to be at the keyboard is not information they
// asked for and not something to leak into a tenant's browser.
export const OPERATOR_ACTOR_NAME = "Autotakt";

type ActivityKind = Doc<"activityLog">["kind"];

export async function recordActivity(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    kind: ActivityKind;
    customerId?: Id<"customers">;
    appointmentId?: Id<"appointments">;
    detail?: string;
    // Force "the system did this", for writes that are system writes no matter
    // who is logged in. A PUBLIC endpoint is the case that matters: the request
    // form answers to anyone, and if the salon owner happens to be signed in in
    // that browser, the auth lookup below cheerfully credits THEM with the
    // customer's own submission. The call site knows which door it is; the
    // cookie does not.
    system?: boolean;
    // An MCP client acting for someone. There is no session cookie on that
    // door either — the person comes from the key, not from auth — so the
    // actor is passed in rather than looked up. Supplying this also marks the
    // row "agent", which is how the feed tells Ayşe clicking apart from Ayşe
    // asking Claude to do it from the bus.
    agent?: {
      actorId: Id<"users">;
      connectionId: Id<"mcpConnections">;
      agentActionId?: Id<"agentActions">;
    };
  },
): Promise<void> {
  try {
    // Unset for anything the system did on its own — a webhook, the voice
    // agent, a cron. The reader sees "system" rather than a name that would
    // be a lie.
    const actorId = args.agent
      ? args.agent.actorId
      : args.system
        ? null
        : await getAuthUserId(ctx);
    // Was this written by the operator working inside this business? Derived
    // here rather than threaded through every call site, so no mutation has to
    // remember to pass it and none can forget. The actor row keeps the real
    // user id either way; only the DISPLAY changes (convex/activity.ts).
    let viaOperator: boolean | undefined;
    if (actorId) {
      const actor = await ctx.db.get(actorId);
      // Both halves, same as the gate: the column names an org, the allowlist
      // decides whether it counts. And it must be THIS org — an operator
      // acting inside salon A writing to salon B is not a thing that should
      // happen, and if it somehow does it is not "Autotakt" doing it.
      if (actor && actingAsOrg(actor) === args.orgId) viaOperator = true;
    }
    await ctx.db.insert("activityLog", {
      orgId: args.orgId,
      actorId: actorId ?? undefined,
      viaOperator,
      actorKind: args.agent ? "agent" : args.system ? "system" : undefined,
      connectionId: args.agent?.connectionId,
      agentActionId: args.agent?.agentActionId,
      kind: args.kind,
      customerId: args.customerId,
      appointmentId: args.appointmentId,
      detail: args.detail,
    });
  } catch {
    // Swallowed on purpose. See the header: the write this describes matters
    // more than the description of it.
  }
}

// "scheduled → no_show", ready to render. Kept here so every call site
// produces the same shape and the reader never has to learn two formats.
export function statusChange(from: string, to: string): string {
  return `${from} → ${to}`;
}
