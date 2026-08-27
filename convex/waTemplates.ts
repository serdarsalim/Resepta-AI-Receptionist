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
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwner } from "./lib/orgAuth";
import { requirePlatformAdmin } from "./lib/platformAuth";
import { resolveWaAccount } from "./lib/platformConfig";
import { WA_CLOUD_GRAPH_BASE } from "./lib/waCloud";
import {
  CAMPAIGN_EXAMPLES,
  CAMPAIGN_PARAMS,
  campaignBodyFor,
  categoryFor,
  cloudBodyFor,
  componentsFor,
  metaLanguageFor,
  metaNameFor,
  normalizeMetaStatus,
  toPositionalBody,
} from "./lib/metaTemplate";
import { DEFAULT_TEMPLATE_TEXTS, LOCKED_TEMPLATE_KINDS } from "./lib/templateTexts";

// The Cloud wording a (kind, language) registers RIGHT NOW: the operator's
// stored override when one exists (platformTemplateTexts), the code constant
// otherwise. Every reader of the registered text goes through here — the
// submit loaders, the editor, the fleet desk — so an edit saved in the
// editor is what the next submission sends, with no second copy to drift.
// Campaign stays code-only (campaignBodyFor): its wrapper is parked by
// decision and its fixed-text ratio is load-bearing at Meta review.
async function resolvePlatformBody(
  ctx: QueryCtx,
  kind: string,
  language: string,
): Promise<string | null> {
  const override = await ctx.db
    .query("platformTemplateTexts")
    .withIndex("by_kind_language", (q) =>
      q.eq("kind", kind).eq("language", language.trim().toLowerCase()),
    )
    .unique();
  return override?.body ?? cloudBodyFor(kind, language);
}

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
    return {
      template,
      waAccount,
      wabaId: own?.wabaId,
      platformBody: await resolvePlatformBody(ctx, template.kind, template.language),
    };
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
    submittedBody: v.optional(v.string()),
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
      submittedBody: args.submittedBody,
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
    // The wording resolved by the loader (override ?? code constant). The
    // fallback below keeps an older caller correct, but the loader's value is
    // the truth — it is what the editor showed the operator.
    platformBody?: string | null;
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
  const platformBody = campaign
    ? null
    : (context.platformBody ?? cloudBodyFor(template.kind, template.language));
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
    // What actually went, named tokens, for the changed-since-submit check.
    submittedBody: campaign ? wrapper! : body,
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
      platformBody: await resolvePlatformBody(ctx, template.kind, template.language),
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

// ---- The fleet template desk (/admin Templates tab) ---------------------
//
// Wording and rollout are FLEET facts, not per-client ones (Serdar,
// 2026-08-27): the standard set is identical for every business, so the
// operator edits a text once and pushes it everywhere, and reads approval
// status as a matrix of businesses rather than a tour of tenant pages.

// Every editable wording, current text beside the code default. The editor
// renders exactly this; `overridden` is what makes "Reset to default" honest.
// `stale` is how many registered templates a resubmit would actually push new
// wording into — the editor shows the resubmit button only when it is > 0, so
// a resting page offers no doomed or pointless submissions (Serdar,
// 2026-08-27: the button "should only appear when we change something").
export const platformWording = query({
  args: {},
  returns: v.array(
    v.object({
      kind: v.string(),
      language: v.string(),
      body: v.string(),
      defaultBody: v.string(),
      overridden: v.boolean(),
      stale: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    // The fleet's kind-level rows, once: same population kindRowsAcrossOrgs
    // walks (wired WABA, kind-level row exists).
    const accounts = await ctx.db.query("waAccounts").collect();
    const fleetRows: { kind: string; language: string; status: string; submittedBody?: string }[] = [];
    for (const account of accounts) {
      if (!account.wabaId?.trim()) continue;
      const rows = await ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", account.orgId))
        .collect();
      for (const row of rows) {
        if (row.ruleId !== undefined) continue;
        fleetRows.push({
          kind: row.kind,
          language: row.language,
          status: String(row.status),
          submittedBody: row.submittedBody,
        });
      }
    }
    const out: {
      kind: string;
      language: string;
      body: string;
      defaultBody: string;
      overridden: boolean;
      stale: number;
    }[] = [];
    for (const language of ["tr", "en", "de"]) {
      for (const kind of LOCKED_TEMPLATE_KINDS) {
        const defaultBody = cloudBodyFor(kind, language);
        if (!defaultBody) continue;
        const body = await resolvePlatformBody(ctx, kind, language);
        const current = body ?? defaultBody;
        // Rows a resubmit would touch with NEW text: not pending (Meta locks
        // those), submittedBody known and different. Unknown rows (submitted
        // before submittedBody existed) don't light the button — the per-row
        // Submit in the matrix still reaches them.
        const stale = fleetRows.filter(
          (row) =>
            row.kind === kind &&
            row.language === language &&
            row.status !== "pending" &&
            row.submittedBody !== undefined &&
            row.submittedBody !== current,
        ).length;
        out.push({
          kind,
          language,
          body: current,
          defaultBody,
          overridden: body !== defaultBody,
          stale,
        });
      }
    }
    return out;
  },
});

export const setPlatformWording = mutation({
  args: { kind: v.string(), language: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const kind = args.kind.trim();
    const language = args.language.trim().toLowerCase();
    if (!(LOCKED_TEMPLATE_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`not an editable kind: ${kind}`);
    }
    const defaultBody = cloudBodyFor(kind, language);
    if (!defaultBody) throw new Error(`no default wording for ${kind}/${language}`);
    const body = args.body.replace(/\r\n/g, "\n").trim();
    if (!body) throw new Error("body is empty");
    // The same three checks performSubmit runs, run NOW: a wording the
    // editor accepts and the submission then refuses is a trap sprung at
    // rollout time, org by org.
    const { text, rejected } = toPositionalBody(body);
    if (rejected.length > 0) {
      throw new Error(
        `tokens the Cloud lane cannot send: ${rejected.join(", ")}`,
      );
    }
    if (text.length > 1024) {
      throw new Error(`body is ${text.length} chars; Meta's ceiling is 1024`);
    }
    const existing = await ctx.db
      .query("platformTemplateTexts")
      .withIndex("by_kind_language", (q) =>
        q.eq("kind", kind).eq("language", language),
      )
      .unique();
    // Saving the default back is a reset, not an override: a stored copy of
    // the constant would go stale the day the constant moves.
    if (body === defaultBody) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { body, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("platformTemplateTexts", {
        kind,
        language,
        body,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const clearPlatformWording = mutation({
  args: { kind: v.string(), language: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const existing = await ctx.db
      .query("platformTemplateTexts")
      .withIndex("by_kind_language", (q) =>
        q.eq("kind", args.kind.trim()).eq("language", args.language.trim().toLowerCase()),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

// The rollout work list for one (kind, language): every wired org's existing
// kind-level row. Orgs with no row are skipped on purpose — creating rows is
// registerStandardSet's job; this door pushes new wording into rows that
// already have a Meta life.
export const kindRowsAcrossOrgs = internalQuery({
  args: { kind: v.string(), language: v.string() },
  returns: v.array(
    v.object({
      orgId: v.id("orgs"),
      name: v.string(),
      templateId: v.id("waTemplates"),
      status: v.string(),
      // Same three-value read as fleetTemplateStatus: false = the row last
      // submitted exactly the text it would submit now.
      changed: v.union(v.boolean(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const accounts = await ctx.db.query("waAccounts").collect();
    const expected =
      args.kind === "campaign"
        ? campaignBodyFor(args.language)
        : await resolvePlatformBody(ctx, args.kind, args.language);
    const out: {
      orgId: Id<"orgs">;
      name: string;
      templateId: Id<"waTemplates">;
      status: string;
      changed: boolean | null;
    }[] = [];
    for (const account of accounts) {
      if (!account.wabaId?.trim()) continue;
      const org = await ctx.db.get(account.orgId);
      if (!org) continue;
      const rows = await ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", account.orgId))
        .collect();
      const row = rows.find(
        (r) =>
          r.ruleId === undefined &&
          r.kind === args.kind &&
          r.language === args.language,
      );
      if (row) {
        out.push({
          orgId: account.orgId,
          name: org.name,
          templateId: row._id,
          status: String(row.status),
          changed:
            row.submittedBody === undefined ? null : expected !== row.submittedBody,
        });
      }
    }
    return out;
  },
});

// Push the current wording of one (kind, language) to every wired business.
// Unlike registerStandardSetAll this does NOT skip approved or pending rows —
// skipping is right when the bulk run is converging on the same text, and
// exactly wrong when the text just changed. performSubmit edits by Meta
// template id where one exists, so an approved template goes back into
// review while its approved version keeps delivering. Sequential for the
// same rate-limit reason as every other loop in this file.
export const resubmitTemplateAll = action({
  args: { kind: v.string(), language: v.string() },
  returns: v.array(
    v.object({
      org: v.string(),
      ok: v.boolean(),
      reason: v.optional(v.string()),
      detail: v.optional(v.string()),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ org: string; ok: boolean; reason?: string; detail?: string }[]> => {
    await ctx.runQuery(internal.waTemplates.assertPlatformAdmin, {});
    const rows = await ctx.runQuery(internal.waTemplates.kindRowsAcrossOrgs, {
      kind: args.kind,
      language: args.language,
    });
    const out: { org: string; ok: boolean; reason?: string; detail?: string }[] = [];
    for (const row of rows) {
      // Two skips, both about not spending anything for nothing. A pending
      // row cannot be edited — Meta locks a template while it reviews it, so
      // the request would only error. An approved row whose wording has not
      // changed since its last submission would re-enter review with
      // IDENTICAL text, burning one of the ~10 monthly edit slots to change
      // nothing. Unknown (null) stays live: rows submitted before
      // submittedBody existed cannot prove they are unchanged.
      if (row.status === "pending") {
        out.push({ org: row.name, ok: true, reason: "in-review" });
        continue;
      }
      if (row.status === "approved" && row.changed === false) {
        out.push({ org: row.name, ok: true, reason: "unchanged" });
        continue;
      }
      const context = await ctx.runQuery(internal.waTemplates.loadForSubmitByOrg, {
        orgId: row.orgId,
        templateId: row.templateId,
      });
      if (!context) {
        out.push({ org: row.name, ok: false, reason: "not-found" });
        continue;
      }
      const result = await performSubmit(ctx, row.templateId, context);
      out.push({
        org: row.name,
        ok: result.ok,
        reason: result.reason,
        detail: result.detail,
      });
    }
    return out;
  },
});

// The matrix: every business in the WhatsApp play, with its kind-level rows.
// A business counts if it has a wired WABA (registration can run) or any
// kind-level template row (history exists even if the WABA went away) — one
// with neither has nothing to show and is not a blank line here.
export const fleetTemplateStatus = query({
  args: {},
  returns: v.array(
    v.object({
      orgId: v.id("orgs"),
      name: v.string(),
      hasWaba: v.boolean(),
      rows: v.array(
        v.object({
          _id: v.id("waTemplates"),
          kind: v.string(),
          language: v.string(),
          metaName: v.optional(v.string()),
          status: v.string(),
          metaStatusDetail: v.optional(v.string()),
          metaRejectionReason: v.optional(v.string()),
          metaCategory: v.optional(v.string()),
          submittedAt: v.union(v.number(), v.null()),
          // Whether the wording this row WOULD submit differs from what it
          // LAST submitted. false greys the button (a resubmit would push
          // identical text); null is "unknown" — rows submitted before
          // submittedBody existed — and leaves the button live.
          changed: v.union(v.boolean(), v.null()),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const accounts = await ctx.db.query("waAccounts").collect();
    const wabaOrgIds = new Set(
      accounts.filter((a) => a.wabaId?.trim()).map((a) => a.orgId),
    );
    // One scan of the whole table, grouped in memory: the fleet is dozens of
    // orgs, and per-org indexed reads here would be a query per business for
    // a page the operator opens once a day.
    const all = await ctx.db.query("waTemplates").collect();
    const byOrg = new Map<Id<"orgs">, typeof all>();
    for (const row of all) {
      if (row.ruleId !== undefined || row.kind === "out_of_hours") continue;
      const list = byOrg.get(row.orgId) ?? [];
      list.push(row);
      byOrg.set(row.orgId, list);
    }
    const orgIds = new Set<Id<"orgs">>([...wabaOrgIds, ...byOrg.keys()]);
    // The wording each (kind, language) would submit today, resolved once —
    // it is fleet-wide, so per-row resolution would repeat the same read for
    // every business.
    const expected = new Map<string, string | null>();
    const expectedFor = async (kind: string, language: string) => {
      const key = `${kind}/${language}`;
      if (!expected.has(key)) {
        expected.set(
          key,
          kind === "campaign"
            ? campaignBodyFor(language)
            : await resolvePlatformBody(ctx, kind, language),
        );
      }
      return expected.get(key) ?? null;
    };
    const KIND_ORDER = [
      "confirmation",
      "reminder",
      "winback",
      "followup",
      "cancellation",
      "campaign",
    ];
    const LANG_ORDER = ["tr", "en", "de"];
    const out: {
      orgId: Id<"orgs">;
      name: string;
      hasWaba: boolean;
      rows: {
        _id: Id<"waTemplates">;
        kind: string;
        language: string;
        metaName?: string;
        status: string;
        metaStatusDetail?: string;
        metaRejectionReason?: string;
        metaCategory?: string;
        submittedAt: number | null;
        changed: boolean | null;
      }[];
    }[] = [];
    for (const orgId of orgIds) {
      const org = await ctx.db.get(orgId);
      if (!org) continue;
      const rows = await Promise.all(
        (byOrg.get(orgId) ?? []).map(async (row) => ({
          _id: row._id,
          kind: row.kind,
          language: row.language,
          metaName: row.metaName,
          status: String(row.status),
          metaStatusDetail: row.metaStatusDetail,
          metaRejectionReason: row.metaRejectionReason,
          metaCategory: row.metaCategory,
          submittedAt: row.submittedAt ?? null,
          changed:
            row.submittedBody === undefined
              ? null
              : (await expectedFor(row.kind, row.language)) !== row.submittedBody,
        })),
      );
      // Kind then language, the editor's own order, so the expansion scans
      // instead of interleaving languages in insertion order.
      rows.sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          LANG_ORDER.indexOf(a.language) - LANG_ORDER.indexOf(b.language),
      );
      out.push({
        orgId,
        name: org.name,
        hasWaba: wabaOrgIds.has(orgId),
        rows,
      });
    }
    // Wired businesses first, then by name — the ones registration can act
    // on are the ones the operator came for.
    out.sort(
      (a, b) =>
        Number(b.hasWaba) - Number(a.hasWaba) || a.name.localeCompare(b.name),
    );
    return out;
  },
});
