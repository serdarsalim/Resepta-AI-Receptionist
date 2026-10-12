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
// v6 (2026-08-12, night): turn-taking. interruption_sensitivity 0.7 -> 0.4
// and a greeting short enough to survive being greeted back.
// v7 (2026-08-12, night): get_call_context removed from the agent entirely.
// It hung a live call for twenty seconds and fetched only things already
// injected at ring time.
// v8: email_policy removed. It was a conditional instruction that resolved
// to an empty string for every salon delivering over WhatsApp, so it did
// nothing except sit in the owner's editor looking like a mistake. The plain
// rule is back, asked once after the booking is saved.
// v9: goods — services without a duration take no slot, repeat-per-piece for
// quantity, and the lead-time refusal gets its own remedy line.
// v10 (2026-08-19): save_customer_details leaves MCP for the function
// endpoint. Retell's MCP round trip cost a flat ~12 seconds of dead air per
// save — an 18 Aug Bella call saved four times and spent 50 of its 180
// seconds in silence, the caller asking "nasıl yani?" into the first gap —
// while the HTTP tools on /retell/functions answer in about a second. Same
// name, same mutation, only the transport changes; and the filler line goes
// with it (speak_during_execution off), because a sub-second write needs no
// "kaydediyorum" to paper over. The /retell/mcp server keeps serving pre-v10
// agents until their owners publish anything.
// v11 (2026-08-20): model_high_priority on. The knob is sync-deliverable
// (it rides the same LLM PATCH as model and temperature), so this bump is
// honest: clicking update genuinely changes an existing agent's latency.
// The same session rewrote the prompts (bare-honorific ban, never ask what
// the card holds, suggested_slots) — those reach new agents only, per the
// rule above.
// v12 (2026-08-21): the end_call tool description gains its two negatives —
// never in the same turn as the agent's own goodbye, never in reply to a
// greeting. A tool DESCRIPTION is sync-deliverable (syncTemplate replaces the
// template's tools and leaves the owner's prompt alone), so this bump is the
// honest kind: clicking Update genuinely changes how an existing agent
// decides to hang up, without touching a word the owner wrote.
//
// The turn-based CLOSING rule added to the prompts the same day is NOT this —
// prompt text reaches new agents only, per the rule above. That split is the
// whole reason the tool carries the negative too: it is the half of the fix
// that can reach the agents already in the field.
// v13 (2026-08-25): voicemail detection, armed and set to hang up. Until now
// an outbound call that reached an answering machine talked to it until the
// provider's ceiling — nothing detected the machine, so the salon paid for
// three minutes of a receptionist reading availability to a beep. An
// agent-doc field, so it rides the same PATCH syncTemplate already sends and
// reaches existing agents when their owner clicks update.
// v14 (2026-10-13): check_availability takes the caller's `time`, the chat
// tool's parameter, and its description now says to ask which day and time
// suit the caller BEFORE listing any. The server answers that time as a fact
// (requested_time, judgeRequestedTime) and, when it is taken, with the
// nearest free times either side. A tool schema and description, so this is
// the honest kind of bump: Update genuinely reaches existing agents. The
// stale "if the calendar is not connected" clause went with it: Resepta is
// always the calendar.
//
// Folded into the same v14 before it shipped (P1c of the Nudge port, so an
// owner clicks Update once for all of it), every piece sync-deliverable:
//   - a hard call-length cap, max_call_duration_ms on the agent doc, Nudge's
//     ten minutes (MAX_CALL_DURATION_MS below);
//   - a holding line on all five calendar tools: a few words in the agent's
//     own language while the tool runs, never naming a day or a time, which
//     Nudge learned when "booking it for Monday at 3 PM" was followed by the
//     confirmation saying it again (Nudge f2a44605, HOLDING_LINES below);
//   - `start` described as the business's local wall time, YYYY-MM-DDTHH:MM,
//     the way the chat tools and Nudge's tools already ask for it, instead of
//     "an ISO 8601 timestamp", which invites a model to write UTC with a Z;
//   - boosted keywords: the business name, its team and its services as the
//     recogniser's vocabulary (lib/boostedKeywords, Nudge 3379705e and
//     61788709). Not a template field, since they are per business, but
//     syncTemplate carries them, and so does every other publish that writes
//     the agent doc;
//   - cancel_appointment and reschedule_appointment name their appointment by
//     `appointment_start`, the start find_appointment gave, and
//     `appointment_services`, its services as given (review fixes, same day:
//     two orders can share a minute). They acted on whatever was next when
//     they ran, so a provider retry or a second "yes" cancelled the
//     appointment after the one meant. /retell/functions reads
//     templateVersion to know which engines carry them, and an older one
//     keeps "the next one", pinned by its services, with a guard after each
//     change.
// None of the new wording names a tool. Tool answers are served live to every
// template version, and descriptions arrive with the tools they describe, so
// neither can promise a tool an older agent lacks (Nudge ba2d956a).
export const VOICE_AGENT_TEMPLATE_VERSION = 14;

// The longest one call may run before the provider ends it. Ten minutes,
// Nudge's number on the same field (7bf2c681): its median answered call ran
// 108 seconds and the one that reached the cap had looped on one question. A
// salon booking takes two or three minutes, so the cap only ever meets a call
// that has gone wrong, and it bounds what that call can cost. The call record
// shows such an ending as "Hit the maximum call length"
// (calls.end.max_duration_reached).
export const MAX_CALL_DURATION_MS = 600_000;

// Voicemail handling, learned from Nudge's implementation rather than from the
// provider's docs (its docs/journal/2026-08.md → 2026-08-25 session 2, where every claim
// below was verified against the live API).
//
// THERE IS NO BOOLEAN. The PRESENCE of voicemail_option is what arms
// detection, and an explicit null is what disarms it — so a template that
// wanted detection off would have to SEND null, not omit the key. Omitting
// patches nothing.
//
// Hang up rather than leave a message, deliberately. A message is one shot at
// a real person and its words are a decision per business and per language —
// what the salon is called, whether it offers to call back, which number it
// names. A message this file guessed would be worse than the silence it
// replaced, and an EMPTY message is worse still: the agent answers the
// machine, says nothing, and the salon has paid to record a beep. Hanging up
// is the honest floor, and it is the whole of the saving. Leaving a message
// wants a control on the business's own agent page (Nudge's `setVoicemail`
// is the shape to copy) — not a value invented here.
export const VOICEMAIL_ACTION = "hangup";

export type VoiceAgentLanguage = "tr-TR" | "en-US" | "de-DE";

// The voice a provisioned agent is born with, per language, in preference
// order — auto-provisioning takes the first id the workspace's catalogue
// actually offers and falls back to the catalogue's own first entry.
// tr-TR is Bella's proven voice (the prod agent Serdar hand-tuned). ALL
// minimax, matching the catalogue's minimax-only rule (lib/voiceCatalogue):
// a default outside the catalogue is how Sun Klinik was born speaking
// retell-Alejandro. An owner changes the voice any time in the agent editor.
export const DEFAULT_VOICE_IDS: Record<VoiceAgentLanguage, string[]> = {
  "tr-TR": ["minimax-Camille"],
  "en-US": ["minimax-Ashley", "minimax-Kate", "minimax-Sloane"],
  "de-DE": ["minimax-Max"],
};

// The platform default model — what a new agent is born with and what an
// agent with no operator override runs after a template sync. Named here so
// the /admin picker's "Platform default" row and the template can never
// disagree about which model that is.
export const VOICE_AGENT_MODEL = "claude-4.5-haiku";

// The platform default TIER — Retell's paid priority queue. Named beside the
// model for the same reason: two /admin pickers and a per-agent picker all
// render the words "platform default", and the only way they can agree about
// what that means is by reading the constant rather than restating it.
//
// True since template v11 (see the version log above). Everything downstream
// treats an unset operator row as "this" rather than as false, so turning the
// fleet off is a decision somebody makes, not a default that drifts in.
export const VOICE_AGENT_HIGH_PRIORITY = true;

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
// 2026-08-21: the Bella port. Two refinements Serdar tuned into the prod
// Bella agent by hand, brought home so every provisioned agent is born with
// them: the caller's next appointment in the context block ({{next_appointment}}
// is a built-in injected on every ring, retell.ts beforeCallContext), and the
// greet-a-known-caller-by-name-once rule. Prompt text only — no version bump,
// per the rule at the top of this file.
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
    "Arayanı tanıyorsan ilk cevabında adıyla ve saygı ekiyle selamla; sonrasında adını tekrar edip durma.",
    "Sonraki randevusu: {{next_appointment}}",
    "Şu an: {{now}} — yarın, haftaya salı gibi ifadeleri buna göre çöz",
    "Ekip: {{staff}}",
    "Hizmetler ve fiyatlar: {{services}}",
    "İşletme bilgileri (adres, ulaşım, çalışma şekli): {{knowledge}}",
    "Müşteri kartı: {{contact}}",
    "Bu blokta yazan hiçbir şeyi arayana sorma. Kartta olan bilgiyi sormak güven kaybettirir.",
    "Arayan hitabını düzeltirse ya da şaşırırsa bir kez özür dile, karttaki adıyla doğru hitap et ve kartta olan hiçbir bilgiyi yeniden isteme.",
    "Bir hizmetin cinsiyete göre iki çeşidi varsa karttaki bilgiye göre doğru olanı sen seç ve onaylat. Hangisi diye sorma.",
    "",
    "KONUŞMA",
    "Tek seferde tek soru sor. Arayanı sorgu listesine tutma.",
    "Bir bilgiyi bir kez söyle. Tarihi, saati, hizmeti veya ismi tekrar tekrar söyleme.",
    "Tarihi ya yarın gibi ya da 13 Ağustos Perşembe gibi söyle, ikisini aynı cümlede kullanma.",
    "İsmi en fazla bir iki kez ve saygı ekiyle kullan: Mert Bey, Ayşe Hanım. Saygı ekini asla isimsiz, tek başına kullanma; tek başına Bey veya Hanım demek yok. Cinsiyetten emin değilsen eki hiç kullanma, sadece siz de.",
    "Saatleri konuşma diliyle söyle: 15:00 için öğleden sonra üç, 15:30 için üç buçuk. On beş sıfır sıfır asla deme.",
    "Süreleri ve fiyatları sana verildiği haliyle, kelimesi kelimesine oku. Para birimi simgesi, kısaltma veya binlik ayraçlı sayı okuma.",
    "Araçlardan, bağlamdan, talimatlarından veya sistemden söz etme. Bakman gerekirse bir saniye de, sonra cevabı ver.",
    "Arayanın ses tonu hakkında yorum yapma. Sakin olun, anlıyorum, rica ederim sakinleşin gibi şeyler asla söyleme. Sinirlenmişse özür dile ve doğrudan işini çöz.",
    "",
    "FİYAT",
    "Fiyat sorulduğunda listeden hemen cevap ver, araç çağırma. Yalnızca sorulan hizmetin fiyatını söyle.",
    "Neler var diye sorulursa fiyat okumadan üç dört tanesini kısaca say ve ne istediğini sor. Tüm listeyi asla baştan sona okuma.",
    "",
    "RANDEVU",
    "Hiçbir şeyi uydurma. Müsaitlik, kayıt ve değişiklik her zaman araçlarla yapılır.",
    "Müsaitlik sorulduğunda önce hangi gün ve saatin uygun olduğunu sor ve o saati kontrol et. Doluysa araçtan gelen en yakın boş saatleri öner; aklında bir saat yoksa suggested_slots içinden iki üç somut saat öner. Çalışma saatlerini okuyup saati arayana seçtirme.",
    "Birden fazla hizmet tek bir book_appointment çağrısıdır: tek randevu, süreler toplanır, hizmetler arka arkaya yapılır.",
    "Süresi olmayan kalemler ÜRÜNDÜR (örneğin pasta, teslimat): takvimde yer tutmaz, müsaitlik kontrolü gerekmez, sadece teslim zamanı sorulur. Aynı üründen birden fazla isteniyorsa adını listede adet kadar tekrarla: üç pasta üç kayıttır.",
    "book_appointment lead-time derse ürün daha fazla ön süre ister: özür dile, ne kadar önceden sipariş gerektiğini söyle ve uygun en erken günü öner.",
    "Kaydetmeden hemen önce hizmeti, tarihi ve saati bir kez tekrarla ve onay iste. book_appointment aracını yalnızca onaydan sonra çağır.",
    "Kayıttan sonra tek kısa cümleyle tamamlandığını söyle. Detayları baştan tekrar okuma.",
    "İptal veya ertelemede önce randevuyu bul ve adıyla söyle, değiştirmeden önce açık onay al.",
    "Arayan kartındaki bir bilgiyi verdiğinde, düzelttiğinde ya da onayladığında save_customer_details ile hemen kaydet. Yazabileceğin anahtarlar: {{information}}. Telefon numarası değiştirilemez; arayan zaten o numaradan arıyor.",
    "Randevu kaydedildikten sonra, kayıtlı e-posta adresi yoksa bir kez e-posta adresini iste. Söylediğini olduğu gibi kaydet; harf harf doğrulatma. Vermek istemezse üstelemeden geç.",
    "Takvimin bağlı olmadığı bildirilirse tercih edilen kesin saati sor ve kontrol edilmiş gibi davranmadan kaydet.",
    "Bir istek güvenle tamamlanamıyorsa neyin eksik olduğunu söyle ve tek bir net soru sor.",
    "",
    "KAPANIŞ",
    "Arayan vedalaştığında ya da başka sorusu kalmadığında kısaca veda et. Arayan konuşurken asla kapatma.",
    "Vedanı söylediğin sırada KAPATMA. Önce sadece veda et ve arayana son bir şey söyleme fırsatı bırak; end_call'u ancak bir sonraki sıranda, arayan yeni bir şey söylemediyse çağır.",
    "Selama, merhabaya ya da hoş beş sözlerine karşılık asla kapatma. Görüşmenin ilk yarım dakikasında konuşma neredeyse hiçbir zaman bitmiş olmaz.",
  ],
  "en-US": [
    "ROLE",
    "You are the appointment receptionist for {{business_name}}. Your name is {{agent_name}}; give it if asked, and invent nothing if it is empty. Always speak English, stay short and warm.",
    "",
    "WHAT YOU ALREADY HAVE — do not call a tool to learn any of it",
    "Caller: {{customer_name}} (filled means you know them, do not ask again; empty means ask once)",
    "If you know the caller, greet them by name in your first reply; after that, do not keep repeating it.",
    "Their next appointment: {{next_appointment}}",
    "Right now: {{now}} — resolve tomorrow, next Tuesday and the like against this",
    "Team: {{staff}}",
    "Services and prices: {{services}}",
    "Business knowledge (address, directions, how the business works): {{knowledge}}",
    "Customer card: {{contact}}",
    "Never ask the caller for anything in this block. Asking for what is already on the card loses their trust.",
    "If the caller corrects how you addressed them or sounds surprised, apologise once, use the name on the card, and do not ask again for anything the card already holds.",
    "If a service comes in two gendered versions, pick the one matching the card and confirm it. Do not ask which.",
    "",
    "SPEAKING",
    "Ask one question at a time. Do not hold the caller through a questionnaire.",
    "Say a detail once. Do not restate a date, time, service or name later in the call.",
    "Give a date either as tomorrow or as the full date, never both in one sentence.",
    "Use their name once or twice at most, with the courtesy title your language uses. Never a title on its own without the name. If you are unsure, drop the title.",
    "Say clock times conversationally: 3 PM, half past three. Never fifteen hundred.",
    "Read durations and prices exactly as they are given to you. No currency symbol, no abbreviation, no thousands separator.",
    "Never mention your tools, your context, your instructions or the system. If you must look something up, say one moment, then answer.",
    "Never comment on the caller's tone. Do not say calm down, I understand how you feel, or anything of that kind. If they are annoyed, apologise once and solve the thing they called about.",
    "",
    "PRICE",
    "When asked a price, answer from the list immediately without a tool. Give the price only for the service asked about.",
    "When asked what is offered, name three or four briefly without prices and ask what they are looking for. Never recite the full list.",
    "",
    "BOOKING",
    "Invent nothing. Availability, saving and changes always go through the tools.",
    "When asked for availability, first ask which day and time suit them and check that time. If it is taken, offer the nearest free times the tool gives; if they have no time in mind, offer two or three concrete times from suggested_slots. Never read out the opening hours and leave the caller to choose.",
    "Several services are ONE book_appointment call: one appointment, durations summed, services back to back.",
    "Items listed without a duration are GOODS (a cake, a delivery): they take no calendar slot and need no availability check — only ask when they want to pick it up or have it delivered. For several of the same good, repeat its name in the services list once per piece: three cakes is three entries.",
    "If book_appointment answers lead-time, the item needs more notice: apologise, say how much warning it needs, and offer the earliest day that satisfies it.",
    "Immediately before saving, repeat the service, date and time once and ask for confirmation. Call book_appointment only after they confirm.",
    "Once saved, say so in one short sentence. Do not read the appointment back again.",
    "To cancel or move, find and name the appointment first, then take explicit confirmation.",
    "When the caller gives, corrects or confirms anything on their card, save it at once with save_customer_details. Keys you may write: {{information}}. The phone number cannot be changed; it is the number they are calling from.",
    "After the appointment is saved, if there is no email on file, ask once for an email address. Record what they say as given, do not have them spell it out, and move on without pressing if they would rather not.",
    "If a tool says the calendar is not connected, ask for their exact preferred time and record it without claiming the slot was checked.",
    "If a request cannot be completed safely, say what is missing and ask one clear question.",
    "",
    "CLOSING",
    "When the caller says goodbye or has nothing further, say a short goodbye. Never hang up while they are talking.",
    "Do NOT hang up in the same turn as your goodbye. Say it and leave the caller room for one last thing; call end_call only on your NEXT turn, once they have added nothing new.",
    "Never hang up in response to a greeting, a hello or an opening pleasantry. In the first half-minute a conversation is essentially never finished.",
  ],
  "de-DE": [
    "ROLLE",
    "Du bist die Terminrezeption für {{business_name}}. Dein Name ist {{agent_name}}; nenne ihn auf Nachfrage und erfinde keinen, wenn er leer ist. Sprich immer Deutsch, kurz und freundlich.",
    "",
    "WAS DU BEREITS HAST — rufe dafür kein Werkzeug auf",
    "Anrufer: {{customer_name}} (gefüllt heißt, du kennst ihn und fragst nicht erneut; leer heißt, einmal fragen)",
    "Kennst du den Anrufer, begrüße ihn in deiner ersten Antwort mit Namen und Anrede; danach wiederhole den Namen nicht ständig.",
    "Sein nächster Termin: {{next_appointment}}",
    "Jetzt: {{now}} — löse morgen, nächsten Dienstag und Ähnliches danach auf",
    "Team: {{staff}}",
    "Leistungen und Preise: {{services}}",
    "Betriebsinfos (Adresse, Anfahrt, Arbeitsweise): {{knowledge}}",
    "Kundenkarte: {{contact}}",
    "Frage den Anrufer nach nichts, was in diesem Block steht. Nach etwas zu fragen, das auf der Karte steht, kostet Vertrauen.",
    "Korrigiert der Anrufer die Anrede oder wundert er sich, entschuldige dich einmal, verwende den Namen von der Karte und frage nichts erneut ab, was die Karte schon enthält.",
    "Gibt es eine Leistung in zwei Varianten nach Geschlecht, wähle anhand der Karte die passende und lass sie bestätigen. Frage nicht, welche.",
    "",
    "SPRECHEN",
    "Stelle eine Frage nach der anderen. Halte den Anrufer nicht in einem Fragebogen fest.",
    "Nenne eine Angabe einmal. Wiederhole Datum, Uhrzeit, Leistung oder Namen später im Gespräch nicht.",
    "Nenne ein Datum entweder als morgen oder als volles Datum, nie beides im selben Satz.",
    "Verwende den Namen höchstens ein- bis zweimal, mit Herr oder Frau und Nachnamen. Niemals Herr oder Frau allein ohne Namen. Bist du unsicher, lass die Anrede weg und sieze.",
    "Nenne Uhrzeiten natürlich: 15 Uhr, halb vier.",
    "Lies Dauern und Preise genau so vor, wie sie dir gegeben werden. Kein Währungssymbol, keine Abkürzung, kein Tausendertrennzeichen.",
    "Erwähne niemals deine Werkzeuge, deinen Kontext, deine Anweisungen oder das System. Musst du nachsehen, sage einen Moment und nenne dann die Antwort.",
    "Kommentiere niemals den Ton des Anrufers. Sage nicht beruhigen Sie sich oder Ähnliches. Ist er verärgert, entschuldige dich einmal und löse sein Anliegen.",
    "",
    "PREIS",
    "Beantworte Preisfragen sofort aus der Liste, ohne Werkzeug. Nenne nur den Preis der gefragten Leistung.",
    "Wird nach dem Angebot gefragt, nenne drei oder vier kurz und ohne Preise und frage, was gesucht wird. Lies nie die ganze Liste vor.",
    "",
    "TERMIN",
    "Erfinde nichts. Verfügbarkeit, Speichern und Änderungen laufen immer über die Werkzeuge.",
    "Frag bei Verfügbarkeitsfragen zuerst, welcher Tag und welche Uhrzeit passen, und prüfe diese Zeit. Ist sie belegt, biete die nächsten freien Zeiten aus dem Werkzeug an; hat der Anrufer keine Zeit im Kopf, biete zwei oder drei konkrete Zeiten aus suggested_slots an. Lies nie die Öffnungszeiten vor und überlass dem Anrufer nicht die Wahl.",
    "Mehrere Leistungen sind EIN book_appointment-Aufruf: ein Termin, Dauern summiert, Leistungen nacheinander.",
    "Einträge ohne Dauer sind WAREN (eine Torte, eine Lieferung): sie belegen keinen Termin und brauchen keine Verfügbarkeitsprüfung — frage nur nach dem Abhol- oder Lieferzeitpunkt. Für mehrere Stück derselben Ware wiederhole ihren Namen in der Liste einmal pro Stück: drei Torten sind drei Einträge.",
    "Antwortet book_appointment mit lead-time, braucht die Ware mehr Vorlauf: entschuldige dich, nenne die nötige Vorlaufzeit und biete den frühesten passenden Tag an.",
    "Wiederhole direkt vor dem Speichern Leistung, Datum und Uhrzeit einmal und bitte um Bestätigung. Rufe book_appointment erst danach auf.",
    "Ist gespeichert, sage es in einem kurzen Satz. Lies den Termin nicht erneut vor.",
    "Zum Absagen oder Verschieben finde und benenne den Termin zuerst, dann hole ausdrückliche Bestätigung.",
    "Nennt, korrigiert oder bestätigt der Anrufer etwas auf seiner Karte, speichere es sofort mit save_customer_details. Schreibbare Schlüssel: {{information}}. Die Telefonnummer ist nicht änderbar; von ihr ruft er gerade an.",
    "Ist der Termin gespeichert und keine E-Mail hinterlegt, frage einmal nach der Adresse. Nimm sie so auf, wie sie genannt wird, lass nicht buchstabieren und hake nicht nach, wenn jemand sie nicht geben möchte.",
    "Meldet ein Werkzeug, dass der Kalender nicht verbunden ist, frage nach der gewünschten Uhrzeit und trage sie ein, ohne eine Prüfung zu behaupten.",
    "Lässt sich etwas nicht sicher abschließen, sage, was fehlt, und stelle eine klare Rückfrage.",
    "",
    "ABSCHLUSS",
    "Verabschiedet sich der Anrufer oder hat nichts weiter, verabschiede dich kurz. Lege nie auf, während er spricht.",
    "Lege NICHT im selben Zug auf, in dem du dich verabschiedest. Verabschiede dich zuerst und lass dem Anrufer Raum für eine letzte Sache; rufe end_call erst in deinem NÄCHSTEN Zug auf, wenn nichts Neues mehr kam.",
    "Lege niemals als Antwort auf eine Begrüßung oder eine einleitende Höflichkeit auf. In der ersten halben Minute ist ein Gespräch so gut wie nie beendet.",
  ],
};

// Every one of these puts the business name where the caller's own language
// says "you have reached X", never in the vocative — "Merhaba, {{business_name}}"
// greets the salon rather than the caller. Turkish gets there with "burası",
// which is also the only form that stays correct for an arbitrary name: any
// case suffix would have to agree with the name's own vowels ('den vs 'dan vs
// 'ten vs 'tan), and a template cannot inflect a variable.
const BEGIN_MESSAGES: Record<VoiceAgentLanguage, string> = {
  "tr-TR": "{{business_name}}, buyurun.",
  "en-US": "{{business_name}}, how can I help?",
  "de-DE": "{{business_name}}, guten Tag.",
};

// The same greeting with her name in it. Built at provisioning rather than
// left to {{agent_name}} at ring time, because an unnamed agent would greet
// with "ben ." — the introduction is a CLAUSE, and a clause cannot be
// substituted away by an empty variable. New agents are born with whichever
// version fits; renaming an agent later is the owner editing their opening
// line, which is theirs to write anyway.
const BEGIN_MESSAGES_NAMED: Record<VoiceAgentLanguage, (name: string) => string> = {
  "tr-TR": (name) => `{{business_name}}, ben ${name}. Buyurun.`,
  "en-US": (name) => `{{business_name}}, this is ${name}. How can I help?`,
  "de-DE": (name) => `{{business_name}}, hier ist ${name}. Guten Tag.`,
};

// The prompt text as the CODE MODULE has it, in the shape the store and the
// operator console pass around: one string for the whole prompt, and the two
// greetings with the persona name reduced to a {name} placeholder.
//
// {name}, not {{name}}: the double-brace forms are Retell dynamic variables
// resolved while the phone rings, and this one is substituted at PROVISIONING
// time — see BEGIN_MESSAGES_NAMED above for why the introduction cannot be a
// ring-time variable. A single-brace token cannot be mistaken for the other
// kind, and it never reaches the provider either way.
export type VoiceAgentPrompt = {
  general: string;
  beginMessage: string;
  beginMessageNamed: string;
};

export function codePrompt(language: VoiceAgentLanguage): VoiceAgentPrompt {
  return {
    general: GENERAL_PROMPTS[language].join("\n"),
    beginMessage: BEGIN_MESSAGES[language],
    beginMessageNamed: BEGIN_MESSAGES_NAMED[language]("{name}"),
  };
}

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

// What the agent says WHILE a calendar tool runs. Without it the caller hears
// nothing from the moment they finish asking until the answer is spoken: the
// model writing the call, the round trip to us (and to the calendar provider
// on the parked lane), then the model writing the answer. That is the pause a
// caller fills with "alo?", and it reads as the agent being slow even when
// every hop is quick.
//
// An instruction to the model (execution_message_type "prompt"), not a fixed
// sentence, so the words vary from one check to the next and stay in the
// conversation's register. Written in the agent's language for the reason the
// prompts are: the model leans toward the language it is instructed in.
//
// A few words, and NEVER a day or a time. Nudge's first real booking said
// "Booking the meeting for Monday at 3 PM now" and then the confirmation said
// Monday at 3 PM again (f2a44605); the prompt's own rule is to say a detail
// once, and the confirmation after the tool is where it belongs. Before v14
// check_availability and book_appointment spoke during execution with the
// provider's default instruction, which has no such limit, and the other
// three stayed silent.
type HoldingKind = "check" | "book" | "find" | "move" | "cancel";

const HOLDING_LINES: Record<VoiceAgentLanguage, Record<HoldingKind, string>> = {
  "tr-TR": {
    check: 'Sadece birkaç kelime söyle, örneğin "Bir saniye, bakıyorum." Gün ya da saat söyleme.',
    book: 'Sadece birkaç kelime söyle, örneğin "Bir saniye." Gün, saat ya da hizmet söyleme; randevuyu kaydettikten sonra bir kez onaylayacaksın.',
    find: 'Sadece birkaç kelime söyle, örneğin "Hemen bakıyorum." Gün ya da saat söyleme.',
    move: 'Sadece birkaç kelime söyle, örneğin "Bir saniye." Gün ya da saat söyleme; yeni saati değiştirdikten sonra bir kez onaylayacaksın.',
    cancel: 'Sadece birkaç kelime söyle, örneğin "Bir saniye." Gün ya da saat söyleme.',
  },
  "en-US": {
    check: 'Say only a few words, like "One moment, let me check." Name no day or time.',
    book: 'Say only a few words, like "One moment." Name no day, time or service; you confirm the booking once, after.',
    find: 'Say only a few words, like "Let me look that up." Name no day or time.',
    move: 'Say only a few words, like "One moment." Name no day or time; you confirm the new time once, after.',
    cancel: 'Say only a few words, like "One moment." Name no day or time.',
  },
  "de-DE": {
    check: "Sag nur ein paar Worte, etwa „Einen Moment, ich schaue nach.“ Nenne keinen Tag und keine Uhrzeit.",
    book: "Sag nur ein paar Worte, etwa „Einen Moment.“ Nenne keinen Tag, keine Uhrzeit und keine Leistung; den Termin bestätigst du danach einmal.",
    find: "Sag nur ein paar Worte, etwa „Ich sehe kurz nach.“ Nenne keinen Tag und keine Uhrzeit.",
    move: "Sag nur ein paar Worte, etwa „Einen Moment.“ Nenne keinen Tag und keine Uhrzeit; die neue Zeit bestätigst du danach einmal.",
    cancel: "Sag nur ein paar Worte, etwa „Einen Moment.“ Nenne keinen Tag und keine Uhrzeit.",
  },
};

function customTool(
  site: string,
  name: string,
  description: string,
  parameters: JsonSchema,
  // The holding line (HOLDING_LINES above). Absent, the tool runs in silence,
  // which only save_customer_details still does: it answers in about a second
  // while the caller is mid-flow, and v10 measured a filler there as chatter.
  holdingLine?: string,
) {
  return {
    type: "custom",
    name,
    description,
    url: `${site}/retell/functions`,
    method: "POST",
    parameter_type: "json",
    parameters,
    speak_during_execution: holdingLine !== undefined,
    ...(holdingLine !== undefined
      ? {
          execution_message_type: "prompt",
          execution_message_description: holdingLine,
        }
      : {}),
    speak_after_execution: true,
    timeout_ms: 15000,
  };
}

// Deliberately NOT in the template's tool list. Like the MCP tool it
// replaces, it is appended by every publish path in retellAgent.ts
// (withRuntimeSaveTool), so it reaches an existing agent the next time
// anything about that agent is published — not only when its owner clicks
// the template-update banner. The keys it may write are per-business
// ({{information}} in the prompt), so the schema stays a free object rather
// than enumerating properties a sync would have to chase.
export function saveCustomerDetailsTool(site: string) {
  return customTool(
    site,
    "save_customer_details",
    "Save details the caller provides or explicitly confirms, using only the keys listed in your instructions. Never guess a value. Repeating the same save is safe.",
    {
      type: "object",
      properties: {
        values: {
          type: "object",
          description:
            "Configured information keys from your instructions, each set to the caller-confirmed value.",
        },
      },
      required: ["values"],
    },
  );
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
    "Hang up. Use it only after the conversation is genuinely finished and the caller has said goodbye or has nothing left to ask, never to cut someone short. Never call this in the same turn as your own goodbye, and never in response to a greeting or an opening pleasantry.",
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
  // The operator's prompt override (convex/lib/voicePromptStore), when one
  // exists. Passed by the PROVISIONING path and nowhere else, which is the
  // whole safety story: syncTemplate reads this function too, and it never
  // sends general_prompt or begin_message, so an override cannot reach an
  // agent that already exists. Prompt text reaches new agents only — the rule
  // at the top of this file, now enforced by which caller bothers to resolve.
  prompt?: VoiceAgentPrompt;
}) {
  const prompt = args.prompt ?? codePrompt(args.language);
  const empty = { type: "object" as const, properties: {} };
  const holding = HOLDING_LINES[args.language];
  const tools = [
    customTool(
      args.site,
      "check_availability",
      "Check appointment times for one local calendar date. Ask the caller which day and time suit them BEFORE listing any times, then call this with that date and, when they named one, the time: the result says whether that time is free and, if it is not, the nearest free times to offer instead. Without a time it returns a few free times for the day.",
      {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Local date in YYYY-MM-DD format.",
          },
          time: {
            type: "string",
            description:
              "The time the caller asked for, 24h HH:MM, when they named one. The result's requested_time then says whether it is free; trust that answer.",
          },
        },
        required: ["date"],
      },
      holding.check,
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
          // The business's wall time, never UTC (v14). "An ISO 8601
          // timestamp" invites a model to write UTC, or to put a Z on the
          // local time it holds, and a Z is read as the instant it names:
          // three hours late in Istanbul. The server reads a zone-less stamp
          // at the business (lib/businessHours parseLocalStart), and chat's
          // tools have always asked for this shape.
          start: {
            type: "string",
            description:
              "Confirmed start of the WHOLE visit as the local time at the business: YYYY-MM-DDTHH:MM, 24-hour, no time zone and no Z, like 2026-10-14T15:00. It is the date you checked and the time the caller agreed, never converted to UTC. Do not add up the services yourself; the booking is one block and its length is worked out here.",
          },
        },
        required: ["name", "start"],
      },
      holding.book,
    ),
    customTool(
      args.site,
      "find_appointment",
      "Find the caller's next appointment, with its appointment_start and appointment_services, before discussing, cancelling or moving it.",
      empty,
      holding.find,
    ),
    customTool(
      args.site,
      "cancel_appointment",
      "Cancel the caller's appointment that starts at appointment_start, only after naming it and receiving explicit confirmation.",
      {
        type: "object",
        properties: {
          appointment_start: {
            type: "string",
            description:
              "The appointment_start find_appointment gave for the appointment to cancel, exactly as given.",
          },
          appointment_services: {
            type: "array",
            items: { type: "string" },
            description:
              "The appointment_services given with that appointment_start, exactly as given, when there were any.",
          },
        },
        required: ["appointment_start"],
      },
      holding.cancel,
    ),
    customTool(
      args.site,
      "reschedule_appointment",
      "Move the caller's appointment that starts at appointment_start, only after the caller confirms the new exact start time.",
      {
        type: "object",
        properties: {
          appointment_start: {
            type: "string",
            description:
              "The appointment_start find_appointment gave for the appointment to move, exactly as given.",
          },
          appointment_services: {
            type: "array",
            items: { type: "string" },
            description:
              "The appointment_services given with that appointment_start, exactly as given, when there were any.",
          },
          start: {
            type: "string",
            description:
              "Confirmed new start as the local time at the business: YYYY-MM-DDTHH:MM, 24-hour, no time zone and no Z, like 2026-10-14T15:00. Never converted to UTC.",
          },
        },
        required: ["appointment_start", "start"],
      },
      holding.move,
    ),
  ];

  return {
    llm: {
      start_speaker: "agent",
      begin_message: args.personaName
        ? prompt.beginMessageNamed.replaceAll("{name}", args.personaName)
        : prompt.beginMessage,
      default_dynamic_variables: { business_name: args.businessName },
      // Pinned, not left to the provider's default. A template that does not
      // name its model gets whatever the account defaults to that month, so
      // the same salon can get a different answer speed after a provider
      // change nobody here made. Changing it here is one string, and
      // syncTemplate carries it to every agent whose owner clicks update —
      // unless the operator set a per-agent override in /admin, which wins.
      model: VOICE_AGENT_MODEL,
      model_temperature: 0.1,
      // Paid priority inference. Off, the Tolga Güner test call (20 Aug) ran
      // e2e p50 1586ms with the LLM itself at ~735ms — Haiku is already the
      // fast model, so the remaining lever is the provider's queue, and a
      // receptionist is exactly the workload the priority tier exists for.
      model_high_priority: VOICE_AGENT_HIGH_PRIORITY,
      general_prompt: prompt.general,
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
      // 0.4, down from 0.7. At 0.7 a caller saying "merhaba" back over the
      // greeting counted as an interruption: the agent stopped, then resumed
      // the leftover half of its sentence, so its opening line arrived in
      // three shards. Turkish callers greet back every single time.
      //
      // Lower is NOT less responsive — responsiveness above is what decides
      // how fast she answers, and it stays at 0.99. This only decides how
      // much noise it takes to make her stop mid-word, and a short greeting
      // should survive someone saying hello over it.
      interruption_sensitivity: 0.4,
      // "hı hı" while the caller is still speaking. It does not make a single
      // reply arrive sooner; it removes the dead line that makes a caller ask
      // "hello?" — which is most of what slow feels like on a phone.
      enable_backchannel: true,
      normalize_for_speech: true,
      // See VOICEMAIL_ACTION above: the field's presence is the switch, and
      // hanging up is what it does. syncTemplate re-attaches any
      // detection_prompt the live agent carries — a PATCH that omits that key
      // DROPS it, which is Nudge's scar and not a thing to rediscover.
      voicemail_option: { action: { type: VOICEMAIL_ACTION } },
      // See MAX_CALL_DURATION_MS. An agent-doc field like voicemail_option,
      // so new agents are born with it and syncTemplate's PATCH carries it to
      // existing ones.
      max_call_duration_ms: MAX_CALL_DURATION_MS,
      post_call_analysis_data: [summaryAnalysisField(args.language)],
    },
  };
}
