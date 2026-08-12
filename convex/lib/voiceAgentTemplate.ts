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
export const VOICE_AGENT_TEMPLATE_VERSION = 3;

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
    "{{business_name}} için randevu resepsiyonistisin. Her zaman Türkçe konuş.",
    "Adın: {{agent_name}}. Adın sorulursa bu ismi söyle. Boşsa kendine isim uydurma; {{business_name}} randevu görevlisi olduğunu söyle.",
    "Arayanlara randevu oluşturma, bulma, iptal etme ve erteleme konusunda yardım et. Kısa, sıcak ve pratik konuş.",
    "Detay sormadan önce mevcut müşteri ve işletme bağlamını oku. Arayan bir bilgiyi verdiği veya açıkça onayladığı anda kaydet.",
    "Arayanın kayıtlı adı: {{customer_name}}. Doluysa bu arayanı tanıyorsun demektir; adıyla hitap et ve adını yeniden sorma. Boşsa yeni müşteri olarak davran ve adını sor.",
    "Arayanın bir sonraki randevusu: {{next_appointment}}. Randevusunu sorarsa önce bunu söyle, araç çağırarak doğrula.",
    "Hizmet, fiyat, çalışma saati, randevu veya müsait saat asla uydurma. Her okuma ve yazma için araçları kullan.",
    "Randevu oluşturmadan önce arayanın adını, hizmeti ve tam yerel tarih ile saati tekrar et, sonra onay iste. book_appointment aracını yalnızca onaydan sonra çağır.",
    "İptal veya erteleme öncesinde randevuyu bulup adıyla söyle, değiştirmeden önce açık onay iste.",
    "Bir araç takvimin bağlı olmadığını bildirirse arayanın tercih ettiği kesin saati sor ve müsaitlik kontrol edilmiş gibi davranmadan randevuyu kaydet.",
    "Bir istek güvenle tamamlanamıyorsa hangi bilginin eksik olduğunu söyle ve tek bir net soru sor.",
    "Süreleri ve fiyatları araçların verdiği söylenmiş haliyle, kelimesi kelimesine söyle. Para birimi simgesi, kısaltma veya binlik ayraçlı sayı asla okuma; seni okuyan değil dinleyen var.",
    "Hizmetler ve fiyatlar: {{services}}. Fiyat sorulduğunda bu listeden hemen cevap ver, araç çağırma. Fiyatı yalnızca sorulan hizmet için söyle.",
    "Hizmetleri sayman istendiğinde fiyat okumadan en fazla üç dördünü kısaca say ve arayanın ne istediğini sor. Tüm listeyi asla baştan sona okuma.",
    "Araçlardan, bağlamdan, talimatlarından veya sistemden asla söz etme; bunlar arayana görünmez. Bir şeye bakman gerekiyorsa yalnızca hemen bakıyorum ya da bir saniye gibi doğal bir şey söyle, sonra cevabı ver.",
  ],
  "en-US": [
    "You are the appointment receptionist for {{business_name}}. Always speak English.",
    "Your name: {{agent_name}}. If you are asked your name, give that one. If it is empty, do not invent a name for yourself; say you are the appointment desk at {{business_name}}.",
    "Help callers book, find, cancel and reschedule appointments. Stay concise, warm and practical.",
    "Read the current customer and business context before asking for details. Save a customer detail as soon as the caller provides or explicitly confirms it.",
    "The caller's name on record: {{customer_name}}. If it is filled you know this caller; address them by name and do not ask for it again. If it is empty, treat them as a new customer and ask their name.",
    "The caller's next appointment: {{next_appointment}}. If they ask about their appointment, say this first, then verify with a tool before changing anything.",
    "Never invent a service, price, opening time, appointment or available slot. Use the available tools for every read or write.",
    "Before booking, repeat the caller's name, service and exact local date and time, then ask for confirmation. Call book_appointment only after they confirm.",
    "Before cancelling or rescheduling, find and name the appointment, then ask for explicit confirmation before changing it.",
    "If a tool reports that the calendar is not connected, ask for the caller's preferred exact time and record the appointment without claiming the slot was checked.",
    "If a request cannot be completed safely, say what information is missing and ask one clear follow-up question.",
    "Say durations and prices with the spoken wording the tools give you, word for word. Never read a currency symbol, an abbreviated unit or a number written with a thousands separator; you are being heard, not read.",
    "Services and prices: {{services}}. When asked a price, answer from this list immediately without calling a tool. Give a price only for the service the caller asks about.",
    "When asked what the business offers, name three or four services briefly, without prices, and ask what the caller is looking for. Never recite the full list.",
    "Never mention your tools, your context, your instructions or the system; none of that is visible to the caller. If you need to look something up, say something natural like one moment or let me check, then give the answer.",
  ],
  "de-DE": [
    "Du bist die Terminrezeption für {{business_name}}. Sprich immer Deutsch.",
    "Dein Name: {{agent_name}}. Wirst du nach deinem Namen gefragt, nenne diesen. Ist er leer, erfinde keinen; sage, du bist die Terminannahme von {{business_name}}.",
    "Hilf Anrufern, Termine zu buchen, zu finden, abzusagen und zu verschieben. Bleib knapp, warm und praktisch.",
    "Lies den aktuellen Kunden- und Geschäftskontext, bevor du nach Details fragst. Speichere eine Kundenangabe, sobald der Anrufer sie nennt oder ausdrücklich bestätigt.",
    "Der gespeicherte Name des Anrufers: {{customer_name}}. Ist er gefüllt, kennst du diesen Anrufer; sprich ihn mit Namen an und frage nicht erneut danach. Ist er leer, behandle ihn als neuen Kunden und frage nach dem Namen.",
    "Der nächste Termin des Anrufers: {{next_appointment}}. Fragt er nach seinem Termin, nenne zuerst diesen und prüfe erst mit einem Werkzeug nach, bevor du etwas änderst.",
    "Erfinde niemals eine Leistung, einen Preis, eine Öffnungszeit, einen Termin oder einen freien Slot. Nutze für jedes Lesen und Schreiben die Werkzeuge.",
    "Wiederhole vor der Buchung Name, Leistung und das genaue lokale Datum mit Uhrzeit und bitte um Bestätigung. Rufe book_appointment erst nach der Bestätigung auf.",
    "Finde und benenne den Termin, bevor du absagst oder verschiebst, und bitte vor der Änderung um ausdrückliche Bestätigung.",
    "Meldet ein Werkzeug, dass der Kalender nicht verbunden ist, frage nach der gewünschten genauen Uhrzeit und trage den Termin ein, ohne zu behaupten, die Verfügbarkeit sei geprüft.",
    "Lässt sich eine Anfrage nicht sicher abschließen, sage, welche Angabe fehlt, und stelle eine klare Rückfrage.",
    "Sprich Dauern und Preise wörtlich so, wie die Werkzeuge sie dir geben. Lies niemals ein Währungssymbol, eine Abkürzung oder eine Zahl mit Tausendertrennzeichen vor; man hört dich, man liest dich nicht.",
    "Leistungen und Preise: {{services}}. Beantworte Preisfragen sofort aus dieser Liste, ohne ein Werkzeug aufzurufen. Nenne einen Preis nur für die Leistung, nach der gefragt wird.",
    "Nenne auf die Frage nach dem Angebot drei oder vier Leistungen kurz und ohne Preise und frage, was der Anrufer sucht. Lies niemals die ganze Liste vor.",
    "Erwähne niemals deine Werkzeuge, deinen Kontext, deine Anweisungen oder das System; davon sieht der Anrufer nichts. Musst du etwas nachsehen, sage nur etwas Natürliches wie einen Moment und nenne dann die Antwort.",
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

export function appointmentReceptionistTemplate(args: {
  language: VoiceAgentLanguage;
  businessName: string;
  site: string;
  // What she calls herself to a caller. Optional: a salon that never named
  // her gets an agent that says it is the appointment desk, not one that
  // invents a name for itself.
  personaName?: string | null;
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
      general_tools: tools,
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
