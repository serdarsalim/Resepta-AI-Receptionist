// Randevu owns the business behavior of agents it creates. The provider gets
// a compiled copy of this versioned template; it is not the source of truth.
// Changing the behavior is a new version so existing agents do not silently
// change under a salon owner.

export const VOICE_AGENT_TEMPLATE_KEY = "appointment_receptionist";
export const VOICE_AGENT_TEMPLATE_VERSION = 1;

export type VoiceAgentLanguage = "tr-TR" | "en-US" | "de-DE";

const LANGUAGE_NAMES: Record<VoiceAgentLanguage, string> = {
  "tr-TR": "Turkish",
  "en-US": "English",
  "de-DE": "German",
};

const BEGIN_MESSAGES: Record<VoiceAgentLanguage, string> = {
  "tr-TR": "Merhaba, {{business_name}}. Size nasıl yardımcı olabilirim?",
  "en-US": "Hello, you've reached {{business_name}}. How can I help?",
  "de-DE": "Guten Tag bei {{business_name}}. Wie kann ich Ihnen helfen?",
};

type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

function customTool(
  site: string,
  name: string,
  description: string,
  parameters: JsonSchema,
) {
  return {
    type: "custom",
    name,
    description,
    url: `${site}/retell/functions`,
    method: "POST",
    parameter_type: "json",
    parameters,
    speak_during_execution: false,
    speak_after_execution: true,
    timeout_ms: 15000,
  };
}

export function appointmentReceptionistTemplate(args: {
  language: VoiceAgentLanguage;
  businessName: string;
  site: string;
}) {
  const languageName = LANGUAGE_NAMES[args.language];
  const empty = { type: "object" as const, properties: {} };
  const tools = [
    customTool(
      args.site,
      "check_availability",
      "Check appointment times for one local calendar date before offering a slot. If the calendar is not connected, ask for the caller's preferred time and continue without inventing availability.",
      {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Local date in YYYY-MM-DD format.",
          },
        },
        required: ["date"],
      },
    ),
    customTool(
      args.site,
      "book_appointment",
      "Create the appointment only after the caller confirms their name, requested service and exact start time.",
      {
        type: "object",
        properties: {
          name: { type: "string", description: "Caller's full name." },
          service: {
            type: "string",
            description: "Service in the caller's own words.",
          },
          start: {
            type: "string",
            description: "Confirmed appointment start as an ISO 8601 timestamp.",
          },
        },
        required: ["name", "start"],
      },
    ),
    customTool(
      args.site,
      "find_appointment",
      "Find the caller's next appointment before discussing, cancelling or moving it.",
      empty,
    ),
    customTool(
      args.site,
      "cancel_appointment",
      "Cancel the next appointment only after naming it and receiving explicit confirmation.",
      empty,
    ),
    customTool(
      args.site,
      "reschedule_appointment",
      "Move the next appointment only after the caller confirms the new exact start time.",
      {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Confirmed new start as an ISO 8601 timestamp.",
          },
        },
        required: ["start"],
      },
    ),
  ];

  return {
    llm: {
      start_speaker: "agent",
      begin_message: BEGIN_MESSAGES[args.language],
      default_dynamic_variables: { business_name: args.businessName },
      model_temperature: 0.1,
      general_prompt: [
        `You are the appointment receptionist for {{business_name}}. Always speak ${languageName}.`,
        "Help callers book, find, cancel and reschedule appointments. Stay concise, warm and practical.",
        "Read the current customer and business context before asking for details. Save a customer detail as soon as the caller provides or explicitly confirms it.",
        "Never invent a service, price, opening time, appointment or available slot. Use the available tools for every read or write.",
        "Before booking, repeat the caller's name, service and exact local date and time, then ask for confirmation. Call book_appointment only after they confirm.",
        "Before cancelling or rescheduling, find and name the appointment, then ask for explicit confirmation before changing it.",
        "If a tool reports that the calendar is not connected, ask for the caller's preferred exact time and record the appointment without claiming the slot was checked.",
        "If a request cannot be completed safely, say what information is missing and ask one clear follow-up question.",
      ].join("\n"),
      general_tools: tools,
    },
    agent: {
      language: args.language,
      webhook_url: `${args.site}/retell/call-ended`,
      webhook_timeout_ms: 10000,
      enable_dynamic_responsiveness: true,
      normalize_for_speech: true,
    },
  };
}
