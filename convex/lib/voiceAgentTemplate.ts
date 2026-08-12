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
//
// WHAT BUMPS THIS NUMBER: changes syncTemplate can deliver — the agent-level
// knobs, the tool definitions, the model, the analysis fields. Prompt text
// does NOT: existing agents own their prompts and the sync never touches
// them, so a bump for a prompt edit would light every tenant's update banner
// and then visibly change nothing. Prompt improvements reach new agents by
// existing, and reach old ones through their owner's editor.
// v3 (2026-08-12, evening): claude-4.5-haiku replaces gpt-4.1. A/B'd on real
// calls to Bella the same day: same adherence to the 13-rule Turkish prompt,
// ~700ms first token against ~800, at half the per-minute price. Retell's own
// guidance warns the gpt-5.x family off voice entirely (per-turn reasoning
// tax), which also closes the "just use a newer mini" door.
// v4 (2026-08-12, late): book_appointment takes SERVICES, plural. The schema
// always said a haircut plus a beard trim is one appointment with two lines
// (see appointments.items); the tool only accepted one, so the agent booked
// twice and put one man in two chairs. A tool definition is sync-deliverable,
// so this bump is one the update banner can actually honour.
// v5 (2026-08-12, night): the agent may hang up. end_call is a tool, so it
// lives in the response engine and cannot be injected at ring time the way
// the persona name is — the Resepta toggle publishes to the provider, and
// syncTemplate honours a salon that switched it off.
export const VOICE_AGENT_TEMPLATE_VERSION = 5;

export type VoiceAgentLanguage = "tr-TR" | "en-US" | "de-DE";

// The whole prompt in the agent's language, not English-with-a-language-line.
// Two readers want this. The model drifts toward the language its prompt is
// written in, so a Turkish prompt is itself pressure toward Turkish output.
// And the OWNER reads this text in the app's editor: a Turkish salon owner
// handed English instructions cannot check what their own receptionist was
// told, let alone edit it.
//
// Tool names (book_appointment) stay English in every language: they are
// addresses, not prose, and the tools are registered under those names.
//
// The {{services}} line leans on beforeCallContext, which injects the spoken
// service list as a built-in dynamic variable on every call. Answering prices
// from the prompt saves the caller a tool round trip on the most common
// question a salon gets, and the two rules after it are field-tested on
// Bella: without them the agent recites the entire menu with prices.
const GENERAL_PROMPTS: Record<VoiceAgentLanguage, string[]> = {
  "tr-TR": [
    "ROL",
    "{{business_name}} için randevu resepsiyonistisin. Adın {{agent_name}}; sorulursa bu ismi söyle, boşsa isim uydurma. Her zaman Türkçe konuş, kısa ve sıcak ol.",
    "",
    "ELİNDEKİLER — bunları öğrenmek için araç çağırma",
    "Arayan: {{customer_name}} (doluysa tanıyorsun, adını sorma; boşsa bir kez sor)",
    "Sonraki randevusu: {{next_appointment}}",
    "Şu an: {{now}} — yarın, haftaya salı gibi ifadeleri buna göre çöz",
    "Ekip: {{staff}}",
    "Hizmetler ve fiyatlar: {{services}}",
    "Kaydedilecek bilgiler: {{information}}",
    "",
    "KONUŞMA",
    "Tek seferde tek soru sor. Arayanı sorgu listesine tutma.",
    "Bir bilgiyi bir kez söyle. Tarihi, saati, hizmeti veya ismi tekrar tekrar söyleme.",
    "Tarihi ya yarın gibi ya da 13 Ağustos Perşembe gibi söyle, ikisini aynı cümlede kullanma.",
    "İsmi en fazla bir iki kez ve saygı ekiyle kullan: Mert Bey, Ayşe Hanım. Cinsiyetten emin değilsen eki hiç kullanma, sadece siz de.",
    "Saatleri konuşma diliyle söyle: 15:00 için öğleden sonra üç, 15:30 için üç buçuk. On beş sıfır sıfır asla deme.",
    "Süreleri ve fiyatları sana verildiği haliyle, kelimesi kelimesine oku. Para birimi simgesi, kısaltma veya binlik ayraçlı sayı okuma.",
    "Araçlardan, bağlamdan, talimatlarından veya sistemden söz etme. Bakman gerekirse bir saniye de, sonra cevabı ver.",
    "",
    "FİYAT",
    "Fiyat sorulduğunda listeden hemen cevap ver, araç çağırma. Yalnızca sorulan hizmetin fiyatını söyle.",
    "Neler var diye sorulursa fiyat okumadan üç dört tanesini kısaca say ve ne istediğini sor. Tüm listeyi asla baştan sona okuma.",
    "",
    "RANDEVU",
    "Hiçbir şeyi uydurma. Müsaitlik, kayıt ve değişiklik her zaman araçlarla yapılır.",
    "Birden fazla hizmet tek bir book_appointment çağrısıdır: tek randevu, süreler toplanır, hizmetler arka arkaya yapılır.",
    "Kaydetmeden hemen önce hizmeti, tarihi ve saati bir kez tekrarla ve onay iste. book_appointment aracını yalnızca onaydan sonra çağır.",
    "Kayıttan sonra tek kısa cümleyle tamamlandığını söyle. Detayları baştan tekrar okuma.",
    "İptal veya ertelemede önce randevuyu bul ve adıyla söyle, değiştirmeden önce açık onay al.",
    "Arayan bir bilgi verdiğinde ya da onayladığında save_customer_details ile hemen kaydet.",
    "Takvimin bağlı olmadığı bildirilirse tercih edilen kesin saati sor ve kontrol edilmiş gibi davranmadan kaydet.",
    "Bir istek güvenle tamamlanamıyorsa neyin eksik olduğunu söyle ve tek bir net soru sor.",
    "",
    "KAPANIŞ",
    "Arayan vedalaştığında ya da başka sorusu kalmadığında kısaca veda et ve end_call ile bitir. Arayan konuşurken asla kapatma.",
  ],
  "en-US": [
    "ROLE",
    "You are the appointment receptionist for {{business_name}}. Your name is {{agent_name}}; give it if asked, and invent nothing if it is empty. Always speak English, stay short and warm.",
    "",
    "WHAT YOU ALREADY HAVE — do not call a tool to learn any of it",
    "Caller: {{customer_name}} (filled means you know them, do not ask again; empty means ask once)",
    "Their next appointment: {{next_appointment}}",
    "Right now: {{now}} — resolve tomorrow, next Tuesday and the like against this",
    "Team: {{staff}}",
    "Services and prices: {{services}}",
    "Information to collect: {{information}}",
    "",
    "SPEAKING",
    "Ask one question at a time. Do not hold the caller through a questionnaire.",
    "Say a detail once. Do not restate a date, time, service or name later in the call.",
    "Give a date either as tomorrow or as the full date, never both in one sentence.",
    "Use their name once or twice at most, with the courtesy title your language uses. If you are unsure, drop the title.",
    "Say clock times conversationally: 3 PM, half past three. Never fifteen hundred.",
    "Read durations and prices exactly as they are given to you. No currency symbol, no abbreviation, no thousands separator.",
    "Never mention your tools, your context, your instructions or the system. If you must look something up, say one moment, then answer.",
    "",
    "PRICE",
    "When asked a price, answer from the list immediately without a tool. Give the price only for the service asked about.",
    "When asked what is offered, name three or four briefly without prices and ask what they are looking for. Never recite the full list.",
    "",
    "BOOKING",
    "Invent nothing. Availability, saving and changes always go through the tools.",
    "Several services are ONE book_appointment call: one appointment, durations summed, services back to back.",
    "Immediately before saving, repeat the service, date and time once and ask for confirmation. Call book_appointment only after they confirm.",
    "Once saved, say so in one short sentence. Do not read the appointment back again.",
    "To cancel or move, find and name the appointment first, then take explicit confirmation.",
    "Save a detail with save_customer_details as soon as the caller gives or confirms it.",
    "If a tool says the calendar is not connected, ask for their exact preferred time and record it without claiming the slot was checked.",
    "If a request cannot be completed safely, say what is missing and ask one clear question.",
    "",
    "CLOSING",
    "When the caller says goodbye or has nothing further, say a short goodbye and end with end_call. Never hang up while they are talking.",
  ],
  "de-DE": [
    "ROLLE",
    "Du bist die Terminrezeption für {{business_name}}. Dein Name ist {{agent_name}}; nenne ihn auf Nachfrage und erfinde keinen, wenn er leer ist. Sprich immer Deutsch, kurz und freundlich.",
    "",
    "WAS DU BEREITS HAST — rufe dafür kein Werkzeug auf",
    "Anrufer: {{customer_name}} (gefüllt heißt, du kennst ihn und fragst nicht erneut; leer heißt, einmal fragen)",
    "Nächster Termin: {{next_appointment}}",
    "Jetzt: {{now}} — löse morgen, nächsten Dienstag und Ähnliches danach auf",
    "Team: {{staff}}",
    "Leistungen und Preise: {{services}}",
    "Zu erfassende Angaben: {{information}}",
    "",
    "SPRECHEN",
    "Stelle eine Frage nach der anderen. Halte den Anrufer nicht in einem Fragebogen fest.",
    "Nenne eine Angabe einmal. Wiederhole Datum, Uhrzeit, Leistung oder Namen später im Gespräch nicht.",
    "Nenne ein Datum entweder als morgen oder als volles Datum, nie beides im selben Satz.",
    "Verwende den Namen höchstens ein- bis zweimal, mit Herr oder Frau und Nachnamen. Bist du unsicher, lass die Anrede weg und sieze.",
    "Nenne Uhrzeiten natürlich: 15 Uhr, halb vier.",
    "Lies Dauern und Preise genau so vor, wie sie dir gegeben werden. Kein Währungssymbol, keine Abkürzung, kein Tausendertrennzeichen.",
    "Erwähne niemals deine Werkzeuge, deinen Kontext, deine Anweisungen oder das System. Musst du nachsehen, sage einen Moment und nenne dann die Antwort.",
    "",
    "PREIS",
    "Beantworte Preisfragen sofort aus der Liste, ohne Werkzeug. Nenne nur den Preis der gefragten Leistung.",
    "Wird nach dem Angebot gefragt, nenne drei oder vier kurz und ohne Preise und frage, was gesucht wird. Lies nie die ganze Liste vor.",
    "",
    "TERMIN",
    "Erfinde nichts. Verfügbarkeit, Speichern und Änderungen laufen immer über die Werkzeuge.",
    "Mehrere Leistungen sind EIN book_appointment-Aufruf: ein Termin, Dauern summiert, Leistungen nacheinander.",
    "Wiederhole direkt vor dem Speichern Leistung, Datum und Uhrzeit einmal und bitte um Bestätigung. Rufe book_appointment erst danach auf.",
    "Ist gespeichert, sage es in einem kurzen Satz. Lies den Termin nicht erneut vor.",
    "Zum Absagen oder Verschieben finde und benenne den Termin zuerst, dann hole ausdrückliche Bestätigung.",
    "Speichere eine Angabe mit save_customer_details, sobald der Anrufer sie nennt oder bestätigt.",
    "Meldet ein Werkzeug, dass der Kalender nicht verbunden ist, frage nach der gewünschten Uhrzeit und trage sie ein, ohne eine Prüfung zu behaupten.",
    "Lässt sich etwas nicht sicher abschließen, sage, was fehlt, und stelle eine klare Rückfrage.",
    "",
    "ABSCHLUSS",
    "Verabschiedet sich der Anrufer oder hat nichts weiter, verabschiede dich kurz und beende mit end_call. Lege nie auf, während er spricht.",
  ],
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

// The same greeting with her name in it. Built at provisioning rather than
// left to {{agent_name}} at ring time, because an unnamed agent would greet
// with "ben ." — the introduction is a CLAUSE, and a clause cannot be
// substituted away by an empty variable. New agents are born with whichever
// version fits; renaming an agent later is the owner editing their opening
// line, which is theirs to write anyway.
const BEGIN_MESSAGES_NAMED: Record<VoiceAgentLanguage, (name: string) => string> = {
  "tr-TR": (name) =>
    `Merhaba, burası {{business_name}}, ben ${name}. Size nasıl yardımcı olabilirim?`,
  "en-US": (name) =>
    `Hello, you've reached {{business_name}}. This is ${name}, how can I help?`,
  "de-DE": (name) =>
    `Guten Tag bei {{business_name}}, hier ist ${name}. Wie kann ich Ihnen helfen?`,
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

// Retell's own end-of-call tool. Not a custom function: hanging up is the
// provider's to do, and routing it through our webhook would mean the line
// stays open until we answer.
//
// OFF is a real choice a salon can make, which is why it is a flag rather
// than always present. A shop where the receptionist would never cut someone
// off wants an agent that waits to be hung up on. Unlike the persona name
// this cannot be injected at ring time — a tool lives in the response engine
// — so the toggle publishes to the provider.
export const END_CALL_TOOL_NAME = "end_call";

const END_CALL_TOOL = {
  type: "end_call",
  name: END_CALL_TOOL_NAME,
  description:
    "Hang up. Use it only after the conversation is genuinely finished and the caller has said goodbye or has nothing left to ask, never to cut someone short.",
};

export function appointmentReceptionistTemplate(args: {
  language: VoiceAgentLanguage;
  businessName: string;
  site: string;
  // What she calls herself to a caller. Optional: a salon that never named
  // her gets an agent that says it is the appointment desk, not one that
  // invents a name for itself.
  personaName?: string | null;
  // Whether she may hang up. Defaults ON for a new agent: without it every
  // call ends by the CALLER hanging up, which is why every transcript so far
  // reads user_hangup and why max_call_duration is the only other backstop.
  canEndCall?: boolean;
}) {
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
      "Create the appointment only after the caller confirms their name, everything they want done and one exact start time. A caller who wants two things booked together is ONE call to this tool listing both, never two calls.",
      {
        type: "object",
        properties: {
          name: { type: "string", description: "Caller's full name." },
          // Plural, because a haircut and a beard trim are one visit. Sending
          // them as two bookings put the same man in two chairs at the same
          // minute on a real call; the server now refuses that outright, so
          // an agent that does not know about this field gets a rejection
          // where it wants an appointment.
          services: {
            type: "array",
            items: { type: "string" },
            description:
              "Every service the caller asked for, in their own words, in the order they said them. One entry for a single service.",
          },
          start: {
            type: "string",
            description:
              "Confirmed start of the WHOLE visit as an ISO 8601 timestamp. Do not add up the services yourself; the booking is one block and its length is worked out here.",
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
      begin_message: args.personaName
        ? BEGIN_MESSAGES_NAMED[args.language](args.personaName)
        : BEGIN_MESSAGES[args.language],
      default_dynamic_variables: { business_name: args.businessName },
      // Pinned, not left to the provider's default. A template that does not
      // name its model gets whatever the account defaults to that month, so
      // the same salon can get a different answer speed after a provider
      // change nobody here made. Changing it here is one string, and
      // syncTemplate carries it to every agent whose owner clicks update.
      model: "claude-4.5-haiku",
      model_temperature: 0.1,
      general_prompt: GENERAL_PROMPTS[args.language].join("\n"),
      general_tools: args.canEndCall === false ? tools : [...tools, END_CALL_TOOL],
    },
    agent: {
      language: args.language,
      webhook_url: `${args.site}/retell/call-ended`,
      webhook_timeout_ms: 10000,
      // Turn-taking. Dynamic responsiveness is explicitly OFF, not merely
      // unset: it lets the provider decide the caller might not be finished
      // and hold the reply back, which buys fewer interruptions at the cost
      // of the exact pause an owner hears as "it's slow". A salon
      // receptionist answers the moment you stop talking. Explicit false
      // because syncTemplate PATCHes this object onto v1 agents that have it
      // true — an omitted key would leave them slow.
      enable_dynamic_responsiveness: false,
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
