// Public landing-page copy. This lives outside i18n.ts because it is long-form
// marketing language, not interface vocabulary.
//
// Each language is written for its reader rather than translated line by line:
// Turkish is warm and direct for owner-operated businesses; German is concrete,
// formal and reliability-led; English leads with time saved and one joined-up
// workflow. The product remains vertical-agnostic in all three.
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

export type LandingCopy = {
  nav: { product: string; workflow: string; useCases: string; features: string };
  navCta: string;
  eyebrow: string;
  headlineLead: string;
  headlineAccent: string;
  subhead: string;
  ctaPrimary: string;
  ctaDemo: string;
  ctaNote: string;
  assurances: string[];
  hero: {
    incoming: string;
    answered: string;
    caller: string;
    request: string;
    booked: string;
    appointment: string;
    confirmation: string;
    confirmed: string;
    today: string;
    calendar: string;
    calendarEntries: Array<{ time: string; name: string }>;
  };
  workflowEyebrow: string;
  workflowTitle: string;
  workflowBody: string;
  workflow: Array<{ number: string; title: string; body: string }>;
  productEyebrow: string;
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
  };
  useCasesEyebrow: string;
  useCasesTitle: string;
  useCasesBody: string;
  useCases: LandingUseCase[];
  featuresEyebrow: string;
  featuresTitle: string;
  features: LandingFeature[];
  closingTitle: string;
  closingBody: string;
  footerLine: string;
  help: string;
  privacy: string;
  terms: string;
};

export const LANDING: Record<Language, LandingCopy> = {
  tr: {
    nav: {
      product: "Ürün",
      workflow: "Nasıl çalışır",
      useCases: "Kullanım alanları",
      features: "Özellikler",
    },
    navCta: "Başlayın",
    eyebrow: "Telefon · Takvim · Mesajlar",
    headlineLead: "Siz işinize bakın. ",
    headlineAccent: "Mahlas gerisini halleder.",
    subhead:
      "Arayan müşteriyi karşılar, uygun saati bulur, randevuyu takvime işler ve takibini yapar. Her şey tek yerde, siz müşterinizin yanındayken.",
    ctaPrimary: "Google ile başlayın",
    ctaDemo: "Ürünü inceleyin",
    ctaNote: "Google hesabınız yeterli. Kredi kartı gerekmez.",
    assurances: ["Gelen aramalar yanıtlanır", "Randevular tek takvimde", "Takip otomatik ilerler"],
    hero: {
      incoming: "Gelen arama",
      answered: "Yanıtlandı",
      caller: "Derya Akın",
      request: "Perşembe öğleden sonra için randevu istiyor",
      booked: "Randevu oluşturuldu",
      appointment: "Perşembe · 14:30",
      confirmation: "Onay gönderildi",
      confirmed: "Müşteri onayladı",
      today: "Bugün",
      calendar: "Takvim",
      calendarEntries: [
        { time: "09:30", name: "Elif" },
        { time: "11:00", name: "Mert" },
        { time: "14:30", name: "Derya" },
      ],
    },
    workflowEyebrow: "Tek bir akış",
    workflowTitle: "Telefon çalar. Takvim dolar. Müşteri haberdar olur.",
    workflowBody:
      "Arada kopyalama, not bırakma ya da başka bir ekrana geçme yok. Bir adım bittiğinde Mahlas sıradakini başlatır.",
    workflow: [
      {
        number: "01",
        title: "Aramayı karşılar",
        body: "Müşterinin ne istediğini anlar, gerekli bilgileri alır ve işletmeniz gibi konuşur.",
      },
      {
        number: "02",
        title: "Uygun saati bulur",
        body: "Hizmeti ve müsaitliği kontrol eder, seçilen saati doğrudan takvime işler.",
      },
      {
        number: "03",
        title: "Takibi kendi yapar",
        body: "Onay ve hatırlatma gider; cevaplar randevuya ve müşteri kartına geri yazılır.",
      },
    ],
    productEyebrow: "İşletmenin ortak hafızası",
    productTitle: "Günün tamamı tek ekranda",
    productBody:
      "Aramalar, müşteriler, randevular ve mesajlar aynı kaydı paylaşır. Kim aradı, ne istedi ve sırada ne var diye aramanız gerekmez.",
    productPoints: [
      "Telefon görüşmesinden doğrudan randevu",
      "Müşteri bilgileri otomatik güncel kalır",
      "Onay, iptal ve hatırlatmalar aynı akışta",
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
      callTitle: "Yeni arama kaydı",
      callSummary: "Derya, perşembe öğleden sonra için randevu aldı.",
      customerTitle: "Müşteri kartı güncellendi",
      customerDetail: "Tercih edilen saat · Öğleden sonra",
    },
    useCasesEyebrow: "Her randevulu iş için",
    useCasesTitle: "Aynı ürün, işletmenize göre çalışan bir akış",
    useCasesBody:
      "Mahlas bir sektöre göre şekillenmez. Hizmetlerinizi, çalışma düzeninizi ve müşteriden toplamak istediğiniz bilgileri siz belirlersiniz.",
    useCases: [
      {
        id: "beauty",
        tab: "Bakım ve güzellik",
        title: "Eller doluyken telefon boş kalmaz",
        body: "Kuaför, berber ve güzellik merkezlerinde ekip müşterinin başındayken gelen arama karşılanır, doğru hizmet ve süreyle takvime düşer.",
        outcome: "Daha az kaçan çağrı, daha dolu bir gün.",
        image: "/images/randevu-salon.webp",
        imageAlt: "Müşterisinin saçını keserken çalışan bağımsız kuaför",
      },
      {
        id: "health",
        tab: "Klinikler",
        title: "Hasta aradığında süreç başlar",
        body: "Muayenehane ve klinikler randevu talebini, temel bilgileri ve tercih edilen saati tek görüşmede alır; ekip tedaviye odaklanır.",
        outcome: "Daha düzenli kabul, daha az telefon trafiği.",
        image: "/images/randevu-clinic.webp",
        imageAlt: "Hastasıyla ilgilenen bağımsız diş hekimi",
      },
      {
        id: "service",
        tab: "Yerel hizmetler",
        title: "İş başındayken yeni iş alın",
        body: "Servisler ve randevuyla çalışan yerel işletmeler, müşterinin talebini ve uygun zamanı siz aletlerin başındayken kaydeder.",
        outcome: "Kesintisiz çalışma, kaybolmayan talepler.",
        image: "/images/randevu-workshop.webp",
        imageAlt: "Atölyesinde bir aracın motorunda çalışan usta",
      },
    ],
    featuresEyebrow: "Arka planda çalışan ayrıntılar",
    featuresTitle: "Randevu almanın ötesinde",
    features: [
      {
        channel: "call",
        title: "Size göre konuşan sesli asistan",
        body: "Hizmetlerinizi, çalışma biçiminizi ve sorulacak bilgileri Mahlas'ta belirlersiniz.",
      },
      {
        channel: "calendar",
        title: "Tek ve güncel takvim",
        body: "Telefonla alınan, elle eklenen ve değiştirilen randevular aynı yerde kalır.",
      },
      {
        channel: "message",
        title: "Otomatik müşteri takibi",
        body: "Onay, hatırlatma, iptal ve gelmeyen müşteriye dönüş ayrı ayrı takip edilmez.",
      },
      {
        channel: "customer",
        title: "Her görüşmede zenginleşen müşteri kartı",
        body: "Müşterinin verdiği bilgiler sonraki görüşmede hazır olur; aynı sorular tekrar sorulmaz.",
      },
    ],
    closingTitle: "Bir sonraki arama takvimde yerini bulsun.",
    closingBody:
      "Mahlas'a Google hesabınızla girin. İşletmenizi oluşturun, akışı birlikte çalıştıralım.",
    footerLine: "Randevulu çalışan işletmeler için telefon ve müşteri otomasyonu.",
    help: "Yardım merkezi",
    privacy: "Gizlilik politikası",
    terms: "Kullanım koşulları",
  },

  en: {
    nav: {
      product: "Product",
      workflow: "How it works",
      useCases: "Use cases",
      features: "Features",
    },
    navCta: "Get started",
    eyebrow: "Calls · Calendar · Customer follow-up",
    headlineLead: "Stay with the work. ",
    headlineAccent: "Mahlas handles the appointment.",
    subhead:
      "It answers the call, finds a time, books it, and keeps the customer informed. One connected workflow for any business built around appointments.",
    ctaPrimary: "Start with Google",
    ctaDemo: "Explore the product",
    ctaNote: "Your Google account is enough. No card required.",
    assurances: ["Calls are answered", "Bookings stay in one calendar", "Follow-up runs automatically"],
    hero: {
      incoming: "Incoming call",
      answered: "Answered",
      caller: "Olivia Reed",
      request: "Looking for an appointment on Thursday afternoon",
      booked: "Appointment booked",
      appointment: "Thursday · 14:30",
      confirmation: "Confirmation sent",
      confirmed: "Customer confirmed",
      today: "Today",
      calendar: "Calendar",
      calendarEntries: [
        { time: "09:30", name: "Emily" },
        { time: "11:00", name: "James" },
        { time: "14:30", name: "Olivia" },
      ],
    },
    workflowEyebrow: "One joined-up workflow",
    workflowTitle: "The phone rings. The calendar fills. The customer stays informed.",
    workflowBody:
      "No copying details, leaving notes, or switching systems. When one step finishes, Mahlas starts the next.",
    workflow: [
      {
        number: "01",
        title: "Answer the call",
        body: "Understand what the customer needs, collect the right details, and speak in the way your business works.",
      },
      {
        number: "02",
        title: "Find the right time",
        body: "Check the service and availability, then place the chosen time directly on the calendar.",
      },
      {
        number: "03",
        title: "Run the follow-up",
        body: "Send confirmations and reminders, then write responses back to the booking and customer record.",
      },
    ],
    productEyebrow: "A shared memory for the business",
    productTitle: "The whole day, in one view",
    productBody:
      "Calls, customers, appointments, and messages share the same record. Nobody has to work out who called, what they wanted, or what should happen next.",
    productPoints: [
      "Turn a phone conversation into a booking",
      "Keep customer details current automatically",
      "Handle confirmations, cancellations, and reminders together",
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
      callTitle: "New call record",
      callSummary: "Olivia booked an appointment for Thursday afternoon.",
      customerTitle: "Customer record updated",
      customerDetail: "Preferred time · Afternoon",
    },
    useCasesEyebrow: "For any appointment business",
    useCasesTitle: "One product, shaped around the way you work",
    useCasesBody:
      "Mahlas is not built around one industry. You define the services, working pattern, and customer information that matter to your business.",
    useCases: [
      {
        id: "beauty",
        tab: "Beauty & care",
        title: "Keep both hands on the client",
        body: "Salons, barbers, and beauty teams can take the call, match the right service and duration, and book the visit while the team stays with the customer.",
        outcome: "Fewer missed calls. A fuller working day.",
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
        body: "Workshops and appointment-led local services capture the request and a suitable time while the team stays on the tools.",
        outcome: "Uninterrupted work. No lost enquiries.",
        image: "/images/randevu-workshop.webp",
        imageAlt: "Mechanic working on a car in an independent workshop",
      },
    ],
    featuresEyebrow: "The details working underneath",
    featuresTitle: "More than taking a booking",
    features: [
      {
        channel: "call",
        title: "A voice agent shaped around your business",
        body: "Define your services, instructions, and the customer information that should be collected inside Mahlas.",
      },
      {
        channel: "calendar",
        title: "One calendar that stays current",
        body: "Bookings made by phone, added manually, or changed later all live in the same place.",
      },
      {
        channel: "message",
        title: "Customer follow-up on autopilot",
        body: "Confirmations, reminders, cancellations, and no-show follow-up move as one workflow.",
      },
      {
        channel: "customer",
        title: "A customer record that gets smarter",
        body: "Information shared in a call is ready next time, so the customer does not have to repeat themselves.",
      },
    ],
    closingTitle: "Let the next call find its place on the calendar.",
    closingBody:
      "Sign in with Google, create your business, and put the first connected appointment workflow to work.",
    footerLine: "Calls and customer automation for appointment-led businesses.",
    help: "Help center",
    privacy: "Privacy policy",
    terms: "Terms of service",
  },

  de: {
    nav: {
      product: "Produkt",
      workflow: "So funktioniert es",
      useCases: "Einsatzbereiche",
      features: "Funktionen",
    },
    navCta: "Loslegen",
    eyebrow: "Telefon · Kalender · Kundenkontakt",
    headlineLead: "Bleiben Sie bei Ihrer Arbeit. ",
    headlineAccent: "Mahlas kümmert sich um den Termin.",
    subhead:
      "Mahlas nimmt den Anruf an, findet einen passenden Zeitpunkt, trägt den Termin ein und informiert den Kunden. Ein verlässlicher Ablauf für jeden Betrieb mit Terminen.",
    ctaPrimary: "Mit Google starten",
    ctaDemo: "Produkt ansehen",
    ctaNote: "Ein Google-Konto genügt. Keine Karte erforderlich.",
    assurances: ["Anrufe werden angenommen", "Termine bleiben in einem Kalender", "Die Nachbetreuung läuft automatisch"],
    hero: {
      incoming: "Eingehender Anruf",
      answered: "Angenommen",
      caller: "Sophie Hartmann",
      request: "Möchte am Donnerstagnachmittag einen Termin",
      booked: "Termin eingetragen",
      appointment: "Donnerstag · 14:30",
      confirmation: "Bestätigung gesendet",
      confirmed: "Kundin hat bestätigt",
      today: "Heute",
      calendar: "Kalender",
      calendarEntries: [
        { time: "09:30", name: "Anna" },
        { time: "11:00", name: "Lukas" },
        { time: "14:30", name: "Sophie" },
      ],
    },
    workflowEyebrow: "Ein durchgängiger Ablauf",
    workflowTitle: "Das Telefon klingelt. Der Kalender füllt sich. Der Kunde bleibt informiert.",
    workflowBody:
      "Keine Zettel, kein Übertragen, kein Wechsel zwischen Programmen. Sobald ein Schritt erledigt ist, beginnt Mahlas mit dem nächsten.",
    workflow: [
      {
        number: "01",
        title: "Anruf annehmen",
        body: "Das Anliegen verstehen, die richtigen Angaben erfassen und so sprechen, wie es zu Ihrem Betrieb passt.",
      },
      {
        number: "02",
        title: "Passenden Zeitpunkt finden",
        body: "Leistung und Verfügbarkeit prüfen und den gewählten Termin direkt in den Kalender eintragen.",
      },
      {
        number: "03",
        title: "Kundenkontakt fortsetzen",
        body: "Bestätigung und Erinnerung senden und Antworten beim Termin sowie im Kundenprofil festhalten.",
      },
    ],
    productEyebrow: "Das gemeinsame Gedächtnis des Betriebs",
    productTitle: "Der ganze Arbeitstag auf einen Blick",
    productBody:
      "Anrufe, Kunden, Termine und Nachrichten gehören zu demselben Vorgang. Ihr Team sieht sofort, wer angerufen hat, worum es ging und was als Nächstes ansteht.",
    productPoints: [
      "Aus einem Telefongespräch wird ein Termin",
      "Kundendaten bleiben automatisch aktuell",
      "Bestätigungen, Absagen und Erinnerungen greifen ineinander",
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
      callTitle: "Neuer Anruf erfasst",
      callSummary: "Sophie hat einen Termin am Donnerstagnachmittag vereinbart.",
      customerTitle: "Kundenprofil aktualisiert",
      customerDetail: "Bevorzugte Zeit · Nachmittag",
    },
    useCasesEyebrow: "Für jeden Betrieb mit Terminen",
    useCasesTitle: "Ein Produkt, das sich nach Ihrem Betrieb richtet",
    useCasesBody:
      "Mahlas ist nicht auf eine Branche festgelegt. Sie bestimmen Leistungen, Arbeitsablauf und die Kundenangaben, die für Ihren Betrieb wichtig sind.",
    useCases: [
      {
        id: "beauty",
        tab: "Pflege & Schönheit",
        title: "Bleiben Sie mit beiden Händen beim Kunden",
        body: "Salons, Barbershops und Kosmetikstudios nehmen Anrufe an, ordnen Leistung und Dauer richtig zu und buchen den Besuch, ohne die Arbeit zu unterbrechen.",
        outcome: "Weniger verpasste Anrufe, ein besser gefüllter Tag.",
        image: "/images/randevu-salon.webp",
        imageAlt: "Selbstständige Friseurin schneidet einer Kundin die Haare",
      },
      {
        id: "health",
        tab: "Praxen",
        title: "Die Aufnahme beginnt bereits beim Anruf",
        body: "Praxen und Kliniken erfassen Anliegen, notwendige Angaben und Wunschzeit in einem Gespräch, während sich das Team auf die Behandlung konzentriert.",
        outcome: "Weniger Telefonlast, ein klarerer Terminplan.",
        image: "/images/randevu-clinic.webp",
        imageAlt: "Selbstständiger Zahnarzt behandelt eine Patientin",
      },
      {
        id: "service",
        tab: "Lokale Betriebe",
        title: "Den nächsten Auftrag während der Arbeit annehmen",
        body: "Werkstätten und andere Betriebe mit Terminvergabe erfassen Anliegen und passenden Zeitpunkt, während das Team bei der eigentlichen Arbeit bleibt.",
        outcome: "Weniger Unterbrechungen, keine verlorenen Anfragen.",
        image: "/images/randevu-workshop.webp",
        imageAlt: "Mechaniker arbeitet in einer freien Werkstatt an einem Auto",
      },
    ],
    featuresEyebrow: "Was im Hintergrund zusammenspielt",
    featuresTitle: "Mehr als nur ein Termin",
    features: [
      {
        channel: "call",
        title: "Ein Sprachassistent nach Ihren Vorgaben",
        body: "Leistungen, Anweisungen und die benötigten Kundenangaben legen Sie direkt in Mahlas fest.",
      },
      {
        channel: "calendar",
        title: "Ein Kalender, der aktuell bleibt",
        body: "Telefonisch vereinbarte, manuell eingetragene und später geänderte Termine stehen an einem Ort.",
      },
      {
        channel: "message",
        title: "Verlässliche Nachbetreuung",
        body: "Bestätigungen, Erinnerungen, Absagen und Rückgewinnung laufen als ein abgestimmter Prozess.",
      },
      {
        channel: "customer",
        title: "Ein Kundenprofil, das dazulernt",
        body: "Angaben aus dem Gespräch sind beim nächsten Kontakt vorhanden und müssen nicht erneut abgefragt werden.",
      },
    ],
    closingTitle: "Der nächste Anruf soll seinen Platz im Kalender finden.",
    closingBody:
      "Melden Sie sich mit Google an, legen Sie Ihren Betrieb an und starten Sie den ersten durchgängigen Terminablauf.",
    footerLine: "Telefon- und Kundenautomatisierung für Betriebe mit Terminvergabe.",
    help: "Hilfe-Center",
    privacy: "Datenschutzerklärung",
    terms: "Nutzungsbedingungen",
  },
};
