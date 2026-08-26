// Getting a template approved by Meta, from inside the app.
//
// Before this, approval was a two-window job with a lie in the middle: the
// owner wrote the message here, re-typed it into Business Manager, created the
// template there by hand, and then came back to set a dropdown that said
// "approved" — a dropdown which made nothing true. If they mistyped the name,
// every send failed with a Meta error nobody could read. If review rejected
// the template, the app never found out and kept trying.
//
// Now the row IS the submission. It goes to Meta with the words the salon
// wrote, comes back with a real status, and says why when the answer is no.
//
// Three things arrive from Meta, and all three are handled:
//   1. the create/edit response  — immediate, gives us the template id
//   2. message_template_status_update — the webhook, the normal path
//   3. syncFromMeta               — the pull, for templates made by hand and
//                                   for webhooks that never came

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireOwner } from "./lib/orgAuth";
import { resolveWaAccount } from "./lib/platformConfig";
import { WA_CLOUD_GRAPH_BASE } from "./lib/waCloud";
import {
  CAMPAIGN_EXAMPLES,
  CAMPAIGN_PARAMS,
  campaignBodyFor,
  categoryFor,
  componentsFor,
  metaLanguageFor,
  metaNameFor,
  normalizeMetaStatus,
  toPositionalBody,
} from "./lib/metaTemplate";

// ---- Reads --------------------------------------------------------------

export const loadForSubmit = internalQuery({
  args: { templateId: v.id("waTemplates") },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Owner-only, like every other template edit: submitting commits the
    // business to a review under its own WABA.
    const { orgId } = await requireOwner(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== orgId) return null;
    const waAccount = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique(),
    );
    // The WABA id lives on the row itself and is never resolved from the
    // platform fallback: approvals belong to a business, and borrowing the
    // platform's WABA would register this salon's wording on somebody else's.
    const own = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    return { template, waAccount, wabaId: own?.wabaId };
  },
});

export const listForOrgInternal = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, args) =>
    await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

// ---- Writes -------------------------------------------------------------

export const recordSubmission = internalMutation({
  args: {
    templateId: v.id("waTemplates"),
    metaName: v.string(),
    metaTemplateId: v.optional(v.string()),
    metaWabaId: v.string(),
    metaParams: v.array(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    metaStatusDetail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, {
      metaName: args.metaName,
      metaTemplateId: args.metaTemplateId,
      metaWabaId: args.metaWabaId,
      metaParams: args.metaParams,
      status: args.status,
      metaStatusDetail: args.metaStatusDetail,
      // Cleared on every submission. A reason from the last rejection sitting
      // under a template that is now pending reads as the current verdict.
      metaRejectionReason: undefined,
      submittedAt: Date.now(),
    });
    return null;
  },
});

// The webhook's write, and the sync's. Resolves by Meta's template id first —
// the only globally unique key — and falls back to (WABA, name, language) for
// a template created in Business Manager that we have adopted but never had an
// id for.
export const applyStatusUpdate = internalMutation({
  args: {
    metaTemplateId: v.optional(v.string()),
    wabaId: v.optional(v.string()),
    metaName: v.optional(v.string()),
    language: v.optional(v.string()),
    // Meta's raw word.
    status: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let row = args.metaTemplateId
      ? await ctx.db
          .query("waTemplates")
          .withIndex("by_meta_template_id", (q) =>
            q.eq("metaTemplateId", args.metaTemplateId),
          )
          .first()
      : null;
    if (!row && args.wabaId && args.metaName) {
      // Unindexed on purpose: this is the fallback for rows that never had an
      // id, it runs once per template per lifetime, and the alternative is an
      // index that exists for a path taken almost never.
      const candidates = await ctx.db.query("waTemplates").collect();
      row =
        candidates.find(
          (t) =>
            t.metaWabaId === args.wabaId &&
            t.metaName === args.metaName &&
            (!args.language || t.language === args.language),
        ) ?? null;
    }
    if (!row) {
      // A template on the WABA that this app did not create — registered in
      // Business Manager, or belonging to another product sharing the account.
      // Nothing to update, and inventing a row for it would put a template
      // nobody here wrote into a salon's settings.
      console.warn(
        `wa template status: no row for ${args.metaTemplateId ?? args.metaName ?? "?"}`,
      );
      return null;
    }
    const status = normalizeMetaStatus(args.status);
    await ctx.db.patch(row._id, {
      status,
      metaStatusDetail: args.status.trim().toUpperCase(),
      // Undefined DELETES the field, which is right: an approval clears the
      // reason the previous rejection gave.
      metaRejectionReason: status === "rejected" ? args.reason || undefined : undefined,
      // Learned late for a hand-made template the sync just matched by name.
      ...(row.metaTemplateId ? {} : { metaTemplateId: args.metaTemplateId }),
    });
    return null;
  },
});

// ---- Submit -------------------------------------------------------------

export const submit = action({
  args: { templateId: v.id("waTemplates") },
  returns: v.object({
    ok: v.boolean(),
    // A slug the UI translates, never a sentence built here — the owner reads
    // this in Turkish and the server has no business picking the language.
    reason: v.optional(v.string()),
    // Meta's own words when review or the API objected. Shown verbatim under
    // the translated line, because "Invalid parameter" from Meta is more use
    // than a generic failure from us.
    detail: v.optional(v.string()),
    // Tokens the body uses that cannot be template parameters, so the UI can
    // name them instead of saying "it didn't work".
    rejectedTokens: v.optional(v.array(v.string())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    reason?: string;
    detail?: string;
    rejectedTokens?: string[];
  }> => {
    const context = await ctx.runQuery(internal.waTemplates.loadForSubmit, {
      templateId: args.templateId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    const { template, waAccount, wabaId } = context;
    if (!waAccount) return { ok: false, reason: "wa-not-configured" };
    if (!wabaId) return { ok: false, reason: "no-waba-id" };

    // out_of_hours is session text by design — the customer just wrote, so the
    // window is open and no approval applies. Submitting one would register a
    // template that nothing will ever send.
    if (template.kind === "out_of_hours") {
      return { ok: false, reason: "kind-not-templated" };
    }
    const body = (template.body ?? "").trim();
    if (!body) return { ok: false, reason: "no-body" };
    const language = metaLanguageFor(template.language);
    if (!language) return { ok: false, reason: "language-unsupported" };

    // The campaign template registers a fixed wrapper rather than the row's
    // words: campaigns.ts fills {{3}} with the whole message the owner types
    // per run, which is what makes one approval serve every campaign. Reading
    // the row's tokens here would register a template the send cannot fill.
    const campaign = template.kind === "campaign";
    const wrapper = campaign ? campaignBodyFor(template.language) : null;
    if (campaign && !wrapper) return { ok: false, reason: "language-unsupported" };
    const { text, variables, rejected } = campaign
      ? { text: wrapper!, variables: CAMPAIGN_PARAMS, rejected: [] as string[] }
      : toPositionalBody(body);
    if (rejected.length > 0) {
      // Refused rather than stripped. A [service] list silently removed from
      // an approved template is a message that goes out for months saying
      // less than the salon wrote and believes it is sending.
      return { ok: false, reason: "tokens-not-sendable", rejectedTokens: rejected };
    }
    // Meta's ceiling. Worth catching here: the API answers a 1024-char body
    // with a generic parameter error that reads like a bug in the payload.
    if (text.length > 1024) return { ok: false, reason: "body-too-long" };

    const metaName = template.metaName?.trim() || metaNameFor(template.kind, template.language);
    const components = componentsFor({
      kind: template.kind,
      language: template.language,
      text,
      variables,
      examples: campaign ? CAMPAIGN_EXAMPLES[template.language] : undefined,
    });
    const category = categoryFor(template.kind);

    // CREATE vs EDIT. Meta refuses a create whose (name, language) already
    // exists on the WABA, so a template that has been submitted before can
    // only be changed through the edit endpoint on its own id. An edit sends
    // it back into review while the approved version keeps delivering.
    //
    // The category is NOT sent on an edit: Meta locks it at approval and
    // answers a change with an error, which would fail an edit whose only
    // real change was the wording.
    const editingId: string | undefined = template.metaTemplateId;
    const url = editingId
      ? `${WA_CLOUD_GRAPH_BASE}/${encodeURIComponent(editingId)}`
      : `${WA_CLOUD_GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates`;
    const payload = editingId
      ? { components }
      : { name: metaName, language, category, components };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${waAccount.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return {
        ok: false,
        reason: "meta-unreachable",
        detail: err instanceof Error ? err.message : undefined,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      category?: string;
      success?: boolean;
      error?: { message?: string; error_user_msg?: string; code?: number };
    };
    if (!res.ok || json.error) {
      return {
        ok: false,
        reason: "meta-refused",
        // error_user_msg is the sentence Meta writes for a human; message is
        // the one it writes for a log. Prefer the human one when it exists.
        detail:
          json.error?.error_user_msg ??
          json.error?.message ??
          `HTTP ${res.status}`,
      };
    }

    await ctx.runMutation(internal.waTemplates.recordSubmission, {
      templateId: args.templateId,
      metaName,
      // An edit returns { success: true } and no id — it already had one.
      metaTemplateId: json.id ?? template.metaTemplateId,
      metaWabaId: wabaId,
      metaParams: variables,
      // Meta usually answers PENDING and reviews asynchronously, but a
      // template it can auto-approve comes back APPROVED in this same
      // response. Reading it beats waiting for a webhook that will not come.
      status: json.status ? normalizeMetaStatus(json.status) : "pending",
      metaStatusDetail: json.status?.toUpperCase(),
    });
    return { ok: true };
  },
});

// ---- Sync ---------------------------------------------------------------

// Pull every template on the org's WABA and reconcile.
//
// The webhook is the normal path and this is the safety net, for the two cases
// it cannot cover: a template registered in Business Manager before this
// screen existed (which is every template on the deployment today), and a
// status update that never arrived because the app was not subscribed to the
// field yet. Also the only way to notice a template someone DELETED at Meta,
// which produces no webhook the app will match.
export const syncFromMeta = action({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    matched: v.optional(v.number()),
  }),
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; reason?: string; matched?: number }> => {
    const context = await ctx.runQuery(internal.waTemplates.loadSyncContext, {});
    if (!context) return { ok: false, reason: "not-found" };
    const { waAccount, wabaId, orgId } = context;
    if (!waAccount) return { ok: false, reason: "wa-not-configured" };
    if (!wabaId) return { ok: false, reason: "no-waba-id" };

    // 250 is Meta's practical page ceiling and far past what one salon has.
    const url =
      `${WA_CLOUD_GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates` +
      `?limit=250&fields=id,name,language,status,category,rejected_reason`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${waAccount.accessToken}` },
      });
    } catch {
      return { ok: false, reason: "meta-unreachable" };
    }
    if (!res.ok) return { ok: false, reason: "meta-refused" };
    const json = (await res.json().catch(() => ({}))) as {
      data?: {
        id?: string;
        name?: string;
        language?: string;
        status?: string;
        rejected_reason?: string;
      }[];
    };

    const rows = await ctx.runQuery(internal.waTemplates.listForOrgInternal, {
      orgId,
    });
    let matched = 0;
    for (const remote of json.data ?? []) {
      if (!remote.name || !remote.status) continue;
      // Matched on the pair Meta itself treats as unique. A row whose
      // metaName the owner typed by hand is adopted here, which is how the
      // templates that exist today get their real status and their id without
      // anybody re-registering them.
      const row = (rows as { _id: string; metaName?: string; language: string }[]).find(
        (t) => t.metaName === remote.name && t.language === remote.language,
      );
      if (!row) continue;
      matched++;
      await ctx.runMutation(internal.waTemplates.applyStatusUpdate, {
        metaTemplateId: remote.id,
        wabaId,
        metaName: remote.name,
        language: remote.language,
        status: remote.status,
        // Meta names the reason as a slug ("INCORRECT_CATEGORY"), which is
        // still the answer to "why was this refused".
        reason: remote.rejected_reason,
      });
    }
    return { ok: true, matched };
  },
});

export const loadSyncContext = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const { orgId } = await requireOwner(ctx);
    const own = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    return {
      orgId,
      wabaId: own?.wabaId,
      waAccount: await resolveWaAccount(ctx, own),
    };
  },
});
