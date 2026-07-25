import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import type { DatabaseWriter } from "./_generated/server";

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

      // Unnamed until onboarding — "" renders as the name prompt in the app.
      const orgId = await db.insert("orgs", {
        name: "",
        timezone: "Europe/Istanbul",
        language: "tr",
        sendBookingConfirmation: true,
      });

      // Seed the two template registrations every org needs, as drafts with
      // suggested Meta names — Settings is where the owner marks them
      // approved once Meta approves them.
      await db.insert("waTemplates", {
        orgId,
        kind: "confirmation",
        metaName: "randevu_onay",
        language: "tr",
        status: "draft",
        bodyPreview:
          "Merhaba {{1}}! {{2}} randevunuz {{3}} için oluşturuldu. Onaylamak için butona dokunun.",
      });
      await db.insert("waTemplates", {
        orgId,
        kind: "reminder",
        metaName: "randevu_hatirlatma",
        language: "tr",
        status: "draft",
        bodyPreview:
          "Merhaba {{1}}! {{2}} randevunuz {{3}}. Gelemeyecekseniz lütfen iptal butonunu kullanın.",
      });

      return await db.insert("users", {
        email,
        name,
        image: args.profile.image as string | undefined,
        orgId,
        role: "owner",
      });
    },
  },
});
