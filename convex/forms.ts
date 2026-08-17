import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertE164, requireOwner } from "./lib/orgAuth";
import { splitName } from "./lib/emailInbound";
import { recordCustomerCreated } from "./lib/newCustomer";

// The public request form: the fourth way into this app, next to WhatsApp,
// email and a phone call.
//
// EVERY function in this file is unauthenticated on purpose — the whole point
// is a stranger with a link. That makes the org slug the only key, so nothing
// here may read or return anything the org has not chosen to publish. No
// customer data, no counts, no settings beyond the name and the service list.
//
// There is no form BUILDER. Nudge has one because it serves marketing teams
// running many landing pages; a salon has one question ("who are you and what
// do you want booked"), and the answer is already in the org's own service
// list. A builder here would be a second configuration surface for a form
// nobody would customise twice.

// Turkish-folded, lowercased, hyphenated. Same shaping as contactFields' key
// derivation, kept separate because that one feeds a data key and this one
// feeds a URL.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// What the public page renders. Deliberately thin.
export const publicForm = query({
  args: { slug: v.string() },
  returns: v.union(
    v.object({
      orgName: v.string(),
      services: v.array(
        v.object({ _id: v.id("services"), name: v.string() }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    if (!slug) return null;
    // Indexed, not a full-table collect — see schema orgs.by_public_slug. In
    // `submit` this mattered doubly: a mutation that reads every org row
    // conflicts with any concurrent write to any of them.
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .unique();
    // A disabled form is indistinguishable from a wrong slug, which is the
    // right answer: an org that switched its form off has not agreed to keep
    // confirming it exists.
    if (!org || !org.formEnabled) return null;
    const services = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    return {
      orgName: org.name,
      // Price is NOT published. What a salon charges is between it and the
      // person in the chair, and a public page that quotes it turns every
      // price change into a customer argument.
      services: services
        .filter((service) => service.active)
        .map((service) => ({ _id: service._id, name: service.name })),
    };
  },
});

export const submit = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    serviceIds: v.optional(v.array(v.id("services"))),
    note: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    // Indexed, not a full-table collect — see schema orgs.by_public_slug. In
    // `submit` this mattered doubly: a mutation that reads every org row
    // conflicts with any concurrent write to any of them.
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
      .unique();
    if (!org || !org.formEnabled) return { ok: false, reason: "not-found" };

    const name = args.name.trim();
    if (!name) return { ok: false, reason: "name-required" };
    let phone: string;
    try {
      phone = assertE164(args.phone);
    } catch {
      return { ok: false, reason: "bad-phone" };
    }

    // Same phone, same person — reuse the record rather than creating a
    // duplicate every time a regular fills the form again. The submission
    // still lands on their timeline, so nothing is lost by not making a row.
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", org._id).eq("phone", phone))
      .unique();
    const named = splitName(name);
    let customerId = existing?._id;
    if (!customerId) {
      customerId = await ctx.db.insert("customers", {
        orgId: org._id,
        firstName: named.firstName,
        ...(named.lastName ? { lastName: named.lastName } : {}),
        phone,
        ...(args.email?.trim() ? { email: args.email.trim().toLowerCase() } : {}),
        // Filling in a form asking to be contacted IS consent to be contacted
        // about it, and it is dated, which is what KVKK actually asks for.
        consentAt: Date.now(),
      });
      await recordCustomerCreated(ctx, {
        orgId: org._id,
        customerId,
        source: "form",
      });
    }

    // Names resolved HERE, not stored as ids: this row is a record of what
    // somebody asked for, and it has to still read correctly after the salon
    // renames or deletes a service.
    const wanted: string[] = [];
    for (const serviceId of args.serviceIds ?? []) {
      const service = await ctx.db.get(serviceId);
      if (service && service.orgId === org._id) wanted.push(service.name);
    }

    // It lands as a MESSAGE, not an appointment. A stranger picking a service
    // has not agreed a time with anybody, and writing a booking straight into
    // the calendar means a form can double-book the salon's day. The staff
    // read this and book it themselves — one extra click, and the calendar
    // keeps meaning "this is happening".
    const body = [
      wanted.length ? wanted.join(", ") : undefined,
      args.note?.trim() || undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
    await ctx.db.insert("messages", {
      orgId: org._id,
      customerId,
      direction: "in",
      // `form_` prefix IS the source marker the feed reads.
      kind: "form_request",
      body: body || undefined,
      status: "received",
    });
    await ctx.db.patch(customerId, { lastInboundAt: Date.now() });
    return { ok: true };
  },
});

// ---- Owner side: switching the form on and finding its link ----

export const enable = mutation({
  args: { enabled: v.boolean() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    if (!args.enabled) {
      // The slug SURVIVES being switched off. Regenerating it on re-enable
      // would silently break every link already printed on a card or pasted
      // into an Instagram bio.
      await ctx.db.patch(orgId, { formEnabled: false });
      return org.publicSlug ?? null;
    }
    let slug = org.publicSlug;
    if (!slug) {
      const base = slugify(org.name) || "resepta";
      const taken = new Set(
        (await ctx.db.query("orgs").collect())
          .filter((other) => other._id !== orgId)
          .map((other) => other.publicSlug),
      );
      slug = base;
      let n = 2;
      while (taken.has(slug)) slug = `${base}-${n++}`;
    }
    await ctx.db.patch(orgId, { formEnabled: true, publicSlug: slug });
    return slug;
  },
});
