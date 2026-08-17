import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import type { DatabaseWriter } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { seedDefaultRules } from "./messageRules";

// ── Walk-in access to the demo org ──────────────────────────────────────────
//
// A prospect should be able to look around a working salon without signing up.
// That needs anonymous sign-in — and anonymous sign-in on a deployment that
// also holds real salons' customer records is a decision an operator makes on
// purpose, never one that arrives with a deploy.
//
// So it is OFF unless DEMO_ORG_ID names the demo org:
//
//   npx convex env set DEMO_ORG_ID "<the demo org's _id>"
//
// With it unset the Anonymous provider is not registered at all, and the only
// way in is Google. With it set, an anonymous visitor gets a membership for
// THAT org and no other — which is what keeps them away from real customers,
// because every query in the app is scoped through requireOrg. The demo org
// must have demoMode set and no waAccounts row; see convex/demo.ts.
function demoOrgId(): Id<"orgs"> | null {
  const raw = process.env.DEMO_ORG_ID?.trim();
  return raw ? (raw as Id<"orgs">) : null;
}

// Google OAuth only (Serdar's call, 2026-07-25): every salon owner in the
// target market has a Google account on their phone, and one tap beats any
// form — plus no password-reset flow to ever build or support. Signing in for
// the first time IS creating the business; the org starts unnamed and the app
// asks for the business name right after (AppShell onboarding gate).

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // Force the account chooser instead of silently reusing whatever session
    // the browser remembers (same reasoning as Nudge: people have multiple
    // Google accounts).
    Google({
      authorization: { params: { prompt: "select_account" } },
    }),
    // Present only when a demo org is configured. Registering it
    // unconditionally would put an unauthenticated door on every deployment,
    // including ones with nothing to demo.
    ...(demoOrgId() ? [Anonymous()] : []),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) {
        // Guard against an auth account pointing at a deleted users row
        // (admin wiped tables in dev) — fall through to re-create.
        const existing = await ctx.db.get(args.existingUserId);
        if (existing) {
          // Refresh identity bits from Google, nothing else.
          await ctx.db.patch(args.existingUserId, {
            email: args.profile.email?.toLowerCase(),
            image: args.profile.image as string | undefined,
          });
          return args.existingUserId;
        }
      }

      const email = args.profile.email?.toLowerCase();
      const name = (args.profile.name as string | undefined)?.trim();
      // `ctx.db` is typed against the generic auth data model; narrow it to
      // this app's schema to write org rows.
      const db = ctx.db as unknown as DatabaseWriter;

      // ---- Walk-in visitor to the demo org. ----
      //
      // No email means the Anonymous provider, which is registered only when
      // DEMO_ORG_ID is set. They get a staff membership for the demo org and
      // nothing else — no new org is founded, and requireOrg will never resolve
      // them to another business.
      //
      // Verified against the org row rather than trusting the env var alone: a
      // DEMO_ORG_ID pointed at a real salon by mistake would otherwise hand
      // every anonymous visitor a membership for it.
      if (!email) {
        const demoId = demoOrgId();
        if (!demoId) throw new Error("anonymous-not-enabled");
        const demoOrg = await db.get(demoId);
        if (!demoOrg?.demoMode) throw new Error("not-a-demo-org");
        const userId = await db.insert("users", {
          name: "Demo",
          language: "en",
          orgId: demoId,
          role: "staff",
          isAnonymous: true,
        });
        // Staff, not owner: a visitor should be able to work the calendar and
        // the inbox, which is the demo, without reshaping the business or
        // reaching the settings that would be credentials on a real org.
        // Stamped: a walk-in asked to be here, so there is nothing to announce.
        await db.insert("memberships", {
          userId,
          orgId: demoId,
          role: "staff",
          seenAt: Date.now(),
        });
        return userId;
      }

      // ---- No invite branch here, deliberately. ----
      //
      // This used to look for an open invite matching the signing-in address
      // and, on a hit, put the new account straight into that org. Possession
      // of an email address was the whole credential: no token, no expiry,
      // nothing accepted. Anyone could found an org, invite an address they did
      // not control, and wait — and the victim's first Google sign-in landed
      // them inside a stranger's salon with read and write access, holding no
      // salon of their own, because the founding path below only ran when no
      // invite matched.
      //
      // Every first sign-in now founds its own org, and joining a workspace is
      // an explicit act: team.acceptInvite, against the token mailed to the
      // invited address. See convex/team.ts. The cost is that an invited person
      // also owns an empty org they will probably never open; acceptInvite
      // switches them into the invited workspace so they at least land in the
      // right one.

      // ---- Founding sign-in. ----
      // Unnamed until onboarding — "" renders as the name prompt in the app.
      const orgId = await db.insert("orgs", {
        name: "",
        timezone: "Europe/Istanbul",
        language: "tr",
        sendBookingConfirmation: true,
      });
      // Confirmation + one 24h reminder, and the migrated marker — a new org
      // is born on the messageRules model, never on the legacy fields.
      await seedDefaultRules(db, orgId);

      // Seed the template rows every org needs, as drafts with suggested Meta
      // names and a starter body the owner can rewrite. The authored body
      // (named tokens) is what emails and the shop phone send from day one;
      // bodyPreview is the positional string to hand Meta if the org ever
      // takes a Cloud number. Neither body mentions buttons: the Cloud lane
      // has real ones and the shop-phone lane appends its own reply hint.
      await db.insert("waTemplates", {
        orgId,
        kind: "confirmation",
        metaName: "randevu_onay",
        language: "tr",
        status: "draft",
        body: "Merhaba [name]! [business] randevunuz [date] için oluşturuldu.",
        subject: "Randevunuz oluşturuldu",
        bodyPreview:
          "Merhaba {{1}}! {{2}} randevunuz {{3}} için oluşturuldu. Onaylamak için butona dokunun.",
      });
      await db.insert("waTemplates", {
        orgId,
        kind: "reminder",
        metaName: "randevu_hatirlatma",
        language: "tr",
        status: "draft",
        body: "Merhaba [name]! [business] randevunuzu hatırlatırız: [date].",
        subject: "Randevu hatırlatması",
        bodyPreview:
          "Merhaba {{1}}! {{2}} randevunuz {{3}}. Gelemeyecekseniz lütfen iptal butonunu kullanın.",
      });
      await db.insert("waTemplates", {
        orgId,
        kind: "winback",
        metaName: "randevu_telafi",
        language: "tr",
        status: "draft",
        body: "Merhaba [name]! [business] olarak sizi özledik. Yeni bir randevu için bu mesajı yanıtlamanız yeterli.",
        subject: "Sizi özledik!",
        bodyPreview:
          "Merhaba {{1}}! {{2}} olarak sizi özledik. Yeni bir randevu için bu mesajı yanıtlamanız yeterli.",
      });

      const userId = await db.insert("users", {
        email,
        name,
        image: args.profile.image as string | undefined,
        orgId,
        role: "owner",
      });
      // Membership is what grants access (requireOrg verifies it) — the
      // founding sign-in gets one exactly like an invited user. Stamped,
      // because nobody needs telling about the business they just founded.
      await db.insert("memberships", {
        userId,
        orgId,
        role: "owner",
        seenAt: Date.now(),
      });
      return userId;
    },
  },
});
