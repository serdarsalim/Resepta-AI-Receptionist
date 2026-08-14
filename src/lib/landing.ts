// Public landing-page copy. This lives outside i18n.ts because it is long-form
// marketing language, not interface vocabulary.
//
// Each language is written for its reader rather than translated line by line.
// The product remains vertical-agnostic in all three.
import type { Language } from "./i18n";

export type LandingFeature = {
  title: string;
  body: string;
  channel: "call" | "calendar" | "message" | "customer";
};

export type LandingUseCase = {
  id: "beauty" | "health" | "service";
  tab: string;
  title: string;
  body: string;
  outcome: string;
  image: string;
  imageAlt: string;
};

type LandingStep = {
  number: string;
  title: string;
  body: string;
};

export type LandingCopy = {
  nav: { product: string; workflow: string; useCases: string; setup: string };
  navCta: string;
  headlineLead: string;
  headlineAccent: string;
  subhead: string;
  ctaPrimary: string;
  ctaDemo: string;
  ctaNote: string;
  proof: string[];
  themeToLight: string;
  themeToDark: string;
  hero: {
    workspace: string;
    live: string;
    incoming: string;
    answered: string;
    caller: string;
    request: string;
    callNote: string;
    booked: string;
    appointment: string;
    service: string;
    confirmation: string;
    confirmed: string;
    customer: string;
    customerDetail: string;
    calendar: string;
    calendarEntries: Array<{ time: string; name: string }>;
  };
  workflowTitle: string;
  workflowBody: string;
  workflow: LandingStep[];
  productTitle: string;
  productBody: string;
  productPoints: string[];
  productPreview: {
    title: string;
    day: string;
    calls: string;
    customers: string;
    appointments: Array<{ time: string; name: string; service: string; status: string }>;
    callTitle: string;
    callSummary: string;
    customerTitle: string;
    customerDetail: string;
    reminderTitle: string;
    reminderDetail: string;
  };
  useCasesTitle: string;
  useCasesBody: string;
  useCases: LandingUseCase[];
  featuresTitle: string;
  featuresBody: string;
  features: LandingFeature[];
  setupTitle: string;
  setupBody: string;
  setup: LandingStep[];
  closingTitle: string;
  closingBody: string;
  footerLine: string;
  footerProduct: string;
  footerResources: string;
  footerCompany: string;
  footerAutotaktLine: string;
  help: string;
  privacy: string;
  terms: string;
};

export const LANDING: Record<Language, LandingCopy> = {
  tr: {
    nav: {
      product: "Ürün",
      workflow: "Nasıl çalışır",
      useCases: "Kimler için",
      setup: "Başlangıç",
    },
    navCta: "Google ile başlayın",
    headlineLead: "Arama randevuya dönüşür. ",
    headlineAccent: "Takip daha siz işinize dönmeden başlar.",
    subhead:
      "Resepta, randevulu işletmeler için aramaları, müşterileri, takvimi, onayları ve hatırlatmaları tek bir bağlantılı ön büroda toplar.",
    ctaPrimary: "Google ile başlayın",
    ctaDemo: "Canlı demoyu deneyin",
    ctaNote: "Şifre yok. Başlamak için tek soru: işletmenizin adı.",
    proof: ["Arama kaydı", "Randevu ve müşteri kartı", "Onay ve hatırlatmalar"],
    themeToLight: "Açık temaya geç",
    themeToDark: "Koyu temaya geç",
    hero: {
      workspace: "Resepta ön büro",
      live: "Canlı akış",
      incoming: "Gelen arama",
      answered: "Resepta yanıtlıyor",
      caller: "Derya Akın",
      request: "Perşembe öğleden sonra ilk randevu",
      callNote: "Hizmet, saat tercihi ve iletişim bilgisi alındı.",
      booked: "Randevu oluşturuldu",
      appointment: "Perşembe · 14:30",
      service: "İlk görüşme · 45 dk",
      confirmation: "Onay gönderildi",
      confirmed: "Derya onayladı",
      customer: "Müşteri kartı güncellendi",
      customerDetail: "Tercih edilen zaman · Öğleden sonra",
      calendar: "Bugünün takvimi",
      calendarEntries: [
        { time: "09:30", name: "Elif" },
        { time: "11:00", name: "Mert" },
        { time: "14:30", name: "Derya" },
      ],
    },
    workflowTitle: "Tek görüşme. Başından sonuna tek kayıt.",
    workflowBody:
      "Resepta yalnızca telefonu açmaz. Görüşmede alınan bilgiyi ekibinizin çalıştığı randevuya, müşteri kartına ve takip akışına taşır.",
    workflow: [
      {
        number: "01",
        title: "Arama karşılanır",
        body: "Sesli asistan işletmenizin dilinde konuşur, talebi anlar ve ihtiyacınız olan müşteri bilgilerini toplar.",
      },
      {
        number: "02",
        title: "Randevu kayda geçer",
        body: "Hizmet, tercih edilen zaman ve görüşme notu aynı randevuya eklenir. Ekibiniz ne olduğunu hemen görür.",
      },
      {
        number: "03",
        title: "Takip bağlı kalır",
        body: "Onay, hatırlatma, iptal ve müşteri cevabı aynı kayda döner. Sonraki adım ortada kalmaz.",
      },
    ],
    productTitle: "Ön büronuzun tamamı aynı bağlamı görür",
    productBody:
      "Takvim ayrı, telefon notları ayrı, mesajlar başka yerde olduğunda işi birleştirmek yine size kalır. Resepta her kanalı aynı müşteri ve randevu etrafında toplar.",
    productPoints: [
      "Görüşmeden randevuya uzanan görünür bir akış",
      "Ekip için güncel müşteri bilgileri ve arama geçmişi",
      "Randevuya bağlı onay, iptal ve hatırlatmalar",
    ],
    productPreview: {
      title: "Bugünün akışı",
      day: "31 Temmuz, Perşembe",
      calls: "4 arama",
      customers: "3 yeni müşteri",
      appointments: [
        { time: "09:30", name: "Elif Demir", service: "İlk görüşme", status: "Onaylandı" },
        { time: "11:00", name: "Mert Kaya", service: "Kontrol", status: "Hatırlatma gitti" },
        { time: "14:30", name: "Derya Akın", service: "Randevu", status: "Yeni" },
      ],
      callTitle: "Arama kaydı hazır",
      callSummary: "Derya perşembe öğleden sonra için randevu istedi.",
      customerTitle: "Müşteri kartı güncel",
      customerDetail: "Saat tercihi ve iletişim bilgisi kaydedildi.",
      reminderTitle: "Takip sırada",
      reminderDetail: "Onay gönderildi. Hatırlatma zamanı planlandı.",
    },
    useCasesTitle: "Telefon için işini bırakamayan ekipler için",
    useCasesBody:
      "Resepta tek bir sektöre göre şekillenmez. Hizmetlerinizi, çalışma düzeninizi ve müşteriden toplanacak bilgileri işletmenize göre belirlersiniz.",
    useCases: [
      {
        id: "beauty",
        tab: "Bakım ve güzellik",
        title: "Eller müşterideyken telefon boş kalmaz",
        body: "Kuaför, berber ve güzellik ekipleri müşterinin başındayken arama karşılanır, talep kaydedilir ve doğru hizmetle randevuya dönüşür.",
        outcome: "Daha az kaçan çağrı, daha düzenli bir gün.",
        image: "/images/randevu-salon.webp",
        imageAlt: "Müşterisinin saçını keserken çalışan bağımsız kuaför",
      },
      {
        id: "health",
        tab: "Klinikler",
        title: "Hasta aradığında kabul süreci başlar",
        body: "Muayenehane ve klinikler randevu talebini, temel bilgileri ve zaman tercihini tek görüşmede alırken ekip tedaviye odaklanır.",
        outcome: "Daha sakin bir ön büro, daha net bir takvim.",
        image: "/images/randevu-clinic.webp",
        imageAlt: "Hastasıyla ilgilenen bağımsız diş hekimi",
      },
      {
        id: "service",
        tab: "Yerel hizmetler",
        title: "Bu işi yaparken sıradaki işi alın",
        body: "Servisler ve randevuyla çalışan yerel işletmeler, ekip iş başındayken müşterinin talebini ve tercih ettiği zamanı kaydeder.",
        outcome: "Kesintisiz çalışma, kaybolmayan talepler.",
        image: "/images/randevu-workshop.webp",
        imageAlt: "Atölyesinde bir aracın motorunda çalışan usta",
      },
    ],
    featuresTitle: "Otomasyon çalışır, kontrol sizde kalır",
    featuresBody:
      "Resepta işletmenizin nasıl konuşacağını ve neyi kaydedeceğini sizin belirlediğiniz bir çalışma alanıdır.",
    features: [
      {
        channel: "call",
        title: "İşletmenize göre konuşan sesli asistan",
        body: "Açılış cümlesini, talimatları, sesi ve görüşmede toplanacak bilgileri siz belirlersiniz.",
      },
      {
        channel: "calendar",
        title: "Ekibin gerçekten çalıştığı takvim",
        body: "Telefonla alınan, elle eklenen ve daha sonra değişen randevular tek yerde görünür.",
      },
      {
        channel: "message",
        title: "Randevuya bağlı müşteri takibi",
        body: "Onay, hatırlatma, iptal ve gelmeyen müşteriye dönüş ayrı listelerde kaybolmaz.",
      },
      {
        channel: "customer",
        title: "Her temasla güçlenen müşteri kaydı",
        body: "Görüşmede alınan bilgiler sonraki aramada ve ekibin ekranında hazır olur.",
      },
    ],
    setupTitle: "Google hesabından gerçek bir çalışma alanına",
    setupBody:
      "Hesap açma kısmı kısa tutulur. İşletmenin akışını ise kendi hızınızda kurarsınız.",
    setup: [
      { number: "01", title: "Google ile girin", body: "Şifre oluşturmayın, sıfırlama akışıyla uğraşmayın." },
      { number: "02", title: "İşletmenizi adlandırın", body: "İlk girişte sorduğumuz tek soru işletmenizin adıdır." },
      { number: "03", title: "Akışı kurun", body: "Hizmetleri, ekibi, sesli asistanı ve ihtiyacınız olan kanalları ekleyin." },
    ],
    closingTitle: "Bir sonraki aramaya net bir sonraki adım verin.",
    closingBody:
      "Çalışma alanınızı şimdi oluşturun. Hizmetleri, ekibi ve bağlı kanalları hazır olduğunuzda kurun.",
    footerLine: "Randevulu işletmeler için bağlantılı arama, müşteri ve takip otomasyonu.",
    footerProduct: "Ürün",
    footerResources: "Kaynaklar",
    footerCompany: "Şirket",
    footerAutotaktLine: "Yapay zekâ asistanları, bağlı iş akışları ve pratik işletme yazılımları.",
    help: "Yardım merkezi",
    privacy: "Gizlilik politikası",
    terms: "Kullanım koşulları",
  },

  en: {
    nav: {
      product: "Product",
      workflow: "How it works",
      useCases: "Who it is for",
      setup: "Getting started",
    },
    navCta: "Start with Google",
    headlineLead: "The call becomes a booking. ",
    headlineAccent: "The follow-up is already moving.",
    subhead:
      "Resepta gives appointment businesses one connected front desk for calls, customers, calendar, confirmations, and reminders.",
    ctaPrimary: "Start with Google",
    ctaDemo: "Try the live demo",
    ctaNote: "No password. One business-name question to get started.",
    proof: ["Call history", "Booking and customer record", "Confirmations and reminders"],
    themeToLight: "Switch to light mode",
    themeToDark: "Switch to dark mode",
    hero: {
      workspace: "Resepta front desk",
      live: "Live workflow",
      incoming: "Incoming call",
      answered: "Resepta is answering",
      caller: "Olivia Reed",
      request: "First visit on Thursday afternoon",
      callNote: "Service, preferred time, and contact details collected.",
      booked: "Appointment created",
      appointment: "Thursday · 14:30",
      service: "First visit · 45 min",
      confirmation: "Confirmation delivered",
      confirmed: "Olivia confirmed",
      customer: "Customer record updated",
      customerDetail: "Preferred time · Afternoon",
      calendar: "Today's calendar",
      calendarEntries: [
        { time: "09:30", name: "Emily" },
        { time: "11:00", name: "James" },
        { time: "14:30", name: "Olivia" },
      ],
    },
    workflowTitle: "One conversation. One connected record.",
    workflowBody:
      "Resepta does more than answer the phone. It carries what was learned into the appointment, customer record, and follow-up your team actually works from.",
    workflow: [
      {
        number: "01",
        title: "The call is answered",
        body: "A voice agent speaks in the way your business works, understands the request, and collects the details you need.",
      },
      {
        number: "02",
        title: "The appointment is recorded",
        body: "The service, preferred time, and call context land on the same appointment. Your team can see what happened.",
      },
      {
        number: "03",
        title: "The follow-up stays attached",
        body: "Confirmations, reminders, cancellations, and replies return to the same record. The next step does not go missing.",
      },
    ],
    productTitle: "Your whole front desk sees the same context",
    productBody:
      "When the calendar, call notes, and messages live in separate tools, your team still has to join the dots. Resepta keeps every channel around the same customer and appointment.",
    productPoints: [
      "A visible path from conversation to appointment",
      "Current customer details and call history for the team",
      "Confirmations, cancellations, and reminders tied to the booking",
    ],
    productPreview: {
      title: "Today's flow",
      day: "Thursday, 31 July",
      calls: "4 calls",
      customers: "3 new customers",
      appointments: [
        { time: "09:30", name: "Emily Carter", service: "First visit", status: "Confirmed" },
        { time: "11:00", name: "James Wilson", service: "Follow-up", status: "Reminder sent" },
        { time: "14:30", name: "Olivia Reed", service: "Appointment", status: "New" },
      ],
      callTitle: "Call record ready",
      callSummary: "Olivia asked for an appointment on Thursday afternoon.",
      customerTitle: "Customer record current",
      customerDetail: "Preferred time and contact details were saved.",
      reminderTitle: "Follow-up queued",
      reminderDetail: "Confirmation delivered. Reminder time is scheduled.",
    },
    useCasesTitle: "For teams that cannot pause the work to answer the phone",
    useCasesBody:
      "Resepta is not shaped around one industry. You define the services, working pattern, and customer details that matter to your business.",
    useCases: [
      {
        id: "beauty",
        tab: "Beauty and care",
        title: "Keep both hands on the client",
        body: "Salons, barbers, and beauty teams can have the call answered, the request recorded, and the right service turned into a booking while the team stays with the client.",
        outcome: "Fewer missed calls. A more orderly working day.",
        image: "/images/randevu-salon.webp",
        imageAlt: "Independent stylist cutting a client's hair",
      },
      {
        id: "health",
        tab: "Clinics",
        title: "Start the intake when the patient calls",
        body: "Practices and clinics collect the request, essential details, and preferred time in one conversation while the team stays focused on care.",
        outcome: "A calmer front desk and a clearer schedule.",
        image: "/images/randevu-clinic.webp",
        imageAlt: "Independent dentist caring for a patient",
      },
      {
        id: "service",
        tab: "Local services",
        title: "Take the next job while doing this one",
        body: "Workshops and appointment-led local services capture the request and preferred time while the team stays on the tools.",
        outcome: "Uninterrupted work. No lost requests.",
        image: "/images/randevu-workshop.webp",
        imageAlt: "Mechanic working on a car in an independent workshop",
      },
    ],
    featuresTitle: "Automation runs. You keep control.",
    featuresBody:
      "Resepta is a workspace where you decide how the business speaks and what each conversation should capture.",
    features: [
      {
        channel: "call",
        title: "A voice agent shaped around your business",
        body: "Set the opening line, instructions, voice, and customer details that should be collected during a call.",
      },
      {
        channel: "calendar",
        title: "The calendar your team actually works from",
        body: "Bookings made by phone, added manually, or changed later remain visible in one place.",
      },
      {
        channel: "message",
        title: "Customer follow-up tied to the booking",
        body: "Confirmations, reminders, cancellations, and no-show follow-up do not disappear into separate lists.",
      },
      {
        channel: "customer",
        title: "A customer record that improves with every contact",
        body: "Details collected during a call are ready for the next conversation and for the team.",
      },
    ],
    setupTitle: "From Google sign-in to a real workspace",
    setupBody:
      "Account creation stays short. You can shape the business workflow at your own pace.",
    setup: [
      { number: "01", title: "Continue with Google", body: "There is no password to create, remember, or reset." },
      { number: "02", title: "Name your business", body: "The only question on first sign-in is the name of your business." },
      { number: "03", title: "Build the workflow", body: "Add services, team members, the voice agent, and the channels your setup needs." },
    ],
    closingTitle: "Give the next caller a clear next step.",
    closingBody:
      "Create the workspace now. Set up services, your team, and connected channels when you are ready.",
    footerLine: "Connected calls, customers, and follow-up for appointment businesses.",
    footerProduct: "Product",
    footerResources: "Resources",
    footerCompany: "Company",
    footerAutotaktLine: "AI assistants, connected workflows, and practical business software.",
    help: "Help center",
    privacy: "Privacy policy",
    terms: "Terms of service",
  },

  de: {
    nav: {
      product: "Produkt",
      workflow: "So funktioniert es",
      useCases: "Für wen",
      setup: "Einstieg",
    },
    navCta: "Mit Google starten",
    headlineLead: "Aus dem Anruf wird ein Termin. ",
    headlineAccent: "Die Nachbereitung läuft schon.",
    subhead:
      "Resepta verbindet Anrufe, Kunden, Kalender, Bestätigungen und Erinnerungen zu einem durchgängigen Empfang für Terminbetriebe.",
    ctaPrimary: "Mit Google starten",
    ctaDemo: "Live-Demo ausprobieren",
    ctaNote: "Kein Passwort. Zum Start nur eine Frage: Wie heißt Ihr Betrieb?",
    proof: ["Anrufverlauf", "Termin und Kundenprofil", "Bestätigungen und Erinnerungen"],
    themeToLight: "Zum hellen Modus wechseln",
    themeToDark: "Zum dunklen Modus wechseln",
    hero: {
      workspace: "Resepta Empfang",
      live: "Laufender Vorgang",
      incoming: "Eingehender Anruf",
      answered: "Resepta nimmt an",
      caller: "Sophie Hartmann",
      request: "Ersttermin am Donnerstagnachmittag",
      callNote: "Leistung, Wunschzeit und Kontaktdaten wurden erfasst.",
      booked: "Termin angelegt",
      appointment: "Donnerstag · 14:30",
      service: "Ersttermin · 45 Min.",
      confirmation: "Bestätigung zugestellt",
      confirmed: "Sophie hat bestätigt",
      customer: "Kundenprofil aktualisiert",
      customerDetail: "Bevorzugte Zeit · Nachmittag",
      calendar: "Heutiger Kalender",
      calendarEntries: [
        { time: "09:30", name: "Anna" },
        { time: "11:00", name: "Lukas" },
        { time: "14:30", name: "Sophie" },
      ],
    },
    workflowTitle: "Ein Gespräch. Ein durchgängiger Vorgang.",
    workflowBody:
      "Resepta nimmt nicht nur den Anruf an. Die erfassten Angaben landen im Termin, im Kundenprofil und in der Nachbereitung, mit der Ihr Team tatsächlich arbeitet.",
    workflow: [
      {
        number: "01",
        title: "Der Anruf wird angenommen",
        body: "Ein Sprachassistent spricht passend zu Ihrem Betrieb, versteht das Anliegen und erfasst die benötigten Angaben.",
      },
      {
        number: "02",
        title: "Der Termin wird erfasst",
        body: "Leistung, Wunschzeit und Gesprächskontext stehen am selben Termin. Ihr Team sieht sofort, was passiert ist.",
      },
      {
        number: "03",
        title: "Die Nachbereitung bleibt verbunden",
        body: "Bestätigungen, Erinnerungen, Absagen und Antworten kehren zum selben Vorgang zurück. Kein nächster Schritt geht verloren.",
      },
    ],
    productTitle: "Ihr gesamter Empfang sieht denselben Zusammenhang",
    productBody:
      "Wenn Kalender, Anrufnotizen und Nachrichten in getrennten Werkzeugen liegen, muss Ihr Team sie weiter selbst verbinden. Resepta bündelt jeden Kanal rund um denselben Kunden und Termin.",
    productPoints: [
      "Ein sichtbarer Weg vom Gespräch zum Termin",
      "Aktuelle Kundendaten und Anrufverlauf für das Team",
      "Bestätigungen, Absagen und Erinnerungen direkt am Termin",
    ],
    productPreview: {
      title: "Heutiger Ablauf",
      day: "Donnerstag, 31. Juli",
      calls: "4 Anrufe",
      customers: "3 neue Kunden",
      appointments: [
        { time: "09:30", name: "Anna Keller", service: "Ersttermin", status: "Bestätigt" },
        { time: "11:00", name: "Lukas Weber", service: "Kontrolle", status: "Erinnert" },
        { time: "14:30", name: "Sophie Hartmann", service: "Termin", status: "Neu" },
      ],
      callTitle: "Anrufnotiz ist bereit",
      callSummary: "Sophie fragte nach einem Termin am Donnerstagnachmittag.",
      customerTitle: "Kundenprofil ist aktuell",
      customerDetail: "Wunschzeit und Kontaktdaten wurden gespeichert.",
      reminderTitle: "Nachbereitung eingeplant",
      reminderDetail: "Bestätigung zugestellt. Erinnerungszeit steht fest.",
    },
    useCasesTitle: "Für Teams, die ihre Arbeit nicht fürs Telefon unterbrechen können",
    useCasesBody:
      "Resepta ist nicht auf eine Branche festgelegt. Sie bestimmen Leistungen, Arbeitsweise und die Kundenangaben, die für Ihren Betrieb wichtig sind.",
    useCases: [
      {
        id: "beauty",
        tab: "Pflege und Schönheit",
        title: "Bleiben Sie mit beiden Händen beim Kunden",
        body: "In Salons, Barbershops und Kosmetikstudios wird der Anruf angenommen, das Anliegen erfasst und die passende Leistung zum Termin, während das Team beim Kunden bleibt.",
        outcome: "Weniger verpasste Anrufe. Ein ruhigerer Arbeitstag.",
        image: "/images/randevu-salon.webp",
        imageAlt: "Selbstständige Friseurin schneidet einer Kundin die Haare",
      },
      {
        id: "health",
        tab: "Praxen",
        title: "Die Aufnahme beginnt bereits beim Anruf",
        body: "Praxen und Kliniken erfassen Anliegen, notwendige Angaben und Wunschzeit in einem Gespräch, während das Team bei der Behandlung bleibt.",
        outcome: "Ein ruhigerer Empfang und ein klarerer Terminplan.",
        image: "/images/randevu-clinic.webp",
        imageAlt: "Selbstständiger Zahnarzt behandelt eine Patientin",
      },
      {
        id: "service",
        tab: "Lokale Betriebe",
        title: "Den nächsten Auftrag während der Arbeit annehmen",
        body: "Werkstätten und andere Terminbetriebe erfassen Anliegen und Wunschzeit, während das Team bei der eigentlichen Arbeit bleibt.",
        outcome: "Weniger Unterbrechungen. Keine verlorenen Anfragen.",
        image: "/images/randevu-workshop.webp",
        imageAlt: "Mechaniker arbeitet in einer freien Werkstatt an einem Auto",
      },
    ],
    featuresTitle: "Die Automatisierung läuft. Sie behalten die Kontrolle.",
    featuresBody:
      "In Resepta legen Sie fest, wie Ihr Betrieb spricht und welche Angaben jedes Gespräch erfassen soll.",
    features: [
      {
        channel: "call",
        title: "Ein Sprachassistent nach Ihren Vorgaben",
        body: "Begrüßung, Anweisungen, Stimme und die zu erfassenden Kundenangaben bestimmen Sie selbst.",
      },
      {
        channel: "calendar",
        title: "Der Kalender, mit dem Ihr Team wirklich arbeitet",
        body: "Telefonisch vereinbarte, manuell angelegte und später geänderte Termine bleiben an einem Ort sichtbar.",
      },
      {
        channel: "message",
        title: "Nachbereitung direkt am Termin",
        body: "Bestätigungen, Erinnerungen, Absagen und Rückgewinnung verschwinden nicht in getrennten Listen.",
      },
      {
        channel: "customer",
        title: "Ein Kundenprofil, das mit jedem Kontakt besser wird",
        body: "Angaben aus dem Gespräch stehen beim nächsten Kontakt und für das Team bereit.",
      },
    ],
    setupTitle: "Von der Google-Anmeldung zum echten Arbeitsbereich",
    setupBody:
      "Die Kontoerstellung bleibt kurz. Den Ablauf Ihres Betriebs richten Sie in Ihrem eigenen Tempo ein.",
    setup: [
      { number: "01", title: "Mit Google anmelden", body: "Sie müssen kein Passwort erstellen, merken oder zurücksetzen." },
      { number: "02", title: "Betrieb benennen", body: "Die einzige Frage beim ersten Einstieg ist der Name Ihres Betriebs." },
      { number: "03", title: "Ablauf einrichten", body: "Fügen Sie Leistungen, Team, Sprachassistent und die benötigten Kanäle hinzu." },
    ],
    closingTitle: "Geben Sie dem nächsten Anrufer einen klaren nächsten Schritt.",
    closingBody:
      "Erstellen Sie jetzt den Arbeitsbereich. Leistungen, Team und verbundene Kanäle richten Sie ein, wenn Sie bereit sind.",
    footerLine: "Verbundene Anrufe, Kunden und Nachbereitung für Terminbetriebe.",
    footerProduct: "Produkt",
    footerResources: "Ressourcen",
    footerCompany: "Unternehmen",
    footerAutotaktLine: "KI-Assistenten, vernetzte Arbeitsabläufe und praktische Unternehmenssoftware.",
    help: "Hilfe-Center",
    privacy: "Datenschutzerklärung",
    terms: "Nutzungsbedingungen",
  },
};
