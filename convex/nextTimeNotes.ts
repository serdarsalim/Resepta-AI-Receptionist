// The customer's "For next time" note (Nudge's, 2026-10-27; here 2026-10-31):
// what should change the NEXT call or chat, in a few short sentences, kept on
// customers.nextTimeNote. Written by the business's AI after every answered
// phone call (voiceEvents.process schedules rewriteAfterCall) and once a
// WhatsApp chat has gone quiet (webhook.ts queues rewriteAfterChat on a typed
// reply), editable by any member on the record (setForCustomer), handed to
// every call as {{for_next_time}} (retell.beforeCallContext) and to the
// WhatsApp assistant's prompt (chatAgent.loadTurnContext). A call never reads
// the WhatsApp chat, so this note is also how what a customer TYPED reaches
// the next call.
//
// The rewrite starts from the note as it stands, so a person's correction is
// what the next call builds on, and the AI never deletes a person's words: an
// answer of "nothing worth keeping" clears only a note the AI wrote itself.
// The prompt and the rules its answer must meet live in lib/nextTimeNote.ts.
//
// Off in the demo org; no model key, no note. Each request is metered to the
// business's month like the owner's chat simulator (counted toward the
// assistant budget, not billed per turn), and a month past its budget writes
// no note.

import { v } from "convex/values";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";
import { isDeleting } from "./lib/customerDeletion";
import { resolveChatLlm } from "./lib/chatLlm";
import {
  DEFAULT_MONTHLY_BUDGET_MICRO_USD,
  chatComplete,
  costMicroUsd,
  isPricedModel,
  textMessage,
} from "./lib/llm";
import { monthKey } from "./lib/usage";
import { callOutcome } from "./lib/callOutcome";
import {
  CHAT_QUIET_MS,
  NOTE_SYSTEM_PROMPT,
  chatText,
  customerSaidSomething,
  normaliseNote,
  noteUserMessage,
  noteWrittenBy,
  parseNoteReply,
  transcriptText,
  type NoteConversation,
} from "./lib/nextTimeNote";

// A note and a rewrite that read it race a person's edit: the write refuses
// when the note changed since it was read, and the action reads again.
const CONFLICT_RETRIES = 2;
// A chat rewrite looks through the customer's newest message rows, and reads
// back at most a week (the first time, or after a long quiet).
const CHAT_READ_ROWS = 80;
const CHAT_LOOKBACK_MS = 7 * 86_400_000;
// The call row's transcript arrives with call_ended; a call whose row has
// none yet (the analysis event first) is tried once more after this.
const NO_TRANSCRIPT_RETRY_MS = 2 * 60_000;

async function bookkeeping(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  customerId: Id<"customers">,
): Promise<Doc<"nextTimeNotes"> | null> {
  return await ctx.db
    .query("nextTimeNotes")
    .withIndex("by_org_customer", (q) => q.eq("orgId", orgId).eq("customerId", customerId))
    .first();
}

/** The note as it stands. */
export function noteOf(customer: Doc<"customers">): string {
  return (customer.nextTimeNote ?? "").trim();
}

/** A person's edit on the record. Any member, like every customer value; the
 *  next rewrite starts from these words, and they are theirs: the AI never
 *  clears them. Saved as the AI's would be, one paragraph. */
export const setForCustomer = mutation({
  args: { customerId: v.id("customers"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { customerId, text }) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    const clean = normaliseNote(text);
    if (clean === noteOf(customer)) return null;
    await ctx.db.patch(customerId, { nextTimeNote: clean || undefined });
    return null;
  },
});

const llmV = v.object({
  provider: v.union(v.literal("anthropic"), v.literal("openai")),
  model: v.string(),
  apiKey: v.string(),
});

type Llm = { provider: "anthropic" | "openai"; model: string; apiKey: string };

/** The guards every rewrite shares, cheapest first: the demo org, a
 *  suspended business, a deleted customer, no model key, a model the price
 *  table does not know (its cost would meter at nothing), a month past the
 *  assistant budget. Null means skip. */
async function rewriteGuards(
  ctx: QueryCtx,
  customer: Doc<"customers"> | null,
  now: number,
): Promise<{ org: Doc<"orgs">; llm: Llm; month: string } | null> {
  if (!customer || isDeleting(customer)) return null;
  const org = await ctx.db.get(customer.orgId);
  // The demo's calls and chats are simulated: nothing to remember.
  if (!org || org.demoMode === true) return null;
  if ((org.status ?? "active") === "suspended") return null;
  const llm = await resolveChatLlm(ctx, org._id);
  if (!llm.apiKey || !isPricedModel(llm.model)) return null;
  const month = monthKey(now, org.timezone);
  const usage = await ctx.db
    .query("usageMonthly")
    .withIndex("by_org_month", (q) => q.eq("orgId", org._id).eq("month", month))
    .unique();
  const budget = org.chatAgentMonthlyBudgetMicroUsd ?? DEFAULT_MONTHLY_BUDGET_MICRO_USD;
  if ((usage?.llmCostMicroUsd ?? 0) >= budget) return null;
  return { org, llm: { provider: llm.provider, model: llm.model, apiKey: llm.apiKey }, month };
}

const callContextV = v.union(
  v.object({ status: v.literal("skip") }),
  v.object({ status: v.literal("no-transcript") }),
  v.object({
    status: v.literal("ok"),
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    // The note as read: the write refuses if it changed since.
    current: v.string(),
    timezone: v.string(),
    month: v.string(),
    llm: llmV,
    startedAt: v.number(),
    transcript: v.string(),
  }),
);

/** Everything one call rewrite needs, read in one transaction from the call
 *  row the post-call webhook wrote: only an answered call (the disconnect
 *  code), only one the customer spoke on, only one this note has not
 *  already taken in. A browser test never has a calls row. */
export const callRewriteContext = internalQuery({
  args: { retellCallId: v.string(), now: v.number() },
  returns: callContextV,
  handler: async (ctx, { retellCallId, now }) => {
    const skip = { status: "skip" as const };
    const call = await ctx.db
      .query("calls")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", retellCallId))
      .unique();
    if (!call?.customerId) return skip;
    if (callOutcome(call.disconnectionReason, call.durationSec) !== "answered") return skip;
    const customer = await ctx.db.get(call.customerId);
    if (!customer || customer.orgId !== call.orgId) return skip;
    const guards = await rewriteGuards(ctx, customer, now);
    if (!guards) return skip;
    const row = await bookkeeping(ctx, call.orgId, customer._id);
    // A repeated webhook for a call this note already took in.
    if (row?.callId === retellCallId) return skip;
    if (!call.transcript) return { status: "no-transcript" as const };
    if (!customerSaidSomething(call.transcript)) return skip;
    return {
      status: "ok" as const,
      orgId: call.orgId,
      customerId: customer._id,
      current: noteOf(customer),
      timezone: guards.org.timezone,
      month: guards.month,
      llm: guards.llm,
      startedAt: call.startedAt,
      transcript: call.transcript,
    };
  },
});

const writeResultV = v.union(
  v.literal("written"),
  v.literal("unchanged"),
  v.literal("conflict"),
  v.literal("gone"),
);
type WriteResult = "written" | "unchanged" | "conflict" | "gone";

/** Land the AI's note, unless the note changed since it was read (a person
 *  edited it mid-rewrite, or the other kind of rewrite landed first:
 *  "conflict", read again and redo). A call marks the bookkeeping with its
 *  id, so a repeated webhook does not rewrite twice; a chat keeps its place
 *  in readThrough instead. A customer deleted meanwhile is "gone" and gets
 *  nothing written. */
async function landNote(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  customerId: Id<"customers">,
  text: string,
  base: string,
  from: { source: "call"; callId: string } | { source: "chat" },
): Promise<WriteResult> {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.orgId !== orgId || isDeleting(customer)) return "gone";
  const current = noteOf(customer);
  if (current !== base) return "conflict";
  const row = await bookkeeping(ctx, orgId, customerId);
  const callMark = from.source === "call" ? { callId: from.callId } : {};
  const save = async (patch: Partial<Doc<"nextTimeNotes">>) => {
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("nextTimeNotes", { orgId, customerId, ...patch });
  };
  const clean = normaliseNote(text);
  if (!clean) {
    // "Nothing worth keeping" clears what the AI wrote, never a person's words.
    if (current && noteWrittenBy(current, row?.aiText) === "ai") {
      await ctx.db.patch(customerId, { nextTimeNote: undefined });
      await save({ aiText: undefined, updatedAt: Date.now(), source: from.source, ...callMark });
      return "written";
    }
    if (from.source === "call") await save(callMark);
    return "unchanged";
  }
  if (clean === current) {
    if (from.source === "call") await save(callMark);
    return "unchanged";
  }
  await ctx.db.patch(customerId, { nextTimeNote: clean });
  // These are the AI's words now, from this call or chat.
  await save({ aiText: clean, updatedAt: Date.now(), source: from.source, ...callMark });
  return "written";
}

/** Write the AI's note from a call (see landNote). */
export const writeFromCall = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    text: v.string(),
    callId: v.string(),
    base: v.string(),
  },
  returns: writeResultV,
  handler: async (ctx, { orgId, customerId, text, callId, base }) =>
    landNote(ctx, orgId, customerId, text, base, { source: "call", callId }),
});

/** The request's cost on the business's month, like the owner's chat
 *  simulator: counted toward the assistant budget, never billed per turn. */
async function meter(
  ctx: Pick<ActionCtx, "runMutation">,
  orgId: Id<"orgs">,
  month: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (inputTokens === 0 && outputTokens === 0) return;
  await ctx.runMutation(internal.chatAgent.meterSimulatedTurn, {
    orgId,
    month,
    inputTokens,
    outputTokens,
    costMicroUsd: costMicroUsd(model, inputTokens, outputTokens),
  });
}

function formatIn(timezone: string, at: number, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(at);
  }
}

function dayIn(timezone: string, at: number, withTime: boolean): string {
  return formatIn(timezone, at, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  });
}

/** A chat line's time: "Tue 28 Oct 14:02", in the business's clock. */
function shortTime(timezone: string, at: number): string {
  return formatIn(timezone, at, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** One request to the AI: the new note, "" for nothing worth keeping, null
 *  when it did not answer (the note then stays as it is). */
async function askForNote(
  ctx: Pick<ActionCtx, "runMutation">,
  c: { orgId: Id<"orgs">; month: string; current: string; timezone: string; llm: Llm },
  conversations: NoteConversation[],
  language: string | undefined,
): Promise<string | null> {
  const res = await chatComplete({
    provider: c.llm.provider,
    apiKey: c.llm.apiKey,
    model: c.llm.model,
    system: NOTE_SYSTEM_PROMPT,
    messages: [
      textMessage(
        "user",
        noteUserMessage({
          today: `${dayIn(c.timezone, Date.now(), false)} (${c.timezone})`,
          language,
          current: c.current,
          conversations,
        }),
      ),
    ],
  });
  if (!res.ok) {
    console.warn(`nextTimeNotes: no answer from the AI (${res.error})`);
    return null;
  }
  await meter(ctx, c.orgId, c.month, c.llm.model, res.inputTokens, res.outputTokens);
  return parseNoteReply(res.text);
}

/** After an answered call (voiceEvents.process, on the event that carries
 *  the disconnect code): rewrite the customer's note from the note as it
 *  stands plus this call's stored transcript. */
export const rewriteAfterCall = internalAction({
  args: {
    retellCallId: v.string(),
    // The language the customer was heard in (lib/textLanguage), when known.
    language: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (let i = 0; i < CONFLICT_RETRIES; i++) {
      const c = await ctx.runQuery(internal.nextTimeNotes.callRewriteContext, {
        retellCallId: args.retellCallId,
        now: Date.now(),
      });
      if (c.status === "skip") return null;
      if (c.status === "no-transcript") {
        if ((args.attempt ?? 0) < 1) {
          await ctx.scheduler.runAfter(NO_TRANSCRIPT_RETRY_MS, internal.nextTimeNotes.rewriteAfterCall, {
            ...args,
            attempt: (args.attempt ?? 0) + 1,
          });
        }
        return null;
      }
      const conversation: NoteConversation = {
        kind: "call",
        when: dayIn(c.timezone, c.startedAt, true),
        text: transcriptText(c.transcript),
      };
      const reply = await askForNote(ctx, c, [conversation], args.language);
      if (reply === null) return null;
      const result = await ctx.runMutation(internal.nextTimeNotes.writeFromCall, {
        orgId: c.orgId,
        customerId: c.customerId,
        text: reply,
        callId: args.retellCallId,
        base: c.current,
      });
      if (result !== "conflict") return null;
    }
    return null;
  },
});

// ── WhatsApp chats ──────────────────────────────────────────────────────────
// One AI request per quiet chat, never per message, and never for a tapped
// button: a bulk send's taps cost nothing.

/** A typed WhatsApp reply (webhook.ts, the same test the language learning
 *  uses): rewrite the note from the chat once it has been quiet
 *  CHAT_QUIET_MS. A newer reply cancels the wait and starts it again. */
export async function queueChatRewrite(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  customerId: Id<"customers">,
  messageId: Id<"messages">,
): Promise<void> {
  const row = await bookkeeping(ctx, orgId, customerId);
  // A job that already ran makes this a no-op.
  if (row?.dueJobId) await ctx.scheduler.cancel(row.dueJobId);
  const dueJobId = await ctx.scheduler.runAfter(CHAT_QUIET_MS, internal.nextTimeNotes.rewriteAfterChat, {
    orgId,
    customerId,
    messageId,
  });
  if (row) await ctx.db.patch(row._id, { dueMessageId: messageId, dueJobId });
  else await ctx.db.insert("nextTimeNotes", { orgId, customerId, dueMessageId: messageId, dueJobId });
}

const chatContextV = v.union(
  v.object({ status: v.literal("skip") }),
  v.object({
    status: v.literal("ok"),
    current: v.string(),
    timezone: v.string(),
    month: v.string(),
    llm: llmV,
    lines: v.array(
      v.object({ from: v.union(v.literal("customer"), v.literal("us")), at: v.number(), text: v.string() }),
    ),
    // The newest customer message read: where the next chat rewrite starts.
    through: v.number(),
  }),
);

/** Everything one chat rewrite needs, read in one transaction: the note, and
 *  the WhatsApp messages since the last customer message a chat rewrite
 *  read. Our replies after that one come along again, so a short answer
 *  ("no, from December") keeps the question it answers. Email is not read:
 *  this is the WhatsApp chat's rewrite. */
export const chatRewriteContext = internalQuery({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    messageId: v.id("messages"),
    now: v.number(),
  },
  returns: chatContextV,
  handler: async (ctx, { orgId, customerId, messageId, now }) => {
    const skip = { status: "skip" as const };
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== orgId) return skip;
    const row = await bookkeeping(ctx, orgId, customerId);
    // A newer typed reply took over the wait.
    if (!row || row.dueMessageId !== messageId) return skip;
    const guards = await rewriteGuards(ctx, customer, now);
    if (!guards) return skip;
    const after = Math.max(row.readThrough ?? 0, now - CHAT_LOOKBACK_MS);
    const rows = (
      await ctx.db
        .query("messages")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .order("desc")
        .take(CHAT_READ_ROWS)
    )
      .filter(
        (m) =>
          m.orgId === orgId &&
          !m.kind.startsWith("email_") &&
          m._creationTime > after &&
          (m.direction === "in" ||
            m.status === "sent" ||
            m.status === "delivered" ||
            m.status === "read") &&
          (m.body ?? "").trim().length > 0,
      )
      .reverse();
    const theirs = rows.filter((m) => m.direction === "in");
    if (theirs.length === 0) return skip;
    return {
      status: "ok" as const,
      current: noteOf(customer),
      timezone: guards.org.timezone,
      month: guards.month,
      llm: guards.llm,
      lines: rows.map((m) => ({
        from: m.direction === "in" ? ("customer" as const) : ("us" as const),
        at: m._creationTime,
        text: m.body ?? "",
      })),
      through: theirs[theirs.length - 1]._creationTime,
    };
  },
});

/** Write the AI's note from a chat (see landNote), and move the chat's read
 *  mark past what it read, whatever the note did with it. */
export const writeFromChat = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    messageId: v.id("messages"),
    text: v.string(),
    through: v.number(),
    base: v.string(),
  },
  returns: writeResultV,
  handler: async (ctx, { orgId, customerId, messageId, text, through, base }) => {
    const result = await landNote(ctx, orgId, customerId, text, base, { source: "chat" });
    if (result === "conflict" || result === "gone") return result;
    const row = await bookkeeping(ctx, orgId, customerId);
    if (row)
      await ctx.db.patch(row._id, {
        readThrough: Math.max(row.readThrough ?? 0, through),
        // Patching to undefined DELETES the fields, which is the point: the
        // wait this reply started is over. A newer reply's wait stays.
        ...(row.dueMessageId === messageId ? { dueMessageId: undefined, dueJobId: undefined } : {}),
      });
    return result;
  },
});

/** A chat gone quiet (queueChatRewrite): rewrite the customer's note from the
 *  note as it stands plus what the chat added since it was last read. */
export const rewriteAfterChat = internalAction({
  args: { orgId: v.id("orgs"), customerId: v.id("customers"), messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (let i = 0; i < CONFLICT_RETRIES; i++) {
      const c = await ctx.runQuery(internal.nextTimeNotes.chatRewriteContext, { ...args, now: Date.now() });
      if (c.status === "skip") return null;
      const chat: NoteConversation = {
        kind: "chat",
        when: dayIn(c.timezone, c.lines[0].at, true),
        text: chatText(c.lines.map((l) => ({ from: l.from, at: shortTime(c.timezone, l.at), text: l.text }))),
      };
      const reply = await askForNote(ctx, { ...c, orgId: args.orgId }, [chat], undefined);
      if (reply === null) return null;
      const result = await ctx.runMutation(internal.nextTimeNotes.writeFromChat, {
        ...args,
        text: reply,
        through: c.through,
        base: c.current,
      });
      if (result !== "conflict") return null;
    }
    return null;
  },
});
