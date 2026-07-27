// Which WhatsApp number a message goes out on.
//
// An org can run BOTH lanes, because they are two phone numbers doing two
// jobs. A number on Meta's Cloud API is deregistered from the consumer app, so
// one number is never both — but a salon can have a Cloud number that sends
// confirmations and reminders and keep the shop phone customers already know
// on Evolution, where staff answer it from the handset as they always have.
//
// Which lanes exist is read off what is configured, never off a selector
// field: a waAccounts row means Cloud, orgs.evolutionInstance means Evolution.
// A third field saying which lanes are on could disagree with the two real
// ones, and would, eventually.
//
// ── THE TWO RULES ───────────────────────────────────────────────────────────
//
// 1. A REPLY GOES BACK OUT THE WAY IT CAME IN. If a customer wrote to the shop
//    phone, the answer leaves from the shop phone. Answering from the Cloud
//    number instead puts a number they have never seen into a conversation
//    they started somewhere else, and on WhatsApp that reads as a stranger,
//    not as the salon.
//
// 2. ANYTHING BUSINESS-INITIATED PREFERS CLOUD. Confirmations, reminders,
//    win-backs and campaigns are all first contact after silence, which is
//    precisely what Evolution drops: WhatsApp's Reachout Timelock refuses
//    business-initiated messages to people who have not written to the number,
//    ACK 463, while the instance reports itself healthy and the send returns
//    success. A reminder that silently never arrives is worse than one that
//    fails loudly, so Cloud wins whenever it exists.
//
// Rule 1 beats rule 2 when both apply, because a reply is by definition not
// first contact — the customer's own message opened the window.

import type { Doc } from "../_generated/dataModel";

export type WaLane = "cloud" | "evolution";

// What an org can actually send on right now.
export type LaneAvailability = { cloud: boolean; evolution: boolean };

export function laneAvailability(args: {
  org: Doc<"orgs">;
  waAccount: Doc<"waAccounts"> | null;
  evolutionConfigured: boolean;
}): LaneAvailability {
  return {
    cloud: Boolean(args.waAccount),
    // The instance name alone is not enough — credentials live in
    // `connections` and an org can have one without the other mid-setup.
    evolution: Boolean(args.org.evolutionInstance) && args.evolutionConfigured,
  };
}

// Business-initiated: a template, a reminder, a campaign. Rule 2.
export function laneForOutbound(available: LaneAvailability): WaLane | null {
  if (available.cloud) return "cloud";
  if (available.evolution) return "evolution";
  return null;
}

// A free-form answer inside an open conversation. Rule 1, falling back to
// rule 2 when the lane they used is no longer configured — a salon that moved
// off Evolution should still be able to answer, just from the other number.
export function laneForReply(
  available: LaneAvailability,
  customer: Doc<"customers">,
): WaLane | null {
  const last = customer.lastInboundLane ?? "cloud";
  if (last === "evolution" && available.evolution) return "evolution";
  if (last === "cloud" && available.cloud) return "cloud";
  return laneForOutbound(available);
}
