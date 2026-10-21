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
// checked against convex/schema.ts, and every company against the code that
// sends data to it (the map is above PRIVACY). If you add a field that holds
// personal data, it belongs in "What we store" in all three languages; if you
// send personal data to a new company, it belongs in "Who handles data for
// us". Otherwise this document becomes false.
import type { Language } from "./i18n";

// Where a sentence names our contact address. The address itself is NOT in
// this file: it is an operator setting (/admin → Platform → Legal pages) that
// the pages read on every request (src/lib/legalContact.ts), because a
// constant here needed a deploy to change and sat empty. LegalDocument turns
// the token into a mailto link, and leaves out any paragraph or bullet holding
// it while no address is set: each such sentence asks the reader to write to
// us, and a policy must not ask for mail it gives no address for. Put the
// token only in a paragraph that can go whole, and never in a heading.
export const CONTACT_TOKEN = "{contact}";

export type LegalSection = {
  heading: string;
  body?: string[];
  bullets?: string[];
  // Paragraphs that qualify the list above them and so read after it, such
  // as where the listed companies are based.
  after?: string[];
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
export const LEGAL_UPDATED_ISO = "2026-10-21";

// Every fact below was checked against the code on 2026-10-13, not carried
// over from the previous text, and the messages section again on 2026-10-21.
// Where each one lives, for the next check:
//   - the sub-processor list: every place the backend or the browser sends
//     personal data out (convex/lib/llm.ts, waCloud.ts, email.ts,
//     emailInbound.ts, evolution.ts, retellAgent.ts, wallet.ts, the Google
//     provider in convex/auth.ts, src/lib/detectCountry.ts). A new one goes
//     on the list in the same change, in all three languages.
//   - messages: no send reads customers.consentAt since 2026-10-21, and
//     nothing writes it. Marketing (lib/marketing isMarketingKind) skips the
//     unsubscribed (isUnsubscribed): bulkRuns.skipReason, campaigns.ts,
//     wa.sendAppointmentMessage for a win-back, delivery.claimForRetry. A
//     requested callback is not marketing (bulkRuns.reachReason).
//   - deletion: customers.remove (owners, convex/customerDeletion.ts) and
//     platform.deleteOrg (the operator, purge starts at once, no restore).
//   - fees: wallet.ts, lib/foundOrg.ts (trial credit), retell.meterCall,
//     chatAgent.recordTurn, lib/usage.ts (WhatsApp template sends).
//   - open tracking: lib/email.withOpenPixel on rule, campaign and bulk mail.

export const PRIVACY: Record<Language, LegalDoc> = {
  tr: {
    title: "Gizlilik politikası",
    updated: "21 Ekim 2026",
    intro: [
      "Resepta, randevuyla çalışan işletmeler için bir yazılımdır. İşletmenin takvimini ve müşteri kayıtlarını tutar, ona bir randevu sayfası verir, müşterilerine WhatsApp ve e-postayla onay ve hatırlatma gönderir, aramaları ve WhatsApp mesajlarını yapay zekâ asistanlarıyla yanıtlar. Bu sayfa hangi verileri tuttuğumuzu, neden tuttuğumuzu ve başka kimlerin işlediğini anlatır.",
      "Burada iki ayrı rol var ve aradaki fark önemli. Resepta'yı kullanan kişilerin hesap bilgileri için veri sorumlusu biziz. Bir işletmenin müşteri kayıtları için veri sorumlusu işletmenin kendisidir; biz yalnızca onun talimatıyla veri işleyen tarafız.",
    ],
    sections: [
      {
        heading: "Hesabınız için tuttuğumuz veriler",
        body: [
          "Google ile giriş yaptığınızda Google bize adınızı, e-posta adresinizi ve profil fotoğrafınızın bağlantısını iletir. Şifrenizi hiçbir zaman görmez, saklamayız.",
          "Hangi işletmelere bağlı olduğunuzu ve her birindeki rolünüzü, dil ve görünüm tercihlerinizi ve hangi bildirim e-postalarını almak istediğinizi de tutarız. Bir işletme sahibi sizi davet ettiğinde e-posta adresinizi davetle birlikte saklar ve size bununla ilgili bir e-posta göndeririz.",
          "Bir işletme için adını, logosunu, telefon numarasını ve çalışma saatlerini, hizmetlerini ve fiyatlarını, ekip üyelerinin adlarını, asistanlarına kendisi hakkında verdiği bilgileri, bakiye yüklemelerini ve kullanımını, telefon numarası başvurusu için yüklediği belgeleri tutarız.",
          "Bu verileri hesabı yürütmek, sizi işletmenizle eşleştirmek, kullanımı ücretlendirmek ve size hizmetle ilgili bildirim göndermek için kullanırız.",
        ],
      },
      {
        heading: "İşletme adına tuttuğumuz veriler",
        body: [
          "İşletme, müşterilerine ait şu kayıtları sisteme girer veya sistem bunları hizmet sırasında oluşturur:",
        ],
        bullets: [
          "Ad, soyad, telefon numarası, varsa e-posta adresi ve tercih edilen dil",
          "Randevular ve siparişler: saat, hizmetler, ekip üyesi, durum, notlar ve verilmişse teslimat adresi",
          "İki yönlü WhatsApp mesajları ve e-postalar; fotoğraflar, sesli mesajlar ve dosyalar dahil, iletim durumlarıyla birlikte",
          "Randevuyla ilgili bir e-postanın ya da bir kampanya veya toplu e-postanın açılıp açılmadığı ve ne zaman açıldığı. Bu e-postalardaki küçük bir görsel açılmayı bildirir.",
          "Telefon asistanıyla yapılan gelen ve giden aramalar: kimin kimi ne zaman aradığı, konuşmanın dökümü, özeti ve toplanan yanıtlar. Ses kaydı telefon sağlayıcısında kalır ve oradan dinletilir.",
          "WhatsApp asistanının taslakları ve yanıtları, yaptığı ya da önerdiği değişiklikler",
          "İşletmenin tanımladığı ek alanlar, serbest notlar ve müşterilerin online randevu alırken bıraktığı notlar",
          "Müşterinin yapay zekâ araması istemediği ya da pazarlamadan çıktığı bilgisi; 21 Ekim 2026'dan önce eklenen müşterilerde mesaj izninin kaydedildiği tarih",
          "Müşterilerde ve randevularda yapılan değişikliklerin ve bunları kimin yaptığının kaydı",
        ],
      },
      {
        heading: "Kime hangi mesaj gider",
        body: [
          "Onaylar, hatırlatmalar, iptal bildirimleri ve takip mesajları müşterinin aldığı bir randevuyla ilgilidir; Resepta bunları işletmenin bütün müşterilerine gönderir. İşletme kapalıyken giden otomatik yanıt, WhatsApp asistanının cevapları ve işletme çalışanlarının yazdığı mesajlar da öyle.",
          "Kampanyalar, toplu mesajlar, toplu aramalar ve geri kazanım mesajları pazarlamadır. Pazarlama e-postasındaki bağlantıyla ya da işletmeye söyleyerek abonelikten çıkan müşteriyi Resepta bunların hepsinin dışında bırakır; WhatsApp'ta, e-postada ve telefonda aynı şekilde. Yapay zekâ araması istemeyen müşteri otomatik aramalara alınmaz. İkisi de onay ve hatırlatmaları durdurmaz.",
          "Resepta pazarlama iznini kaydetmez. Bu izni almak ve yasanın istediği yerde kaydetmek (Türkiye'de İYS'de) işletmenin sorumluluğundadır.",
        ],
      },
      {
        heading: "Verileri bizim için kimler işliyor",
        body: [
          "Hizmeti çalıştırmak için aşağıdaki şirketlerle çalışıyoruz. Her biri yalnızca kendi işi için gerekeni alır.",
        ],
        bullets: [
          "Convex: veritabanı, uygulama altyapısı ve dosya depolama",
          "Vercel: web uygulamasının barındırılması, e-postalardaki bağlantılar dahil",
          "Google: giriş",
          "Meta (WhatsApp Business Platform): WhatsApp mesajlarının gönderilmesi ve alınması",
          "Retell AI: telefon asistanının aramaları yanıtlaması ve yapması, aramaların kaydı ve dökümü",
          "Resend: e-posta gönderimi ve alımı",
          "OpenAI ve Anthropic: WhatsApp asistanının yanıtlarını yazan yapay zekâ modelleri. Kullanılan model konuşmayı, müşterinin adını ve randevularını ve yanıt için gereken işletme bilgilerini alır.",
          "Stripe: bakiye yüklemelerinde kartla ödeme. Kart bilgileri doğrudan Stripe'a gider, bize hiç ulaşmaz.",
          "GeoJS: randevu sayfasındaki ve uygulamadaki telefon alanları, alan kodunu doldurmak için ziyaretçinin hangi ülkede olduğunu IP adresinden sorar.",
        ],
        after: [
          "Bir işletme WhatsApp Business numarası yerine kendi WhatsApp telefonunu bağladığında mesajları, bu bağlantı için çalıştırdığımız bir mesajlaşma sunucusundan geçer. Mesajları yine WhatsApp taşır.",
          "Bu şirketler Türkiye dışındadır, çoğu ABD'dedir; işledikleri veriler yurt dışında işlenir.",
          "Bir işletme kendi yapay zekâ asistanını, örneğin Claude veya ChatGPT'yi, Resepta hesabına bağlayabilir. Bu asistan, işletme istediğinde işletmenin kayıtlarını okuyabilir ve değiştirebilir. Bu bağlantı işletmenin tercihidir ve işletmenin o asistanın sağlayıcısındaki kendi hesabıyla çalışır.",
        ],
      },
      {
        heading: "Verileri ne kadar süre tutuyoruz",
        body: [
          "Bir işletmenin kayıtlarını, işletme daha önce silmedikçe hesabı açık kaldığı sürece tutarız.",
          "İşletme sahibi bir müşteriyi müşterinin kaydından silebilir. Müşteri hemen her listeden kalkar, hakkında tutulan her şey de hemen ardından silinir: randevular, mesajlar, aramalar, notlar ve asistanın yanıtları. Bu geri alınamaz. Değişiklik kaydında bir müşterinin silindiğini ve kimin sildiğini gösteren bir satır kalır; müşterinin kim olduğu kalmaz.",
          "Bir hesabı, sahibi istediğinde kapatırız. Kapatmak işletmeyi ve onun için tutulan her şeyi siler. Silme hemen başlar ve geri alınamaz; kapatılan bir hesabın geri getirilebileceği bir süre yoktur.",
          "Bir hesabı kapatmak ya da kendi giriş bilgilerinizi sildirmek için {contact} adresine yazın.",
          "Yukarıdaki şirketler kendi kopyalarını kendi kurallarına göre saklar; örneğin telefon sağlayıcısındaki bir arama kaydı ya da WhatsApp'taki bir mesaj. Bir müşteriyi silmek veya bir hesabı kapatmak bu kopyaları kaldırmaz.",
        ],
      },
      {
        heading: "Haklarınız",
        body: [
          "KVKK kapsamında verilerinize erişme, bunların düzeltilmesini veya silinmesini isteme ve işlenmesine itiraz etme hakkınız var.",
          "{contact} adresine yazın, otuz gün içinde yanıtlarız.",
          "Resepta kullanan bir işletmenin müşterisiyseniz kaydınız o işletmeye aittir; talebinizi doğrudan işletmeye iletin. İşletme bilgilerinizi düzeltebilir, size yapılan yapay zekâ aramalarını ya da gönderilen pazarlama e-postalarını durdurabilir veya kaydınızı silebilir. Talebiniz bize ulaşırsa ilgili işletmeye iletiriz.",
          "Pazarlama e-postalarını kendiniz durdurmak için herhangi birinin altındaki abonelikten çıkma bağlantısını kullanın.",
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
          "Bu politikayı değiştirdiğimizde sayfanın başındaki tarihi de değiştiririz.",
        ],
      },
    ],
  },
  en: {
    title: "Privacy policy",
    updated: "21 October 2026",
    intro: [
      "Resepta is software for businesses that work by appointment. It keeps a business's calendar and customer records, gives it a booking page, sends its customers confirmations and reminders by WhatsApp and email, and answers calls and WhatsApp messages with AI assistants. This page explains what we store, why, and who else handles it.",
      "There are two roles here, and the difference matters. For the account details of the people who use Resepta, we are the data controller. For a business's customer records, the business is the controller and we are a processor acting on its instructions.",
    ],
    sections: [
      {
        heading: "What we store for your account",
        body: [
          "When you sign in with Google, Google passes us your name, email address and a link to your profile picture. We never see or store a password.",
          "We also keep which businesses you belong to and your role in each, your language and display settings, and which notification emails you want. When an owner invites you, we keep your email address with the invitation and email you about it.",
          "For a business we keep its name, logo, phone number and opening hours, its services and prices, the names of its team members, what it tells its assistants about itself, its balance top-ups and usage, and any document it uploads to apply for a phone number.",
          "We use this to run the account, connect you to your business, charge for use and send you notices about the service.",
        ],
      },
      {
        heading: "What we store on behalf of a business",
        body: [
          "A business enters the following about its customers, or the service creates it while doing its job:",
        ],
        bullets: [
          "Name, phone number, email address where given, and preferred language",
          "Appointments and orders: time, services, team member, status, notes, and a delivery address where one is given",
          "WhatsApp messages and emails in both directions, including photos, voice messages and files, with their delivery status",
          "Whether and when an email about an appointment, or a campaign or bulk email, was opened. These emails contain a small image that reports the open.",
          "Calls with the phone agent in both directions: who called whom and when, a transcript, a summary and the answers collected. The recording stays with the voice provider and plays from there.",
          "The WhatsApp assistant's drafts and replies, and the changes it made or proposed",
          "Fields the business defines, free-text notes, and notes customers leave when they book online",
          "Whether the customer asked for no AI calls or unsubscribed from marketing, and, for customers added before 21 October 2026, the date consent to messages was recorded",
          "A record of changes to customers and appointments, and who made them",
        ],
      },
      {
        heading: "Who gets which messages",
        body: [
          "Confirmations, reminders, cancellation notices and follow-ups are about a booking the customer made, and Resepta sends them to every customer of the business. So do the automatic reply sent while the business is closed, the WhatsApp assistant's answers, and the messages the business's staff write.",
          "Campaigns, bulk messages, bulk calls and win-back messages are marketing. Resepta leaves out every customer who unsubscribed, by the link in a marketing email or by asking the business, on WhatsApp, by email and by phone alike. A customer who asked for no AI calls is left out of automated calls. Neither stops their confirmations or reminders.",
          "Resepta does not record marketing consent. Collecting it, and recording it where the law asks for it (in Türkiye, in the İYS register), is the business's responsibility.",
        ],
      },
      {
        heading: "Who handles data for us",
        body: [
          "We use these companies to run the service. Each gets only what its own job needs.",
        ],
        bullets: [
          "Convex: database, application backend and file storage",
          "Vercel: hosting for the web app, including the links in emails",
          "Google: sign-in",
          "Meta (WhatsApp Business Platform): sending and receiving WhatsApp messages",
          "Retell AI: answering and placing the phone agent's calls, and recording and transcribing them",
          "Resend: sending and receiving email",
          "OpenAI and Anthropic: the AI models that write the WhatsApp assistant's replies. The one in use receives the conversation, the customer's name and appointments, and the business details the assistant needs to answer.",
          "Stripe: card payments for balance top-ups. Card details go to Stripe directly and never reach us.",
          "GeoJS: phone number fields on the booking page and in the app ask it which country the visitor is in, from their IP address, to fill in the dialling code.",
        ],
        after: [
          "When a business links its own WhatsApp phone instead of a WhatsApp Business number, its messages pass through a messaging server we run for that connection. WhatsApp still carries them.",
          "These companies are based outside Türkiye, most of them in the United States, so the data they handle is processed abroad.",
          "A business can also connect an AI assistant of its own, such as Claude or ChatGPT, to its Resepta account. That assistant can then read and change the business's records when the business asks it to. The connection is the business's choice and runs under its own account with that assistant's provider.",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "We keep a business's records while its account is open, unless the business deletes them sooner.",
          "An owner can delete a customer from the customer's record. The customer leaves every list at once, and everything held on them is erased right after: appointments, messages, calls, notes and the assistant's replies. This cannot be undone. The record of changes keeps a line saying that a customer was deleted and by whom, never who the customer was.",
          "We close an account when its owner asks us to. Closing it deletes the business and everything stored for it. Deletion starts at once and cannot be undone: there is no period in which a closed account can be brought back.",
          "To close an account, or to have your own sign-in details deleted, write to us at {contact}.",
          "The companies listed above keep their own copies under their own rules, such as a call recording at the voice provider or a message at WhatsApp. Deleting a customer or closing an account does not remove those copies.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "You can ask to see your data, have it corrected or deleted, and object to how it is processed.",
          "Write to us at {contact} and we will answer within thirty days.",
          "If you are a customer of a business that uses Resepta, your record belongs to that business, so ask the business directly. It can correct your details, stop AI calls or marketing email to you, or delete your record. If your request reaches us, we pass it on to the business.",
          "To stop marketing emails yourself, use the unsubscribe link at the bottom of any of them.",
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
        body: ["When we change this policy, we change the date at the top of this page."],
      },
    ],
  },
  de: {
    title: "Datenschutzerklärung",
    updated: "21. Oktober 2026",
    intro: [
      "Resepta ist eine Software für Betriebe, die mit Terminen arbeiten. Sie führt den Kalender und die Kundendaten eines Betriebs, stellt ihm eine Buchungsseite bereit, schickt seinen Kunden Bestätigungen und Erinnerungen per WhatsApp und E-Mail und beantwortet Anrufe und WhatsApp-Nachrichten mit KI-Assistenten. Diese Seite erklärt, welche Daten wir speichern, warum, und wer sie noch verarbeitet.",
      "Es gibt hier zwei Rollen, und der Unterschied ist wichtig. Für die Kontodaten der Menschen, die Resepta nutzen, sind wir Verantwortlicher. Für die Kundendaten eines Betriebs ist der Betrieb der Verantwortliche, und wir sind Auftragsverarbeiter nach seinen Weisungen.",
    ],
    sections: [
      {
        heading: "Was wir für Ihr Konto speichern",
        body: [
          "Wenn Sie sich mit Google anmelden, übermittelt Google uns Ihren Namen, Ihre E-Mail-Adresse und einen Link zu Ihrem Profilbild. Ein Passwort sehen und speichern wir nie.",
          "Außerdem speichern wir, zu welchen Betrieben Sie gehören und mit welcher Rolle, Ihre Sprach- und Anzeigeeinstellungen und welche Benachrichtigungen per E-Mail Sie erhalten möchten. Lädt ein Inhaber Sie ein, speichern wir Ihre E-Mail-Adresse mit der Einladung und schreiben Ihnen dazu eine E-Mail.",
          "Für einen Betrieb speichern wir Name, Logo, Telefonnummer und Öffnungszeiten, seine Leistungen und Preise, die Namen der Teammitglieder, was er seinen Assistenten über sich mitteilt, Guthabenaufladungen und Nutzung sowie Unterlagen, die er für die Beantragung einer Telefonnummer hochlädt.",
          "Wir nutzen diese Daten, um das Konto zu führen, Sie Ihrem Betrieb zuzuordnen, die Nutzung abzurechnen und Ihnen Mitteilungen zum Dienst zu senden.",
        ],
      },
      {
        heading: "Was wir im Auftrag eines Betriebs speichern",
        body: [
          "Ein Betrieb erfasst die folgenden Daten über seine Kunden, oder der Dienst erzeugt sie bei seiner Arbeit:",
        ],
        bullets: [
          "Name, Telefonnummer, E-Mail-Adresse sofern angegeben, und bevorzugte Sprache",
          "Termine und Bestellungen: Uhrzeit, Leistungen, Teammitglied, Status, Notizen und, falls angegeben, eine Lieferadresse",
          "WhatsApp-Nachrichten und E-Mails in beide Richtungen, auch Fotos, Sprachnachrichten und Dateien, samt Zustellstatus",
          "Ob und wann eine E-Mail zu einem Termin oder eine Kampagnen- oder Sammel-E-Mail geöffnet wurde. Diese E-Mails enthalten ein kleines Bild, das das Öffnen meldet.",
          "Anrufe mit dem Telefonassistenten in beide Richtungen: wer wen wann angerufen hat, ein Transkript, eine Zusammenfassung und die erfassten Antworten. Die Aufnahme bleibt beim Telefonie-Anbieter und wird von dort abgespielt.",
          "Entwürfe und Antworten des WhatsApp-Assistenten und die Änderungen, die er vorgenommen oder vorgeschlagen hat",
          "Eigene Felder des Betriebs, freie Notizen und Notizen, die Kunden bei der Online-Buchung hinterlassen",
          "Ob der Kunde keine KI-Anrufe möchte oder Werbung abbestellt hat, und bei Kunden, die vor dem 21. Oktober 2026 angelegt wurden, das Datum, an dem die Einwilligung in Nachrichten erfasst wurde",
          "Ein Protokoll der Änderungen an Kunden und Terminen und wer sie vorgenommen hat",
        ],
      },
      {
        heading: "Wer welche Nachrichten bekommt",
        body: [
          "Bestätigungen, Erinnerungen, Stornohinweise und Nachfassnachrichten betreffen eine Buchung des Kunden, und Resepta schickt sie an alle Kunden des Betriebs. Das gilt auch für die automatische Antwort, während der Betrieb geschlossen ist, für die Antworten des WhatsApp-Assistenten und für Nachrichten, die das Personal des Betriebs schreibt.",
          "Kampagnen, Sammelnachrichten, Sammelanrufe und Rückgewinnungsnachrichten sind Werbung. Resepta lässt jeden Kunden aus, der sich abgemeldet hat, über den Link in einer Werbe-E-Mail oder beim Betrieb selbst, per WhatsApp, E-Mail und Telefon gleichermaßen. Wer keine KI-Anrufe möchte, wird bei automatischen Anrufen übersprungen. Bestätigungen und Erinnerungen laufen in beiden Fällen weiter.",
          "Resepta erfasst keine Werbeeinwilligung. Sie einzuholen und dort festzuhalten, wo das Gesetz es verlangt (in der Türkei im İYS-Register), ist Sache des Betriebs.",
        ],
      },
      {
        heading: "Wer Daten für uns verarbeitet",
        body: [
          "Für den Betrieb des Dienstes arbeiten wir mit diesen Unternehmen. Jedes erhält nur, was seine Aufgabe erfordert.",
        ],
        bullets: [
          "Convex: Datenbank, Anwendungsbackend und Dateispeicher",
          "Vercel: Hosting der Web-App, einschließlich der Links in E-Mails",
          "Google: Anmeldung",
          "Meta (WhatsApp Business Platform): Senden und Empfangen von WhatsApp-Nachrichten",
          "Retell AI: Annehmen und Tätigen der Anrufe des Telefonassistenten, Aufnahme und Transkription",
          "Resend: Senden und Empfangen von E-Mails",
          "OpenAI und Anthropic: die KI-Modelle, die die Antworten des WhatsApp-Assistenten schreiben. Das jeweils genutzte Modell erhält das Gespräch, Name und Termine des Kunden und die Angaben zum Betrieb, die es für die Antwort braucht.",
          "Stripe: Kartenzahlung beim Aufladen des Guthabens. Kartendaten gehen direkt an Stripe und erreichen uns nie.",
          "GeoJS: Telefonnummernfelder auf der Buchungsseite und in der App fragen dort anhand der IP-Adresse ab, in welchem Land sich jemand befindet, und füllen damit die Vorwahl aus.",
        ],
        after: [
          "Verbindet ein Betrieb statt einer WhatsApp-Business-Nummer sein eigenes WhatsApp-Telefon, laufen seine Nachrichten über einen Nachrichtenserver, den wir für diese Verbindung betreiben. Zugestellt werden sie weiterhin über WhatsApp.",
          "Diese Unternehmen haben ihren Sitz außerhalb der Türkei, die meisten in den USA; die Daten, die sie verarbeiten, werden also im Ausland verarbeitet.",
          "Ein Betrieb kann auch einen eigenen KI-Assistenten, etwa Claude oder ChatGPT, mit seinem Resepta-Konto verbinden. Dieser Assistent kann dann die Daten des Betriebs lesen und ändern, wenn der Betrieb ihn darum bittet. Die Verbindung ist die Entscheidung des Betriebs und läuft über sein eigenes Konto beim Anbieter des Assistenten.",
        ],
      },
      {
        heading: "Wie lange wir Daten aufbewahren",
        body: [
          "Wir bewahren die Daten eines Betriebs auf, solange sein Konto besteht, sofern der Betrieb sie nicht vorher löscht.",
          "Ein Inhaber kann einen Kunden in dessen Datensatz löschen. Der Kunde verschwindet sofort aus allen Listen, und alles, was über ihn gespeichert ist, wird gleich danach gelöscht: Termine, Nachrichten, Anrufe, Notizen und die Antworten des Assistenten. Das lässt sich nicht rückgängig machen. Im Änderungsprotokoll bleibt eine Zeile, dass und von wem ein Kunde gelöscht wurde, aber nie, wer der Kunde war.",
          "Ein Konto schließen wir, wenn sein Inhaber uns darum bittet. Dabei werden der Betrieb und alles, was für ihn gespeichert ist, gelöscht. Die Löschung beginnt sofort und lässt sich nicht rückgängig machen; eine Frist, in der ein geschlossenes Konto wiederhergestellt werden könnte, gibt es nicht.",
          "Um ein Konto zu schließen oder Ihre eigenen Anmeldedaten löschen zu lassen, schreiben Sie uns an {contact}.",
          "Die oben genannten Unternehmen bewahren eigene Kopien nach ihren eigenen Regeln auf, etwa eine Anrufaufnahme beim Telefonie-Anbieter oder eine Nachricht bei WhatsApp. Das Löschen eines Kunden oder das Schließen eines Kontos entfernt diese Kopien nicht.",
        ],
      },
      {
        heading: "Ihre Rechte",
        body: [
          "Sie können Auskunft über Ihre Daten verlangen, sie berichtigen oder löschen lassen und der Verarbeitung widersprechen.",
          "Schreiben Sie uns an {contact}; wir antworten innerhalb von dreißig Tagen.",
          "Wenn Sie Kunde eines Betriebs sind, der Resepta nutzt, gehört Ihr Datensatz diesem Betrieb; wenden Sie sich direkt an ihn. Er kann Ihre Angaben berichtigen, KI-Anrufe oder Werbe-E-Mails an Sie stoppen oder Ihren Datensatz löschen. Erreicht uns Ihre Anfrage, leiten wir sie an den Betrieb weiter.",
          "Werbe-E-Mails können Sie selbst über den Abmeldelink am Ende jeder dieser E-Mails abbestellen.",
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
          "Wenn wir diese Erklärung ändern, ändern wir auch das Datum oben auf dieser Seite.",
        ],
      },
    ],
  },
};

export const TERMS: Record<Language, LegalDoc> = {
  tr: {
    title: "Kullanım koşulları",
    updated: "21 Ekim 2026",
    intro: [
      "Resepta'yı kullanarak bu koşulları kabul etmiş olursunuz. Kısa tutmaya çalıştık.",
    ],
    sections: [
      {
        heading: "Hizmet ne yapar",
        body: [
          "Resepta, işletmenizin randevularını ve müşteri kayıtlarını tek yerde toplar ve müşterilerinizin kendi kullanabileceği bir randevu sayfası verir. Müşterilerinize WhatsApp ve e-postayla onay, hatırlatma ve başka mesajlar gönderir; yapay zekâ asistanları sizin adınıza aramaları yanıtlayabilir, arama yapabilir ve WhatsApp mesajlarına cevap verebilir.",
        ],
      },
      {
        heading: "Hesap",
        body: [
          "Google hesabınızla giriş yaparsınız; ilk işletmeniz ilk girişinizde oluşturulur. Ekibinizi e-postayla davet edebilirsiniz. Hesabınızla yapılan her işlemden siz sorumlusunuz.",
          "On sekiz yaşından küçükseniz veya bir işletme adına sözleşme yapma yetkiniz yoksa bu hizmeti kullanamazsınız.",
        ],
      },
      {
        heading: "Müşteri verileriyle ilgili sorumluluğunuz",
        body: [
          "Sisteme girdiğiniz müşteri kayıtlarından ve Resepta'nın sizin talimatınızla müşterilerinize gönderdiklerinden ve söylediklerinden siz sorumlusunuz. Şunları taahhüt edersiniz:",
        ],
        bullets: [
          "Mesaj gönderdiğiniz veya aradığınız her müşteri için gerekli izni almış olmak",
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
        heading: "Diğer şirketlerin hizmetleri",
        body: [
          "Resepta hizmetin bazı bölümleri için başka şirketlere dayanır; WhatsApp, telefon aramaları, e-posta, yapay zekâ modelleri ve kartla ödeme bunlardan bazılarıdır. Gizlilik politikası bu şirketlerin adlarını verir. Biri hizmetini değiştirir veya keserse ona bağlı özellik etkilenebilir.",
        ],
      },
      {
        heading: "Ücretler",
        body: [
          "Resepta kullanıma göre ücretlendirilir. Telefon asistanıyla yapılan aramalar dakika başına fiyatlanır ve saniye bazında faturalanır, WhatsApp asistanının gönderdiği her yanıtın belirli bir fiyatı vardır, WhatsApp Business numarasından gönderilen şablon mesajlar ise alıcının ülkesine göre mesaj başına ücretlendirilir. Kullanımınızı ve dakika ile yanıt başına ödediğiniz tutarı Faturalama sayfası gösterir.",
          "Ödeme iki şekilde olur. Ön ödemeli bakiyede kullanım bakiyeden düşer: yeni bir hesabın ilk işletmesi deneme kredisiyle başlayabilir, sonrasında bakiyeyi kartla yüklersiniz. Kartınızdan yalnızca sizin başlattığınız bir yüklemede ödeme alınır. Bakiye bittiğinde siz yükleme yapana kadar telefon asistanı yeni aramaları yanıtlamaz ve toplu gönderim başlatılamaz.",
          "Sizinle faturayla çalışmayı kararlaştırdıysak kullanımınız bunun yerine faturayla ücretlendirilir.",
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
          "Bir hesabı, sahibi istediğinde kapatırız. Kapatmak, gizlilik politikasında anlatıldığı gibi işletmeyi ve onun için tutulan her şeyi siler. Silme hemen başlar ve geri alınamaz.",
          "Bunun için {contact} adresine yazın.",
          "Bu koşulları ihlal eden bir hesabı askıya alabilir veya kapatabiliriz.",
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
    updated: "21 October 2026",
    intro: ["By using Resepta you agree to these terms. We have kept them short."],
    sections: [
      {
        heading: "What the service does",
        body: [
          "Resepta keeps your appointments and customer records in one place and gives you a booking page your customers can use themselves. It sends your customers confirmations, reminders and other messages by WhatsApp and email, and its AI assistants can answer and place phone calls and answer WhatsApp messages for you.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You sign in with a Google account, and your first business is created when you first sign in. You can invite your team by email. You are responsible for everything done through your account.",
          "You may not use the service if you are under eighteen or lack authority to enter an agreement for the business you are signing up.",
        ],
      },
      {
        heading: "Your responsibility for customer data",
        body: [
          "You are responsible for the customer records you put into the system, and for what Resepta sends and says to your customers on your instructions. You confirm that you will:",
        ],
        bullets: [
          "Have the consent you need for every customer you message or call",
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
        heading: "Other companies' services",
        body: [
          "Resepta relies on other companies for parts of the service, among them WhatsApp, phone calls, email, AI models and card payments. The privacy policy names them. If one of them changes or withdraws its service, the feature that depends on it can be affected.",
        ],
      },
      {
        heading: "Fees",
        body: [
          "Resepta charges for use. Calls with the phone agent are priced per minute and billed by the second, each reply the WhatsApp assistant sends has a set price, and WhatsApp template messages sent from a WhatsApp Business number are charged per message, at a rate that depends on the recipient's country. The Billing page shows your usage and what you pay per minute and per reply.",
          "You pay in one of two ways. With a prepaid balance, use is taken from the balance: the first business on a new account can start with a trial credit, and after that you top up by card. Your card is charged only when you start a top-up yourself. When the balance runs out, the phone agent stops answering new calls and bulk sends cannot be started until you top up.",
          "If we have agreed to invoice your business, your use is billed by invoice instead.",
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
          "We close an account when its owner asks us to. Closing it deletes the business and everything stored for it, as the privacy policy describes. Deletion starts at once and cannot be undone.",
          "To ask, write to us at {contact}.",
          "We may suspend or close an account that breaks these terms.",
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
    updated: "21. Oktober 2026",
    intro: [
      "Mit der Nutzung von Resepta stimmen Sie diesen Bedingungen zu. Wir haben sie kurz gehalten.",
    ],
    sections: [
      {
        heading: "Was der Dienst leistet",
        body: [
          "Resepta bündelt die Termine und Kundendaten Ihres Betriebs an einer Stelle und stellt eine Buchungsseite bereit, über die Ihre Kunden selbst buchen können. Der Dienst schickt Ihren Kunden Bestätigungen, Erinnerungen und andere Nachrichten per WhatsApp und E-Mail, und seine KI-Assistenten können für Sie Anrufe annehmen und tätigen und WhatsApp-Nachrichten beantworten.",
        ],
      },
      {
        heading: "Ihr Konto",
        body: [
          "Sie melden sich mit einem Google-Konto an, und Ihr erster Betrieb wird bei der ersten Anmeldung angelegt. Ihr Team können Sie per E-Mail einladen. Für alles, was über Ihr Konto geschieht, sind Sie verantwortlich.",
          "Sie dürfen den Dienst nicht nutzen, wenn Sie unter achtzehn sind oder nicht berechtigt sind, für den angemeldeten Betrieb einen Vertrag zu schließen.",
        ],
      },
      {
        heading: "Ihre Verantwortung für Kundendaten",
        body: [
          "Für die Kundendaten, die Sie erfassen, und für das, was Resepta in Ihrem Auftrag an Ihre Kunden schickt und ihnen sagt, sind Sie verantwortlich. Sie bestätigen, dass Sie:",
        ],
        bullets: [
          "für jeden Kunden, dem Sie schreiben oder den Sie anrufen, die nötige Einwilligung haben",
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
        heading: "Dienste anderer Unternehmen",
        body: [
          "Resepta stützt sich für Teile des Dienstes auf andere Unternehmen, unter anderem für WhatsApp, Anrufe, E-Mail, KI-Modelle und Kartenzahlung. Die Datenschutzerklärung nennt sie. Ändert oder beendet eines davon seinen Dienst, kann die Funktion betroffen sein, die darauf beruht.",
        ],
      },
      {
        heading: "Gebühren",
        body: [
          "Resepta wird nach Nutzung berechnet. Anrufe mit dem Telefonassistenten kosten pro Minute und werden sekundengenau abgerechnet, jede Antwort, die der WhatsApp-Assistent schickt, hat einen festen Preis, und WhatsApp-Vorlagennachrichten von einer WhatsApp-Business-Nummer kosten pro Nachricht, je nach Land des Empfängers. Ihre Nutzung und die Preise pro Minute und pro Antwort zeigt die Seite Abrechnung.",
          "Bezahlt wird auf eine von zwei Arten. Bei einem Guthaben wird die Nutzung davon abgezogen: Der erste Betrieb eines neuen Kontos kann mit einem Startguthaben beginnen, danach laden Sie per Karte auf. Ihre Karte wird nur belastet, wenn Sie selbst eine Aufladung starten. Ist das Guthaben aufgebraucht, nimmt der Telefonassistent keine neuen Anrufe an, und Sammelversände lassen sich erst nach einer Aufladung wieder starten.",
          "Haben wir mit Ihnen eine Abrechnung per Rechnung vereinbart, wird Ihre Nutzung stattdessen in Rechnung gestellt.",
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
          "Ein Konto schließen wir, wenn sein Inhaber uns darum bittet. Dabei werden der Betrieb und alles, was für ihn gespeichert ist, gelöscht, wie in der Datenschutzerklärung beschrieben. Die Löschung beginnt sofort und lässt sich nicht rückgängig machen.",
          "Schreiben Sie uns dazu an {contact}.",
          "Wir können ein Konto sperren oder schließen, das gegen diese Bedingungen verstößt.",
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
