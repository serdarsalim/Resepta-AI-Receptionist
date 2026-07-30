// Landing page copy, in the three languages the app ships.
//
// Same reasoning as legal.ts for living outside i18n.ts: this is sentences and
// paragraphs, and pasting marketing prose into the interface-string file buries
// the 400 short keys it exists to hold.
//
// Written per language rather than translated. Turkish is the primary market,
// so the Turkish reads as the original and the other two follow it, which is
// why none of them are word-for-word matches. Turkish uses siz-form with
// proper diacritics throughout.
//
// `demo` is the fiction shown in the hero card. Deliberately one specific
// booking rather than a feature list: the pitch is the loop from booking to
// confirmation to reminder, and a reader gets that from one thread faster than
// from any paragraph. Names match the seeded demo org (convex/devSeed.ts) so
// the landing and the live demo tell the same story.
import type { Language } from "./i18n";

// Which lane a feature belongs to. Drives the marker colour, reusing the app's
// channel-colour convention rather than inventing decoration: green is
// WhatsApp, blue is the phone, brand green is the calendar.
export type Channel = "whatsapp" | "call" | "calendar";

export type LandingFeature = { title: string; body: string; channel: Channel };

export type LandingCopy = {
  navCta: string;
  headlineLead: string;
  headlineAccent: string;
  subhead: string;
  ctaPrimary: string;
  ctaDemo: string;
  ctaNote: string;
  demo: {
    label: string;
    customer: string;
    service: string;
    sent: string;
    sentMeta: string;
    reply: string;
    replyMeta: string;
    reminder: string;
    reminderMeta: string;
  };
  featuresTitle: string;
  features: LandingFeature[];
  closingTitle: string;
  closingBody: string;
  privacy: string;
  terms: string;
};

export const LANDING: Record<Language, LandingCopy> = {
  tr: {
    navCta: "Başlayın",
    headlineLead: "Koltuk doluyken telefonu ",
    headlineAccent: "Randevu açar.",
    subhead:
      "Aramayı yanıtlar, randevuyu oluşturur, onayı ve hatırlatmayı WhatsApp'tan gönderir. Siz işinize bakarsınız.",
    ctaPrimary: "Google ile başlayın",
    ctaDemo: "Önce bir bakın",
    ctaNote: "Kurulum yok, kart yok. İlk girişte işletmeniz oluşur.",
    demo: {
      label: "Bugün",
      customer: "Merve Kılıç",
      service: "Saç boyama · 14:30",
      sent: "Merhaba Merve! Saç boyama randevunuz bugün 14:30 için oluşturuldu.",
      sentMeta: "Onay gönderildi",
      reply: "Onaylıyorum",
      replyMeta: "Müşteri butona dokundu",
      reminder: "Hatırlatma yarın 12:30'da gidecek",
      reminderMeta: "Otomatik",
    },
    featuresTitle: "Ne yapar",
    features: [
      {
        channel: "call",
        title: "Çalan telefon boş kalmaz",
        body: "Elleriniz doluyken arayan müşteri sesli asistanla konuşur, uygun saati alır ve randevusu oluşur. Kaçan çağrı, kaçan müşteri demek değildir artık.",
      },
      {
        channel: "whatsapp",
        title: "Onay ve hatırlatma WhatsApp'tan",
        body: "Randevu oluşunca onay, ziyaretten önce hatırlatma gider. Müşteri tek dokunuşla onaylar ya da iptal eder; iptal gelirse saat aynı anda boşalır.",
      },
      {
        channel: "calendar",
        title: "Takvim tek yerde",
        body: "Telefondan geleni de, WhatsApp'tan geleni de, elle yazdığınızı da aynı takvim gösterir. Çift kayıt olmaz, defterle ekran birbirini tutar.",
      },
      {
        channel: "whatsapp",
        title: "Gelmeyeni geri kazanın",
        body: "Randevusuna gelmeyen müşteriye birkaç gün sonra tek bir mesaj gider. Israr etmez, hatırlatır; çoğu insan zaten unuttuğu için gelmemiştir.",
      },
    ],
    closingTitle: "İlk girişte işletmeniz hazır",
    closingBody:
      "Google hesabınızla girin, işletmeniz otomatik oluşsun. Kurulum ekranı, kredi kartı ya da satış görüşmesi yok.",
    privacy: "Gizlilik politikası",
    terms: "Kullanım koşulları",
  },
  en: {
    navCta: "Get started",
    headlineLead: "Your phone gets answered ",
    headlineAccent: "while the chair is full.",
    subhead:
      "Randevu picks up, books the appointment, and sends the confirmation and the reminder on WhatsApp. You keep working.",
    ctaPrimary: "Start with Google",
    ctaDemo: "Have a look around first",
    ctaNote: "No setup, no card. Your business is created on first sign-in.",
    demo: {
      label: "Today",
      customer: "Merve Kılıç",
      service: "Colour · 14:30",
      sent: "Hi Merve! Your colour appointment is booked for 14:30 today.",
      sentMeta: "Confirmation sent",
      reply: "Confirm",
      replyMeta: "Customer tapped the button",
      reminder: "Reminder goes out tomorrow at 12:30",
      reminderMeta: "Automatic",
    },
    featuresTitle: "What it does",
    features: [
      {
        channel: "call",
        title: "A ringing phone stops being a lost customer",
        body: "When both your hands are busy, the caller talks to a voice agent, takes a time that actually works, and walks away booked. The call you couldn't reach is no longer the customer you didn't get.",
      },
      {
        channel: "whatsapp",
        title: "Confirmations and reminders on WhatsApp",
        body: "A confirmation goes out when the booking lands, a reminder before the visit. The customer confirms or cancels with one tap, and a cancellation frees the slot the moment it arrives.",
      },
      {
        channel: "calendar",
        title: "One calendar, not three",
        body: "Phone bookings, WhatsApp replies, and the ones you type in yourself all show up in the same calendar. Nothing gets booked twice, and the screen matches the paper book.",
      },
      {
        channel: "whatsapp",
        title: "Win back the no-shows",
        body: "Someone who missed their appointment gets one message a few days later. It reminds rather than nags, because most people did not skip on purpose, they just forgot.",
      },
    ],
    closingTitle: "Your business exists after the first sign-in",
    closingBody:
      "Sign in with Google and the business is created for you. No setup wizard, no card, no sales call.",
    privacy: "Privacy policy",
    terms: "Terms of service",
  },
  de: {
    navCta: "Loslegen",
    headlineLead: "Das Telefon wird abgenommen, ",
    headlineAccent: "auch wenn der Stuhl besetzt ist.",
    subhead:
      "Randevu geht ran, bucht den Termin und schickt Bestätigung und Erinnerung per WhatsApp. Sie arbeiten weiter.",
    ctaPrimary: "Mit Google starten",
    ctaDemo: "Erst einmal umsehen",
    ctaNote:
      "Keine Einrichtung, keine Karte. Ihr Betrieb entsteht bei der ersten Anmeldung.",
    demo: {
      label: "Heute",
      customer: "Merve Kılıç",
      service: "Färben · 14:30",
      sent: "Hallo Merve! Ihr Termin zum Färben steht heute um 14:30.",
      sentMeta: "Bestätigung gesendet",
      reply: "Bestätigen",
      replyMeta: "Kundin hat getippt",
      reminder: "Erinnerung geht morgen um 12:30 raus",
      reminderMeta: "Automatisch",
    },
    featuresTitle: "Was es macht",
    features: [
      {
        channel: "call",
        title: "Ein klingelndes Telefon ist kein verlorener Kunde mehr",
        body: "Wenn beide Hände voll sind, spricht der Anrufer mit einem Sprachagenten, bekommt eine Zeit, die wirklich passt, und ist am Ende gebucht. Der Anruf, den niemand annehmen konnte, kostet Sie keinen Kunden mehr.",
      },
      {
        channel: "whatsapp",
        title: "Bestätigung und Erinnerung per WhatsApp",
        body: "Bei der Buchung geht die Bestätigung raus, vor dem Besuch die Erinnerung. Der Kunde bestätigt oder sagt mit einem Tippen ab, und eine Absage gibt den Termin sofort wieder frei.",
      },
      {
        channel: "calendar",
        title: "Ein Kalender statt drei",
        body: "Telefonbuchungen, WhatsApp-Antworten und alles, was Sie selbst eintragen, stehen im selben Kalender. Nichts wird doppelt gebucht, und der Bildschirm stimmt mit dem Terminbuch überein.",
      },
      {
        channel: "whatsapp",
        title: "Nichterschienene zurückholen",
        body: "Wer seinen Termin verpasst hat, bekommt ein paar Tage später eine einzige Nachricht. Sie erinnert, statt zu drängen, denn die meisten sind nicht absichtlich weggeblieben, sondern haben es schlicht vergessen.",
      },
    ],
    closingTitle: "Nach der ersten Anmeldung steht Ihr Betrieb",
    closingBody:
      "Mit Google anmelden, der Betrieb wird automatisch angelegt. Kein Einrichtungsassistent, keine Karte, kein Verkaufsgespräch.",
    privacy: "Datenschutzerklärung",
    terms: "Nutzungsbedingungen",
  },
};
