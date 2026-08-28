// WHO ANSWERS THIS CONVERSATION — the one place the question is decided.
//
// Four callers ask it: the webhook deciding whether to schedule a turn at all,
// the turn itself deciding whether to run, the thread UI drawing its control,
// and the takeover write when a human sends into a thread. Three copies of a
// precedence rule is how the four of them start disagreeing about which
// conversations the agent is in, so there is one copy and it is here.
//
// A LEAF MODULE — it imports types and nothing else, deliberately. A value
// imported across a cycle reads as `undefined` while the importing module's
// top level runs, and a precedence rule that silently resolves to undefined is
// an agent that either goes mute or answers threads a human took over.

import type { Doc } from "../_generated/dataModel";

// What the ORG is entitled to and where it is in its rollout. The operator's
// half, from /admin (schema: orgs.chatAgentMode).
export type AgentLifecycle = "off" | "shadow" | "live";

// What the agent DOES in a given conversation. The three the owner and their
// staff choose between, plus "shadow", which only the operator can cause and
// which no per-conversation control can reach.
export type AgentMode = "off" | "shadow" | "suggest" | "live";

// The three a human may pick. "shadow" is deliberately not among them: it is
// a fleet-QA state the operator causes and the tenant is never shown, so no
// per-conversation control and no settings row can reach it.
export type SettableAgentMode = "off" | "suggest" | "live";

export type ConversationAgentState = {
  // The operator's gate. "off" here means the org does not have the agent.
  lifecycle: AgentLifecycle;
  // The business default, once entitled. Unset behaviour reads as "live" —
  // see the schema comment on orgs.chatAgentBehavior for why that and not
  // "suggest".
  orgDefault: SettableAgentMode;
  // What THIS conversation was deliberately set to, or null when it follows
  // the business.
  override: SettableAgentMode | null;
  // What actually happens on the next inbound message.
  effective: AgentMode;
  // Whether a human may see and change any of this. False while the operator
  // has the org off or in shadow: an org that has not been given the agent
  // must not be offered a control for it, and shadow is a state the tenant is
  // deliberately not told about.
  settable: boolean;
};

// `customer` is optional because the settings page asks this question about a
// business with no conversation in hand.
export function conversationAgentMode(
  org: Pick<Doc<"orgs">, "chatAgentMode" | "chatAgentBehavior">,
  customer?: Pick<Doc<"customers">, "agentModeOverride" | "agentPausedAt"> | null,
): ConversationAgentState {
  const lifecycle: AgentLifecycle = org.chatAgentMode ?? "off";
  const orgDefault: SettableAgentMode = org.chatAgentBehavior ?? "live";

  // The compatibility read, and the only thing agentPausedAt still decides: a
  // conversation a human took over before agentModeOverride existed carries
  // the stamp and no override. Dropping it would hand every one of those
  // threads back to the agent silently, mid-repair, on deploy day.
  const override: SettableAgentMode | null =
    customer?.agentModeOverride ??
    (customer?.agentPausedAt !== undefined ? "off" : null);

  // The operator's two gates answer before anything else can. Shadow in
  // particular is a CEILING, not a default: an org that has not been cleared
  // to send must not be able to send because one conversation was pinned.
  if (lifecycle === "off" || lifecycle === "shadow") {
    return {
      lifecycle,
      orgDefault,
      override,
      effective: lifecycle,
      settable: false,
    };
  }

  return {
    lifecycle,
    orgDefault,
    override,
    // The whole rule, in one expression: the conversation wins if it said
    // anything, otherwise the business does.
    effective: override ?? orgDefault,
    settable: true,
  };
}

// Does this mode generate a reply at all? Off is the only one that does not —
// shadow and suggest both run the full turn and spend the same tokens; they
// differ in who is allowed to see the result.
export function agentGenerates(mode: AgentMode): boolean {
  return mode !== "off";
}

// Does this mode put the reply in front of the CUSTOMER? Only live. Anything
// else means the customer is still waiting on a person, which is what the
// away-reply and the unread dot are for.
export function agentAnswersCustomer(mode: AgentMode): boolean {
  return mode === "live";
}
