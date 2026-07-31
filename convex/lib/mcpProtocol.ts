// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL COPY — lives in nudge/convex/lib/mcpProtocol.ts
//
// randevu carries a byte-identical copy. Edit THIS file, then run:
//     npm run sync:mcp
// which rewrites the other repo's copy and fails if they had diverged.
//
// Vendored rather than published as a package on purpose. Two repos, one
// author, independent deploy pipelines: a package would mean version-bump,
// publish, and two lockfile updates for every protocol tweak. The only real
// cost of vendoring is drift, so drift is what the sync script checks. If a
// third app ever needs this, publish it then — the seam is already here.
//
// Everything below is PURE PROTOCOL: JSON-RPC framing, transport shape, result
// clamping. It knows nothing about contacts, customers, orgs or tenants, and it
// must stay that way — the moment app types leak in, the two copies stop being
// interchangeable and the sync check starts lying.
// ─────────────────────────────────────────────────────────────────────────────

// Claude supports 2025-03-26, 2025-06-18 and 2025-11-25. We speak 06-18: the
// revision that introduced Protected Resource Metadata, supported by every
// client we target. The 2026-07-28 revision is a release candidate and adds
// required routing headers — revisit when it lands as stable.
export const PROTOCOL_VERSION = "2025-06-18";

// Claude.ai/Desktop cuts a tool result near 150k characters, Claude Code at 25k
// tokens. Blowing the cap mangles the result rather than failing loudly, so
// clamping happens once here instead of each tool being trusted to behave.
export const MAX_RESULT_CHARS = 100_000;

export type ToolAnnotations = {
  // Absent readOnlyHint means "this writes" to both Claude and ChatGPT, and
  // they will confirm with the user before running it. Never set it true on
  // anything that mutates, however harmless it looks.
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

// Generic over the identity type so each app can carry its own shape — Nudge
// resolves a person, randevu a person AND a workspace — without this file
// knowing what either looks like.
export type ToolDef<Ctx, Who> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  handler: (ctx: Ctx, args: Record<string, unknown>, who: Who) => Promise<unknown>;
};

export const str = (a: Record<string, unknown>, k: string): string | undefined => {
  const val = a[k];
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
};

export const num = (a: Record<string, unknown>, k: string): number | undefined => {
  const val = a[k];
  return typeof val === "number" && Number.isFinite(val) ? val : undefined;
};

export type RpcId = string | number | null;

export const rpcResult = (id: RpcId, result: unknown) =>
  ({ jsonrpc: "2.0", id, result }) as const;

export const rpcError = (id: RpcId, code: number, message: string) =>
  ({ jsonrpc: "2.0", id, error: { code, message } }) as const;

// Convex wraps a thrown Error as "Uncaught Error: <msg>\n    at handler (…)".
// The model reads the whole thing and starts reasoning about our file paths, so
// the sentence a tool wrote on purpose arrives buried in a stack trace it can
// do nothing with. Keep the sentence, drop the frame.
export function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return (
    raw
      .replace(/^\s*Uncaught\s+(ConvexError|Error):\s*/i, "")
      .split(/\n\s*at\s/)[0]
      .trim() || "The request failed."
  );
}

// Structured data goes over as JSON rather than prose: the model reads JSON
// precisely and prose approximately, and precision is the entire point of
// connecting to the real system instead of guessing.
export function toolContent(value: unknown) {
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text =
      text.slice(0, MAX_RESULT_CHARS) +
      `\n\n[truncated at ${MAX_RESULT_CHARS} characters — narrow the query and ask again; this is not the complete result]`;
  }
  return { content: [{ type: "text", text }] };
}

export function bearer(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // Claude's request-header auth allowlists x-api-key, and it is what a curl
  // smoke test reaches for first.
  return req.headers.get("x-api-key")?.trim() ?? "";
}

export const jsonResponse = (body: unknown, status = 200, realm = "mcp") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // A 401 without this leaves a spec-compliant client with nowhere to go.
      ...(status === 401
        ? { "www-authenticate": `Bearer realm="${realm}", error="invalid_token"` }
        : {}),
    },
  });

export type ServerInfo = { name: string; version: string };

// The JSON-RPC dispatcher. Returns null for notifications, which must get no
// response body at all.
export async function handleRpc<Ctx, Who>(
  ctx: Ctx,
  msg: Record<string, unknown>,
  who: Who,
  opts: {
    tools: ToolDef<Ctx, Who>[];
    serverInfo: ServerInfo;
    instructions: string;
  },
): Promise<object | null> {
  const id = (msg.id ?? null) as RpcId;
  const method = String(msg.method ?? "");
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: opts.serverInfo,
        instructions: opts.instructions,
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: opts.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      });

    case "tools/call": {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      const name = String(params.name ?? "");
      const tool = opts.tools.find((t) => t.name === name);
      // A result naming the real tools, NOT a JSON-RPC error. A transport error
      // reads to the model as "the server broke"; this reads as "that name does
      // not exist, here are the ones that do" — actionable in the same turn.
      if (!tool) {
        return rpcResult(id, {
          content: [
            {
              type: "text",
              text: `Error: no tool named "${name}". Available: ${opts.tools.map((t) => t.name).join(", ")}`,
            },
          ],
          isError: true,
        });
      }
      try {
        const out = await tool.handler(
          ctx,
          (params.arguments ?? {}) as Record<string, unknown>,
          who,
        );
        return rpcResult(id, toolContent(out));
      } catch (e: unknown) {
        // Tool failures come back as a result with isError so the model reads
        // the message and corrects itself, rather than seeing a dead server.
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${cleanError(e)}` }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// The transport shell around handleRpc: method guards, body parse, batch
// handling. Auth stays with the caller, because how an identity is resolved is
// exactly what differs between apps.
export async function serveMcp<Ctx, Who>(
  ctx: Ctx,
  req: Request,
  who: Who,
  opts: {
    tools: ToolDef<Ctx, Who>[];
    serverInfo: ServerInfo;
    instructions: string;
  },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
  }

  // A batch is an array, a single call an object. Notifications drop out of the
  // batch response entirely, and an all-notification batch gets 202.
  if (Array.isArray(body)) {
    const out = (
      await Promise.all(
        body.map((m) => handleRpc(ctx, m as Record<string, unknown>, who, opts)),
      )
    ).filter(Boolean);
    return out.length ? jsonResponse(out) : new Response(null, { status: 202 });
  }

  const res = await handleRpc(ctx, body as Record<string, unknown>, who, opts);
  return res ? jsonResponse(res) : new Response(null, { status: 202 });
}

// A bare GET is a client probing for the deprecated SSE transport. Say so
// plainly rather than 404ing, which reads as a wrong URL.
export const NOT_STREAMABLE_HTTP = {
  error: "This endpoint speaks Streamable HTTP. POST JSON-RPC 2.0 here.",
};
