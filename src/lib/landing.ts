// Public landing-page copy. This lives outside i18n.ts because it is long-form
// marketing language, not interface vocabulary.
//
// Each language is written for its reader rather than translated line by line.
// The page tells one story in three beats: the promise (hero), the price of
// doing nothing (cost), the machine that fixes it (how). Auth method is a
// /signin concern — no CTA here mentions Google.
import type { Language } from "./i18n";

export type LandingStep = {
  title: string;
  body: string;
};

export type LandingTier = {
  name: string;
  price: string;
  period: string;
  // "Everything in X, plus:" — absent on the first tier.
  includesLead?: string;
  features: string[];
  recommended?: boolean;
};

export type LandingCopy = {
  nav: { cost: string; how: string; pricing: string };
  signIn: string;
  cta: string;
  headline: string;
  subhead: string;
  seeHow: string;
  themeToLight: string;
  themeToDark: string;
  cost: {
    title: string;
    body: string;
    missedLabel: string;
    valueLabel: string;
    // BCP 47 locale + ISO currency for Intl formatting of the result.
    locale: string;
    currency: string;
    defaultMissed: number;
    defaultValue: number;
    // Slider bounds are per-currency: a sensible ceiling in lira is not a
    // sensible ceiling in euros.
    missedMax: number;
    valueMax: number;
    valueStep: number;
    resultSuffix: string;
    chartCaption: string;
    // The one borrowed statistic on the page, kept because it can be
    // attributed to a named study. Nothing uncited gets added next to it.
    statLine: string;
  };
  how: {
    title: string;
    body: string;
    steps: LandingStep[];
    channelsNote: string;
    closing: string;
  };
  pricing: {
    title: string;
    body: string;
    recommendedLabel: string;
    tiers: LandingTier[];
  };
  footerLine: string;
  footerProduct: string;
  footerResources: string;
  footerCompany: string;
  footerAutotaktLine: string;
  demoLink: string;
  help: string;
  privacy: string;
  terms: string;
};

export const LANDING: Record<Language, LandingCopy> = {
  tr: {
    nav: { cost: "Maliyet", how: "Nasıl çalışır", pricing: "Fiyatlar" },
    signIn: "Giriş yapın",
    cta: "Hemen başlayın",
    headline: "Bir daha randevu kaçmasın.",
    subhead:
      "Siz müsait olmadığınızda Resepta açar: işletmenizi tanıyan sesli asistan aramayı yanıtlar, randevuyu takvime işler ve siz işinize dönmeden onayı gönderir.",
    seeHow: "Bir aramanın yolculuğunu izleyin",
    themeToLight: "Açık temaya geç",
    themeToDark: "Koyu temaya geç",
    cost: {
      title: "Kaçan aramaların sessiz bir maliyeti var",
      body: "Telefonun çalması için zaten para harcadınız — dükkân, tabela, reklam. Kendi rakamlarınızı girin; cevapsız kalan aramaların bir yıllık bedeli bu.",
      missedLabel: "Haftada kaçan arama",
      valueLabel: "Ortalama randevu tutarı",
      locale: "tr-TR",
      currency: "TRY",
      defaultMissed: 5,
      defaultValue: 500,
      missedMax: 40,
      valueMax: 5000,
      valueStep: 50,
      resultSuffix: "her yıl masada kalıyor",
      chartCaption: "Ay ay nasıl biriktiği",
      statLine:
        "411 Locals'ın araştırmasında küçük işletmelere gelen aramaların %62'si cevapsız kaldı.",
    },
    how: {
      title: "Bir arama, baştan sona",
      body: "Makinenin tamamı bu. Birleştirilecek sekme, elle taşınacak bilgi yok.",
      steps: [
        {
          title: "Telefon çalar",
          body: "Sesli asistan sizin dilinizde ve üslubunuzla açar; siz müşterideyken de, dükkân kapalıyken de.",
        },
        {
          title: "Randevu kayda geçer",
          body: "Hizmet, saat ve sormasını istediğiniz her bilgi doğrudan takvime işlenir.",
        },
        {
          title: "Müşteri kayıt altındadır",
          body: "Geçmişi, tercihleri ve tüm görüşmeleriyle bir müşteri kartı. Bir sonraki aramada asistan onu zaten tanır.",
        },
        {
          title: "Onay yola çıkar",
          body: "Resepta müşteriye e-posta gönderir ve ayarladığınız hatırlatmaları planlar.",
        },
        {
          title: "Takviminize düşer",
          body: "Etkinlik Google Takvim'e ya da hangi takvimi kullanıyorsanız ona aktarılır.",
        },
      ],
      channelsNote:
        "Bugün rezervasyonu telefon alıyor. WhatsApp ve e-posta şimdiden onay ve hatırlatmaları taşıyor; sırada onlardan da randevu almak var.",
      closing: "Bir sonraki arama her hâlükârda gelecek.",
    },
    pricing: {
      title: "Fiyatlar",
      body: "Bir ön büro maaş ister; bu ₺1.990'dan başlıyor. Her planda sesli asistan, takvim ve müşteri kayıtları var — fark dakikalarda ve kanallarda.",
      recommendedLabel: "Önerilen",
      tiers: [
        {
          name: "Başlangıç",
          price: "₺1.990",
          period: "/ ay",
          features: [
            "Kendi numarasında sesli asistan",
            "Ayda 200 arama dakikası",
            "Randevu takvimi ve müşteri kayıtları",
            "E-posta onay ve hatırlatmaları",
            "Google Takvim eşitlemesi",
          ],
        },
        {
          name: "İşletme",
          price: "₺3.990",
          period: "/ ay",
          includesLead: "Başlangıç'taki her şey, artı:",
          recommended: true,
          features: [
            "Ayda 400 arama dakikası",
            "WhatsApp onay ve hatırlatmaları",
            "Gelmeyen ve iptal takipleri",
          ],
        },
        {
          name: "Pro",
          price: "₺7.990",
          period: "/ ay",
          includesLead: "İşletme'deki her şey, artı:",
          features: [
            "Ayda 800 arama dakikası",
            "Ek numaralar ve sesli asistanlar",
            "Öncelikli destek",
          ],
        },
      ],
    },
    footerLine: "Randevulu işletmeler için bağlantılı arama, müşteri ve takip otomasyonu.",
    footerProduct: "Ürün",
    footerResources: "Kaynaklar",
    footerCompany: "Şirket",
    footerAutotaktLine: "Yapay zekâ asistanları, bağlı iş akışları ve pratik işletme yazılımları.",
    demoLink: "Ürün demosu",
    help: "Yardım merkezi",
    privacy: "Gizlilik politikası",
    terms: "Kullanım koşulları",
  },

  en: {
    nav: { cost: "The cost", how: "How it works", pricing: "Pricing" },
    signIn: "Sign in",
    cta: "Get started",
    headline: "Never miss another booking.",
    subhead:
      "Resepta picks up when you can't: a voice agent trained on your business answers the call, books the appointment into your calendar, and sends the confirmation before you're free again.",
    seeHow: "Follow one call through",
    themeToLight: "Switch to light mode",
    themeToDark: "Switch to dark mode",
    cost: {
      title: "The calls you miss are quietly expensive",
      body: "You already paid to make the phone ring — the shop, the sign, the ads. Put your own numbers in; this is what ringing out costs over a year.",
      missedLabel: "Missed calls per week",
      valueLabel: "Average appointment value",
      locale: "en-US",
      currency: "USD",
      defaultMissed: 5,
      defaultValue: 40,
      missedMax: 40,
      valueMax: 500,
      valueStep: 5,
      resultSuffix: "left on the table every year",
      chartCaption: "How it adds up, month by month",
      statLine:
        "In a 411 Locals study, 62% of calls to small businesses went unanswered.",
    },
    how: {
      title: "One call, start to finish",
      body: "This is the whole machine. No tabs to reconcile, nothing to copy across.",
      steps: [
        {
          title: "The phone rings",
          body: "Your voice agent answers in your language and your tone — whether you're mid-appointment or closed for the day.",
        },
        {
          title: "The appointment is booked",
          body: "Service, time, and any details you told the agent to ask for go straight into the calendar.",
        },
        {
          title: "The customer is on record",
          body: "A contact card with history, preferences, and every conversation. Next time, the agent already knows them.",
        },
        {
          title: "The confirmation goes out",
          body: "Resepta emails the customer and schedules the reminders you've configured.",
        },
        {
          title: "It lands on your calendar",
          body: "The event syncs to Google Calendar — or whichever calendar your business runs on.",
        },
      ],
      channelsNote:
        "Calls book today. WhatsApp and email already carry confirmations and reminders — taking bookings through them is next.",
      closing: "The next call is coming either way.",
    },
    pricing: {
      title: "Pricing",
      body: "A front desk costs a salary. This one starts at $49 a month. Every plan includes the voice agent, the calendar, and the customer records — the difference is minutes and channels.",
      recommendedLabel: "Recommended",
      tiers: [
        {
          name: "Starter",
          price: "$49",
          period: "/ month",
          features: [
            "Voice agent on its own number",
            "200 call minutes a month",
            "Booking calendar and customer records",
            "Email confirmations and reminders",
            "Google Calendar sync",
          ],
        },
        {
          name: "Business",
          price: "$99",
          period: "/ month",
          includesLead: "Everything in Starter, plus:",
          recommended: true,
          features: [
            "400 call minutes a month",
            "WhatsApp confirmations and reminders",
            "No-show and cancellation follow-ups",
          ],
        },
        {
          name: "Pro",
          price: "$199",
          period: "/ month",
          includesLead: "Everything in Business, plus:",
          features: [
            "800 call minutes a month",
            "Additional numbers and voice agents",
            "Priority support",
          ],
        },
      ],
    },
    footerLine: "Connected calls, customers, and follow-up for appointment businesses.",
    footerProduct: "Product",
    footerResources: "Resources",
    footerCompany: "Company",
    footerAutotaktLine: "AI assistants, connected workflows, and practical business software.",
    demoLink: "Product demo",
    help: "Help center",
    privacy: "Privacy policy",
    terms: "Terms of service",
  },

  de: {
    nav: { cost: "Die Kosten", how: "So funktioniert es", pricing: "Preise" },
    signIn: "Anmelden",
    cta: "Jetzt starten",
    headline: "Kein Termin geht mehr verloren.",
    subhead:
      "Resepta geht ran, wenn Sie nicht können: Ein Sprachassistent, der Ihren Betrieb kennt, nimmt den Anruf an, trägt den Termin in den Kalender ein und verschickt die Bestätigung, bevor Sie wieder Zeit haben.",
    seeHow: "Verfolgen Sie einen Anruf von Anfang bis Ende",
    themeToLight: "Zum hellen Modus wechseln",
    themeToDark: "Zum dunklen Modus wechseln",
    cost: {
      title: "Verpasste Anrufe haben einen stillen Preis",
      body: "Dass das Telefon klingelt, haben Sie längst bezahlt — Laden, Schild, Werbung. Tragen Sie Ihre eigenen Zahlen ein; so viel kostet ein Jahr unbeantworteter Anrufe.",
      missedLabel: "Verpasste Anrufe pro Woche",
      valueLabel: "Durchschnittlicher Terminwert",
      locale: "de-DE",
      currency: "EUR",
      defaultMissed: 5,
      defaultValue: 40,
      missedMax: 40,
      valueMax: 500,
      valueStep: 5,
      resultSuffix: "bleiben jedes Jahr liegen",
      chartCaption: "So summiert es sich, Monat für Monat",
      statLine:
        "In einer Studie von 411 Locals blieben 62 % der Anrufe bei kleinen Betrieben unbeantwortet.",
    },
    how: {
      title: "Ein Anruf, von Anfang bis Ende",
      body: "Das ist die ganze Maschine. Keine Tabs zum Abgleichen, nichts von Hand zu übertragen.",
      steps: [
        {
          title: "Das Telefon klingelt",
          body: "Ihr Sprachassistent nimmt an — in Ihrer Sprache, in Ihrem Ton. Ob Sie gerade beim Kunden sind oder längst Feierabend haben.",
        },
        {
          title: "Der Termin wird gebucht",
          body: "Leistung, Uhrzeit und alles, was der Assistent erfragen soll, landen direkt im Kalender.",
        },
        {
          title: "Der Kunde ist erfasst",
          body: "Ein Kundenprofil mit Verlauf, Vorlieben und jedem Gespräch. Beim nächsten Anruf kennt der Assistent ihn schon.",
        },
        {
          title: "Die Bestätigung geht raus",
          body: "Resepta schreibt dem Kunden eine E-Mail und plant die Erinnerungen, die Sie eingestellt haben.",
        },
        {
          title: "Er landet in Ihrem Kalender",
          body: "Der Termin wird mit Google Kalender synchronisiert — oder mit dem Kalender, den Ihr Betrieb nutzt.",
        },
      ],
      channelsNote:
        "Gebucht wird heute am Telefon. WhatsApp und E-Mail übernehmen bereits Bestätigungen und Erinnerungen — Buchungen darüber folgen.",
      closing: "Der nächste Anruf kommt so oder so.",
    },
    pricing: {
      title: "Preise",
      body: "Ein Empfang kostet ein Gehalt; hier geht es ab 49 € im Monat los. Jeder Plan enthält Sprachassistent, Kalender und Kundenprofile — der Unterschied liegt in Minuten und Kanälen.",
      recommendedLabel: "Empfohlen",
      tiers: [
        {
          name: "Starter",
          price: "49 €",
          period: "/ Monat",
          features: [
            "Sprachassistent auf eigener Nummer",
            "200 Anrufminuten pro Monat",
            "Terminkalender und Kundenprofile",
            "Bestätigungen und Erinnerungen per E-Mail",
            "Google-Kalender-Synchronisierung",
          ],
        },
        {
          name: "Business",
          price: "99 €",
          period: "/ Monat",
          includesLead: "Alles aus Starter, plus:",
          recommended: true,
          features: [
            "400 Anrufminuten pro Monat",
            "WhatsApp-Bestätigungen und -Erinnerungen",
            "Nachfassen bei No-Shows und Absagen",
          ],
        },
        {
          name: "Pro",
          price: "199 €",
          period: "/ Monat",
          includesLead: "Alles aus Business, plus:",
          features: [
            "800 Anrufminuten pro Monat",
            "Zusätzliche Nummern und Sprachassistenten",
            "Bevorzugter Support",
          ],
        },
      ],
    },
    footerLine: "Verbundene Anrufe, Kunden und Nachbereitung für Terminbetriebe.",
    footerProduct: "Produkt",
    footerResources: "Ressourcen",
    footerCompany: "Unternehmen",
    footerAutotaktLine: "KI-Assistenten, vernetzte Arbeitsabläufe und praktische Unternehmenssoftware.",
    demoLink: "Produkt-Demo",
    help: "Hilfe-Center",
    privacy: "Datenschutzerklärung",
    terms: "Nutzungsbedingungen",
  },
};
