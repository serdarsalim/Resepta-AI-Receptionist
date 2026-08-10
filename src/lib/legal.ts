// Privacy policy and terms of service, in the three languages the app ships.
//
// These live here rather than in i18n.ts on purpose. i18n.ts holds UI strings,
// where a key maps to a phrase and the file stays scannable. Legal text is
// paragraphs, and pasting nine documents' worth of prose into that file would
// bury the 400 interface strings it exists to hold.
//
// TWO ROLES, and the split is the reason this policy reads the way it does.
// For a salon owner's own account (their Google name, email, avatar) Resepta is
// the data controller. For the salon's CUSTOMER records, the salon is the
// controller and Resepta is the processor acting on its instructions. Getting
// that backwards would promise customers rights we cannot grant and relieve
// owners of duties they actually carry. Turkish law here is KVKK, not GDPR.
//
// Accuracy note for whoever edits next: every data category listed below is
// checked against convex/schema.ts. If you add a field that holds personal
// data, it belongs in section "What we store" in all three languages, or this
// document becomes false.
import type { Language } from "./i18n";

// MUST be set before these pages are submitted to Google Cloud branding or
// Meta app review. Left empty rather than filled with a plausible-looking
// address: a privacy policy naming a mailbox nobody reads is worse than one
// that visibly still needs an address. The contact section omits the line when
// this is empty instead of rendering a dead mailto.
export const LEGAL_CONTACT_EMAIL = "";

export type LegalSection = {
  heading: string;
  body?: string[];
  bullets?: string[];
};

export type LegalDoc = {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
};

export const LEGAL_UI: Record<
  Language,
  { back: string; updated: string; privacy: string; terms: string; contact: string }
> = {
  tr: {
    back: "Girişe dön",
    updated: "Son güncelleme",
    privacy: "Gizlilik politikası",
    terms: "Kullanım koşulları",
    contact: "Sorularınız için bize yazın:",
  },
  en: {
    back: "Back to sign in",
    updated: "Last updated",
    privacy: "Privacy policy",
    terms: "Terms of service",
    contact: "Questions? Write to us:",
  },
  de: {
    back: "Zurück zur Anmeldung",
    updated: "Zuletzt aktualisiert",
    privacy: "Datenschutzerklärung",
    terms: "Nutzungsbedingungen",
    contact: "Fragen? Schreiben Sie uns:",
  },
};

// The same date the documents print, in the form a machine reads. The sitemap
// tells crawlers when /privacy and /terms last changed, and it has to agree
// with what the page itself says or the claim is worthless. Six `updated`
// strings below (three languages, two documents) and this constant move
// together or not at all.
export const LEGAL_UPDATED_ISO = "2026-07-30";

export const PRIVACY: Record<Language, LegalDoc> = {
  tr: {
    title: "Gizlilik politikası",
    updated: "30 Temmuz 2026",
    intro: [
      "Resepta, küçük işletmelerin randevularını yönetmesini ve müşterilerine WhatsApp üzerinden hatırlatma göndermesini sağlar. Bu politika hangi verileri tuttuğumuzu, neden tuttuğumuzu ve kimlerle paylaştığımızı anlatır.",
      "Burada iki ayrı rol var ve aradaki fark önemli. İşletme sahibinin kendi hesap bilgileri için veri sorumlusu biziz. İşletmenin müşteri kayıtları için veri sorumlusu işletmenin kendisidir, biz yalnızca onun talimatıyla veri işleyen tarafız.",
    ],
    sections: [
      {
        heading: "Hesabınız için tuttuğumuz veriler",
        body: [
          "Google ile giriş yaptığınızda Google bize adınızı, e-posta adresinizi ve profil fotoğrafınızın adresini iletir. Şifrenizi görmüyoruz ve saklamıyoruz.",
          "Bu verileri hesabınızı oluşturmak, sizi işletmenizle eşleştirmek ve size hizmetle ilgili bildirim göndermek için kullanırız.",
        ],
      },
      {
        heading: "İşletmenin müşterileri adına tuttuğumuz veriler",
        body: [
          "İşletme, müşterilerine ait şu kayıtları sisteme girer veya sistem bu kayıtları hizmet sırasında oluşturur:",
        ],
        bullets: [
          "Ad, soyad, telefon numarası, varsa e-posta adresi ve tercih edilen dil",
          "Resepta geçmişi, hizmet türü, personel ve süre bilgisi",
          "WhatsApp yazışmalarının içeriği ve gönderim durumu",
          "Telefonla gelen aramaların ses kaydı, dökümü ve özeti",
          "İşletmenin kendi tanımladığı ek alanlar ve müşteri notları",
          "WhatsApp mesajı için onayın alındığı tarih",
        ],
      },
      {
        heading: "Onay olmadan mesaj gitmez",
        body: [
          "Bir müşteri kaydında onay tarihi yoksa sistem o numaraya WhatsApp mesajı göndermez. Bu bir tercih değil, kodun içindeki bir kilit. Onayı toplamak ve kaydetmek işletmenin sorumluluğundadır.",
        ],
      },
      {
        heading: "Verileri kimlerle paylaşıyoruz",
        body: [
          "Hizmeti çalıştırmak için aşağıdaki sağlayıcıları kullanıyoruz. Her biri yalnızca kendi işi için gereken veriyi görür.",
        ],
        bullets: [
          "Convex: veritabanı ve uygulama altyapısı",
          "Vercel: web arayüzünün barındırılması",
          "Google: hesap girişi",
          "Meta WhatsApp Cloud API: WhatsApp mesajlarının gönderilmesi ve alınması",
          "cal.com: takvim ve randevu kayıtları",
          "Retell: telefon çağrılarının yanıtlanması ve dökümü",
          "Resend: e-posta gönderimi",
        ],
      },
      {
        heading: "Verileri ne kadar süre tutuyoruz",
        body: [
          "Hesabınız açık olduğu sürece işletmenizin kayıtlarını tutarız. Hesabınızı kapattığınızda kayıtlar en fazla otuz gün içinde silinir. Bu süre, yanlışlıkla silinen bir hesabın geri getirilebilmesi içindir.",
          "Yasal olarak saklamak zorunda olduğumuz kayıtlar bu sürenin dışındadır.",
        ],
      },
      {
        heading: "Haklarınız",
        body: [
          "KVKK kapsamında verilerinize erişme, düzeltilmesini isteme, silinmesini isteme ve işlenmesine itiraz etme hakkınız var. Talebinizi bize iletirseniz otuz gün içinde yanıtlarız.",
          "Bir işletmenin müşterisiyseniz ve kaydınızın silinmesini istiyorsanız, doğrudan randevu aldığınız işletmeye başvurmanız gerekir. Kayıt onlara ait, biz yalnızca onların adına tutuyoruz. Bize ulaşırsanız talebinizi ilgili işletmeye yönlendiririz.",
        ],
      },
      {
        heading: "Güvenlik",
        body: [
          "Veriler aktarım sırasında ve sunucuda şifrelenir. Her işletmenin kayıtları kendi hesabına bağlıdır ve uygulamadaki her sorgu bu bağı kontrol eder.",
          "Hiçbir sistem kusursuz değildir. Bir güvenlik olayı yaşanırsa etkilenen işletmeleri ve gerekli durumlarda yetkili kurumu bilgilendiririz.",
        ],
      },
      {
        heading: "Değişiklikler",
        body: [
          "Bu politikayı güncellediğimizde sayfadaki tarihi değiştiririz. Önemli bir değişiklik olursa uygulama içinde bildiririz.",
        ],
      },
    ],
  },
  en: {
    title: "Privacy policy",
    updated: "30 July 2026",
    intro: [
      "Resepta helps small businesses manage appointments and send WhatsApp reminders to their customers. This page explains what we store, why, and who else sees it.",
      "There are two roles here and the difference matters. For a business owner's own account details, we are the data controller. For the records of that business's customers, the business is the controller and we are a processor acting on its instructions.",
    ],
    sections: [
      {
        heading: "What we store for your account",
        body: [
          "When you sign in with Google, Google passes us your name, email address, and a link to your profile picture. We never see or store your password.",
          "We use this to create your account, connect you to your business, and send you notices about the service.",
        ],
      },
      {
        heading: "What we store on behalf of a business",
        body: [
          "A business enters the following records about its customers, or the service creates them while doing its job:",
        ],
        bullets: [
          "Name, phone number, email address where given, and preferred language",
          "Appointment history, service type, staff member, and duration",
          "The content and delivery status of WhatsApp conversations",
          "Recordings, transcripts, and summaries of inbound phone calls",
          "Custom fields the business defines, and free-text notes",
          "The date consent to receive WhatsApp messages was recorded",
        ],
      },
      {
        heading: "No consent, no message",
        body: [
          "If a customer record carries no consent date, the system will not send a WhatsApp message to that number. That is a lock in the code, not a setting. Collecting and recording consent is the business's responsibility.",
        ],
      },
      {
        heading: "Who we share data with",
        body: [
          "We use these providers to run the service. Each sees only the data its own job requires.",
        ],
        bullets: [
          "Convex: database and application backend",
          "Vercel: hosting for the web interface",
          "Google: account sign-in",
          "Meta WhatsApp Cloud API: sending and receiving WhatsApp messages",
          "cal.com: calendar and booking records",
          "Retell: answering and transcribing phone calls",
          "Resend: outbound email",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "We keep a business's records for as long as its account is open. When an account is closed, records are deleted within thirty days. That window exists so an account closed by mistake can be recovered.",
          "Records we are legally required to retain sit outside that window.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "You can ask to see your data, correct it, delete it, or object to how it is processed. Send us a request and we will answer within thirty days.",
          "If you are a customer of a business using Resepta and you want your record deleted, ask that business directly. The record belongs to them and we hold it on their behalf. If you contact us, we will pass your request to them.",
        ],
      },
      {
        heading: "Security",
        body: [
          "Data is encrypted in transit and at rest. Every business's records are tied to its own account, and every query in the application checks that tie.",
          "No system is perfect. If there is a security incident, we will tell the affected businesses and, where required, the relevant authority.",
        ],
      },
      {
        heading: "Changes",
        body: [
          "When we update this policy we change the date on this page. If a change is significant, we will say so inside the app.",
        ],
      },
    ],
  },
  de: {
    title: "Datenschutzerklärung",
    updated: "30. Juli 2026",
    intro: [
      "Resepta hilft kleinen Betrieben, Termine zu verwalten und Erinnerungen per WhatsApp zu verschicken. Diese Seite erklärt, welche Daten wir speichern, warum, und wer sie noch sieht.",
      "Es gibt hier zwei Rollen, und der Unterschied ist wichtig. Für die Kontodaten eines Inhabers sind wir Verantwortlicher. Für die Kundendaten des Betriebs ist der Betrieb der Verantwortliche und wir sind Auftragsverarbeiter nach seinen Weisungen.",
    ],
    sections: [
      {
        heading: "Was wir für Ihr Konto speichern",
        body: [
          "Wenn Sie sich mit Google anmelden, übermittelt Google uns Ihren Namen, Ihre E-Mail-Adresse und einen Link zu Ihrem Profilbild. Ihr Passwort sehen und speichern wir nicht.",
          "Wir nutzen diese Daten, um Ihr Konto anzulegen, Sie Ihrem Betrieb zuzuordnen und Ihnen Mitteilungen zum Dienst zu senden.",
        ],
      },
      {
        heading: "Was wir im Auftrag eines Betriebs speichern",
        body: [
          "Ein Betrieb erfasst die folgenden Daten über seine Kunden, oder der Dienst erzeugt sie im laufenden Betrieb:",
        ],
        bullets: [
          "Name, Telefonnummer, E-Mail-Adresse sofern angegeben, und bevorzugte Sprache",
          "Terminverlauf, Leistungsart, Mitarbeiter und Dauer",
          "Inhalt und Versandstatus der WhatsApp-Konversationen",
          "Aufzeichnungen, Transkripte und Zusammenfassungen eingehender Anrufe",
          "Eigene Felder, die der Betrieb definiert, sowie freie Notizen",
          "Das Datum, an dem die Einwilligung für WhatsApp-Nachrichten erfasst wurde",
        ],
      },
      {
        heading: "Ohne Einwilligung keine Nachricht",
        body: [
          "Fehlt in einem Kundendatensatz das Einwilligungsdatum, sendet das System keine WhatsApp-Nachricht an diese Nummer. Das ist im Code verankert, keine Einstellung. Das Einholen und Festhalten der Einwilligung liegt beim Betrieb.",
        ],
      },
      {
        heading: "Mit wem wir Daten teilen",
        body: [
          "Wir nutzen die folgenden Dienstleister für den Betrieb. Jeder sieht nur die Daten, die seine Aufgabe erfordert.",
        ],
        bullets: [
          "Convex: Datenbank und Anwendungsbackend",
          "Vercel: Hosting der Weboberfläche",
          "Google: Kontoanmeldung",
          "Meta WhatsApp Cloud API: Senden und Empfangen von WhatsApp-Nachrichten",
          "cal.com: Kalender und Buchungen",
          "Retell: Annahme und Transkription von Anrufen",
          "Resend: E-Mail-Versand",
        ],
      },
      {
        heading: "Wie lange wir Daten aufbewahren",
        body: [
          "Wir bewahren die Daten eines Betriebs auf, solange sein Konto besteht. Nach Schließung des Kontos werden sie innerhalb von dreißig Tagen gelöscht. Diese Frist gibt es, damit ein versehentlich geschlossenes Konto wiederhergestellt werden kann.",
          "Daten, die wir gesetzlich aufbewahren müssen, fallen nicht unter diese Frist.",
        ],
      },
      {
        heading: "Ihre Rechte",
        body: [
          "Sie können Auskunft, Berichtigung oder Löschung Ihrer Daten verlangen und der Verarbeitung widersprechen. Wir antworten innerhalb von dreißig Tagen.",
          "Wenn Sie Kunde eines Betriebs sind, der Resepta nutzt, und Ihren Datensatz löschen lassen möchten, wenden Sie sich direkt an diesen Betrieb. Die Daten gehören ihm, wir halten sie nur in seinem Auftrag. Erreicht uns Ihre Anfrage, leiten wir sie weiter.",
        ],
      },
      {
        heading: "Sicherheit",
        body: [
          "Daten werden bei der Übertragung und auf dem Server verschlüsselt. Die Daten jedes Betriebs sind an sein eigenes Konto gebunden, und jede Abfrage in der Anwendung prüft diese Bindung.",
          "Kein System ist fehlerfrei. Bei einem Sicherheitsvorfall informieren wir die betroffenen Betriebe und, wo erforderlich, die zuständige Behörde.",
        ],
      },
      {
        heading: "Änderungen",
        body: [
          "Wenn wir diese Erklärung aktualisieren, ändern wir das Datum auf dieser Seite. Bei wesentlichen Änderungen weisen wir in der Anwendung darauf hin.",
        ],
      },
    ],
  },
};

export const TERMS: Record<Language, LegalDoc> = {
  tr: {
    title: "Kullanım koşulları",
    updated: "30 Temmuz 2026",
    intro: [
      "Resepta'yı kullanarak bu koşulları kabul etmiş olursunuz. Kısa tutmaya çalıştık.",
    ],
    sections: [
      {
        heading: "Hizmet ne yapar",
        body: [
          "Resepta, işletmenizin randevularını tek yerde toplar, müşterilerinize WhatsApp üzerinden onay ve hatırlatma gönderir ve gelen telefon çağrılarını yanıtlayabilir. Takvim tarafında cal.com kullanılır.",
        ],
      },
      {
        heading: "Hesap",
        body: [
          "Hesap açmak için Google hesabınızla giriş yaparsınız. İlk girişte işletmeniz otomatik oluşturulur. Hesabınızla yapılan her işlemden siz sorumlusunuz.",
          "On sekiz yaşından küçükseniz veya bir işletme adına sözleşme yapma yetkiniz yoksa bu hizmeti kullanamazsınız.",
        ],
      },
      {
        heading: "Müşteri verileriyle ilgili sorumluluğunuz",
        body: [
          "Sisteme girdiğiniz müşteri kayıtlarının sorumlusu sizsiniz. Şunları taahhüt edersiniz:",
        ],
        bullets: [
          "Mesaj göndereceğiniz her numara için gerekli onayı almış olmak",
          "KVKK ve tabi olduğunuz diğer veri koruma kurallarına uymak",
          "Meta'nın WhatsApp Business politikalarına uymak",
          "İstenmeyen mesaj göndermemek",
        ],
      },
      {
        heading: "Yapamayacağınız şeyler",
        bullets: [
          "Hizmeti yasaya aykırı bir amaçla kullanmak",
          "Sisteme izinsiz erişmeye çalışmak veya başka bir işletmenin kayıtlarına ulaşmaya çalışmak",
          "Hizmeti tersine mühendislikle çoğaltmak veya yeniden satmak",
          "Altyapıya orantısız yük bindirmek",
        ],
      },
      {
        heading: "Üçüncü taraf hizmetler",
        body: [
          "Resepta, WhatsApp için Meta, takvim için cal.com, telefon için Retell ve e-posta için Resend kullanır. Bu sağlayıcıların kendi koşulları da sizin için geçerlidir. Biri hizmetini değiştirdiğinde veya kestiğinde ilgili özellik etkilenebilir.",
        ],
      },
      {
        heading: "Ücretler",
        body: [
          "Şu anda ücret alınmamaktadır. Ücretli bir plana geçtiğimizde fiyatı ve koşulları önceden gösterir, onayınızı almadan hiçbir tahsilat yapmayız.",
        ],
      },
      {
        heading: "Kesintiler ve garanti",
        body: [
          "Hizmeti çalışır durumda tutmaya çalışıyoruz ama kesintisiz çalışacağını garanti etmiyoruz. Bakım, sağlayıcı arızası veya hata nedeniyle kesinti olabilir.",
          "Hizmet olduğu gibi sunulur. Belirli bir amaca uygunluk konusunda zımni bir garanti verilmez.",
        ],
      },
      {
        heading: "Sorumluluğun sınırı",
        body: [
          "Gönderilmeyen bir hatırlatma yüzünden kaçırılan randevudan, dolaylı zararlardan veya kâr kaybından sorumlu değiliz. Sorumluluğumuz her durumda son on iki ayda bize ödediğiniz tutarla sınırlıdır.",
        ],
      },
      {
        heading: "Hesabın kapatılması",
        body: [
          "Hesabınızı istediğiniz zaman kapatabilirsiniz. Bu koşulları ihlal ederseniz hesabınızı askıya alabilir veya kapatabiliriz. Kapanıştan sonra veri silme süresi gizlilik politikasında yazılıdır.",
        ],
      },
      {
        heading: "Uygulanacak hukuk",
        body: [
          "Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır ve uyuşmazlıklarda Türkiye mahkemeleri yetkilidir.",
        ],
      },
    ],
  },
  en: {
    title: "Terms of service",
    updated: "30 July 2026",
    intro: ["By using Resepta you agree to these terms. We have kept them short."],
    sections: [
      {
        heading: "What the service does",
        body: [
          "Resepta keeps your appointments in one place, sends confirmations and reminders to your customers over WhatsApp, and can answer your inbound phone calls. cal.com handles the calendar side.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You sign in with a Google account, and your business is created on first sign-in. You are responsible for everything done through your account.",
          "You may not use the service if you are under eighteen or lack authority to enter an agreement for the business you are signing up.",
        ],
      },
      {
        heading: "Your responsibility for customer data",
        body: [
          "You are responsible for the customer records you put into the system. You confirm that you will:",
        ],
        bullets: [
          "Have the consent you need for every number you message",
          "Follow KVKK and any other data protection rules that apply to you",
          "Follow Meta's WhatsApp Business policies",
          "Not send unsolicited messages",
        ],
      },
      {
        heading: "What you may not do",
        bullets: [
          "Use the service for an unlawful purpose",
          "Try to reach the system, or another business's records, without authorisation",
          "Reverse engineer, copy, or resell the service",
          "Place a disproportionate load on the infrastructure",
        ],
      },
      {
        heading: "Third-party services",
        body: [
          "Resepta uses Meta for WhatsApp, cal.com for calendars, Retell for phone calls, and Resend for email. Those providers' own terms apply to you as well. If one of them changes or withdraws its service, the matching feature can be affected.",
        ],
      },
      {
        heading: "Fees",
        body: [
          "There is no charge at present. If we introduce a paid plan we will show the price and terms first, and we will not bill you without your agreement.",
        ],
      },
      {
        heading: "Availability and warranty",
        body: [
          "We work to keep the service running but do not promise uninterrupted service. Maintenance, a provider outage, or a bug can all cause downtime.",
          "The service is provided as it is, without implied warranties of fitness for a particular purpose.",
        ],
      },
      {
        heading: "Limit of liability",
        body: [
          "We are not liable for an appointment missed because a reminder did not arrive, nor for indirect loss or lost profit. Our total liability is limited to what you paid us in the previous twelve months.",
        ],
      },
      {
        heading: "Closing an account",
        body: [
          "You can close your account whenever you like. We may suspend or close an account that breaks these terms. The deletion window after closure is set out in the privacy policy.",
        ],
      },
      {
        heading: "Governing law",
        body: [
          "These terms are governed by the law of the Republic of Türkiye, and the Turkish courts have jurisdiction over disputes.",
        ],
      },
    ],
  },
  de: {
    title: "Nutzungsbedingungen",
    updated: "30. Juli 2026",
    intro: [
      "Mit der Nutzung von Resepta stimmen Sie diesen Bedingungen zu. Wir haben sie kurz gehalten.",
    ],
    sections: [
      {
        heading: "Was der Dienst leistet",
        body: [
          "Resepta bündelt Ihre Termine an einer Stelle, verschickt Bestätigungen und Erinnerungen per WhatsApp und kann eingehende Anrufe annehmen. Den Kalender übernimmt cal.com.",
        ],
      },
      {
        heading: "Ihr Konto",
        body: [
          "Sie melden sich mit einem Google-Konto an, und Ihr Betrieb wird bei der ersten Anmeldung angelegt. Für alles, was über Ihr Konto geschieht, sind Sie verantwortlich.",
          "Sie dürfen den Dienst nicht nutzen, wenn Sie unter achtzehn sind oder nicht berechtigt sind, für den angemeldeten Betrieb einen Vertrag zu schließen.",
        ],
      },
      {
        heading: "Ihre Verantwortung für Kundendaten",
        body: [
          "Für die Kundendaten, die Sie erfassen, sind Sie verantwortlich. Sie bestätigen, dass Sie:",
        ],
        bullets: [
          "für jede Nummer, die Sie anschreiben, die nötige Einwilligung haben",
          "die DSGVO, KVKK und weitere für Sie geltende Datenschutzregeln einhalten",
          "die WhatsApp-Business-Richtlinien von Meta einhalten",
          "keine unerwünschten Nachrichten senden",
        ],
      },
      {
        heading: "Was Sie nicht dürfen",
        bullets: [
          "den Dienst für rechtswidrige Zwecke nutzen",
          "unbefugt auf das System oder die Daten eines anderen Betriebs zugreifen",
          "den Dienst zurückentwickeln, kopieren oder weiterverkaufen",
          "die Infrastruktur unverhältnismäßig belasten",
        ],
      },
      {
        heading: "Dienste Dritter",
        body: [
          "Resepta nutzt Meta für WhatsApp, cal.com für Kalender, Retell für Anrufe und Resend für E-Mail. Deren Bedingungen gelten auch für Sie. Ändert oder beendet einer dieser Anbieter seinen Dienst, kann die zugehörige Funktion betroffen sein.",
        ],
      },
      {
        heading: "Gebühren",
        body: [
          "Derzeit fallen keine Gebühren an. Wenn wir einen bezahlten Tarif einführen, zeigen wir Preis und Bedingungen vorher und rechnen nichts ohne Ihre Zustimmung ab.",
        ],
      },
      {
        heading: "Verfügbarkeit und Gewährleistung",
        body: [
          "Wir halten den Dienst nach Kräften am Laufen, versprechen aber keinen unterbrechungsfreien Betrieb. Wartung, ein Ausfall bei einem Anbieter oder ein Fehler können zu Ausfallzeiten führen.",
          "Der Dienst wird so bereitgestellt, wie er ist, ohne stillschweigende Zusicherung der Eignung für einen bestimmten Zweck.",
        ],
      },
      {
        heading: "Haftungsgrenze",
        body: [
          "Wir haften nicht für einen verpassten Termin, weil eine Erinnerung nicht ankam, und nicht für mittelbare Schäden oder entgangenen Gewinn. Unsere Haftung ist auf den Betrag begrenzt, den Sie in den letzten zwölf Monaten gezahlt haben.",
        ],
      },
      {
        heading: "Konto schließen",
        body: [
          "Sie können Ihr Konto jederzeit schließen. Wir können ein Konto sperren oder schließen, das gegen diese Bedingungen verstößt. Die Löschfrist nach Schließung steht in der Datenschutzerklärung.",
        ],
      },
      {
        heading: "Anwendbares Recht",
        body: [
          "Es gilt das Recht der Republik Türkei, und für Streitigkeiten sind die türkischen Gerichte zuständig.",
        ],
      },
    ],
  },
};
