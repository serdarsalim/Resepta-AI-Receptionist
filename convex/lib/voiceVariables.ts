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
  v.literal("customer_phone"),
  v.literal("customer_language"),
  v.literal("next_appointment"),
  v.literal("contact_field"),
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
  destination: v.union(v.literal("call"), v.literal("contact")),
  contactFieldId: v.optional(v.id("contactFields")),
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
    | "customer_phone"
    | "customer_language"
    | "next_appointment"
    | "contact_field";
  beforeValue?: string;
  beforeFieldId?: Id<"contactFields">;
  duringMode: "none" | "if_missing" | "confirm";
  afterCall: boolean;
  destination: "call" | "contact";
  contactFieldId?: Id<"contactFields">;
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
