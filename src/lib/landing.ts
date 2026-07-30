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
import type { Language } from "./i18n";

export type LandingFeature = { title: string; body: string };

export type LandingCopy = {
  headline: string;
  subhead: string;
  ctaPrimary: string;
  ctaDemo: string;
  ctaDemoHint: string;
  featuresTitle: string;
  features: LandingFeature[];
  closingTitle: string;
  closingBody: string;
  privacy: string;
  terms: string;
};

export const LANDING: Record<Language, LandingCopy> = {
  tr: {
    headline: "Koltuk doluyken telefonu Randevu açar.",
    subhead:
      "Aramayı yanıtlar, randevuyu oluşturur, onayı ve hatırlatmayı WhatsApp'tan gönderir. Siz işinize bakarsınız.",
    ctaPrimary: "Google ile başlayın",
    ctaDemo: "Önce bir bakın",
    ctaDemoHint: "Örnek bir kuaförün hesabı. Kayıt gerekmez.",
    featuresTitle: "Ne yapar",
    features: [
      {
        title: "Çalan telefon boş kalmaz",
        body: "Elleriniz doluyken arayan müşteri sesli asistanla konuşur, uygun saati alır ve randevusu oluşur. Kaçan çağrı, kaçan müşteri demek değildir artık.",
      },
      {
        title: "Onay ve hatırlatma WhatsApp'tan",
        body: "Randevu oluşunca onay, ziyaretten önce hatırlatma gider. Müşteri tek dokunuşla onaylar ya da iptal eder; iptal gelirse saat aynı anda boşalır.",
      },
      {
        title: "Takvim tek yerde",
        body: "Telefondan gelen de, WhatsApp'tan geleni de, elle yazdığınız da aynı takvime düşer. Çift kayıt olmaz, defterle ekran birbirini tutar.",
      },
      {
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
    headline: "Your phone gets answered while the chair is full.",
    subhead:
      "Randevu picks up, books the appointment, and sends the confirmation and the reminder on WhatsApp. You keep working.",
    ctaPrimary: "Start with Google",
    ctaDemo: "Have a look around first",
    ctaDemoHint: "A sample salon's account. No signup.",
    featuresTitle: "What it does",
    features: [
      {
        title: "A ringing phone stops being a lost customer",
        body: "When both your hands are busy, the caller talks to a voice agent, takes a time that actually works, and walks away booked. The call you couldn't reach is no longer the customer you didn't get.",
      },
      {
        title: "Confirmations and reminders on WhatsApp",
        body: "A confirmation goes out when the booking lands, a reminder before the visit. The customer confirms or cancels with one tap, and a cancellation frees the slot the moment it arrives.",
      },
      {
        title: "One calendar, not three",
        body: "Phone bookings, WhatsApp replies, and the ones you type in yourself all land in the same calendar. Nothing gets booked twice, and the screen matches the paper book.",
      },
      {
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
    headline: "Das Telefon wird abgenommen, auch wenn der Stuhl besetzt ist.",
    subhead:
      "Randevu geht ran, bucht den Termin und schickt Bestätigung und Erinnerung per WhatsApp. Sie arbeiten weiter.",
    ctaPrimary: "Mit Google starten",
    ctaDemo: "Erst einmal umsehen",
    ctaDemoHint: "Das Konto eines Beispielsalons. Keine Anmeldung nötig.",
    featuresTitle: "Was es macht",
    features: [
      {
        title: "Ein klingelndes Telefon ist kein verlorener Kunde mehr",
        body: "Wenn beide Hände voll sind, spricht der Anrufer mit einem Sprachagenten, bekommt eine Zeit, die wirklich passt, und ist am Ende gebucht. Der Anruf, den niemand annehmen konnte, kostet Sie keinen Kunden mehr.",
      },
      {
        title: "Bestätigung und Erinnerung per WhatsApp",
        body: "Bei der Buchung geht die Bestätigung raus, vor dem Besuch die Erinnerung. Der Kunde bestätigt oder sagt mit einem Tippen ab, und eine Absage gibt den Termin sofort wieder frei.",
      },
      {
        title: "Ein Kalender statt drei",
        body: "Telefonbuchungen, WhatsApp-Antworten und alles, was Sie selbst eintragen, landen im selben Kalender. Nichts wird doppelt gebucht, und der Bildschirm stimmt mit dem Terminbuch überein.",
      },
      {
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
