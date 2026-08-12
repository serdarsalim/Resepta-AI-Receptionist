// Resepta owns the business behavior of agents it creates. The provider gets
// a compiled copy of this versioned template; it is not the source of truth.
// Changing the behavior is a new version so existing agents do not silently
// change under a salon owner.

export const VOICE_AGENT_TEMPLATE_KEY = "appointment_receptionist";
// v2 (2026-08-12): turn-taking and tool dead air. v1 left every latency knob
// unset EXCEPT enable_dynamic_responsiveness, which it turned on — and that one
// deliberately waits longer before answering, so the one setting v1 made was
// the slow one. Values here are copied from a hand-tuned Turkish agent that
// does not feel slow on the phone, not guessed.
export const VOICE_AGENT_TEMPLATE_VERSION = 2;

export type VoiceAgentLanguage = "tr-TR" | "en-US" | "de-DE";

const LANGUAGE_NAMES: Record<VoiceAgentLanguage, string> = {
  "tr-TR": "Turkish",
  "en-US": "English",
  "de-DE": "German",
};

// Every one of these puts the business name where the caller's own language
// says "you have reached X", never in the vocative — "Merhaba, {{business_name}}"
// greets the salon rather than the caller. Turkish gets there with "burası",
// which is also the only form that stays correct for an arbitrary name: any
// case suffix would have to agree with the name's own vowels ('den vs 'dan vs
// 'ten vs 'tan), and a template cannot inflect a variable.
const BEGIN_MESSAGES: Record<VoiceAgentLanguage, string> = {
  "tr-TR": "Merhaba, burası {{business_name}}. Size nasıl yardımcı olabilirim?",
  "en-US": "Hello, you've reached {{business_name}}. How can I help?",
  "de-DE": "Guten Tag bei {{business_name}}. Wie kann ich Ihnen helfen?",
};

// The summary the owner reads on the call, asked for by name.
//
// Retell's built-in call_summary has no language setting and comes back
// English for a Turkish call. It is not even reliably English: the analysis
// pass drifts toward whatever language its prompt happens to be full of, so an
// agent with Turkish field descriptions gets Turkish summaries by accident and
// one without gets English. Emergent is not a feature — this asks outright.
//
// Namespaced so it can never collide with a contact field the salon names
// itself; the key derivation in contactFields would otherwise be free to
// produce "summary".
export const VOICE_SUMMARY_FIELD = "resepta_call_summary";

// Summarised in the language the CALL was held in, not the dashboard's. A
// summary is worth reading because it carries the caller's own words for what
// they wanted, and translating those into a second language loses the exact
// phrasing that makes it evidence. A Turkish salon reads a Turkish dashboard
// anyway, so the two only diverge for a business taking calls in a language it
// does not administer in — and there the call's language is still the honest
// one for a quote.
export function summaryAnalysisField(language: string) {
  const key = (language ?? "").toLowerCase().slice(0, 2);
  const name =
    key === "tr" ? "Turkish" : key === "de" ? "German" : key === "en" ? "English" : "English";
  return {
    type: "string",
    name: VOICE_SUMMARY_FIELD,
    description: [
      `Two or three sentences on what the caller wanted and what happened.`,
      `Write it in ${name}. Always ${name}, whatever language this instruction is in.`,
      `Name the service, the date and time, and whether it was booked, moved or cancelled.`,
      `If nothing was settled, say what was missing.`,
    ].join(" "),
  };
}

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
  // Whether the agent talks WHILE the tool runs. Off, the caller hears nothing
  // from the moment they finish asking until the round trip comes back — us,
  // then possibly the calendar provider — and silence on a phone reads as the
  // agent being slow even when the answer is quick. On only for the two tools
  // that can leave the deployment; the pure reads return fast enough that
  // filler would just make the agent chattier.
  speakDuringExecution = false,
) {
  return {
    type: "custom",
    name,
    description,
    url: `${site}/retell/functions`,
    method: "POST",
    parameter_type: "json",
    parameters,
    speak_during_execution: speakDuringExecution,
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
      true,
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
      true,
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
      // Pinned, not left to the provider's default. A template that does not
      // name its model gets whatever the account defaults to that month, so
      // the same salon can get a different answer speed after a provider
      // change nobody here made. If this still reads slow, a mini tier is the
      // next lever — it is one string, and this is where it lives.
      model: "gpt-4.1",
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
      // Turn-taking. enable_dynamic_responsiveness used to be here and is
      // gone on purpose: it lets the provider decide the caller might not be
      // finished and hold the reply back, which buys fewer interruptions at
      // the cost of the exact pause an owner hears as "it's slow". A salon
      // receptionist answers the moment you stop talking.
      responsiveness: 0.99,
      // The other half of the same trade. The agent yields quickly when the
      // caller talks over it, so an over-long answer costs a second, not the
      // whole turn.
      interruption_sensitivity: 0.7,
      // "hı hı" while the caller is still speaking. It does not make a single
      // reply arrive sooner; it removes the dead line that makes a caller ask
      // "hello?" — which is most of what slow feels like on a phone.
      enable_backchannel: true,
      normalize_for_speech: true,
      post_call_analysis_data: [summaryAnalysisField(args.language)],
    },
  };
}
