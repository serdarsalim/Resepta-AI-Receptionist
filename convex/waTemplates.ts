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
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireOwner } from "./lib/orgAuth";
import { requirePlatformAdmin } from "./lib/platformAuth";
import { resolveWaAccount } from "./lib/platformConfig";
import { WA_CLOUD_GRAPH_BASE } from "./lib/waCloud";
import {
  CAMPAIGN_EXAMPLES,
  CAMPAIGN_PARAMS,
  buttonsFor,
  campaignBodyFor,
  categoryFor,
  cloudBodyFor,
  componentsFor,
  metaLanguageFor,
  metaNameFor,
  normalizeMetaStatus,
  toPositionalBody,
} from "./lib/metaTemplate";
import { DEFAULT_TEMPLATE_TEXTS } from "./lib/templateTexts";

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
    metaCategory: v.optional(v.string()),
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
      // Only when Meta answered one — an EDIT response carries no category,
      // and an absent key must not erase the landed one.
      ...(args.metaCategory ? { metaCategory: args.metaCategory } : {}),
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
    category: v.optional(v.string()),
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
      // The landed category, when the caller learned one (the sync pull
      // does; the status webhook does not) — review recategorises, and the
      // landed value is what sends are billed at.
      ...(args.category ? { metaCategory: args.category.toLowerCase() } : {}),
      // Learned late for a hand-made template the sync just matched by name.
      ...(row.metaTemplateId ? {} : { metaTemplateId: args.metaTemplateId }),
    });
    return null;
  },
});

// ---- Submit -------------------------------------------------------------

type SubmitResult = {
  ok: boolean;
  reason?: string;
  detail?: string;
  rejectedTokens?: string[];
};

const submitResult = v.object({
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
});

// The submission itself, shared by the owner door and the /admin doors — one
// payload builder, so the operator registering a template and an owner doing
// it can never produce different templates.
async function performSubmit(
  ctx: ActionCtx,
  templateId: Id<"waTemplates">,
  context: {
    template: {
      _id: string;
      kind: string;
      language: string;
      body?: string;
      metaName?: string;
      metaTemplateId?: string;
    };
    waAccount: { accessToken: string } | null;
    wabaId?: string;
  },
): Promise<SubmitResult> {
  const { template, waAccount, wabaId } = context;
  if (!waAccount) return { ok: false, reason: "wa-not-configured" };
  if (!wabaId) return { ok: false, reason: "no-waba-id" };

  // out_of_hours is session text by design — the customer just wrote, so the
  // window is open and no approval applies. Submitting one would register a
  // template that nothing will ever send.
  if (template.kind === "out_of_hours") {
    return { ok: false, reason: "kind-not-templated" };
  }
  const language = metaLanguageFor(template.language);
  if (!language) return { ok: false, reason: "language-unsupported" };

  // What gets registered, per species. The campaign template registers a
  // fixed wrapper rather than the row's words: campaigns.ts fills {{3}} with
  // the whole message the owner types per run, which is what makes one
  // approval serve every campaign. The LIFECYCLE kinds register the
  // platform's own Cloud text (CLOUD_TEMPLATE_TEXTS) rather than the row's
  // rich body — the body carries [service] and [manage_link], which the
  // Cloud lane cannot take and whose job the quick-reply buttons already do;
  // the rich body keeps serving Evolution and email. Only a kind this module
  // does not know registers the row's own words.
  const campaign = template.kind === "campaign";
  const wrapper = campaign ? campaignBodyFor(template.language) : null;
  if (campaign && !wrapper) return { ok: false, reason: "language-unsupported" };
  const platformBody = campaign ? null : cloudBodyFor(template.kind, template.language);
  const body = platformBody ?? (template.body ?? "").trim();
  if (!campaign && !body) return { ok: false, reason: "no-body" };
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
    templateId,
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
    metaCategory: json.category?.toLowerCase(),
  });
  return { ok: true };
}

export const submit = action({
  args: { templateId: v.id("waTemplates") },
  returns: submitResult,
  handler: async (ctx, args): Promise<SubmitResult> => {
    const context = await ctx.runQuery(internal.waTemplates.loadForSubmit, {
      templateId: args.templateId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    return await performSubmit(ctx, args.templateId, context);
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
type SyncResult = { ok: boolean; reason?: string; matched?: number };

const syncResult = v.object({
  ok: v.boolean(),
  reason: v.optional(v.string()),
  matched: v.optional(v.number()),
});

// The pull itself, shared by the owner door and the /admin door below.
async function performSync(
  ctx: ActionCtx,
  context: {
    orgId: string;
    wabaId?: string;
    waAccount: { accessToken: string } | null;
  },
): Promise<SyncResult> {
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
      category?: string;
      rejected_reason?: string;
    }[];
  };

  const rows = await ctx.runQuery(internal.waTemplates.listForOrgInternal, {
    orgId: orgId as Id<"orgs">,
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
      category: remote.category,
    });
  }
  return { ok: true, matched };
}

export const syncFromMeta = action({
  args: {},
  returns: syncResult,
  handler: async (ctx): Promise<SyncResult> => {
    const context = await ctx.runQuery(internal.waTemplates.loadSyncContext, {});
    if (!context) return { ok: false, reason: "not-found" };
    return await performSync(ctx, context);
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


// ---- The platform's own registration machinery ---------------------------
//
// Approval is the PLATFORM'S work (Serdar, 2026-08-26, twice): the desk left
// the salon's Automations page, the Cloud wording is platform text
// (CLOUD_TEMPLATE_TEXTS in lib/metaTemplate) — and registration is not even a
// per-client click. Templates are per-WABA at Meta, that is physics; but the
// standard set is the same for every client, so the SYSTEM registers it: the
// moment a WABA id lands on an org (platform.setWaAccount, orgs
// .connectWhatsapp) a scheduled run submits the set, and the fleet page has
// one button to roll the current texts across every connected business.
//
// Authorization shape: the internal loaders below are UNGATED because the
// scheduler has no user identity — they are reachable only from our own code.
// Every PUBLIC action here instead opens with assertPlatformAdmin, the one
// query whose whole job is to throw for anyone else.

export const assertPlatformAdmin = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return null;
  },
});

export const loadForSubmitByOrg = internalQuery({
  args: { orgId: v.id("orgs"), templateId: v.id("waTemplates") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== args.orgId) return null;
    const own = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
    return {
      template,
      waAccount: await resolveWaAccount(ctx, own),
      // The row's own WABA, never the platform's — the same rule as
      // loadForSubmit above: approvals belong to a business.
      wabaId: own?.wabaId,
    };
  },
});

export const submitForOrg = action({
  args: { orgId: v.id("orgs"), templateId: v.id("waTemplates") },
  returns: submitResult,
  handler: async (ctx, args): Promise<SubmitResult> => {
    await ctx.runQuery(internal.waTemplates.assertPlatformAdmin, {});
    const context = await ctx.runQuery(internal.waTemplates.loadForSubmitByOrg, {
      orgId: args.orgId,
      templateId: args.templateId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    return await performSubmit(ctx, args.templateId, context);
  },
});

export const loadSyncContextByOrg = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const own = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
    return {
      orgId: args.orgId,
      wabaId: own?.wabaId,
      waAccount: await resolveWaAccount(ctx, own),
    };
  },
});

export const syncForOrg = action({
  args: { orgId: v.id("orgs") },
  returns: syncResult,
  handler: async (ctx, args): Promise<SyncResult> => {
    await ctx.runQuery(internal.waTemplates.assertPlatformAdmin, {});
    const context = await ctx.runQuery(internal.waTemplates.loadSyncContextByOrg, {
      orgId: args.orgId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    return await performSync(ctx, context);
  },
});

// The tenant page's registration desk: the org's kind-level rows — the ones
// Meta registration lives on. Rule-bound wording rows have no Meta life of
// their own, and out_of_hours is session text with nothing to register.
export const listForOrgAdmin = query({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      _id: v.id("waTemplates"),
      kind: v.string(),
      language: v.string(),
      metaName: v.optional(v.string()),
      status: v.string(),
      metaStatusDetail: v.optional(v.string()),
      metaRejectionReason: v.optional(v.string()),
      metaCategory: v.optional(v.string()),
      // The EXACT wording this row registers at Meta — resolved from the same
      // pure functions the submission path reads (cloudBodyFor /
      // campaignBodyFor), so the desk can never show a text the registration
      // would not send. Platform text by decision (2026-08-26): the operator
      // reviews it here and changes it in code, for the whole fleet at once.
      // Null when the kind has no Cloud wording in this language, which is
      // itself worth seeing: that row will refuse to register.
      cloudBody: v.union(v.string(), v.null()),
      // Whether the registered template declares the confirm/cancel quick
      // replies, so the desk shows the whole shape Meta reviews.
      buttons: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return rows
      .filter((row) => row.ruleId === undefined && row.kind !== "out_of_hours")
      .map((row) => ({
        _id: row._id,
        kind: row.kind,
        language: row.language,
        metaName: row.metaName,
        status: String(row.status),
        metaStatusDetail: row.metaStatusDetail,
        metaRejectionReason: row.metaRejectionReason,
        metaCategory: row.metaCategory,
        cloudBody:
          row.kind === "campaign"
            ? campaignBodyFor(row.language)
            : cloudBodyFor(row.kind, row.language),
        buttons: buttonsFor(row.kind),
      }));
  },
});

// What "register the standard set" registers. out_of_hours stays out (session
// text); campaign rides along because its wrapper is as standard as the rest.
const STANDARD_CLOUD_KINDS = [
  "confirmation",
  "reminder",
  "winback",
  "followup",
  "cancellation",
] as const;

export const ensureStandardRows = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      templateId: v.id("waTemplates"),
      kind: v.string(),
      status: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return [];
    const orgLanguage = org.language ?? "tr";
    const rows = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const out: { templateId: Id<"waTemplates">; kind: string; status: string }[] = [];
    // EVERY supported language, not the org's one. Sends resolve the template
    // by the CUSTOMER's language (wa.ts), falling back to the org's, and a
    // missing language fails the send visibly by doctrine — so an org-language
    // registration quietly guaranteed that failure for every customer who
    // speaks one of the other two. Fifteen templates per WABA is nothing
    // against Meta's ceiling; a Turkish regular of an English-configured
    // salon getting her reminder is everything. Found live on Bella: org
    // language en, customer base Turkish.
    for (const language of ["tr", "en", "de"]) {
      const stock = DEFAULT_TEMPLATE_TEXTS[language] ?? DEFAULT_TEMPLATE_TEXTS.en;
      for (const kind of STANDARD_CLOUD_KINDS) {
        const existing = rows.find(
          (row) => row.ruleId === undefined && row.kind === kind && row.language === language,
        );
        if (existing) {
          out.push({
            templateId: existing._id,
            kind: `${kind}/${language}`,
            status: String(existing.status),
          });
          continue;
        }
        // Seeded with the rich stock text: the row's body serves Evolution and
        // email, while the Cloud registration reads CLOUD_TEMPLATE_TEXTS — see
        // performSubmit.
        const id = await ctx.db.insert("waTemplates", {
          orgId: args.orgId,
          kind,
          language,
          status: "draft",
          body: stock[kind].body,
          subject: stock[kind].subject,
        });
        out.push({ templateId: id, kind: `${kind}/${language}`, status: "draft" });
      }
    }
    // The campaign wrapper — orgs.ensureCampaignTemplate's shape, reachable
    // without a session because the operator is doing the registering now.
    // Org language only: campaigns are written by the OWNER in one language
    // per run, unlike the lifecycle sends that follow each customer.
    const language = orgLanguage;
    const campaign = rows.find(
      (row) => row.kind === "campaign" && row.language === language,
    );
    if (campaign) {
      out.push({ templateId: campaign._id, kind: "campaign", status: String(campaign.status) });
    } else {
      const preview: Record<string, string> = {
        tr: "Merhaba {{1}}! {{2}} olarak {{3}}",
        en: "Hello {{1}}! {{2}} here — {{3}}",
        de: "Hallo {{1}}! {{2}} — {{3}}",
      };
      const id = await ctx.db.insert("waTemplates", {
        orgId: args.orgId,
        kind: "campaign",
        metaName: "randevu_kampanya",
        language,
        status: "draft",
        bodyPreview: preview[language] ?? preview.en,
      });
      out.push({ templateId: id, kind: "campaign", status: "draft" });
    }
    return out;
  },
});

// One click per business: every standard row exists, then everything not
// already approved goes to Meta. Sequential on purpose — six templates is
// six requests, and Meta rate-limits template creation harder than most
// endpoints; a Promise.all here is how one click becomes three mystery
// failures.
type StandardSetResult = { kind: string; ok: boolean; reason?: string; detail?: string };

const standardSetResults = v.array(
  v.object({
    kind: v.string(),
    ok: v.boolean(),
    reason: v.optional(v.string()),
    detail: v.optional(v.string()),
  }),
);

async function performRegisterStandardSet(
  ctx: ActionCtx,
  orgId: Id<"orgs">,
): Promise<StandardSetResult[]> {
  const rows = await ctx.runMutation(internal.waTemplates.ensureStandardRows, {
    orgId,
  });
  const results: StandardSetResult[] = [];
  for (const row of rows) {
    if (row.status === "approved") {
      results.push({ kind: row.kind, ok: true, reason: "already-approved" });
      continue;
    }
    // A pending row's submission is already on Meta's desk; re-submitting it
    // as an edit would reset its review for nothing. The bulk run CONVERGES —
    // the per-row Submit button on the tenant page stays the force-resubmit
    // for a row that is genuinely stuck.
    if (row.status === "pending") {
      results.push({ kind: row.kind, ok: true, reason: "in-review" });
      continue;
    }
    const context = await ctx.runQuery(internal.waTemplates.loadForSubmitByOrg, {
      orgId,
      templateId: row.templateId,
    });
    if (!context) {
      results.push({ kind: row.kind, ok: false, reason: "not-found" });
      continue;
    }
    const result = await performSubmit(ctx, row.templateId, context);
    results.push({
      kind: row.kind,
      ok: result.ok,
      reason: result.reason,
      detail: result.detail,
    });
  }
  return results;
}

// The tenant page's manual run — a repair door now, since wiring a WABA
// registers the set on its own.
export const registerStandardSet = action({
  args: { orgId: v.id("orgs") },
  returns: standardSetResults,
  handler: async (ctx, args): Promise<StandardSetResult[]> => {
    await ctx.runQuery(internal.waTemplates.assertPlatformAdmin, {});
    return await performRegisterStandardSet(ctx, args.orgId);
  },
});

// The scheduler's door — fired by platform.setWaAccount and
// orgs.connectWhatsapp the moment a WABA id lands on an org, so wiring a
// number IS the registration and no human clicks anything per client. A
// failure here is not silent: every row it touched carries its status and
// the tenant page shows them.
export const registerStandardSetForOrg = internalAction({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const results = await performRegisterStandardSet(ctx, args.orgId);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.warn(
        `standard set for ${args.orgId}: ${failed
          .map((r) => `${r.kind}=${r.reason ?? "failed"}`)
          .join(", ")}`,
      );
    }
    return null;
  },
});

// Every org with a WABA to register on — the fleet rollout's work list.
export const listConnectedOrgsInternal = internalQuery({
  args: {},
  returns: v.array(v.object({ orgId: v.id("orgs"), name: v.string() })),
  handler: async (ctx) => {
    const accounts = await ctx.db.query("waAccounts").collect();
    const out: { orgId: Id<"orgs">; name: string }[] = [];
    for (const account of accounts) {
      if (!account.wabaId?.trim()) continue;
      const org = await ctx.db.get(account.orgId);
      if (org) out.push({ orgId: account.orgId, name: org.name });
    }
    return out;
  },
});

// The fleet button: the standard set is the same for every client, so rolling
// a wording update out is ONE click here, not a tour of tenant pages.
// Sequential across orgs for the same rate-limit reason as within one.
export const registerStandardSetAll = action({
  args: {},
  returns: v.array(
    v.object({
      org: v.string(),
      results: standardSetResults,
    }),
  ),
  handler: async (
    ctx,
  ): Promise<{ org: string; results: StandardSetResult[] }[]> => {
    await ctx.runQuery(internal.waTemplates.assertPlatformAdmin, {});
    const orgs = await ctx.runQuery(
      internal.waTemplates.listConnectedOrgsInternal,
      {},
    );
    const out: { org: string; results: StandardSetResult[] }[] = [];
    for (const org of orgs) {
      out.push({
        org: org.name,
        results: await performRegisterStandardSet(ctx, org.orgId),
      });
    }
    return out;
  },
});
