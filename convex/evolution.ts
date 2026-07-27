// The salon's side of the Evolution lane.
//
// Split along the same line as everything else here: the operator installs the
// server credentials (baseUrl, apiKey, adminKey live in `connections`, behind
// requirePlatformAdmin), and the SALON does the one part only they can do,
// which is hold their phone up to a QR code. Nothing in this file returns a
// credential — a salon sees a QR image, a connection state and the number that
// ended up linked, and never the key that fetched them.
//
// requireOrg, not requirePlatformAdmin: this is their number and their
// Settings screen.

import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/orgAuth";
import { connectionField } from "./lib/connections";
import { fetchEvolutionInstance, fetchEvolutionQr } from "./lib/evolution";

// Instance name plus the operator-installed credentials, resolved server-side.
// Internal because it hands back an api key, which is exactly what the actions
// above it must not return to a browser.
export const laneContext = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      instance: v.union(v.string(), v.null()),
      baseUrl: v.union(v.string(), v.null()),
      apiKey: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    return {
      instance: org.evolutionInstance ?? null,
      baseUrl: await connectionField(ctx, orgId, "evolution", "baseUrl"),
      apiKey: await connectionField(ctx, orgId, "evolution", "apiKey"),
    };
  },
});

const laneStatus = v.object({
  // Whether this org has an Evolution lane at all. False means the whole
  // section stays hidden — a salon on Cloud only should never see a QR code
  // for a product they were not sold.
  enabled: v.boolean(),
  connected: v.boolean(),
  state: v.string(),
  number: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
});

type LaneStatus = {
  enabled: boolean;
  connected: boolean;
  state: string;
  number: string | null;
  error: string | null;
};

const OFF: LaneStatus = {
  enabled: false,
  connected: false,
  state: "unset",
  number: null,
  error: null,
};

// Never throws. This renders inside the salon's own Settings, and a server the
// operator is restarting should read as "reconnecting", not as a crashed page.
export const status = action({
  args: {},
  returns: laneStatus,
  handler: async (ctx): Promise<LaneStatus> => {
    const context = await ctx.runQuery(internal.evolution.laneContext, {});
    if (!context?.instance || !context.baseUrl || !context.apiKey) return OFF;
    const result = await fetchEvolutionInstance({
      baseUrl: context.baseUrl,
      apiKey: context.apiKey,
      instance: context.instance,
    });
    if (!result.ok) {
      return { ...OFF, enabled: true, state: "unreachable", error: result.reason };
    }
    return {
      enabled: true,
      connected: result.connected,
      state: result.state,
      number: result.number,
      error: null,
    };
  },
});

// The pairing QR, as a data URI the UI drops straight into an <img>.
//
// Fetched on demand rather than polled: Evolution's codes expire in well under
// a minute, so one held on screen from a page load is a code that will fail
// when somebody finally points a phone at it. The UI asks when the salon says
// they are ready to scan.
export const qr = action({
  args: {},
  returns: v.object({
    qr: v.union(v.string(), v.null()),
    connected: v.boolean(),
    error: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
  ): Promise<{ qr: string | null; connected: boolean; error: string | null }> => {
    const context = await ctx.runQuery(internal.evolution.laneContext, {});
    if (!context?.instance || !context.baseUrl || !context.apiKey) {
      return { qr: null, connected: false, error: "not-configured" };
    }
    const result = await fetchEvolutionQr({
      baseUrl: context.baseUrl,
      apiKey: context.apiKey,
      instance: context.instance,
    });
    if (!result.ok) return { qr: null, connected: false, error: result.reason };
    return { qr: result.qr, connected: result.connected, error: null };
  },
});
