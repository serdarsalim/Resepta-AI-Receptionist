// Keys for the MCP control surface — one per chat client, per person, per
// workspace. Pasted into Claude or ChatGPT as a custom connector.
//
// This product is a SINGLE deployment where every row carries an orgId, so a
// key has to name the workspace as well as the person. Nudge gets that for free
// from the request host, one deployment per tenant; here the key carries it.
//
// But pinning is not trusting. `memberships` stays the authority, exactly as in
// lib/orgAuth.ts, and verify() re-checks it on every call. An owner removing
// someone from the team will not think to also hunt down that person's
// connector — re-checking is what makes removing them enough on its own.

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { actingAsOrg, requireOrg } from "./lib/orgAuth";
import { emailIsPlatformAdmin } from "./lib/platformAuth";

// mk_<48 hex>, 192 bits from the Web Crypto CSPRNG. A distinct prefix from
// anything else in the product so "which key is this" is answerable by looking.
function mintKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `mk_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const CLIENT_LABEL: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
};

function mask(key: string): string {
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

const clientArg = v.union(
  v.literal("claude"),
  v.literal("chatgpt"),
  v.literal("other"),
);

// Returns the RAW key — shown once, never again.
export const create = mutation({
  args: { client: clientArg, name: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, { client, name }) => {
    const { user, orgId } = await requireOrg(ctx);
    // An operator working INSIDE a tenant CAN mint one, and it works. This
    // refused until 2026-08-19, for a reason that was half right: requireOrg
    // resolves an operator to the tenant they are acting into, so the row comes
    // out as {orgId: the salon, userId: the operator}, and verify re-checking
    // `memberships` — which an operator does not have there — rejected every
    // call the key was ever used for. The key was born dead.
    //
    // The old repair was to refuse the mint. The objection to the other repair
    // was that honouring an operator would be "a bearer token that answers to
    // nobody's membership". That reading was wrong about which authority is
    // stronger. It answers to PLATFORM_ADMIN_EMAILS, which is the same env
    // allowlist that let the operator into this business at all, and which
    // lib/orgAuth already calls exactly as strong as acting-as itself: it
    // evaporates the moment the address comes off the list, and no
    // application-level bug can mint one. A membership row is the weaker
    // credential — it lives in the database every org-scoped mutation writes.
    //
    // What the key grants is also strictly LESS than its holder already has: it
    // reaches one org, while /admin reaches every org on the deployment.
    //
    // Stamped viaOperator so verify knows which door to check, and so the
    // salon's feed says "Autotakt", never the operator's name.
    const operator = actingAsOrg(user) === orgId;
    const key = mintKey();
    await ctx.db.insert("mcpConnections", {
      orgId,
      userId: user._id,
      name: name?.trim() || (CLIENT_LABEL[client] ?? "MCP client"),
      key,
      client,
      createdAt: Date.now(),
      ...(operator ? { viaOperator: true } : {}),
    });
    return key;
  },
});

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("mcpConnections"),
      name: v.string(),
      masked: v.string(),
      client: v.string(),
      ownerName: v.string(),
      isMine: v.boolean(),
      createdAt: v.number(),
      lastUsedAt: v.union(v.number(), v.null()),
      revoked: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("mcpConnections")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const names = new Map(
      (await Promise.all(userIds.map((id) => ctx.db.get(id)))).flatMap((u) =>
        u ? [[u._id, u.name || u.email || "Unknown"] as const] : [],
      ),
    );
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        _id: r._id,
        name: r.name,
        masked: mask(r.key),
        client: r.client,
        ownerName: names.get(r.userId) ?? "Unknown",
        isMine: r.userId === user._id,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt ?? null,
        revoked: !!r.revoked,
      }));
  },
});

export const revoke = mutation({
  args: { id: v.id("mcpConnections") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { user, orgId, role } = await requireOrg(ctx);
    const row = await ctx.db.get(id);
    // Scoped to the caller's own workspace, so an id from another org is simply
    // not found rather than being reported as forbidden.
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    // A stylist can pull their own connector; only an owner can pull someone
    // else's. Same shape as the rest of the team surface.
    if (row.userId !== user._id && role !== "owner") throw new Error("not-allowed");
    await ctx.db.patch(id, { revoked: true });
    return null;
  },
});

// ── Verification (the MCP endpoint's only entry point) ───────────────────────

export const verify = internalQuery({
  args: { key: v.string() },
  returns: v.union(
    v.object({
      connectionId: v.id("mcpConnections"),
      orgId: v.id("orgs"),
      userId: v.id("users"),
      name: v.string(),
      client: v.string(),
      userName: v.string(),
      orgName: v.string(),
      role: v.string(),
      label: v.string(),
      viaOperator: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { key }) => {
    if (!key) return null;
    const row = await ctx.db
      .query("mcpConnections")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!row || row.revoked) return null;

    const user = await ctx.db.get(row.userId);
    const org = await ctx.db.get(row.orgId);
    if (!user || !org) return null;

    // The re-check. Everything above is what the key CLAIMS; this is what is
    // still true, and it is re-derived on EVERY call so revoking access
    // anywhere kills the connector without anyone having to remember it exists.
    //
    // Two doors, because there are two ways to be entitled to this business.
    // A member's key answers to their membership row. An operator's key
    // answers to the env allowlist — the same authority behind acting-as, and
    // the one that has to be right for /admin to open at all. Neither door
    // accepts the other's credential: a member who becomes an operator does
    // not keep a revoked membership alive, and an operator taken off the
    // allowlist does not get a membership they never had.
    let role: string;
    if (row.viaOperator) {
      if (!emailIsPlatformAdmin(user.email)) return null;
      // Owner, for the same reason requireOrg hands acting-as owner: an
      // operator is here to fix something, and read-only answers none of the
      // calls that prompt one.
      role = "owner";
    } else {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", row.userId).eq("orgId", row.orgId),
        )
        .unique();
      if (!membership) return null;
      role = membership.role;
    }

    const userName = user.name || user.email || "Unknown";
    return {
      connectionId: row._id,
      orgId: row.orgId,
      userId: row.userId,
      name: row.name,
      client: row.client,
      userName,
      orgName: org.name,
      role,
      // Composed once, here, so no tool can render it differently.
      label: `${userName} · ${CLIENT_LABEL[row.client] ?? row.name}`,
      viaOperator: !!row.viaOperator,
    };
  },
});

// Revoking without a UI session. Exists because `revoke` above goes through
// requireOrg, so there was no way to kill a connector from the CLI — and
// "revoke the key you just leaked" is exactly the moment you do not want to be
// hunting for the right browser tab.
export const revokeFromCli = internalMutation({
  args: { key: v.optional(v.string()), id: v.optional(v.id("mcpConnections")) },
  returns: v.string(),
  handler: async (ctx, { key, id }) => {
    const row = id
      ? await ctx.db.get(id)
      : key
        ? await ctx.db
            .query("mcpConnections")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique()
        : null;
    if (!row) throw new Error("no such connection");
    await ctx.db.patch(row._id, { revoked: true });
    return `revoked ${row.name} (${mask(row.key)})`;
  },
});

export const stampUsed = internalMutation({
  args: { connectionId: v.id("mcpConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    await ctx.db.patch(connectionId, { lastUsedAt: Date.now() });
    return null;
  },
});

// Provisioning without a UI session — the CLI has no requireOrg to lean on, so
// the person and workspace are named explicitly.
//   npx convex run mcpKeys:createFromCli '{"userEmail":"…","client":"claude"}'
export const createFromCli = internalMutation({
  args: {
    userEmail: v.string(),
    client: clientArg,
    name: v.optional(v.string()),
    orgId: v.optional(v.id("orgs")),
  },
  returns: v.string(),
  handler: async (ctx, { userEmail, client, name, orgId }) => {
    const email = userEmail.trim().toLowerCase();
    const user = (await ctx.db.query("users").collect()).find(
      (u) => (u.email ?? "").toLowerCase() === email,
    );
    if (!user) throw new Error(`no user with email ${userEmail}`);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (memberships.length === 0) throw new Error(`${userEmail} belongs to no workspace`);
    // Ambiguity is refused rather than guessed: picking "the first workspace"
    // for someone who has three is how a key ends up pointed at the wrong
    // salon, and it would look like it worked.
    const chosen = orgId
      ? memberships.find((m) => m.orgId === orgId)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!chosen) {
      throw new Error(
        orgId
          ? `${userEmail} is not a member of that workspace`
          : `${userEmail} belongs to ${memberships.length} workspaces — pass orgId to say which`,
      );
    }
    const key = mintKey();
    await ctx.db.insert("mcpConnections", {
      orgId: chosen.orgId,
      userId: user._id,
      name: name?.trim() || (CLIENT_LABEL[client] ?? "MCP client"),
      key,
      client,
      createdAt: Date.now(),
    });
    return key;
  },
});
