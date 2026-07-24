import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";

// Self-serve: signing up IS creating a business. No invites, no operator.
// The signUp form carries orgName; profile() passes it through to
// createOrUpdateUser, which creates the org and its owner user in one shot.

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        const profile = {
          email: String(params.email ?? "")
            .toLowerCase()
            .trim(),
          name: String(params.name ?? "").trim() || undefined,
          orgName: String(params.orgName ?? "").trim(),
        };
        // orgName isn't a users field; it rides along for the callback only.
        return profile as typeof profile & { email: string };
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) {
        // Guard against an auth account pointing at a deleted users row
        // (admin wiped tables in dev) — fall through to re-create.
        const existing = await ctx.db.get(args.existingUserId);
        if (existing) return args.existingUserId;
      }

      const profile = args.profile as {
        email?: string;
        name?: string;
        orgName?: string;
      };
      const email = profile.email;
      // `ctx.db` is typed against the generic auth data model; narrow it to
      // this app's schema to write org rows.
      const db = ctx.db as unknown as DatabaseWriter;

      const orgId = await db.insert("orgs", {
        name: profile.orgName || email || "My business",
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
        name: profile.name,
        orgId,
        role: "owner",
      });
    },
  },
});
