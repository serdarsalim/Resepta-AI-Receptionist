import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { DOC_EXTENSIONS, fileNameForAsset } from "./media";
import { formatAppointmentTime } from "./lib/format";
import {
  customerSender,
  emailBodyHtml,
  emailLaneConfigured,
  sendEmail,
  withOpenPixel,
} from "./lib/email";
import { appointmentIcs } from "./lib/ics";
import { resolveWaAccount } from "./lib/platformConfig";
import { recomputeThread } from "./lib/thread";
import {
  fetchWaMedia,
  markWaCloudRead,
  sendWaCloudDocument,
  sendWaCloudImage,
  sendWaCloudVideo,
  sendWaCloudReaction,
  sendWaCloudTemplate,
  sendWaCloudText,
} from "./lib/waCloud";
import { isOrgSetupFailure } from "./lib/alerts";
import { outOfHoursMessage } from "./lib/awayReply";
import { renderTokens, tokenDefaults } from "./lib/renderTokens";
import { buttonLabelsFor, buttonsFor, defaultForKey } from "./lib/metaTemplate";
import { sendEvolutionText } from "./lib/evolution";
import {
  evolutionReplyHint,
  laneAvailability,
  laneForOutbound,
  laneForReply,
  loadEvolutionCreds,
} from "./lib/waLane";
import { isDemo } from "./demo";
import { EVOLUTION_NO_MEDIA, EVOLUTION_NO_REACTION } from "./lib/sendFailure";
import { formatMoney as formatMinorUnits } from "./lib/money";
import { requireOrg } from "./lib/orgAuth";
import { resolvePublicPhone } from "./lib/publicPhone";
import { isDeleting } from "./lib/customerDeletion";
import { emailVerdict, lifecycleTemplates, whatsappVerdict } from "./lib/lifecycleSend";

const SESSION_WINDOW_MS = 24 * 3600_000;

// Context for a rep-typed session message. Runs with the caller's auth (auth
// propagates through runQuery), so the org scoping holds inside the action.
export const loadSessionContext = internalQuery({
  args: {
    customerId: v.id("customers"),
    // The library asset being attached, if any. Resolved HERE rather than at
    // the send because the payload Meta wants differs by type — an image and a
    // document are different objects, not one object with a different link —
    // and the action doing the send has no db to ask what the file is.
    mediaStorageId: v.optional(v.id("_storage")),
    // The message being quote-replied to (2026-08-31). Resolved here for the
    // same reason as the asset: the send action has no db, and the row's
    // wamid + a body snapshot are what both the provider payload and the
    // thread's quote block need.
    replyToId: v.optional(v.id("messages")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    // A customer being deleted is gone: nothing more goes out to them.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    const [waAccount, org, contactFields] = await Promise.all([
      // Resolved here, not at the send: the platform-token fallback
      // (lib/platformConfig resolveWaAccount) needs ctx.db, and the action
      // reading this context has none.
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique()
        .then((row) => resolveWaAccount(ctx, row)),
      ctx.db.get(orgId),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);
    // org rides along for token rendering ([business]); the send itself needs
    // only the account. contactFields feed the same tokens the reminders and
    // campaigns speak — one vocabulary everywhere.
    const evolution = org
      ? await loadEvolutionCreds(ctx, orgId, org.evolutionInstance)
      : null;
    return {
      customer,
      waAccount,
      // publicPhone resolved here, where there is a db: the actions that read
      // this context render [phone] but cannot query the agent table.
      org: org ? { ...org, publicPhone: await resolvePublicPhone(ctx, org) } : org,
      evolution,
      contactFields,
      asset: args.mediaStorageId
        ? await resolveAsset(ctx, orgId, args.mediaStorageId)
        : null,
      // Null when the row is missing, another customer's, or has no wamid to
      // hand the provider — the send then simply goes unquoted rather than
      // failing, and no quote is stamped on the row (the thread must never
      // show a quote the customer didn't get). Media rows snapshot their
      // caption or nothing; the quote block renders its own media word.
      replyTo: await (async () => {
        if (!args.replyToId) return null;
        const quoted = await ctx.db.get(args.replyToId);
        if (!quoted || quoted.customerId !== args.customerId || !quoted.wamid)
          return null;
        return {
          wamid: quoted.wamid,
          body: quoted.body ?? "",
          direction: quoted.direction as "in" | "out",
        };
      })(),
    };
  },
});

// What an attached library file IS, in the two facts a send needs: the type
// that picks the payload, and the name the customer will see on their phone.
//
// Scoped to the org on the way through. The storage id arrives from the
// client, and without this check one salon could attach another's file by
// pasting its id — the blob is not org-scoped, only the row that names it is.
export async function resolveAsset(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  storageId: Id<"_storage">,
): Promise<{ contentType: string; fileName: string | null } | null> {
  const row = await ctx.db
    .query("mediaAssets")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
  if (!row || row.orgId !== orgId) return null;
  return {
    contentType: row.contentType,
    fileName:
      row.contentType in DOC_EXTENSIONS
        ? fileNameForAsset(row.name, row.contentType)
        : null,
  };
}

// Free-form reply from the contact page composer. Session messages only work
// inside the 24h window the customer's last inbound opened — outside it Meta
// rejects with 131047, so we refuse locally with a readable reason instead.
export const sendSession = action({
  args: {
    customerId: v.id("customers"),
    body: v.string(),
    // Unset = send now. A moment in the future parks the row instead, for the
    // cron to pick up — the salon writing tonight's follow-up at 23:00 and
    // having it land at 10:00 tomorrow.
    scheduledFor: v.optional(v.number()),
    // A file from the library (convex/media.ts) — a photo or a document. With
    // one attached the body becomes the CAPTION rather than a separate
    // message, because two notifications for one thought is how a salon's
    // thread becomes noise.
    mediaStorageId: v.optional(v.id("_storage")),
    // Quote-reply (Serdar, 2026-08-31): the thread message this send answers.
    // The customer sees the quoted bubble above the reply, same as a phone
    // swipe-reply. Text sends only — a media send drops the quote silently
    // (Meta accepts context on media, but the composer clears the reply chip
    // when a file is attached, and the backend enforcing the same keeps the
    // two honest).
    replyToId: v.optional(v.id("messages")),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  // Annotated explicitly: this handler calls internal.wa.* from the file that
  // defines it, so without a written return type the inference runs back
  // through the generated api and lands on itself (TS7022/7023). The
  // annotation cuts the loop — and losing it degrades the api types to `any`
  // for every caller in src/, which is a much noisier failure than it looks.
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const raw = args.body.trim();
    // A file on its own is a message; text on its own is a message; neither
    // is not.
    if (!raw && !args.mediaStorageId) return { ok: false, reason: "empty" };
    const context = await ctx.runQuery(internal.wa.loadSessionContext, {
      customerId: args.customerId,
      mediaStorageId: args.mediaStorageId,
      replyToId: args.mediaStorageId ? undefined : args.replyToId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    const { customer, waAccount, org, evolution, contactFields, asset, replyTo } =
      context;
    // Named a file we cannot account for. Refused rather than sent as a bare
    // link: the storage id comes from the client, and an asset that resolves
    // to nothing is either another org's or one that has been deleted.
    if (args.mediaStorageId && !asset) return { ok: false, reason: "media-missing" };
    // A human is answering this thread, so the chat agent stands down for it
    // (docs/chat-agent.md §5). Stamped before the send on purpose: even a
    // send that fails downstream is a person engaging, and the agent talking
    // over a human mid-repair is the worse failure. Idempotent; hand-back is
    // chatAgent.setPaused from the conversation header.
    await ctx.runMutation(internal.chatAgent.pauseForCustomer, {
      customerId: args.customerId,
    });
    // org is non-null for every real send here; the demo path below is the
    // only caller that reaches this with one missing.
    const available = org
      ? laneAvailability({ org, waAccount, evolutionConfigured: Boolean(evolution) })
      : { cloud: false, evolution: false };
    // Rule 1: answer on the number they wrote to. A customer who messaged the
    // shop phone and gets answered from the Cloud number sees an unknown
    // number replying to a conversation they had somewhere else.
    const lane = laneForReply(available, customer);
    // Before the credential check, for the same reason as the template lane:
    // the demo org has no waAccount by design.
    if (!lane && !isDemo(org)) return { ok: false, reason: "wa-not-configured" };
    // Free-form session text, so named tokens work here — this is not a Meta
    // template and nothing about {{1}} applies. Rendered ONCE, at send time,
    // and the stored row keeps the rendered text: the thread has to show what
    // the customer actually received, not the recipe for it.
    const sessionCustom: Record<string, string> = {};
    for (const field of (contactFields ?? []) as { key: string }[]) {
      sessionCustom[field.key] = customer.custom?.[field.key] ?? "";
    }
    const body = renderTokens(raw, {
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: org?.name,
      // Business number and link — one vocabulary across every surface.
      phone: org?.publicPhone,
      email: customer.email,
      bookingLink: org?.bookingUrl,
      custom: sessionCustom,
    });
    if (!body && !args.mediaStorageId) return { ok: false, reason: "empty" };
    // Suspension (docs/chat-agent.md §8): outbound stops, and the person
    // typing sees why instead of a silent nothing.
    if (org && (org.status ?? "active") === "suspended") {
      return { ok: false, reason: "org-suspended" };
    }
    if (customer.consentAt === undefined) return { ok: false, reason: "no-consent" };
    // Meta's 24h session window is Meta's rule. Evolution is a linked handset
    // and has no such window — the salon can answer an old message from their
    // phone whenever they like, and refusing to do the same from inside
    // Resepta would just teach them to pick the phone up instead.
    if (
      lane !== "evolution" &&
      (!customer.lastInboundAt ||
        Date.now() - customer.lastInboundAt > SESSION_WINDOW_MS)
    ) {
      // Checked for an immediate send only. A scheduled one is checked again
      // at dispatch, because a window that is open now may be shut by then —
      // and one that is shut now may have re-opened if the customer writes
      // back in the meantime.
      if (!args.scheduledFor) {
        return { ok: false, reason: "session-window-closed" };
      }
    }
    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: customer.orgId,
      customerId: customer._id,
      kind: "session",
      body,
      scheduledFor: args.scheduledFor,
      mediaStorageId: args.mediaStorageId,
      mediaContentType: asset?.contentType,
      mediaFileName: asset?.fileName ?? undefined,
      lane: lane ?? undefined,
      // Stamped only when the provider payload will carry the context —
      // loadSessionContext already returned null for a row it can't quote.
      ...(replyTo
        ? {
            replyToWamid: replyTo.wamid,
            replyToBody: replyTo.body,
            replyToDirection: replyTo.direction,
          }
        : {}),
    });
    // Parked. The row is visible in the thread immediately, counting down,
    // which is the whole point: a scheduled message you cannot see is a
    // message you will send twice.
    if (args.scheduledFor) return { ok: true };

    if (isDemo(org)) {
      await ctx.runMutation(internal.demo.landSimulated, {
        messageId,
        orgId: customer.orgId,
        customerId: customer._id,
      });
      return { ok: true };
    }
    if (lane === "evolution" && evolution) {
      // No image lane here. Evolution can send media, but it fetches the URL
      // itself and Convex storage URLs are signed and short-lived, so a
      // picture would arrive as a broken fetch rather than a photo. Text is
      // what this lane is for.
      //
      // Said out loud rather than dropped: sending the caption alone and
      // returning ok put the photo in the staff thread and nothing in the
      // customer's.
      if (args.mediaStorageId) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId,
          ok: false,
          error: EVOLUTION_NO_MEDIA,
        });
        return { ok: false, reason: EVOLUTION_NO_MEDIA };
      }
      const sent = await sendEvolutionText({
        baseUrl: evolution.baseUrl,
        apiKey: evolution.apiKey,
        instance: evolution.instance,
        to: customer.phone,
        body,
        quotedId: replyTo?.wamid,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: sent.ok,
        wamid: sent.ok ? sent.messageId : undefined,
        error: sent.ok ? undefined : sent.reason,
      });
      return sent.ok ? { ok: true } : { ok: false, reason: sent.reason };
    }
    // Only a demo org reaches this far without one, and that path returned
    // above — so this is narrowing for the compiler, not a real case.
    if (!waAccount) return { ok: false, reason: "wa-not-configured" };

    // Meta fetches the image from this URL itself, so it has to be reachable
    // from the outside. In DEV ctx.storage.getUrl returns a 127.0.0.1 address
    // that Meta obviously cannot reach — image sends only work from a
    // deployed backend. (Nudge hit exactly this and it is worth knowing before
    // you spend an evening on it.)
    const link = args.mediaStorageId
      ? await ctx.storage.getUrl(args.mediaStorageId)
      : null;
    const result =
      args.mediaStorageId && link
        ? // Each species is its own Meta payload type, and sending one
          // through another's is rejected outright: a document carries a
          // filename, a video declares itself video, everything else is an
          // image. asset is non-null here — the guard above returned already
          // if it were not.
          asset?.fileName
          ? await sendWaCloudDocument({
              accessToken: waAccount.accessToken,
              phoneNumberId: waAccount.phoneNumberId,
              to: customer.phone,
              link,
              fileName: asset.fileName,
              caption: body || undefined,
            })
          : asset?.contentType?.startsWith("video/")
            ? await sendWaCloudVideo({
                accessToken: waAccount.accessToken,
                phoneNumberId: waAccount.phoneNumberId,
                to: customer.phone,
                link,
                caption: body || undefined,
              })
            : await sendWaCloudImage({
                accessToken: waAccount.accessToken,
                phoneNumberId: waAccount.phoneNumberId,
                to: customer.phone,
                link,
                caption: body || undefined,
              })
        : await sendWaCloudText({
            accessToken: waAccount.accessToken,
            phoneNumberId: waAccount.phoneNumberId,
            to: customer.phone,
            body,
            contextMessageId: replyTo?.wamid,
          });
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: result.ok,
      wamid: result.ok ? result.wamid : undefined,
      error: result.ok ? undefined : result.reason,
    });
    // No alert here: applySendResult owns that decision now, because it is the
    // only place that knows whether this failure is terminal or about to be
    // retried. The caller still gets the reason back — someone typed this
    // message and is watching for it to land.
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },
});

// ---- Read receipts ----
//
// The blue ticks on the customer's phone. Without this, someone who wrote to
// the salon sees their message sitting at "delivered" forever, including while
// a human is reading it and typing an answer — which reads as being ignored by
// a business that is in fact right there.
//
// Deliberately separate from messages.markConversationRead, which is the
// INBOX dot: "I have looked at this" is a fact about our own list, and it
// fires once when a contact page mounts. Blue ticks answer a different
// question at a different moment — a message arriving while the thread is
// already open has to tick immediately, and the dot has no reason to move.

export const markThreadRead = mutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    // A customer being deleted is gone: nothing more goes out to them.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    // Evolution is a linked handset: the phone itself owns its read state, and
    // Baileys needs the full message key, which that lane never stored — the
    // same wall the reaction path hits.
    if ((customer.lastInboundLane ?? "cloud") !== "cloud") return null;

    // Newest first, and only a handful are read: an inbound row with a wamid
    // is almost always at the very top of a thread somebody just opened, and
    // the alternative is pulling a conversation's whole history to find one id.
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(20);
    const newest = recent.find(
      (row) =>
        row.direction === "in" &&
        row.wamid !== undefined &&
        (row.lane ?? "cloud") === "cloud",
    );
    if (!newest?.wamid) return null;
    // Already ticked. This is the guard that makes the call safe to fire on
    // every render of an open thread, which is exactly how it is used.
    if (customer.lastReadReceiptWamid === newest.wamid) return null;

    await ctx.scheduler.runAfter(0, internal.wa.sendReadReceipt, {
      customerId: args.customerId,
      wamid: newest.wamid,
    });
    return null;
  },
});

export const sendReadReceipt = internalAction({
  args: {
    customerId: v.id("customers"),
    wamid: v.string(),
    // The chat agent's variant: blue-tick AND show "typing…", because the
    // agent genuinely is about to write. Never set by the thread-open path.
    typing: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.wa.loadReadReceiptContext, {
      customerId: args.customerId,
    });
    if (!context?.waAccount) return null;
    // No message row, no alert, no retry. A read receipt that does not land is
    // a customer who keeps seeing two grey ticks for another minute; writing a
    // red row into their conversation about it would be a worse product than
    // the missing tick. Meta also refuses receipts for messages older than
    // roughly a day, and a thread nobody opened for a week must not fill the
    // log with failures nobody can act on.
    const result = await markWaCloudRead({
      accessToken: context.waAccount.accessToken,
      phoneNumberId: context.waAccount.phoneNumberId,
      wamid: args.wamid,
      typing: args.typing,
    });
    if (!result.ok) {
      console.warn(`wa read receipt: ${args.wamid} failed — ${result.reason}`);
      return null;
    }
    await ctx.runMutation(internal.wa.stampReadReceipt, {
      customerId: args.customerId,
      wamid: args.wamid,
    });
    return null;
  },
});

// The newest inbound cloud wamid, for the chat agent's read-and-typing call.
// Same scan as markRead above, minus the session gates: the agent was woken
// BY an inbound message, so one is always near the top.
export const newestInboundWamid = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(20);
    const newest = recent.find(
      (row) =>
        row.direction === "in" &&
        row.wamid !== undefined &&
        (row.lane ?? "cloud") === "cloud",
    );
    return newest?.wamid ?? null;
  },
});

export const loadReadReceiptContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    // No requireOrg: the caller is a scheduled action, which carries no auth
    // identity (the lesson loadScheduledSendContext records). The org comes
    // off the customer row the mutation already scoped to the caller's org.
    const customer = await ctx.db.get(args.customerId);
    if (!customer || isDeleting(customer)) return null;
    return {
      waAccount: await resolveWaAccount(
        ctx,
        await ctx.db
          .query("waAccounts")
          .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
          .unique(),
      ),
    };
  },
});

export const stampReadReceipt = internalMutation({
  args: { customerId: v.id("customers"), wamid: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // The receipt is an action's afterthought; the customer may have been
    // deleted while it ran, and a patch on a row the sweep removed throws.
    const customer = await ctx.db.get(args.customerId);
    if (!customer || isDeleting(customer)) return null;
    await ctx.db.patch(args.customerId, { lastReadReceiptWamid: args.wamid });
    return null;
  },
});

// ---- Reactions ----
//
// Reacting is the cheapest honest answer a busy salon has. "Görüldü, tamam"
// costs a message and reopens nothing; a thumbs-up on the customer's own line
// says the same thing and reads, on their phone, exactly like a person picking
// up the message — because that is what it is.
//
// Only INBOUND rows can be reacted to. That is not a Meta rule; it is what
// keeps messages.reactionEmoji unambiguous — one field, and direction says
// whose emoji is in it. Reacting to our own outbound message would overwrite
// whatever the customer put there.

export const loadReactionTarget = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, args) => {
    // requireOrg, unlike the webhook-triggered loaders in this file: the
    // caller is a signed-in person clicking an emoji, and the org has to come
    // from their session rather than from the row they named.
    const { orgId } = await requireOrg(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message || message.orgId !== orgId) return null;
    if (!message.customerId) return null;
    const customer = await ctx.db.get(message.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    const org = await ctx.db.get(orgId);
    const waAccount = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique(),
    );
    return { message, customer, org, waAccount };
  },
});

export const setReaction = internalMutation({
  args: { messageId: v.id("messages"), emoji: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Patching to undefined DELETES the field, which is what taking a
    // reaction back means.
    await ctx.db.patch(args.messageId, { reactionEmoji: args.emoji || undefined });
    return null;
  },
});

export const reactToMessage = action({
  args: {
    messageId: v.id("messages"),
    // Empty removes the reaction — Meta has no separate unreact call, it is
    // the same request with an empty emoji.
    emoji: v.string(),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  // Annotated for the same reason as sendSession: this handler calls
  // internal.wa.* from the file that defines them, and without a written
  // return type the inference runs back through the generated api and lands
  // on itself.
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const target = await ctx.runQuery(internal.wa.loadReactionTarget, {
      messageId: args.messageId,
    });
    if (!target) return { ok: false, reason: "not-found" };
    const { message, customer, org, waAccount } = target;
    if (message.direction !== "in") return { ok: false, reason: "not-inbound" };
    if (!message.wamid) {
      // A row imported from the salon's old phone, or one that predates the
      // Cloud lane. There is no message id at Meta to attach an emoji to.
      return { ok: false, reason: "no-wamid" };
    }
    if (org && (org.status ?? "active") === "suspended") {
      return { ok: false, reason: "org-suspended" };
    }
    // The demo org has no credentials by design, and a demo thread that
    // refuses to react would read as the feature being broken.
    if (isDemo(org)) {
      await ctx.runMutation(internal.wa.setReaction, {
        messageId: args.messageId,
        emoji: args.emoji,
      });
      return { ok: true };
    }
    // Evolution is a linked handset over Baileys and reacting through it needs
    // the full message key, which this lane never stored. Said out loud rather
    // than written locally and called a success: an emoji that appears in the
    // salon's thread and nowhere on the customer's phone is worse than a
    // button that admits it cannot.
    if (message.lane === "evolution") {
      return { ok: false, reason: EVOLUTION_NO_REACTION };
    }
    if (!waAccount) return { ok: false, reason: "wa-not-configured" };
    if (
      !customer.lastInboundAt ||
      Date.now() - customer.lastInboundAt > SESSION_WINDOW_MS
    ) {
      return { ok: false, reason: "session-window-closed" };
    }
    const result = await sendWaCloudReaction({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.phone,
      wamid: message.wamid,
      emoji: args.emoji,
    });
    // Written only after Meta takes it. The alternative — write first, roll
    // back on failure — puts an emoji on the salon's screen that the customer
    // never saw, and a reaction is precisely the kind of small signal nobody
    // goes back to verify.
    if (!result.ok) return { ok: false, reason: result.reason };
    await ctx.runMutation(internal.wa.setReaction, {
      messageId: args.messageId,
      emoji: args.emoji,
    });
    return { ok: true };
  },
});

// ---- Out-of-hours away-reply ----

export const loadAwayReplyContext = internalQuery({
  args: { customerId: v.id("customers"), ruleId: v.id("messageRules") },
  returns: v.any(),
  handler: async (ctx, args) => {
    // No requireOrg: this one is triggered by an inbound webhook, not a signed-in
    // user. The org comes from the customer row, which the webhook already
    // resolved by phone_number_id.
    const customer = await ctx.db.get(args.customerId);
    if (!customer || isDeleting(customer)) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const [waAccount, rule, templates, contactFields] = await Promise.all([
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .unique()
        .then((row) => resolveWaAccount(ctx, row)),
      ctx.db.get(args.ruleId),
      ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
    ]);
    return {
      customer,
      // Same as loadSessionContext: [phone] is resolved where the db is.
      org: { ...org, publicPhone: await resolvePublicPhone(ctx, org) },
      waAccount,
      rule,
      templates,
      contactFields,
    };
  },
});

// Deliberately does NOT require consentAt, unlike sendSession. Consent governs
// messages WE start; this is a reply to someone who just wrote to us, which is
// what every business messaging system does and what Meta's own away message
// does. The session window is open by construction — their inbound opened it.
// The once-per-window guard lives in webhook.ts, stamped before this is
// scheduled, same ordering as the reminder tick's double-send guard.
export const sendAwayReply = internalAction({
  args: { customerId: v.id("customers"), ruleId: v.id("messageRules") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.wa.loadAwayReplyContext, {
      customerId: args.customerId,
      ruleId: args.ruleId,
    });
    if (!context) return null;
    const { customer, org, waAccount, rule, templates, contactFields } = context;
    if (!waAccount) return null;
    // Paused (or deleted) between the webhook's stamp and this action running.
    // The stamp already happened, which errs toward not sending — the right
    // kind of stale, same as sendAppointmentMessage's guard.
    if (!rule || rule.paused) return null;
    const custom: Record<string, string> = {};
    for (const field of contactFields as { key: string }[]) {
      custom[field.key] = customer.custom?.[field.key] ?? "";
    }
    const message = outOfHoursMessage({
      templates,
      ruleId: args.ruleId,
      org,
      // The CUSTOMER's language, falling back to the org's.
      language: customer.language ?? org.language,
      firstName: customer.firstName,
      lastName: customer.lastName,
      custom,
    });
    // Null means nothing useful to say — no wording of the org's own, and no
    // link or phone for the stock text to hand over. The owner's notification
    // is better than "we're closed" and silence after it.
    if (!message) return null;

    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: customer.orgId,
      customerId: customer._id,
      kind: "session",
      body: message.body,
    });
    const result = await sendWaCloudText({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.phone,
      body: message.body,
    });
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: result.ok,
      wamid: result.ok ? result.wamid : undefined,
      error: result.ok ? undefined : result.reason,
    });
    return null;
  },
});

// Everything one send needs, in one read. Internal-only: the waAccount here
// carries the live access token, which must never transit a public function.
export const loadSendContext = internalQuery({
  args: {
    appointmentId: v.id("appointments"),
    // The rule this send belongs to, when it belongs to one — carries the
    // channel and selects the per-rule wording. Legacy sends have none.
    ruleId: v.optional(v.id("messageRules")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) return null;
    const rule = args.ruleId ? await ctx.db.get(args.ruleId) : null;
    const [customer, org, waAccount, templates, staffRow, contactFields] =
      await Promise.all([
        ctx.db.get(appointment.customerId),
        ctx.db.get(appointment.orgId),
        ctx.db
          .query("waAccounts")
          .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
          .unique()
          .then((row) => resolveWaAccount(ctx, row)),
        ctx.db
          .query("waTemplates")
          .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
          .collect(),
        // For the [staff] token. Null when nobody is assigned, and the token
        // renders as nothing — renderTokens' whitespace cleanup owns that case.
        appointment.staffId ? ctx.db.get(appointment.staffId) : null,
        // The org's field registry, so [age] and friends resolve from the same
        // source of truth the Fields tab shows.
        ctx.db
          .query("contactFields")
          .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
          .collect(),
      ]);
    // The reminder, confirmation, follow-up, winback and cancellation of a
    // customer being deleted: nothing goes, on any channel. Their appointments
    // are deleted with them, but a send already scheduled can run first.
    if (customer && isDeleting(customer)) return null;
    const evolution = org
      ? await loadEvolutionCreds(ctx, appointment.orgId, org.evolutionInstance)
      : null;
    return {
      appointment,
      customer,
      // Same as loadSessionContext: [phone] is resolved where the db is.
      org: org ? { ...org, publicPhone: await resolvePublicPhone(ctx, org) } : org,
      waAccount,
      templates,
      evolution,
      staffRow,
      rule,
      contactFields,
    };
  },
});

// The one outbound path for appointment-lifecycle messages: confirmations on
// booking, reminders and follow-ups from the cron, cancellation notices from
// the mutation that cancelled. Business-initiated → the Cloud lane always
// rides a Meta template message; session messages play no part here.
export const sendAppointmentMessage = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    kind: v.union(
      v.literal("confirmation"),
      v.literal("reminder"),
      v.literal("winback"),
      v.literal("followup"),
      v.literal("cancellation"),
    ),
    offsetHours: v.optional(v.number()),
    // Present on every send that came from a messageRules row. Drives the
    // channel and the per-rule wording; absent means a legacy-model org.
    ruleId: v.optional(v.id("messageRules")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.wa.loadSendContext, {
      appointmentId: args.appointmentId,
      ruleId: args.ruleId,
    });
    if (!context) return null;
    // Deployment-wide mail settings. An action has no ctx.db, so the operator's
    // platformConfig row is read through its own internal query.
    const mailConfig = await ctx.runQuery(internal.platformConfig.forSend, {});
    const {
      appointment,
      customer,
      org,
      waAccount,
      templates,
      evolution,
      staffRow,
      rule,
      contactFields,
    } = context;
    if (!customer || !org) return null;

    // Status gate per kind: each message only makes sense against the state
    // that earned it — a follow-up exists BECAUSE the visit happened, a
    // winback because it didn't, a cancellation notice because it won't.
    if (args.kind === "winback") {
      if (appointment.status !== "no_show") return null;
    } else if (args.kind === "followup") {
      if (appointment.status !== "completed") return null;
    } else if (args.kind === "cancellation") {
      if (appointment.status !== "cancelled") return null;
    } else if (
      appointment.status !== "scheduled" &&
      appointment.status !== "confirmed"
    ) {
      return null;
    }
    // A reminder for a start time already in the past is stale queue noise.
    if (args.kind === "reminder" && appointment.startAt <= Date.now()) return null;
    // A rule paused (or deleted) between the cron's stamp and this action
    // running says nothing should leave. The stamp already happened, which is
    // fine — a guard that errs toward not sending is the right kind of stale.
    if (args.ruleId && (!rule || rule.paused)) return null;

    // Suspension (docs/chat-agent.md §8). One failed row per owed send keeps
    // the stop visible in the thread and the failure counts; the alert lane
    // stays quiet (STEADY_STATE_FAILURES) because the operator did this on
    // purpose and one email per blocked reminder helps nobody.
    if ((org.status ?? "active") === "suspended") {
      const suspendedRow = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: org._id,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: args.kind,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId: suspendedRow,
        ok: false,
        error: "org-suspended",
      });
      return null;
    }

    const messageKind =
      (args.kind === "reminder" || args.kind === "followup") &&
      args.offsetHours !== undefined
        ? `${args.kind}_${args.offsetHours}h`
        : args.kind;

    // Exact language match, no cross-language fallback (Nudge lesson: the
    // wrong-language message is worse than no message). The template ROW is
    // the content source for both channels; Meta approval only gates the
    // WhatsApp send, not the email.
    //
    // Resolution order is the per-message-wording feature: this rule's own row
    // first, the kind-level row for everything the owner has not worded
    // specifically.
    const language = customer.language ?? org.language;
    // The content row and the Cloud registration, chosen by the same function
    // that tells the assistants in advance whether this send can go
    // (lib/lifecycleSend). The Cloud lane needs both halves of the Meta
    // registration: the approved status AND the name to send under. metaName
    // went optional the day orgs without a Cloud number stopped being forced
    // to invent one.
    //
    // Registration resolves SEPARATELY from content, and falls back to the
    // kind-level row: authoring per-rule wording must not cut off a Cloud lane
    // that was sending fine on the shared approved template. Until this rule's
    // own wording is registered and approved with Meta, Cloud sends the
    // generic approved string while email and the shop phone carry the words
    // the owner actually wrote.
    const { content: contentTemplate, registered: metaSource } = lifecycleTemplates(
      templates,
      rule,
      args.kind,
      language,
    );
    const cloudTemplate =
      metaSource
        ? {
            metaName: metaSource.metaName,
            language: metaSource.language,
            // From the SAME row as the name. metaParams describes the body
            // that row registered, so reading it off the content template
            // instead would fill one template's placeholders with another
            // template's tokens the moment those two rows differ — which is
            // the whole point of the fallback above.
            metaParams: metaSource.metaParams as string[] | undefined,
            // The registered body itself, for the honest stamp below: what
            // Meta DELIVERS is this text with the params filled, never the
            // rich body.
            submittedBody: metaSource.submittedBody as string | undefined,
            bodyPreview: metaSource.bodyPreview as string | undefined,
          }
        : undefined;

    const fail = async (reason: string) => {
      if (
        isOrgSetupFailure(reason) &&
        (await ctx.runQuery(internal.messages.hasRecentFailure, {
          orgId: appointment.orgId,
          error: reason,
        }))
      ) {
        // Already on record for this org. The alert below is suppressed for
        // these reasons anyway, so there is nothing else to do.
        return;
      }
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
      });
      // applySendResult alerts if this reason warrants it. Every reason that
      // reaches here is a local refusal, so it classifies permanent and fails
      // terminally rather than entering the retry queue — which is right: a
      // customer who never consented will not have consented in five minutes.
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: false,
        error: reason,
      });
    };

    // KVKK consent gates EVERY channel.
    if (customer.consentAt === undefined) {
      await fail("no-consent");
      return null;
    }

    // An ASAP goods order has no promised minute — startAt records when the
    // order was PLACED (convex/booking.ts book), and a confirmation printing
    // that minute back reads as a promise already broken ("your appointment
    // at 15:32", sent at 15:33). The phrase is picked to sit in the [date]
    // slot of each stock confirmation without breaking its grammar ("[date]
    // için alındı", "booked for [date]", "für [date] gebucht"). Confirmation
    // ONLY: the other kinds embed [date] in constructions a phrase cannot
    // fill ("[date] tarihli", "am [date]"), and a reminder never fires for a
    // start already in the past.
    const ASAP_WHEN: Record<string, string> = {
      tr: "en yakın zaman",
      en: "the earliest possible time",
      de: "den nächstmöglichen Zeitpunkt",
    };
    const when =
      appointment.fulfillment?.asap && args.kind === "confirmation"
        ? (ASAP_WHEN[language] ?? ASAP_WHEN.en)
        : formatAppointmentTime(appointment.startAt, org.timezone, language);
    // The authored body, when the owner has written one — named tokens, same
    // vocabulary as the composer and campaigns. The positional bodyPreview
    // survives only as the fallback for rows nobody has authored yet; it is a
    // transcription of Meta's approved string, not something the salon wrote.
    // Every org field key present, empty when this customer has no value —
    // so a real field always resolves (to nothing, cleanly) and only a token
    // nobody defined stays literal. See renderTokens.
    const customValues: Record<string, string> = {};
    for (const field of contactFields as { key: string }[]) {
      customValues[field.key] = customer.custom?.[field.key] ?? "";
    }
    // The appointment total for the [price] token, in the org's currency and
    // the message language. Items store integer minor units; no items or a
    // zero total renders as nothing rather than as a free appointment.
    const totalMinor = (
      (appointment.items ?? []) as { price?: number; quantity?: number }[]
    ).reduce((sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1), 0);
    // narrowSymbol, and the exponent from Intl rather than a hardcoded /100 —
    // i.e. lib/money.formatMoney, whose own comment names this exact case:
    // English renders TRY as the literal code ("TRY 400.00"), "which is what
    // you want in a table listing many currencies and wrong here". An org has
    // one currency, and this is the surface that reaches the customer, so the
    // dashboard was showing ₺400.00 while the reminder about that same
    // appointment said TRY 400.00.
    const formatMoney = (minor: number) =>
      formatMinorUnits(minor, org.currency ?? "TRY", language, org.priceDecimals);
    const price = totalMinor > 0 ? formatMoney(totalMinor) : undefined;
    // [pricelist] — the receipt look. An unpriced item keeps its bullet
    // without a dangling dash.
    const servicePriceList = appointment.items
      ?.map((item: { name: string; price?: number; quantity?: number }) => {
        const quantity = item.quantity ?? 1;
        const label = quantity > 1 ? `${quantity}× ${item.name}` : item.name;
        // The line's worth, not the unit price — a receipt line for three
        // cakes says what three cakes cost.
        // price === undefined, not falsy. A service priced 0 is "free", which
        // services.ts keeps deliberately distinct from "not priced" — and this
        // rendered both as a bare bullet, so a customer was never told the
        // consultation costs nothing. itemsTotal and lineWorth in
        // appointments.ts both test identity; this line was the holdout.
        return `• ${label}${
          item.price !== undefined ? ` — ${formatMoney(item.price * quantity)}` : ""
        }`;
      })
      .join("\n");
    const tokenValues = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: org.name,
      appointmentAt: when,
      staffName: staffRow?.name,
      // The BUSINESS's number and link, not the customer's — [phone] is "call
      // us here" in a message the salon sends. See renderTokens.
      phone: org.publicPhone,
      email: customer.email,
      bookingLink: org.bookingUrl,
      // The appointment's own reschedule/cancel page. SITE_URL is deployment
      // config; without it the token renders as nothing rather than a
      // localhost link in a customer's inbox.
      manageLink:
        appointment.manageToken && process.env.SITE_URL
          ? `${process.env.SITE_URL}/appt/${appointment.manageToken}`
          : undefined,
      // One bullet line per booked service — [service] renders as a LIST, so
      // the stock texts put it on its own paragraph rather than mid-sentence.
      serviceName: appointment.items
        ?.map((item: { name: string; quantity?: number }) =>
          (item.quantity ?? 1) > 1 ? `• ${item.quantity}× ${item.name}` : `• ${item.name}`,
        )
        .join("\n"),
      servicePriceList,
      price,
      custom: customValues,
    };
    // The template's own "when empty, print…" table, so a token this
    // customer has no value for still says something (schema:
    // waTemplates.variableDefaults).
    const defaults = tokenDefaults(contentTemplate?.variableDefaults);
    // What fills {{1}}..{{n}} in the Meta template.
    //
    // From metaParams when the template was submitted through the app, which
    // records WHICH token is behind each placeholder — so the salon's own
    // sentence gets its own parameters instead of everyone being stuck with
    // the one sentence the fixed triple could express.
    //
    // The triple stays as the fallback, and it is not legacy debris: it is
    // exactly what every template registered by hand in Business Manager
    // declares ({{1}} first name, {{2}} business, {{3}} date+time), so those
    // keep sending untouched.
    const metaParams = (cloudTemplate as { metaParams?: string[] } | undefined)
      ?.metaParams;
    const bodyParams = metaParams?.length
      ? metaParams.map((key) => {
          const value = (tokenValues as Record<string, unknown>)[key];
          const text = typeof value === "string" ? value.trim() : "";
          // Meta rejects an EMPTY parameter outright (132000) and takes the
          // whole message down with it, so a token this customer has no value
          // for falls to the owner's default and then to a dash. A dash in one
          // sentence beats a reminder nobody receives.
          //
          // Newlines and runs of spaces are rejected the same way. Those are
          // refused at submit time (lib/metaTemplate UNSENDABLE), but a value
          // can still arrive with one — a business name someone pasted across
          // two lines — so it is flattened here rather than trusted.
          const filled = text || defaultForKey(key, defaults) || "-";
          return filled.replace(/\s+/g, " ");
        })
      : [customer.firstName, org.name, when];
    const body = contentTemplate?.body
      ? renderTokens(contentTemplate.body, tokenValues, defaults)
      : contentTemplate?.bodyPreview
        ? contentTemplate.bodyPreview
            .replace(/\{\{1\}\}/g, customer.firstName)
            .replace(/\{\{2\}\}/g, org.name)
            .replace(/\{\{3\}\}/g, when)
        : undefined;

    // What the customer's PHONE will actually show for a Cloud template send:
    // the REGISTERED body with the very params this send carries. Never the
    // rich body — that one keeps [pricelist] and [manage_link] for Evolution
    // and email, while the Cloud lane's registered texts deliberately drop
    // them (the buttons are the manage link's job, lib/metaTemplate). Stamping
    // the rich body on Cloud rows made the thread show a manage URL and a
    // price list the phone never received (Serdar, 2026-09-01) — the bubble
    // must tell the truth about what went out, the same frozen-snapshot rule
    // Nudge's wa_cloud lane follows. submittedBody is named tokens in
    // metaParams order; bodyPreview is the hand-registered positional
    // fallback ({{1}} first name, {{2}} business, {{3}} date+time), which the
    // fallback bodyParams triple matches by construction.
    const deliveredBody = (() => {
      if (!cloudTemplate) return body;
      if (cloudTemplate.submittedBody && cloudTemplate.metaParams?.length) {
        let out = cloudTemplate.submittedBody;
        cloudTemplate.metaParams.forEach((key, i) => {
          out = out.split(`[${key}]`).join(bodyParams[i] ?? "-");
        });
        return out;
      }
      if (cloudTemplate.bodyPreview) {
        return cloudTemplate.bodyPreview.replace(
          /\{\{(\d+)\}\}/g,
          (_, n: string) => bodyParams[Number(n) - 1] ?? "-",
        );
      }
      return body;
    })();

    // ---- Demo org: nothing leaves the building.
    //
    // Checked BEFORE the waAccount test, not after: the demo org deliberately
    // has no credentials, so the ordinary path would fail it as
    // "wa-not-configured" and the showroom would be a wall of red rows. The
    // simulated send never constructs a request at all.
    if (isDemo(org)) {
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
        templateName: contentTemplate?.metaName,
        templateParams: bodyParams,
        // The demo simulates the Cloud lane, so its rows carry what a real
        // send would have stamped — gated the same way (a template actually
        // named, a kind that attaches buttons).
        buttonLabels:
          contentTemplate?.metaName && buttonsFor(args.kind)
            ? buttonLabelsFor(language)
            : undefined,
        // The same honest stamp as the real Cloud branch — the demo's rows
        // carry what a real send would have.
        body: deliveredBody,
      });
      await ctx.runMutation(internal.demo.landSimulated, {
        messageId,
        orgId: appointment.orgId,
        customerId: customer._id,
      });
      if (args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
      return null;
    }

    // Which channel(s) this message rides. The RULE owns the choice now — the
    // 24h reminder can be WhatsApp while the review ask goes by mail; the org
    // preference survives as the legacy default. "email" skips the WhatsApp
    // attempt entirely — including its failure rows, because a channel the
    // owner switched off cannot be broken.
    const channelPref = rule?.channel ?? org.messageChannel ?? "both";

    // ---- WhatsApp attempt. Failures log a visible row and do NOT block the
    // email lane — an unconfigured number is exactly what the Messages tab
    // needs to show the owner.
    const available = laneAvailability({
      org,
      waAccount,
      evolutionConfigured: Boolean(evolution),
    });
    // Rule 2: Cloud wins whenever it exists. A confirmation or a reminder is
    // first contact after silence, which is precisely what Evolution drops
    // silently (Reachout Timelock, ACK 463, while the send returns success).
    const lane = channelPref === "email" ? null : laneForOutbound(available);
    // Which lane goes, or why none does: lib/lifecycleSend, the same verdict
    // the assistants read in advance to know whether this message will reach
    // the customer (2026-10-13).
    const onWhatsApp = whatsappVerdict({
      channel: channelPref,
      lane,
      cloud: Boolean(waAccount),
      evolution: Boolean(evolution),
      hasWords: Boolean(body),
      registered: Boolean(cloudTemplate),
      language,
    });

    if (onWhatsApp.send === "evolution" && evolution && body) {
      // No Meta template here and none needed — this lane has no approval to
      // satisfy (its need for words is the verdict's). What the buttons would
      // have been, in words: Baileys never delivers quick replies, so the
      // customer is told which words to type, and webhook.ts already
      // understands every one of them.
      const text = `${body}\n\n${evolutionReplyHint(language)}`;
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
        body: text,
        lane: "evolution",
      });
      const result = await sendEvolutionText({
        baseUrl: evolution.baseUrl,
        apiKey: evolution.apiKey,
        instance: evolution.instance,
        to: customer.phone,
        body: text,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: result.ok,
        wamid: result.ok ? result.messageId : undefined,
        error: result.ok ? undefined : result.reason,
      });
      if (result.ok && args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
    } else if (onWhatsApp.send === null) {
      // No WhatsApp send. Silent when the owner chose email-only (the rows
      // would tell them a channel they switched off is broken) or never
      // connected WhatsApp at all (the rule stays "both" until someone edits
      // it, and the editor already shows such a business "Email"). Only total
      // absence is silent: a business that HAS WhatsApp and cannot send logs
      // the row (wa-not-configured, no-approved-template-<lang>), because that
      // one is a real fault and hiding it is how deliveries fail unnoticed. A
      // shop phone with no words to send (a row nobody authored once sent the
      // customer the string "undefined") ends the send there.
      if (onWhatsApp.reason) await fail(onWhatsApp.reason);
      if (onWhatsApp.stop) return null;
    } else if (onWhatsApp.send === "cloud" && waAccount && cloudTemplate) {
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
        templateName: cloudTemplate.metaName,
        templateParams: bodyParams,
        // Stamped in the language of the template that is going out — the
        // exact words Meta will draw under the customer's copy. buttonsFor
        // mirrors the send below, which passes the two payloads on every
        // lifecycle kind; the gate keeps the stamp honest if a button-less
        // kind ever routes through here.
        buttonLabels: buttonsFor(args.kind)
          ? buttonLabelsFor(cloudTemplate.language)
          : undefined,
        body: deliveredBody,
      });
      const result = await sendWaCloudTemplate({
        accessToken: waAccount.accessToken,
        phoneNumberId: waAccount.phoneNumberId,
        to: customer.phone,
        templateName: cloudTemplate.metaName,
        languageCode: cloudTemplate.language,
        bodyParams,
        buttons: [
          { index: 0, payload: `confirm:${appointment._id}` },
          { index: 1, payload: `cancel:${appointment._id}` },
        ],
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: result.ok,
        wamid: result.ok ? result.wamid : undefined,
        error: result.ok ? undefined : result.reason,
      });
      if (result.ok && args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
    }

    // Email lane: rides alongside WhatsApp (or replaces it, when the owner
    // chose email-only) for customers with an address and an org with a From.
    // No Meta approval applies to email, so the authored body sends as-is.
    //
    // On "both", a customer this cannot reach is skipped silently — WhatsApp
    // already carried the message or logged its own failure. On email-only
    // there is no other channel to blame, so every reason nothing went out
    // becomes a visible row: an owner who chose email and set no From, or a
    // customer with no address, must not produce a reminder that vanishes.
    // The From address, resolved rather than required: the salon's own domain
    // if they have one, otherwise the address they already own on ours.
    const sender = customerSender(org, mailConfig);
    // Switched off on a WhatsApp-only rule, skipped silently on "both" for a
    // customer it cannot reach, a visible row on email-only: the verdict in
    // lib/lifecycleSend, shared with the assistants' advance check.
    const byEmail = emailVerdict({
      channel: channelPref,
      configured: emailLaneConfigured(mailConfig),
      sender: Boolean(sender),
      address: Boolean(customer.email),
      hasWords: Boolean(body),
      language,
    });
    if (byEmail.reason) {
      await fail(byEmail.reason);
    } else if (byEmail.send && customer.email && sender && body) {
      // The authored subject, rendered with the same tokens as the body. The
      // "name, time" fallback covers rows without one — and an authored
      // subject that renders to nothing for this customer falls through too,
      // because an empty subject line reads as spam.
      const subject =
        (contentTemplate?.subject
          ? renderTokens(contentTemplate.subject, tokenValues, defaults)
          : "") || `${org.name}, ${when}`;
      // The WYSIWYG-authored HTML when there is one — signature tables and
      // all — otherwise the plain body wrapped the way it always was. Tokens
      // render in either; they are literal text in both representations. The
      // service list swaps its newlines for <br/> here, because inside HTML a
      // bare \n is just a space and the list would flatten to one line.
      const emailHtml = contentTemplate?.bodyHtml
        ? renderTokens(
            contentTemplate.bodyHtml,
            {
              ...tokenValues,
              serviceName: tokenValues.serviceName?.replace(/\n/g, "<br/>"),
              servicePriceList: tokenValues.servicePriceList?.replace(/\n/g, "<br/>"),
            },
            defaults,
          )
        : emailBodyHtml(body);
      // Replies come back to US, not to whatever mailbox the From address
      // belongs to — same wiring as email.sendToCustomer, and for the same
      // reason: an answer that lands in a personal inbox never reaches the
      // timeline.
      const domain = mailConfig.domain;
      const replyTo =
        org.inboundAddress && domain
          ? `${org.inboundAddress}@${domain}`
          : undefined;
      // Every rule email counts and tracks now — the editor shows each
      // message's sent count, open rate and reply rate, so the numbers
      // finally report somewhere. Still a RATE over the template, never a
      // per-customer fact; recordEmailOpen's prefetch guard and the relay
      // caveat apply as ever.
      const tracked = contentTemplate;
      const trackingToken = tracked ? crypto.randomUUID() : undefined;
      // Confirmations carry the appointment as a real calendar invite;
      // cancellations carry the retraction under the same UID, so the entry
      // the invite created disappears again. Only these two kinds: a reminder
      // re-attaching the invite would re-prompt "add to calendar" for an event
      // the customer already holds, and a winback has no event at all.
      const ics =
        args.kind === "confirmation" || args.kind === "cancellation"
          ? {
              method: args.kind === "confirmation" ? ("REQUEST" as const) : ("CANCEL" as const),
              content: appointmentIcs({
                method: args.kind === "confirmation" ? "REQUEST" : "CANCEL",
                uid: String(appointment._id),
                startAtMs: appointment.startAt,
                durationMinutes:
                  appointment.durationMinutes ??
                  appointment.items?.reduce(
                    (sum: number, item: { durationMinutes: number }) =>
                      sum + item.durationMinutes,
                    0,
                  ) ??
                  30,
                summary: appointment.items?.length
                  ? `${org.name} — ${appointment.items
                      .map((item: { name: string }) => item.name)
                      .join(", ")}`
                  : org.name,
                ...(staffRow?.name ? { description: staffRow.name } : {}),
                organizerName: org.name,
                organizerEmail: sender,
                attendeeName:
                  [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
                  customer.email,
                attendeeEmail: customer.email,
                sequence: appointment.icsSequence,
              }),
            }
          : undefined;
      const emailMessageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: `email_${messageKind}`,
        body,
        // On the row from the start, so the thread shows the real subject and
        // a retry reuses it instead of rebuilding a different one.
        emailSubject: subject,
        // The resolved From, not the org's raw field: a retry has to leave
        // from the same address this attempt did, and the row is what the
        // retry reads.
        emailFrom: sender,
        trackingToken,
        templateId: tracked ? contentTemplate._id : undefined,
      });
      const emailResult = await sendEmail({
        apiKey: mailConfig.apiKey,
        from: sender,
        to: customer.email,
        subject,
        html: withOpenPixel(emailHtml, trackingToken),
        replyTo,
        ics,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId: emailMessageId,
        ok: emailResult.ok,
        error: emailResult.ok ? undefined : emailResult.reason,
      });
      // On "both", the WhatsApp branches own this stamp. Email-only has no
      // other branch to do it, and an unstamped confirmation reads as never
      // sent.
      if (emailResult.ok && channelPref === "email" && args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
    }
    return null;
  },
});

// The org's WhatsApp credentials, for the media download below. Its own query
// rather than reusing loadSendContext, which loads a customer this has no
// business reading.
export const accountForOrg = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.union(v.object({ accessToken: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const account = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .unique(),
    );
    return account ? { accessToken: account.accessToken } : null;
  },
});

// ---- Inbound media download ----
//
// Every attachment, not just photos: a voice note is a reply somebody spoke
// instead of typing, and a price list a supplier sends back is a document the
// salon needs to open.
//
// Scheduled by the webhook, never awaited by it. Meta retries a webhook it
// does not get a fast 200 for, so doing two network round-trips inside the
// handler would turn one slow download into duplicate deliveries of the whole
// message.
export const downloadInboundMedia = internalAction({
  args: {
    orgId: v.id("orgs"),
    messageId: v.id("messages"),
    mediaId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.runQuery(internal.wa.accountForOrg, {
      orgId: args.orgId,
    });
    if (!account) {
      // Clear the flag anyway. A row stuck "pending" forever shows a spinner
      // that will never resolve, which is worse than a message with no image.
      await ctx.runMutation(internal.messages.attachMedia, {
        messageId: args.messageId,
      });
      return null;
    }
    const media = await fetchWaMedia({
      accessToken: account.accessToken,
      mediaId: args.mediaId,
    });
    if (!media) {
      await ctx.runMutation(internal.messages.attachMedia, {
        messageId: args.messageId,
      });
      return null;
    }
    const storageId = await ctx.storage.store(media.blob);
    await ctx.runMutation(internal.messages.attachMedia, {
      messageId: args.messageId,
      storageId,
      contentType: media.contentType,
    });
    return null;
  },
});

// ---- Scheduled sends ----

// Context for the DISPATCH of a parked message. Deliberately not
// loadSessionContext: that one begins with requireOrg because its caller is a
// signed-in composer, and this one's caller is a CRON — scheduled functions
// carry no auth identity, so requireOrg throws "not-signed-in" and the whole
// dispatch tick died on the first due message (found 2026-08-11; the claimed
// row then hung in flight until the reaper failed it as "stuck"). The org
// comes from the CUSTOMER row instead, which the message row named — the same
// sessionless resolution loadAwayReplyContext uses, and the same scoping
// guarantee: the org is read off our own stored rows, never off caller input.
export const loadScheduledSendContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || isDeleting(customer)) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const waAccount = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .unique(),
    );
    const evolution = await loadEvolutionCreds(ctx, customer.orgId, org.evolutionInstance);
    return { customer, org, waAccount, evolution };
  },
});

export const dueScheduled = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      messageId: v.id("messages"),
      customerId: v.id("customers"),
      // Optional because an image on its own is a legitimate message; with one
      // attached this is the caption.
      body: v.optional(v.string()),
      mediaStorageId: v.optional(v.id("_storage")),
      // Set when the attachment is a document, and it is the name the
      // customer will see. Read off the ROW rather than re-resolved from the
      // library: this is the record of what was composed, and a file renamed
      // in the hour between writing and sending must not change what goes out.
      mediaFileName: v.optional(v.string()),
      // What the attachment IS, so dispatch picks the right Meta payload
      // type (video vs image; a document already declares itself by name).
      mediaContentType: v.optional(v.string()),
      // Which number this was written to go out on. Unset = cloud.
      lane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_status_scheduled", (q) =>
        // Above zero excludes rows with no scheduledFor at all — unset sorts
        // before every number, so without it this range reads every queued
        // message on the deployment, including ones merely waiting on a retry.
        q.eq("status", "queued").gt("scheduledFor", 0).lte("scheduledFor", Date.now()),
      )
      .take(100);
    return rows
      .filter((row) => row.customerId && (row.body || row.mediaStorageId))
      .map((row) => ({
        messageId: row._id,
        customerId: row.customerId!,
        body: row.body,
        mediaStorageId: row.mediaStorageId,
        mediaFileName: row.mediaFileName,
        mediaContentType: row.mediaContentType,
        lane: row.lane,
      }));
  },
});

// Clears the parked marker the moment dispatch starts, BEFORE the send. Same
// ordering the reminder cron uses, and for the same reason: two overlapping
// ticks must not both decide a message is still due.
export const claimScheduled = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row || row.status !== "queued" || row.scheduledFor === undefined) return false;
    // Cancelled rather than sent when its customer is being deleted. The
    // deletion cancels queued rows itself; this is the race where the cron
    // read the row first. Deleting is how a parked send is cancelled
    // (cancelScheduled below), and the row was going with the customer anyway.
    if (row.customerId) {
      const customer = await ctx.db.get(row.customerId);
      if (!customer || isDeleting(customer)) {
        await ctx.db.delete(args.messageId);
        return false;
      }
    }
    // sendingAt marks it in flight so delivery.reapStuck can find it if this
    // action dies before reporting a result. Without it a parked send whose
    // dispatch was killed would sit queued with nothing left to pick it up.
    await ctx.db.patch(args.messageId, {
      scheduledFor: undefined,
      sendingAt: Date.now(),
    });
    return true;
  },
});

export const sendDueScheduled = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.wa.dueScheduled, {});
    for (const item of due) {
      const claimed = await ctx.runMutation(internal.wa.claimScheduled, {
        messageId: item.messageId,
      });
      if (!claimed) continue;
      // The sessionless context — see loadScheduledSendContext above for why
      // loadSessionContext must never be called from this cron.
      const context = await ctx.runQuery(internal.wa.loadScheduledSendContext, {
        customerId: item.customerId,
      });
      // The demo boundary, restored: sendSession parks a scheduled row BEFORE
      // its demo branch, so this dispatch is the first point a demo org's
      // parked message could reach a provider. Simulate it instead — the same
      // promise every immediate send path keeps, checked before credentials
      // for the same reason (the demo org has none by design).
      if (context && isDemo(context.org)) {
        await ctx.runMutation(internal.demo.landSimulated, {
          messageId: item.messageId,
          orgId: context.org._id,
          customerId: item.customerId,
        });
        continue;
      }
      // The lane comes off the ROW, set when the salon wrote the message. A
      // reply parked at 23:00 for 10:00 has to leave from the number the
      // conversation is on, not from whatever the org has configured by then.
      const lane = item.lane ?? "cloud";
      if (!context || (lane === "cloud" ? !context.waAccount : !context.evolution)) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: lane === "cloud" ? "wa-not-configured" : "evolution-not-configured",
        });
        continue;
      }
      const { customer, waAccount, evolution } = context;
      // Suspension re-checked at dispatch, like the window below: the org may
      // have been suspended between parking the message and its moment.
      if ((context.org?.status ?? "active") === "suspended") {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: "org-suspended",
        });
        continue;
      }
      // Re-checked HERE, not at scheduling time. The 24h window a message was
      // written inside may have shut before its moment arrived, and Meta will
      // reject the send rather than deliver it late. Evolution is a linked
      // handset with no such window, so it is exempt for the same reason the
      // immediate path is.
      if (
        lane === "cloud" &&
        (!customer.lastInboundAt ||
          Date.now() - customer.lastInboundAt > SESSION_WINDOW_MS)
      ) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: "session-window-closed",
        });
        continue;
      }
      // Refused, not silently downgraded. Evolution is text-only here for the
      // reason the immediate path states, and that is fine — what was not fine
      // is that this branch dropped the attachment, sent the caption alone, and
      // reported ok:true, so the row went to "sent" and the staff thread
      // rendered a photo the customer never received.
      if (lane === "evolution" && item.mediaStorageId) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: EVOLUTION_NO_MEDIA,
        });
        continue;
      }
      const link =
        lane === "cloud" && item.mediaStorageId
          ? await ctx.storage.getUrl(item.mediaStorageId)
          : null;
      const result = evolution && lane === "evolution"
        ? await sendEvolutionText({
            baseUrl: evolution.baseUrl,
            apiKey: evolution.apiKey,
            instance: evolution.instance,
            to: customer.phone,
            body: item.body ?? "",
          }).then((sent) =>
            sent.ok
              ? ({ ok: true as const, wamid: sent.messageId })
              : ({ ok: false as const, reason: sent.reason }),
          )
        : !waAccount
          ? ({ ok: false as const, reason: "wa-not-configured" })
          : item.mediaStorageId && link
          ? item.mediaFileName
            ? await sendWaCloudDocument({
                accessToken: waAccount.accessToken,
                phoneNumberId: waAccount.phoneNumberId,
                to: customer.phone,
                link,
                fileName: item.mediaFileName,
                caption: item.body || undefined,
              })
            : item.mediaContentType?.startsWith("video/")
              ? await sendWaCloudVideo({
                  accessToken: waAccount.accessToken,
                  phoneNumberId: waAccount.phoneNumberId,
                  to: customer.phone,
                  link,
                  caption: item.body || undefined,
                })
              : await sendWaCloudImage({
                  accessToken: waAccount.accessToken,
                  phoneNumberId: waAccount.phoneNumberId,
                  to: customer.phone,
                  link,
                  caption: item.body || undefined,
                })
          : await sendWaCloudText({
              accessToken: waAccount.accessToken,
              phoneNumberId: waAccount.phoneNumberId,
              to: customer.phone,
              body: item.body ?? "",
            });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId: item.messageId,
        ok: result.ok,
        wamid: result.ok ? result.wamid : undefined,
        error: result.ok ? undefined : result.reason,
      });
    }
    return null;
  },
});

// Cancel a parked send. Deletes the row rather than marking it cancelled: it
// never reached anybody, so leaving a tombstone in the customer's thread
// records a conversation that did not happen.
export const cancelScheduled = mutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const row = await ctx.db.get(args.messageId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    // Already gone out — nothing to cancel, and pretending otherwise would be
    // telling the salon a message was stopped when the customer has it.
    if (row.scheduledFor === undefined || row.status !== "queued") return null;
    await ctx.db.delete(args.messageId);
    // It may have been the newest entry the inbox row was previewing.
    if (row.customerId) await recomputeThread(ctx, row.customerId);
    return null;
  },
});
