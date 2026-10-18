import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const voiceVariableType = v.union(
  v.literal("string"),
  v.literal("number"),
  v.literal("boolean"),
  v.literal("enum"),
);

export const voiceBeforeSource = v.union(
  v.literal("none"),
  v.literal("static"),
  v.literal("business_name"),
  v.literal("customer_name"),
  v.literal("customer_first_name"),
  v.literal("customer_last_name"),
  v.literal("customer_phone"),
  v.literal("customer_email"),
  v.literal("customer_language"),
  v.literal("next_appointment"),
  v.literal("contact_field"),
);

// The details that live in their own columns on a customer rather than in the
// custom map, and so cannot be reached through a contactField.
//
// First and last name are SEPARATE, and captured separately. Taking one
// spoken name and splitting it on the first space is a guess that no amount
// of code improves: "serdar salim domurcuk" has no rule that says where the
// given name ends. The agent is the only party to the call that can ask, or
// tell from how it was said, so it hands back two values and we store two.
//
// Phone is absent on purpose: it is how a caller is IDENTIFIED, and letting a
// call rewrite it would move the record out from under the lookup that found
// it.
export const voiceCustomerField = v.union(
  v.literal("firstName"),
  v.literal("lastName"),
  v.literal("email"),
);

export const voiceDuringMode = v.union(
  v.literal("none"),
  v.literal("if_missing"),
  v.literal("confirm"),
);

export const voiceVariableInput = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
  type: voiceVariableType,
  choices: v.optional(v.array(v.string())),
  required: v.boolean(),
  beforeSource: voiceBeforeSource,
  beforeValue: v.optional(v.string()),
  beforeFieldId: v.optional(v.id("contactFields")),
  duringMode: voiceDuringMode,
  afterCall: v.boolean(),
  destination: v.union(v.literal("call"), v.literal("contact"), v.literal("customer")),
  contactFieldId: v.optional(v.id("contactFields")),
  customerField: v.optional(voiceCustomerField),
});

export type VoiceVariableInput = {
  key: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum";
  choices?: string[];
  required: boolean;
  beforeSource:
    | "none"
    | "static"
    | "business_name"
    | "customer_name"
    | "customer_first_name"
    | "customer_last_name"
    | "customer_phone"
    | "customer_email"
    | "customer_language"
    | "next_appointment"
    | "contact_field";
  beforeValue?: string;
  beforeFieldId?: Id<"contactFields">;
  duringMode: "none" | "if_missing" | "confirm";
  afterCall: boolean;
  destination: "call" | "contact" | "customer";
  contactFieldId?: Id<"contactFields">;
  customerField?: "firstName" | "lastName" | "email";
};

// Turkish letters fold before lowercasing — "İ".toLowerCase() is i plus a
// combining dot the ascii class would turn into an underscore. The NFD strip
// clears any other combining mark the same way.
export function normaliseVoiceVariableKey(raw: string): string {
  return raw
    .trim()
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

// The agent's four first sentences (P34, lib/opener; retellAgents.openers),
// as the agent page saves them and the browser test previews them unsaved.
export const openersValidator = v.object({
  cold: v.optional(v.string()),
  followUp: v.optional(v.string()),
  missed: v.optional(v.string()),
  inbound: v.optional(v.string()),
});
