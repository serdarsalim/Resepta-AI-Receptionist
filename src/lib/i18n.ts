// UI translations. A typed dictionary, deliberately not next-intl: this is a
// logged-in app with no locale-prefixed routes and no SEO surface, so the
// routing/SEO machinery would be dead weight. Adding a language = adding a
// column here. If a PUBLIC booking page ever ships, that page can adopt
// next-intl on its own without touching this.
//
// The active language comes from the signed-in org (orgs.language); the
// sign-in screen reads a browser/localStorage preference since no org exists
// yet.
//
// House rules for the German column, so nobody has to re-derive them:
// - Sie throughout, never du. This is software a business pays for.
// - The business is a "Betrieb", never an "Arbeitsbereich". A Friseur, a
//   Kfz-Werkstatt and a Zahnarztpraxis all call themselves a Betrieb;
//   "Unternehmen" reads like somewhere with a legal department.
// - A bookable item is a "Leistung", not a "Dienstleistung". German booking
//   products say Leistungen, and the short word is the one that fits a
//   column header.
// - KVKK is Turkish law and means nothing in Germany, so the German column
//   says DSGVO. English keeps KVKK: the English UI serves the Turkish
//   market, not a German one.
//
// Values and plurals (2026-10-13, ported from what Nudge's ICU messages do):
// - A string names its values in braces, "Goes to {n} people", and the caller
//   passes them: t("bulk.counts", { done, total, failed, skipped }). The names
//   are read off this file's own literal types, so a missing or misspelled
//   value is a compile error, the same as a missing key or language.
// - A count that changes the words gets a PAIR of keys, `<base>.one` and
//   `<base>.other`, and t.plural("<base>", count) picks one by the language's
//   own plural rule and fills {n} with the count. Turkish keeps the noun
//   singular after a number ("3 kişi"), so its two strings are usually the
//   same; they are written out anyway, because a sentence around the count
//   can still change ("Telefon çalar" for one, "Telefonlar çalar" for many).

export const LANGUAGES = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: Language = "tr";
export const LANGUAGE_STORAGE_KEY = "randevu.lang";

const dictionary = {
  "app.name": { tr: "Resepta", en: "Resepta", de: "Resepta" },
  // Matches the browser title's positioning (lib/brand.ts DEFAULT_TITLE) —
  // it read "WhatsApp appointment reminders" long after the product became
  // the front desk.
  "app.tagline": {
    tr: "Randevulu işletmeler için yapay zekâ resepsiyon",
    en: "The AI front desk for appointment businesses",
    de: "Der KI-Empfang für Terminbetriebe",
  },

  "menu.appearance": { tr: "Görünüm", en: "Appearance", de: "Darstellung" },
  "menu.helpCenter": {
    tr: "Yardım merkezi",
    en: "Help center",
    de: "Hilfe-Center",
  },
  "menu.account": {
    tr: "Hesap menüsü",
    en: "Account menu",
    de: "Kontomenü",
  },
  "theme.light": { tr: "Açık", en: "Light", de: "Hell" },
  "theme.dark": { tr: "Koyu", en: "Dark", de: "Dunkel" },
  "theme.auto": { tr: "Otomatik", en: "Auto", de: "Automatisch" },

  "nav.today": { tr: "Bugün", en: "Today", de: "Heute" },
  // "Takvim"/"Calendar", not "Randevular": the destination is the calendar and
  // three of its four views are a grid. The thing you CREATE there is still a
  // randevu, so the button stays "Yeni randevu" — the place and the object do
  // not have to share a name.
  "nav.appointments": { tr: "Takvim", en: "Calendar", de: "Kalender" },
  "nav.customers": { tr: "Müşteriler", en: "Customers", de: "Kunden" },
  "nav.inbox": { tr: "Gelen Kutusu", en: "Inbox", de: "Posteingang" },
  "nav.collapse": {
    tr: "Menüyü daralt",
    en: "Collapse sidebar",
    de: "Menü einklappen",
  },
  "nav.expand": {
    tr: "Menüyü genişlet",
    en: "Expand sidebar",
    de: "Menü ausklappen",
  },
  // "Business", not "Workspace": Fresha, Booksy, Square and Treatwell all use
  // the business's own word for this, and a salon owner does not think of the
  // salon as a workspace.
  "nav.business": { tr: "İşletme", en: "Business", de: "Betrieb" },
  "nav.settings": { tr: "Ayarlar", en: "Settings", de: "Einstellungen" },
  "nav.menu": { tr: "Menü", en: "Menu", de: "Menü" },
  "nav.closeMenu": {
    tr: "Menüyü kapat",
    en: "Close menu",
    de: "Menü schließen",
  },
  "nav.primary": {
    tr: "Ana gezinme",
    en: "Main navigation",
    de: "Hauptnavigation",
  },
  "nav.account": { tr: "Hesabım", en: "My account", de: "Mein Konto" },

  // The avatar menu is the USER's menu: their name, their alerts, their
  // theme. It never routes into the business config, which lives in the
  // sidebar.
  "account.title": { tr: "Hesabım", en: "My account", de: "Mein Konto" },
  "account.name": { tr: "Adınız", en: "Your name", de: "Ihr Name" },
  "account.nameHint": {
    tr: "Ekip listesinde ve gönderdiğiniz notlarda görünen ad.",
    en: "The name your team sees in the members list and on anything you send.",
    de: "Diesen Namen sieht Ihr Team in der Mitgliederliste und bei allem, was Sie versenden.",
  },
  "account.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  "account.emailHint": {
    tr: "Google hesabınızdan gelir ve burada değiştirilemez.",
    en: "Comes from your Google account and cannot be changed here.",
    de: "Kommt aus Ihrem Google-Konto und lässt sich hier nicht ändern.",
  },
  // The card title carries "email" ONCE; the row labels are bare events so
  // four rows don't each re-explain the delivery channel. The hints still
  // spell out what actually arrives.
  "account.notifications": {
    tr: "E-posta bildirimleri",
    en: "Email notifications",
    de: "E-Mail-Benachrichtigungen",
  },
  "account.notifyInbound": {
    tr: "Müşteri yanıtı",
    en: "Customer replies",
    de: "Kundenantwort",
  },
  "account.notifyInboundHint": {
    tr: "Bir müşteri WhatsApp'tan yazdığında e-posta adresinize haber verilir. Her mesaj için bir e-posta.",
    en: "You get an email at your account address when a customer writes on WhatsApp. One email per message.",
    de: "Sie bekommen eine E-Mail an Ihre Kontoadresse, sobald ein Kunde über WhatsApp schreibt. Eine E-Mail pro Nachricht.",
  },
  "account.notifyFailed": {
    tr: "Gönderilemeyen mesaj",
    en: "Failed message",
    de: "Fehlgeschlagene Nachricht",
  },
  "account.notifyFailedHint": {
    tr: "Hatırlatma veya onay mesajı gönderilemediğinde haber verilir. İşletmenin sessizce mesajsız kalmaması için açık tutun.",
    en: "Tells you when a reminder or confirmation could not be delivered, so your business never goes quiet without anyone noticing.",
    de: "Meldet, wenn eine Erinnerung oder Bestätigung nicht zugestellt werden konnte. So merken Sie es, bevor ein Kunde ohne Nachricht dasteht.",
  },
  "account.notifyNewContact": {
    tr: "Yeni kişi",
    en: "New contact",
    de: "Neuer Kontakt",
  },
  // The second sentence is the one that matters: without it the switch reads
  // as "email me every time I type a customer in", which nobody wants and
  // which is not what it does.
  "account.notifyNewContactHint": {
    tr: "Sesli asistan, talep formu, WhatsApp veya cal.com üzerinden yeni bir kişi eklendiğinde haber verilir. Ekipten biri kişiyi kendi eklediğinde e-posta gönderilmez.",
    en: "Tells you when someone new arrives through the voice agent, your request form, WhatsApp or cal.com. Contacts you or your team type in yourselves never send an email.",
    de: "Meldet neue Kontakte über den Sprachagenten, Ihr Anfrageformular, WhatsApp oder cal.com. Von Ihnen oder Ihrem Team selbst angelegte Kontakte lösen keine E-Mail aus.",
  },
  "account.notifyNewBooking": {
    tr: "Yeni randevu",
    en: "New booking",
    de: "Neue Buchung",
  },
  "account.notifyCancelledBooking": {
    tr: "Randevu iptali",
    en: "Booking cancelled",
    de: "Stornierte Buchung",
  },
  // The second sentence is the switch's whole personality: your own cancels
  // never email you, so the toggle only ever carries news.
  "account.notifyCancelledBookingHint": {
    tr: "Müşteri randevusunu iptal ettiğinde (WhatsApp, telefon asistanı, randevu bağlantısı veya cal.com üzerinden) e-posta gelir; ekteki dosya kaydı takviminizden kaldırır. Sizin veya ekibinizin uygulama içinden yaptığı iptaller e-posta göndermez.",
    en: "You get an email when a customer cancels their booking (via WhatsApp, the voice agent, their booking link or cal.com); the attachment removes it from your calendar. Cancellations you or your team make in the app never send one.",
    de: "Sie bekommen eine E-Mail, wenn ein Kunde seinen Termin absagt (über WhatsApp, den Sprachagenten, den Buchungslink oder cal.com); der Anhang entfernt ihn aus Ihrem Kalender. Absagen, die Sie oder Ihr Team in der App vornehmen, lösen keine E-Mail aus.",
  },
  // The calendar invite is the point of this switch, so the hint leads with
  // it — without that sentence it reads as one more notification, not as
  // "your Google Calendar fills itself in".
  "account.notifyNewBookingHint": {
    tr: "Randevu sayfası, sesli asistan veya sohbet üzerinden randevu alındığında e-posta gelir. Ekteki takvim daveti randevuyu kendi takviminize ekler; iptal edilirse kaldırır. Elle girdiğiniz randevular e-posta göndermez.",
    en: "You get an email when a booking arrives through the booking page, the voice agent or chat. Its calendar invite adds the appointment to your own calendar and removes it again if it is cancelled. Bookings you type in yourself never send one.",
    de: "Sie bekommen eine E-Mail, wenn ein Termin über die Buchungsseite, den Sprachagenten oder den Chat eingeht. Die Kalendereinladung trägt ihn in Ihren eigenen Kalender ein und entfernt ihn bei Stornierung wieder. Selbst eingetragene Termine lösen keine E-Mail aus.",
  },
  "account.role": { tr: "Rolünüz", en: "Your role", de: "Ihre Rolle" },
  "account.language": {
    tr: "Uygulama dili",
    en: "App language",
    de: "App-Sprache",
  },
  // Says the thing an owner will otherwise fear: changing this does not change
  // what customers receive.
  "account.languageHint": {
    tr: "Uygulamayı yalnızca sizin için bu dilde gösterir. Müşterilere gönderilen mesajların dilini değiştirmez — onu İşletme > Genel altındaki mesaj dili belirler.",
    en: "Shows the app in this language for you only. It does not change the language customers are messaged in — that is the message language under Business > General.",
    de: "Zeigt die App nur für Sie in dieser Sprache. Die Sprache der Kundennachrichten ändert sich dadurch nicht — die steht unter Betrieb > Allgemein.",
  },
  "nav.signOut": { tr: "Çıkış", en: "Sign out", de: "Abmelden" },

  "auth.continueWithGoogle": {
    tr: "Google ile devam et",
    en: "Continue with Google",
    de: "Weiter mit Google",
  },
  "auth.googleHint": {
    tr: "İlk girişte işletmeniz otomatik oluşturulur.",
    en: "Your business is created on first sign-in.",
    de: "Ihr Betrieb wird bei der ersten Anmeldung angelegt.",
  },
  "auth.failed": {
    tr: "Giriş başarısız. Tekrar deneyin.",
    en: "Sign-in failed. Try again.",
    de: "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
  },

  "join.title": {
    tr: "Ekibe katılın",
    en: "Join the team",
    de: "Zum Team hinzufügen",
  },
  "join.prompt": {
    tr: "Davetinizi kabul etmek için Google ile giriş yapın. Davet edildiğiniz e-posta adresini kullanın.",
    en: "Sign in with Google to accept your invitation. Use the address it was sent to.",
    de: "Melden Sie sich mit Google an, um die Einladung anzunehmen. Nutzen Sie die Adresse, an die sie ging.",
  },
  "join.working": {
    tr: "Davet kontrol ediliyor…",
    en: "Checking your invitation…",
    de: "Einladung wird geprüft…",
  },
  "join.welcome": {
    tr: "Katıldınız:",
    en: "You've joined",
    de: "Sie sind dabei:",
  },
  "join.open": {
    tr: "Açın",
    en: "Open it",
    de: "Öffnen",
  },
  // One line per way this can fail, because "invalid invite" makes the reader
  // guess which of four different things to do about it.
  "join.notFound": {
    tr: "Bu davet bağlantısı geçerli değil. Sizi davet eden kişiden yenisini isteyin.",
    en: "This invitation link isn't valid. Ask whoever invited you for a new one.",
    de: "Dieser Einladungslink ist ungültig. Bitten Sie um einen neuen.",
  },
  "join.alreadyAccepted": {
    tr: "Bu davet zaten kullanılmış. Zaten üyesiniz — giriş yapın.",
    en: "This invitation was already used. You're already a member — just sign in.",
    de: "Diese Einladung wurde bereits genutzt. Sie sind schon Mitglied — melden Sie sich an.",
  },
  "join.expired": {
    tr: "Bu davetin süresi doldu. Sizi davet eden kişiden yenisini isteyin.",
    en: "This invitation has expired. Ask whoever invited you for a new one.",
    de: "Diese Einladung ist abgelaufen. Bitten Sie um eine neue.",
  },
  "join.wrongAccount": {
    tr: "Bu davet başka bir e-posta adresine gönderildi. Davetin gittiği adresle giriş yapın.",
    en: "This invitation was sent to a different address. Sign in with the one it went to.",
    de: "Diese Einladung ging an eine andere Adresse. Melden Sie sich mit dieser an.",
  },

  // The step's QUESTION is the card's heading — "Welcome!" died 2026-08-21:
  // a greeting that says nothing while the real question sat demoted in the
  // subtext line.
  "onboarding.nameTitle": {
    tr: "İşletmenizin adı ne?",
    en: "What's your business called?",
    de: "Wie heißt Ihr Betrieb?",
  },
  "onboarding.nameHint": {
    tr: "Müşterilerinize giden mesajlarda görünecek.",
    en: "It appears in messages to your customers.",
    de: "Der Name steht in den Nachrichten an Ihre Kunden.",
  },
  "onboarding.langTitle": {
    tr: "Hangi dilde çalışalım?",
    en: "Which language should we use?",
    de: "In welcher Sprache arbeiten wir?",
  },
  "onboarding.langHint": {
    tr: "Uygulamanın, mesajların ve telefon asistanınızın dili. Sonradan değiştirebilirsiniz.",
    en: "The language of the app, your messages and your phone agent. You can change it later.",
    de: "Die Sprache der App, Ihrer Nachrichten und Ihres Telefonassistenten. Sie können sie später ändern.",
  },
  "onboarding.businessName": {
    tr: "İşletme adı",
    en: "Business name",
    de: "Betriebsname",
  },
  // Shorter than the settings version on purpose: nobody at this screen has a
  // booking page yet, so the reason would be an explanation of a thing they
  // have not met. They just need another name.
  "onboarding.nameTaken": {
    tr: "Bu ismi başka bir işletme kullanıyor. Başka bir isim deneyin.",
    en: "Another business already uses this name. Try a different one.",
    de: "Diesen Namen nutzt bereits ein anderer Betrieb. Versuchen Sie einen anderen.",
  },
  "onboarding.start": { tr: "Başla", en: "Get started", de: "Loslegen" },
  "onboarding.industryTitle": {
    tr: "Ne tür bir işletmesiniz?",
    en: "What kind of business are you?",
    de: "Was für ein Betrieb sind Sie?",
  },
  "onboarding.industryHint": {
    tr: "Seçiminize göre hizmetlerinizi, müşteri alanlarınızı ve telefon asistanınızı sizin için hazırlarız.",
    en: "We use this to prepare your services, customer fields and phone agent for you.",
    de: "Damit bereiten wir Ihre Leistungen, Kundenfelder und Ihren Telefonassistenten für Sie vor.",
  },
  "onboarding.prefillYes": {
    tr: "Hazır şablonla başla",
    en: "Start with a ready template",
    de: "Mit fertiger Vorlage starten",
  },
  "onboarding.prefillYesHint": {
    tr: "Sektörünüze uygun hizmetler ve müşteri alanları hazır gelir. Hepsini değiştirebilirsiniz.",
    en: "Services and customer fields for your industry arrive ready. You can change everything.",
    de: "Leistungen und Kundenfelder für Ihre Branche kommen fertig an. Alles lässt sich ändern.",
  },
  "onboarding.prefillNo": {
    tr: "Boş başla",
    en: "Start blank",
    de: "Leer starten",
  },
  "onboarding.prefillNoHint": {
    tr: "Her şeyi kendiniz eklersiniz. Şablona daha sonra İşletme ayarlarından dönebilirsiniz.",
    en: "You add everything yourself. You can still apply the template later from Business settings.",
    de: "Sie fügen alles selbst hinzu. Die Vorlage lässt sich später in den Betriebseinstellungen anwenden.",
  },
  "onboarding.infoTitle": {
    tr: "İşletmenizi tanıtın",
    en: "Tell us about your business",
    de: "Stellen Sie Ihren Betrieb vor",
  },
  "onboarding.infoHint": {
    tr: "Telefon asistanınız arayanları bu bilgilerle yanıtlar. Hepsi isteğe bağlı; daha sonra Sesli asistan → Bilgi bölümünden düzenleyebilirsiniz.",
    en: "Your phone agent answers callers from this. Everything is optional; you can edit it later under Voice agent → Knowledge.",
    de: "Ihr Telefonassistent beantwortet Anrufe mit diesen Angaben. Alles ist optional; Sie können sie später unter Sprachassistent → Wissen bearbeiten.",
  },
  "onboarding.address": { tr: "Adres", en: "Address", de: "Adresse" },
  "onboarding.website": { tr: "Web sitesi", en: "Website", de: "Website" },
  "onboarding.about": {
    tr: "Hakkınızda",
    en: "About your business",
    de: "Über Ihren Betrieb",
  },
  "onboarding.aboutPlaceholder": {
    tr: "Çalışma şekliniz, park, ödeme yöntemleri...",
    en: "How you work, parking, payment methods...",
    de: "Arbeitsweise, Parken, Zahlungsarten...",
  },
  "onboarding.numberTitle": {
    tr: "Telefon numaranız",
    en: "Your phone number",
    de: "Ihre Telefonnummer",
  },
  // No country list (Serdar, 2026-08-26). All three locales carried the same
  // sentence naming Türkiye, Germany, Austria and the UK — which reads as
  // internal coverage notes, not as an instruction. A salon owner needs one
  // fact: the document is required before a number can be issued. Each
  // language says that to its own reader and names nobody else's country.
  "onboarding.numberPromise": {
    tr: "Şirket kayıt belgenizi yükleyin, 24 saat içinde numaranızı tanımlayalım. Numara tahsisi için bu belge yasal olarak zorunlu.",
    en: "Upload your company registration document and we set up your number within 24 hours. Regulators require it before a number can be issued.",
    de: "Laden Sie Ihren Handelsregisterauszug hoch, wir richten Ihre Nummer innerhalb von 24 Stunden ein. Ohne dieses Dokument darf keine Nummer vergeben werden.",
  },
  "onboarding.uploadDoc": {
    tr: "Belge yükle",
    en: "Upload document",
    de: "Dokument hochladen",
  },
  "onboarding.uploadReplace": {
    tr: "Belgeyi değiştir",
    en: "Replace document",
    de: "Dokument ersetzen",
  },
  "onboarding.dropHint": {
    tr: "veya dosyayı buraya sürükleyin",
    en: "or drag the file here",
    de: "oder Datei hierher ziehen",
  },
  "onboarding.uploadLater": {
    tr: "Bu adımı geçebilirsiniz; belgeyi daha sonra Sesli asistan sekmesinden yükleyebilirsiniz.",
    en: "You can skip this and upload the document later from the Voice agent tab.",
    de: "Sie können diesen Schritt überspringen und das Dokument später im Tab Sprachassistent hochladen.",
  },
  "onboarding.uploaded": {
    tr: "Belge alındı: {file}",
    en: "Document received: {file}",
    de: "Dokument erhalten: {file}",
  },
  "onboarding.uploadFailedType": {
    tr: "Bu dosya türü desteklenmiyor. PDF veya fotoğraf yükleyin.",
    en: "That file type is not supported. Upload a PDF or a photo.",
    de: "Dieser Dateityp wird nicht unterstützt. Laden Sie ein PDF oder ein Foto hoch.",
  },
  "onboarding.uploadFailedSize": {
    tr: "Dosya çok büyük. En fazla 10 MB.",
    en: "That file is too large. 10 MB at most.",
    de: "Die Datei ist zu groß. Maximal 10 MB.",
  },
  "onboarding.back": { tr: "Geri", en: "Back", de: "Zurück" },
  "onboarding.continue": { tr: "Devam", en: "Continue", de: "Weiter" },
  "onboarding.finish": { tr: "Bitir", en: "Finish", de: "Fertig" },
  "onboarding.working": {
    tr: "Hazırlanıyor...",
    en: "Setting up...",
    de: "Wird eingerichtet...",
  },
  "settings.industry": { tr: "Sektör", en: "Industry", de: "Branche" },
  "settings.industryHint": {
    tr: "İşletme türünüz. Varsayılana sıfırlama, hizmetleri ve müşteri alanlarını bu şablondan yeniden yükler.",
    en: "What kind of business this is. Reset to defaults re-seeds services and customer fields from this template.",
    de: "Ihre Branche. Das Zurücksetzen lädt Leistungen und Kundenfelder neu aus dieser Vorlage.",
  },
  "settings.industryNone": {
    tr: "Seçilmedi",
    en: "Not set",
    de: "Nicht gewählt",
  },
  "settings.industryReset": {
    tr: "Varsayılanlara sıfırla",
    en: "Reset to defaults",
    de: "Auf Standard zurücksetzen",
  },
  "settings.industryResetConfirm": {
    tr: "Hizmetler ve müşteri alanları {industry} şablonuyla değiştirilsin mi?",
    en: "Replace services and customer fields with the {industry} template?",
    de: "Leistungen und Kundenfelder durch die Vorlage {industry} ersetzen?",
  },
  "settings.industryResetBody": {
    tr: "Mevcut fiyat listeniz silinir ve şablon yeniden yüklenir. Randevular, müşteriler ve mesajlar etkilenmez; telefon asistanınızın kullandığı alanlar korunur.",
    en: "Your current price list is deleted and the template is seeded fresh. Appointments, customers and messages are untouched; fields your phone agent uses are kept.",
    de: "Ihre aktuelle Preisliste wird gelöscht und die Vorlage neu geladen. Termine, Kunden und Nachrichten bleiben unberührt; Felder, die Ihr Telefonassistent nutzt, bleiben erhalten.",
  },
  "numberReq.pending": {
    tr: "Belgeniz alındı. Numaranız 24 saat içinde tanımlanacak.",
    en: "Your document is in. Your number will be provisioned within 24 hours.",
    de: "Ihr Dokument ist eingegangen. Ihre Nummer wird innerhalb von 24 Stunden bereitgestellt.",
  },
  "numberReq.approved": {
    tr: "Onaylandı. Numaranız kısa süre içinde burada görünecek.",
    en: "Approved. Your number will appear here shortly.",
    de: "Genehmigt. Ihre Nummer erscheint hier in Kürze.",
  },
  "numberReq.live": {
    tr: "Numaranız hazır ve çalışıyor.",
    en: "Your number is live.",
    de: "Ihre Nummer ist aktiv.",
  },
  "numberReq.denied": {
    tr: "Belge kabul edilmedi. Lütfen yeni bir belge yükleyin.",
    en: "The document was not accepted. Please upload a new one.",
    de: "Das Dokument wurde nicht akzeptiert. Bitte laden Sie ein neues hoch.",
  },
  "onboarding.kbAddress": {
    tr: "Adres ve ulaşım",
    en: "Address & directions",
    de: "Adresse & Anfahrt",
  },
  "onboarding.kbWebsite": { tr: "Web sitesi", en: "Website", de: "Website" },
  "onboarding.kbAbout": { tr: "Hakkımızda", en: "About us", de: "Über uns" },

  "appointments.edit": { tr: "Randevuyu düzenle", en: "Edit appointment", de: "Termin bearbeiten" },
  "appointments.duration": { tr: "Süre (dk)", en: "Duration (min)", de: "Dauer (Min.)" },
  "appointments.quantity": { tr: "Adet", en: "Quantity", de: "Anzahl" },
  "services.kind": { tr: "Tür", en: "Type", de: "Art" },
  "services.kindService": { tr: "Hizmet", en: "Service", de: "Leistung" },
  "services.kindGood": { tr: "Ürün", en: "Product", de: "Produkt" },
  // One line at the sheet's column width, deliberately — a wrapping hint
  // makes the modal resize when the kind flips.
  "services.goodHint": {
    tr: "Takvimde yer tutmaz (ör. pasta)",
    en: "Blocks no calendar time (e.g. a cake)",
    de: "Belegt keinen Termin (z. B. Torte)",
  },
  // Also the PRODUCTS list's second column header, where "Duration" was a
  // question a good cannot answer: it is handed over, not performed, and the
  // cell holds this when it holds anything.
  "services.leadTime": {
    tr: "Ön sipariş süresi",
    en: "Lead time",
    de: "Vorlaufzeit",
  },
  "services.leadDays": { tr: "gün önce", en: "days ahead", de: "Tage vorher" },
  "booking.leadTime": {
    tr: "Bu ürün için daha erken bir tarih seçilemez, lütfen daha ileri bir gün seçin",
    en: "This item needs more notice, please pick a later day",
    de: "Dieser Artikel braucht mehr Vorlauf, bitte einen späteren Tag wählen",
  },
  // The sheet's read-only row on a goods order: pickup/delivery, ASAP, the
  // address. Label kept to one plain word like its neighbours (When, Service).
  "appointments.fulfillment": {
    tr: "Teslim",
    en: "Handover",
    de: "Übergabe",
  },
  "appointments.bookAnyway": {
    tr: "Yine de kaydet",
    en: "Book anyway",
    de: "Trotzdem buchen",
  },
  // The calendar's verdict on a slot (schedule.slotVerdict, P6), the line
  // under the booking sheet's Team member row. Free and the two facts that
  // never need a confirm first, then each conflict, most fundamental first.
  "appointments.slotFree": { tr: "Boş", en: "Free", de: "Frei" },
  "appointments.slotPast": {
    tr: "Saati geçmiş: müşteriye onay gitmez",
    en: "Already started: the customer gets no confirmation",
    de: "Schon begonnen: der Kunde bekommt keine Bestätigung",
  },
  "appointments.slotInsideNotice": {
    tr: "Boş, ama en az önceden haber süresinin içinde",
    en: "Free, but inside your minimum notice",
    de: "Frei, aber innerhalb Ihres Mindestvorlaufs",
  },
  "appointments.slotOutsideHours": {
    tr: "Çalışma saatleri dışında",
    en: "Outside your opening hours",
    de: "Außerhalb Ihrer Öffnungszeiten",
  },
  "appointments.slotClosed": { tr: "Kapalı saat", en: "Blocked time", de: "Schließzeit" },
  "appointments.slotClosedReason": {
    tr: "Kapalı saat: {reason}",
    en: "Blocked time: {reason}",
    de: "Schließzeit: {reason}",
  },
  "appointments.slotCustomerBusy": {
    tr: "{name} bu saatte zaten randevulu",
    en: "{name} already has an appointment then",
    de: "{name} hat da schon einen Termin",
  },
  "appointments.slotCustomerBusyAnon": {
    tr: "Müşterinin bu saatte zaten randevusu var",
    en: "The customer already has an appointment then",
    de: "Der Kunde hat da schon einen Termin",
  },
  "appointments.slotStaffBusy": {
    tr: "{name} bu saatte dolu",
    en: "{name} is already booked then",
    de: "{name} ist da schon gebucht",
  },
  "appointments.slotStaffBusyAnon": {
    tr: "Bu ekip üyesi bu saatte dolu",
    en: "This team member is already booked then",
    de: "Dieses Teammitglied ist da schon gebucht",
  },
  "appointments.slotFull": {
    tr: "Bu saatte tüm ekip dolu",
    en: "Every team member is booked then",
    de: "Da ist das ganze Team gebucht",
  },
  // The question a conflict asks before the booking is made anyway, in the
  // sheet's foot like the bin's (and in a dialog after a drag).
  "appointments.anywayBookTitle": {
    tr: "Yine de kaydedilsin mi?",
    en: "Book it anyway?",
    de: "Trotzdem buchen?",
  },
  "appointments.anywayMoveTitle": {
    tr: "Yine de taşınsın mı?",
    en: "Move it anyway?",
    de: "Trotzdem verschieben?",
  },
  "appointments.anywaySaveTitle": {
    tr: "Yine de kaydedilsin mi?",
    en: "Save it anyway?",
    de: "Trotzdem speichern?",
  },
  "appointments.moveAnyway": {
    tr: "Yine de taşı",
    en: "Move anyway",
    de: "Trotzdem verschieben",
  },
  "appointments.saveAnyway": {
    tr: "Yine de kaydet",
    en: "Save anyway",
    de: "Trotzdem speichern",
  },
  "appointments.cancelAppointment": {
    tr: "Randevuyu iptal et",
    en: "Cancel appointment",
    de: "Termin stornieren",
  },
  // The bin's question in the booking sheet (Nudge c49864af). It names the
  // rule by its own name in the Automations list, because that rule is what
  // the customer receives.
  "appointments.cancelConfirmTitle": {
    tr: "Bu randevu iptal edilsin mi?",
    en: "Cancel this appointment?",
    de: "Diesen Termin stornieren?",
  },
  "appointments.cancelConfirmBody": {
    tr: "İptal bildirimi açıksa müşteriye gönderilir.",
    en: "If the cancellation notice is on, it goes to the customer.",
    de: "Ist die Stornomitteilung aktiv, geht sie an den Kunden.",
  },
  // The same question on a booking whose start has passed: the business is
  // correcting its own record, and the customer is not messaged (P6).
  "appointments.cancelConfirmBodyPast": {
    tr: "Randevu saati geçtiği için müşteriye haber verilmez.",
    en: "It has already started, so the customer is not told.",
    de: "Der Termin hat schon begonnen, der Kunde wird nicht benachrichtigt.",
  },
  "appointments.keep": { tr: "Kalsın", en: "Keep it", de: "Behalten" },
  "appointments.moveFailed": {
    tr: "Takvim bu değişikliği kabul etmedi, randevu eski yerinde kaldı.",
    en: "The calendar refused this change, so the appointment stayed where it was.",
    de: "Der Kalender hat diese Änderung abgelehnt, der Termin blieb unverändert.",
  },
  "staff.title": { tr: "Ekip", en: "Team", de: "Team" },
  // A team member's calendar colour (StaffColorPicker): Google Calendar's
  // event palette with Resepta's lavender first, named as Google names them
  // in each language.
  "staffColor.lavender": { tr: "Lavanta", en: "Lavender", de: "Lavendel" },
  "staffColor.peacock": { tr: "Tavus kuşu", en: "Peacock", de: "Pfau" },
  "staffColor.sage": { tr: "Adaçayı", en: "Sage", de: "Salbei" },
  "staffColor.tangerine": { tr: "Mandalina", en: "Tangerine", de: "Mandarine" },
  "staffColor.grape": { tr: "Üzüm", en: "Grape", de: "Weintraube" },
  "staffColor.banana": { tr: "Muz", en: "Banana", de: "Banane" },
  "staffColor.blueberry": { tr: "Yaban mersini", en: "Blueberry", de: "Heidelbeere" },
  "staffColor.flamingo": { tr: "Flamingo", en: "Flamingo", de: "Flamingo" },
  "staffColor.basil": { tr: "Fesleğen", en: "Basil", de: "Basilikum" },
  "staffColor.graphite": { tr: "Grafit", en: "Graphite", de: "Graphit" },
  "staffColor.of": {
    tr: "{name}: {color}",
    en: "{name}: {color}",
    de: "{name}: {color}",
  },
  "staffColor.change": {
    tr: "{name}: {color}. Rengi değiştir",
    en: "{name}: {color}. Change color",
    de: "{name}: {color}. Farbe ändern",
  },
  "staffColor.title": {
    tr: "{name} için takvim rengi",
    en: "Calendar color for {name}",
    de: "Kalenderfarbe für {name}",
  },
  "staffColor.takenBy": {
    tr: "{name} bu rengi kullanıyor",
    en: "{name} has this one",
    de: "{name} hat diese Farbe",
  },
  "staffColor.takenError": {
    tr: "Bu rengi ekipte başka biri kullanıyor.",
    en: "Someone else on the team has that color.",
    de: "Diese Farbe hat schon jemand anderes im Team.",
  },
  "staff.hint": {
    tr: "Randevuyu kim veriyor. Gün görünümü herkese bir sütun açar. Ayrılan birini önce pasife alın; sonra tamamen kaldırabilirsiniz, ama geçmiş randevuları artık bir isim göstermez.",
    en: "Who delivers the appointment. Day view gives each person a column. Switch somebody off before removing them — once removed, their past appointments no longer show who did them.",
    de: "Wer den Termin ausführt. Die Tagesansicht gibt jeder Person eine Spalte. Deaktivieren Sie jemanden, bevor Sie ihn entfernen — danach zeigen vergangene Termine nicht mehr, wer sie ausgeführt hat.",
  },
  "staff.none": { tr: "Henüz kimse eklenmedi.", en: "Nobody added yet.", de: "Noch niemand hinzugefügt." },
  "staff.namePlaceholder": { tr: "Ad", en: "Name", de: "Name" },
  "staff.add": { tr: "Ekle", en: "Add", de: "Hinzufügen" },
  "appointments.title": { tr: "Randevular", en: "Appointments", de: "Termine" },
  "appointments.new": {
    tr: "Yeni randevu",
    en: "New appointment",
    de: "Neuer Termin",
  },
  "appointments.none": {
    tr: "Randevu yok",
    en: "No appointments",
    de: "Keine Termine",
  },
  "appointments.customer": { tr: "Müşteri", en: "Customer", de: "Kunde" },
  "appointments.month": { tr: "Ay", en: "Month", de: "Monat" },
  "appointments.year": { tr: "Yıl", en: "Year", de: "Jahr" },
  // {n} is how many more bookings that day holds than the cell can show.
  "appointments.more": { tr: "+{n} daha", en: "+{n} more", de: "+{n} weitere" },
  "appointments.findCustomer": { tr: "Müşteri ara", en: "Find customer", de: "Kunde suchen" },
  "appointments.findCustomerHint": {
    tr: "Müşterinin adı",
    en: "Customer's name",
    de: "Name des Kunden",
  },
  "appointments.createCustomer": {
    tr: "Yeni müşteri: \"{name}\"",
    en: "New customer: \"{name}\"",
    de: "Neuer Kunde: \"{name}\"",
  },
  // "Sale", not "appointment". One sheet, one row, and what you pick decides
  // what it is: a timed service, a good, or both together. Naming it after the
  // timed half hid the other one completely — Serdar read the label and
  // concluded the product he had just added to the catalog could not be sold
  // from a customer's record, which it always could.
  //
  // Square's word, and Square is the catalog model the goods design followed
  // (one catalog, two kinds). The rule is the app's own: name the SET, not its
  // best-known member — the same mistake "Add reminder" made for a sheet that
  // adds any of six message types.
  "appointments.addForCustomer": {
    tr: "Satış ekle",
    en: "Add sale",
    de: "Verkauf hinzufügen",
  },
  // The record card's appointments block (Nudge's deal block, in a salon's
  // terms). The count rides the heading, and the visits that are over sit
  // behind a disclosure rather than pushing the record off the screen.
  "appointments.showPast": {
    tr: "{n} geçmiş randevuyu göster",
    en: "Show {n} past",
    de: "{n} vergangene anzeigen",
  },
  "appointments.hidePast": {
    tr: "Geçmişi gizle",
    en: "Hide history",
    de: "Verlauf ausblenden",
  },
  "appointments.when": { tr: "Tarih", en: "When", de: "Datum" },
  // The booking sheet's two time fields, for a screen reader: the row's
  // label already says When.
  "appointments.startTime": { tr: "Başlangıç saati", en: "Start time", de: "Beginn" },
  "appointments.endTime": { tr: "Bitiş saati", en: "End time", de: "Ende" },
  "appointments.service": { tr: "Hizmet", en: "Service", de: "Leistung" },
  // What a bookable person is called, everywhere. Was overridable per org; the
  // override is gone because it set this one string and cost a form field on
  // the page you go to manage people.
  "appointments.staff": { tr: "Ekip üyesi", en: "Team member", de: "Teammitglied" },
  "appointments.status": { tr: "Durum", en: "Status", de: "Status" },
  "appointments.notes": { tr: "Not", en: "Notes", de: "Notiz" },
  "appointments.source": { tr: "Kaynak", en: "Source", de: "Quelle" },
  "appointments.cancel": {
    tr: "Randevuyu iptal et",
    en: "Cancel appointment",
    de: "Termin absagen",
  },
  // The calendar list row's ⋯, for screen readers. It said "Actions" in
  // English in every language until 2026-10-13.
  "appointments.actions": {
    tr: "Randevu işlemleri",
    en: "Appointment actions",
    de: "Terminaktionen",
  },
  "appointments.complete": {
    tr: "Tamamlandı olarak işaretle",
    en: "Mark as completed",
    de: "Als erledigt markieren",
  },
  "appointments.noShow": {
    tr: "Gelmedi olarak işaretle",
    en: "Mark as no-show",
    de: "Als nicht erschienen markieren",
  },
  "appointments.reopen": {
    tr: "Yeniden planla",
    en: "Reopen",
    de: "Wieder öffnen",
  },
  "appointments.list": { tr: "Liste", en: "List", de: "Liste" },
  "appointments.day": { tr: "Gün", en: "Day", de: "Tag" },
  "appointments.week": { tr: "Hafta", en: "Week", de: "Woche" },
  "appointments.today": { tr: "Bugün", en: "Today", de: "Heute" },
  "appointments.search": {
    tr: "Randevularda ara",
    en: "Search appointments",
    de: "Termine durchsuchen",
  },
  "appointments.bookings": { tr: "randevu", en: "bookings", de: "Termine" },
  "appointments.unassigned": {
    tr: "Atanmamış",
    en: "Unassigned",
    de: "Nicht zugeordnet",
  },
  "appointments.everyone": {
    tr: "Tüm personel",
    en: "Everyone",
    de: "Alle Mitarbeiter",
  },
  "appointments.previous": { tr: "Önceki", en: "Previous", de: "Zurück" },
  "appointments.next": { tr: "Sonraki", en: "Next", de: "Weiter" },

  "status.scheduled": { tr: "Planlandı", en: "Scheduled", de: "Geplant" },
  "status.confirmed": { tr: "Onaylandı", en: "Confirmed", de: "Bestätigt" },
  "status.cancelled": { tr: "İptal", en: "Cancelled", de: "Abgesagt" },
  "status.completed": { tr: "Tamamlandı", en: "Completed", de: "Erledigt" },
  "status.no_show": { tr: "Gelmedi", en: "No-show", de: "Nicht erschienen" },

  "customers.title": { tr: "Müşteriler", en: "Customers", de: "Kunden" },
  // The first tab on the Customers strip. NOT "Müşteriler" — the sidebar row
  // and the header already say that, and a strip must not re-name the page it
  // sits on. Same reason VoiceView's first tab is "Agents" and not
  // "Voice agent".
  "customers.tabList": { tr: "Liste", en: "List", de: "Liste" },
  "customers.hasEmail": {
    tr: "E-postası var",
    en: "Has email",
    de: "Mit E-Mail",
  },
  "customers.noEmail": {
    tr: "E-postası yok",
    en: "No email",
    de: "Ohne E-Mail",
  },
  "customers.selectAll": {
    tr: "Görünen herkesi seç",
    en: "Select everyone shown",
    de: "Alle angezeigten auswählen",
  },

  // ── Bulk actions ────────────────────────────────────────────────────────
  //
  // The German column follows the house rules above: Sie throughout, Betrieb
  // for the business, and DSGVO where the English says KVKK.
  "bulk.title": { tr: "Toplu işlem", en: "Bulk", de: "Sammelaktion" },
  "bulk.selected": {
    tr: "{n} kişi seçildi",
    en: "{n} selected",
    de: "{n} ausgewählt",
  },
  "bulk.noConsentCount": {
    tr: "{n} kişinin izni yok",
    en: "{n} without consent",
    de: "{n} ohne Einwilligung",
  },
  "bulk.clear": { tr: "Seçimi bırak", en: "Clear", de: "Aufheben" },
  "bulk.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  "bulk.whatsapp": { tr: "WhatsApp", en: "WhatsApp", de: "WhatsApp" },
  "bulk.call": { tr: "Ara", en: "Call", de: "Anrufen" },
  "bulk.compose.email": {
    tr: "Toplu e-posta",
    en: "Bulk email",
    de: "Sammel-E-Mail",
  },
  "bulk.compose.whatsapp": {
    tr: "Toplu WhatsApp",
    en: "Bulk WhatsApp",
    de: "Sammel-WhatsApp",
  },
  "bulk.compose.call": {
    tr: "Toplu arama",
    en: "Bulk call",
    de: "Sammelanruf",
  },
  // Plural pairs (t.plural): a selection of one used to read "Goes to 1
  // people".
  "bulk.willReach.one": {
    tr: "{n} kişiye gidecek",
    en: "Goes to {n} person",
    de: "Geht an {n} Person",
  },
  "bulk.willReach.other": {
    tr: "{n} kişiye gidecek",
    en: "Goes to {n} people",
    de: "Geht an {n} Personen",
  },
  "bulk.willSkip": {
    tr: "· {n} kişi atlanacak",
    en: "· {n} skipped",
    de: "· {n} übersprungen",
  },
  "bulk.subject": { tr: "Konu", en: "Subject", de: "Betreff" },
  "bulk.body": { tr: "Mesaj", en: "Message", de: "Nachricht" },
  "bulk.bodyHintEmail": {
    tr: "Her kişi için ayrı ayrı doldurulur. [ad] yazarsanız kişinin adı gelir.",
    en: "Filled in per person. Write [first_name] and each one sees their own.",
    de: "Wird pro Person eingesetzt. [first_name] wird zum jeweiligen Vornamen.",
  },
  // The newline rule is not a style preference. Meta rejects a template body
  // parameter containing a line break with error 132000, per recipient, so a
  // message written in paragraphs fails the run one row at a time.
  "bulk.bodyHintWa": {
    tr: "Tek satır. WhatsApp şablonlarında satır sonu Meta tarafından reddedilir.",
    en: "One line. Meta refuses a line break inside a WhatsApp template.",
    de: "Eine Zeile. Meta lehnt Zeilenumbrüche in WhatsApp-Vorlagen ab.",
  },
  "bulk.previewFor": {
    tr: "{name} şunu görecek:",
    en: "{name} sees:",
    de: "{name} sieht:",
  },
  "bulk.agent": { tr: "Asistan", en: "Agent", de: "Assistent" },
  "bulk.pickAgent": { tr: "Seçin", en: "Pick one", de: "Auswählen" },
  "bulk.callHint": {
    tr: "Teker teker aranır. Bir görüşme bitmeden sonraki başlamaz.",
    en: "Dialled one at a time. The next call waits for the current one to end.",
    de: "Nacheinander. Der nächste Anruf beginnt erst nach dem laufenden.",
  },
  "bulk.confirmSend.one": {
    tr: "{n} kişiye gönderilsin mi? Geri alınamaz.",
    en: "Send to {n} person? This cannot be undone.",
    de: "An {n} Person senden? Das lässt sich nicht rückgängig machen.",
  },
  "bulk.confirmSend.other": {
    tr: "{n} kişiye gönderilsin mi? Geri alınamaz.",
    en: "Send to {n} people? This cannot be undone.",
    de: "An {n} Personen senden? Das lässt sich nicht rückgängig machen.",
  },
  // The one pair whose Turkish changes too: one phone rings, not phones.
  "bulk.confirmCall.one": {
    tr: "{n} kişi aransın mı? Telefonu gerçekten çalar.",
    en: "Call {n} person? Their phone really rings.",
    de: "{n} Person anrufen? Das Telefon klingelt wirklich.",
  },
  "bulk.confirmCall.other": {
    tr: "{n} kişi aransın mı? Telefonlar gerçekten çalar.",
    en: "Call {n} people? Their phones really ring.",
    de: "{n} Personen anrufen? Die Telefone klingeln wirklich.",
  },

  // Gates. Every one of these renders as a line under a disabled button, so
  // each names the thing to go and fix rather than restating the refusal.
  "bulk.ownerOnly": {
    tr: "Toplu işlemi yalnızca işletme sahibi başlatabilir.",
    en: "Only the owner can start a bulk action.",
    de: "Nur die Inhaberin oder der Inhaber kann eine Sammelaktion starten.",
  },
  "bulk.walletEmpty": {
    tr: "Bakiye bitti. Yükleme yapmadan toplu gönderim başlamaz.",
    en: "Your balance is empty. Top up before starting a bulk send.",
    de: "Ihr Guthaben ist leer. Bitte vor dem Sammelversand aufladen.",
  },
  "bulk.noneEligible": {
    tr: "Seçilenlerin hiçbirine bu kanaldan ulaşılamıyor.",
    en: "None of the selected people can be reached on this channel.",
    de: "Keine der ausgewählten Personen ist über diesen Kanal erreichbar.",
  },
  "bulk.tooMany": {
    tr: "Tek seferde en fazla {n} kişi. Listeyi filtreleyip daraltın.",
    en: "At most {n} people in one run. Filter the list down.",
    de: "Höchstens {n} Personen pro Lauf. Bitte die Liste eingrenzen.",
  },
  "bulk.emailNotReady": {
    tr: "E-posta kanalı kurulu değil.",
    en: "The email lane is not set up.",
    de: "Der E-Mail-Kanal ist nicht eingerichtet.",
  },
  "bulk.waNotReady": {
    tr: "Bağlı bir WhatsApp numarası yok.",
    en: "No WhatsApp number is connected.",
    de: "Es ist keine WhatsApp-Nummer verbunden.",
  },
  // The one gate that is about Meta rather than about this app. Booking
  // templates are approved for confirmations and reminders, not for a blast:
  // sending one to people with no appointment is untrue, and it is what gets
  // a template paused and a number's quality rating downgraded.
  "bulk.waTemplatePending": {
    tr: "Toplu mesaj şablonu Meta onayında. Onaylanınca burası kendiliğinden açılır.",
    en: "The bulk template is waiting on Meta. This opens by itself once approved.",
    de: "Die Sammelvorlage wartet auf Meta. Sobald sie freigegeben ist, öffnet sich das hier von selbst.",
  },
  "bulk.waTooMany": {
    tr: "WhatsApp'ta tek seferde en fazla {n} kişi.",
    en: "At most {n} people per WhatsApp run.",
    de: "Höchstens {n} Personen pro WhatsApp-Lauf.",
  },
  "bulk.noDialableAgent": {
    tr: "Arama yapabilecek bir asistan yok.",
    en: "No agent has a line it can call from.",
    de: "Kein Assistent hat eine Nummer zum Anrufen.",
  },
  "bulk.errorSuspended": {
    tr: "İşletme askıya alınmış.",
    en: "This business is suspended.",
    de: "Dieser Betrieb ist gesperrt.",
  },
  "bulk.errorDemo": {
    tr: "Demo çalışma alanından gerçek gönderim yapılmaz.",
    en: "The demo workspace never sends anything for real.",
    de: "Der Demo-Bereich versendet nie wirklich etwas.",
  },
  "bulk.errorGeneric": {
    tr: "Başlatılamadı. Tekrar deneyin.",
    en: "Could not start. Try again.",
    de: "Start nicht möglich. Bitte erneut versuchen.",
  },

  // History
  "bulk.noRuns": {
    tr: "Henüz toplu işlem yapılmadı.",
    en: "No bulk actions yet.",
    de: "Noch keine Sammelaktionen.",
  },
  "bulk.backToRuns": { tr: "Geri", en: "Back", de: "Zurück" },
  "bulk.statusRunning": { tr: "Sürüyor", en: "Running", de: "Läuft" },
  "bulk.statusPaused": { tr: "Duraklatıldı", en: "Paused", de: "Pausiert" },
  "bulk.statusCancelled": { tr: "Durduruldu", en: "Stopped", de: "Gestoppt" },
  "bulk.statusDone": { tr: "Bitti", en: "Done", de: "Fertig" },
  "bulk.counts": {
    tr: "{done}/{total} tamam · {failed} hata · {skipped} atlandı",
    en: "{done}/{total} done · {failed} failed · {skipped} skipped",
    de: "{done}/{total} erledigt · {failed} fehlgeschlagen · {skipped} übersprungen",
  },
  "bulk.pause": { tr: "Duraklat", en: "Pause", de: "Pausieren" },
  "bulk.resume": { tr: "Devam et", en: "Resume", de: "Fortsetzen" },
  "bulk.stop": { tr: "Durdur", en: "Stop", de: "Stoppen" },
  // Says plainly what a stop cannot undo. A call already ringing finishes and
  // a message already with the provider lands; promising otherwise would be a
  // promise the phone network does not keep.
  "bulk.stopConfirm": {
    tr: "Kalanlar iptal edilsin mi? Başlamış arama ve gönderimler geri alınamaz.",
    en: "Cancel the rest? Calls already ringing and messages already sent cannot be recalled.",
    de: "Den Rest abbrechen? Laufende Anrufe und bereits gesendete Nachrichten lassen sich nicht zurückholen.",
  },
  "bulk.skipNoConsent": { tr: "İzin yok", en: "No consent", de: "Keine Einwilligung" },
  "bulk.skipNoEmail": { tr: "E-posta yok", en: "No email", de: "Keine E-Mail" },
  "bulk.skipBadPhone": { tr: "Numara geçersiz", en: "Bad number", de: "Nummer ungültig" },
  // The customer asked not to be called by the AI (the record's switch, or
  // the phone agent hearing it on an earlier call).
  // Unsubscribed from marketing email through a link in an earlier mail.
  "bulk.skipUnsubscribed": {
    tr: "Abonelikten çıktı",
    en: "Unsubscribed",
    de: "Abbestellt",
  },
  "bulk.skipNoAiCalls": {
    tr: "Asistanla aranmak istemiyor",
    en: "Asked for no AI calls",
    de: "Möchte keine KI-Anrufe",
  },
  "bulk.skipOther": { tr: "Atlandı", en: "Skipped", de: "Übersprungen" },
  "bulk.itemPending": { tr: "Sırada", en: "Waiting", de: "Wartet" },
  "bulk.itemQueued": { tr: "Kuyrukta", en: "Queued", de: "In Warteschlange" },
  "bulk.itemRinging": { tr: "Çalıyor", en: "Ringing", de: "Klingelt" },
  "bulk.itemSent": { tr: "Gönderildi", en: "Sent", de: "Gesendet" },
  "bulk.itemOpened": { tr: "Açıldı", en: "Opened", de: "Geöffnet" },
  "bulk.itemReplied": { tr: "Yanıtladı", en: "Replied", de: "Geantwortet" },
  "bulk.itemAnswered": { tr: "{s} sn görüştü", en: "Talked {s}s", de: "{s} s gesprochen" },
  "bulk.itemNoAnswer": { tr: "Açmadı", en: "No answer", de: "Nicht abgenommen" },
  "bulk.itemFailed": { tr: "Başarısız", en: "Failed", de: "Fehlgeschlagen" },
  "bulk.itemCancelled": { tr: "İptal", en: "Cancelled", de: "Abgebrochen" },
  "customers.new": {
    tr: "Müşteri ekle",
    en: "Add customer",
    de: "Kunden hinzufügen",
  },
  "customers.none": {
    tr: "Müşteri yok",
    en: "No customers",
    de: "Keine Kunden",
  },
  "customers.firstName": { tr: "Ad", en: "First name", de: "Vorname" },
  "customers.lastName": { tr: "Soyad", en: "Last name", de: "Nachname" },
  "customers.phone": { tr: "Telefon", en: "Phone", de: "Telefon" },
  "customers.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  // Short enough to sit on one line in a record label column; the KVKK detail
  // lives in the hint next to it.
  "customers.consent": {
    tr: "İletişim izni",
    en: "Messaging consent",
    de: "Einwilligung",
  },
  // The record footer's one-word form. Same fact as customers.consent, in a
  // grid column narrow enough that "Messaging consent" would wrap and drag the
  // cell beside it out of shape. Unambiguous where it appears: it sits next to
  // Mute on a contact record, and there is nothing else it could be consent to.
  "customers.consentShort": {
    tr: "İzin",
    en: "Consent",
    de: "Einwilligung",
  },
  // Says exactly what consent gates, because "no channel sends anything" was
  // false: the away reply and the assistant's answers reply to a message the
  // customer just sent and go without it (wa.sendAwayReply,
  // email.sendOutOfHoursReply, the assistant's auto-send). legal.ts makes the
  // same split in its consent section; keep the two in step.
  "customers.consentHint": {
    tr: "Müşterinin KVKK kapsamındaki izni. İzin yoksa randevu onayları, hatırlatmalar, kampanyalar, toplu mesaj ve aramalar ona gitmez; ekibiniz de ona WhatsApp'tan yazamaz. Kapalıyken otomatik yanıt ve asistanın cevapları yine gider, çünkü müşterinin az önce gönderdiği mesaja yanıt verirler.",
    en: "The customer's KVKK consent. Without it they get no confirmations, reminders, campaigns or bulk messages and calls, and your team can't write to them on WhatsApp. The away reply and the assistant's answers still go, because they answer a message the customer just sent.",
    de: "Die Einwilligung des Kunden nach DSGVO. Ohne sie bekommt er keine Terminbestätigungen, Erinnerungen, Kampagnen oder Sammelaktionen per Nachricht oder Anruf, und Ihr Team kann ihm nicht per WhatsApp schreiben. Die Abwesenheitsantwort und die Antworten des Assistenten gehen trotzdem raus, weil sie auf eine Nachricht antworten, die er gerade geschickt hat.",
  },
  // "Stumm", not "Stummschalten": this is a label on a switch in a four-column
  // footer, and the extra eight characters were the widest single thing in the
  // German layout. The switch itself supplies the verb.
  "customers.mute": {
    tr: "Sessize al",
    en: "Mute",
    de: "Stumm",
  },
  // The row indicator's tooltip. States the consequence, not the setting: the
  // icon already says "muted", what somebody hovering wants is why this row is
  // at the bottom and silent.
  "customers.mutedMark": {
    tr: "Sessize alındı: gelen kutusunda görünmez, bildirim vermez",
    en: "Muted: no inbox row, no notifications",
    de: "Stummgeschaltet: nicht im Posteingang, keine Benachrichtigungen",
  },
  "customers.muteHint": {
    tr: "Sessize alınan müşteri gelen kutusunda görünmez ve hiçbir yerde bildirim noktası yakmaz. Mesaj göndermeye devam edebilirsiniz; kişi listenin sonuna iner.",
    en: "A muted customer stays out of the inbox and never lights an attention dot. You can still message them; they sit at the bottom of Contacts.",
    de: "Ein stummgeschalteter Kunde erscheint nicht im Posteingang und löst nirgends einen Hinweispunkt aus. Nachrichten sind weiterhin möglich; der Kontakt rutscht ans Ende der Liste.",
  },
  // "No AI calls" (customers.noAiCallsAt), the record footer's switch. Short,
  // because it shares an auto-width label column with Consent and the footer
  // must keep four columns at 20rem (ContactView's note); the detail rides the
  // hint. Nudge's Turkish label for the same switch is "AI aramaz".
  "customers.noAiCalls": {
    tr: "AI aramaz",
    en: "No AI calls",
    de: "Kein KI-Anruf",
  },
  "customers.noAiCallsHint": {
    tr: "Müşteri, sesli asistanın kendisini aramamasını istedi. Toplu aramalar onu atlar; buradan arama başlatırken önce sorulur. Hatırlatmalar ve mesajlar gitmeye devam eder. Bir aramada bunu isteyen arayanı asistan kendisi işaretler; işareti yalnızca bir kişi kaldırabilir.",
    en: "They asked not to be called by the voice agent. Bulk call runs skip them, and placing a call from here asks first. Reminders and messages still go. The voice agent turns this on when a caller asks on a call; only a person can turn it off.",
    de: "Der Kunde möchte nicht vom Sprachassistenten angerufen werden. Sammelaktionen per Anruf überspringen ihn, und ein Anruf von hier fragt vorher nach. Erinnerungen und Nachrichten gehen weiter. Bittet ein Anrufer im Gespräch darum, setzt der Assistent das selbst; aufheben kann es nur ein Mensch.",
  },
  // The marketing-email opt-out (customers.marketingEmailOptOutAt), the
  // footer's last switch. On = unsubscribed, the same direction as Mute and
  // No AI calls beside it. Short for the footer's column (ContactView's 20rem
  // note): "Abonelikten çıktı" and "Abgemeldet" pushed it over.
  "customers.unsubscribed": {
    tr: "Abone değil",
    en: "Unsubscribed",
    de: "Abbestellt",
  },
  "customers.unsubscribedHint": {
    tr: "Açıkken müşteriye pazarlama e-postası gitmez: kampanya, toplu işlem ve geri kazanım e-postaları durur. Bu e-postaların altındaki abonelikten çıkma bağlantısı bunu açar; müşteri size söylerse siz de açabilirsiniz. Onaylar, hatırlatmalar ve WhatsApp etkilenmez.",
    en: "On means the customer gets no marketing email from you: campaign, bulk and win-back emails stop. The unsubscribe link at the foot of those emails turns it on, and you can turn it on when they ask you in person. Confirmations, reminders and WhatsApp are not affected.",
    de: "Ist es an, bekommt der Kunde keine Werbe-E-Mails von Ihnen: Kampagnen-, Sammel- und Rückgewinnungs-E-Mails stoppen. Der Abmeldelink am Ende dieser E-Mails schaltet es ein, und Sie können es einschalten, wenn der Kunde Sie darum bittet. Bestätigungen, Erinnerungen und WhatsApp sind nicht betroffen.",
  },
  // Switching Unsubscribed off puts the customer back on marketing email, so
  // the switch asks first.
  "customers.resubscribeTitle": {
    tr: "Pazarlama e-postaları yeniden gönderilsin mi?",
    en: "Send them marketing email again?",
    de: "Wieder Werbe-E-Mails senden?",
  },
  "customers.resubscribeBody": {
    tr: "Bunu yalnızca müşteri yeniden almak istediğini söylediyse yapın. Kampanya, toplu işlem ve geri kazanım e-postaları ona yeniden gider.",
    en: "Only do this if the customer asked to get them again. Campaign, bulk and win-back emails will reach them again.",
    de: "Nur, wenn der Kunde sie wieder erhalten möchte. Kampagnen-, Sammel- und Rückgewinnungs-E-Mails gehen dann wieder an ihn.",
  },
  "customers.resubscribe": {
    tr: "Yeniden gönder",
    en: "Send again",
    de: "Wieder senden",
  },
  // The record's ⋯ menu and its delete sheet (CustomerDeleteSheet). Owners
  // only; the menu is not drawn for anybody else.
  "customers.actions": {
    tr: "Müşteri işlemleri",
    en: "Customer actions",
    de: "Kundenaktionen",
  },
  "customers.delete": {
    tr: "Müşteriyi sil",
    en: "Delete customer",
    de: "Kunden löschen",
  },
  "customers.deleteTitle": {
    tr: "{name} silinsin mi?",
    en: "Delete {name}?",
    de: "{name} löschen?",
  },
  // A caller the voice agent filed has no name until somebody gives one.
  "customers.deleteTitleUnnamed": {
    tr: "Bu müşteri silinsin mi?",
    en: "Delete this customer?",
    de: "Diesen Kunden löschen?",
  },
  "customers.deleteHint": {
    tr: "Müşteri hemen tüm listelerden ve aramalardan kalkar; ona gönderilmeyi bekleyen her mesaj iptal edilir. Kendisine bu konuda bir şey gönderilmez. Etkinlik kaydında bir müşterinin silindiği ve kimin sildiği kalır, silinen kişinin adı kalmaz. Telefon, WhatsApp ve e-posta hizmetlerinin kendi kopyalarına dokunulmaz.",
    en: "They leave every list and search at once, and anything still waiting to be sent to them is cancelled. Nothing is sent to them about it. The activity log keeps a line saying a customer was deleted and by whom, never who. Copies kept by the phone, WhatsApp and email services are not touched.",
    de: "Der Kunde verschwindet sofort aus allen Listen und Suchen, und alles, was noch an ihn gesendet werden sollte, wird abgebrochen. Er erhält darüber keine Nachricht. Das Aktivitätsprotokoll behält einen Eintrag, dass ein Kunde gelöscht wurde und von wem, aber nicht, wer. Kopien bei den Telefon-, WhatsApp- und E-Mail-Diensten bleiben unberührt.",
  },
  "customers.deleteLead": {
    tr: "Onunla birlikte silinecekler:",
    en: "Deleted with them:",
    de: "Mit gelöscht werden:",
  },
  "customers.deleteNothingElse": {
    tr: "Başka kaydı yok.",
    en: "Nothing else is held on them.",
    de: "Sonst ist zu diesem Kunden nichts gespeichert.",
  },
  "customers.deleteKindMessages": { tr: "Mesajlar", en: "Messages", de: "Nachrichten" },
  "customers.deleteKindCalls": { tr: "Aramalar", en: "Calls", de: "Anrufe" },
  "customers.deleteKindChatTurns": {
    tr: "Asistan yanıtları",
    en: "Assistant replies",
    de: "Antworten des Assistenten",
  },
  "customers.deleteKindBulk": {
    tr: "Toplu işlem kayıtları",
    en: "Bulk send entries",
    de: "Einträge in Sammelaktionen",
  },
  "customers.deleteKindInboxMarks": {
    tr: "Gelen kutusu işaretleri",
    en: "Inbox pins and read marks",
    de: "Markierungen im Posteingang",
  },
  "customers.deleteActivityKept": {
    tr: "Etkinlik kaydında adı olmadan kalan satırlar: {n}",
    en: "Activity log entries kept without their name: {n}",
    de: "Einträge im Aktivitätsprotokoll, die ohne Namen bleiben: {n}",
  },
  "customers.deleteFinal": {
    tr: "Bu işlem geri alınamaz.",
    en: "This can't be undone.",
    de: "Das lässt sich nicht rückgängig machen.",
  },
  "customers.deleteConfirm": {
    tr: "Kalıcı olarak sil",
    en: "Delete permanently",
    de: "Endgültig löschen",
  },
  "customers.deleting": { tr: "Siliniyor…", en: "Deleting…", de: "Wird gelöscht…" },
  "customers.deleteFailed": {
    tr: "Silinemedi. Tekrar deneyin.",
    en: "Could not delete. Try again.",
    de: "Löschen fehlgeschlagen. Bitte erneut versuchen.",
  },
  "customers.noConsent": {
    tr: "İzin yok",
    en: "No consent",
    de: "Keine Einwilligung",
  },
  // The consent funnel needs a name for the other half. The cell itself stays
  // blank when consent is on file: only the missing one is worth a word.
  "customers.consentGiven": {
    tr: "İzin var",
    en: "Consent on file",
    de: "Einwilligung liegt vor",
  },
  // One column header for the whole identity, since the table shows first and
  // last name together.
  "customers.name": { tr: "Ad soyad", en: "Name", de: "Name" },
  "customers.search": {
    tr: "Müşteri ara",
    en: "Search customers",
    de: "Kunden suchen",
  },
  "customers.noMatches": {
    tr: "Aramanıza uyan müşteri yok",
    en: "No customer matches",
    de: "Keine passenden Kunden",
  },
  // Record footer. "Last activity" rather than "last update": a salon cares
  // when the customer last got in touch, not when someone edited the row.
  // The dot's tooltip. Says what it wants, not what it is: "new" would be
  // wrong for a customer of two years who has just written in.
  "customers.needsLook": {
    tr: "Henüz kimse bakmadı",
    en: "Nobody has looked at this yet",
    de: "Noch niemand hat sich das angesehen",
  },
  // The table's dot is a button that only ever clears, so its label says so
  // rather than describing the state the way the record page's toggle does.
  "customers.dismissLook": {
    tr: "Henüz kimse bakmadı. Bakıldı olarak işaretle",
    en: "Nobody has looked at this yet. Mark as handled",
    de: "Noch niemand hat sich das angesehen. Als erledigt markieren",
  },
  "customers.cannotBeMessaged": {
    tr: "Bu müşteriye mesaj izni verilmediği için onay, hatırlatma ve geri kazanım mesajlarının hiçbiri gitmiyor. İzni müşteri kartından işaretleyebilirsiniz.",
    en: "No messaging consent on file, so confirmations, reminders and win-backs all skip this customer. You can record consent on their profile.",
    de: "Keine Einwilligung hinterlegt, daher entfallen Bestätigungen, Erinnerungen und Rückgewinnungen für diese Person. Sie können die Einwilligung im Kundenprofil eintragen.",
  },
  "customers.added": { tr: "Eklendi", en: "Added", de: "Angelegt" },
  // "Last reply", not "Last activity": activity is ambiguous in an app where a
  // booking, a reminder we sent and a note a staff member typed are all
  // activity. This column only ever means the last time the CUSTOMER wrote.
  "customers.lastReply": {
    tr: "Son yanıt",
    en: "Last reply",
    de: "Letzte Antwort",
  },

  "messages.none": {
    tr: "Henüz mesaj yok",
    en: "No messages yet",
    de: "Noch keine Nachrichten",
  },

  "appointments.addService": {
    tr: "+ Hizmet ekle",
    en: "+ Add service",
    de: "+ Leistung hinzufügen",
  },
  "appointments.total": { tr: "Toplam", en: "Total", de: "Gesamt" },
  "services.price": { tr: "Fiyat", en: "Price", de: "Preis" },
  "settings.formEmbedCopy": {
    tr: "Kodu kopyala",
    en: "Copy embed code",
    de: "Einbettungscode kopieren",
  },
  "settings.inboundAddress": {
    tr: "Gelen e-posta adresi",
    en: "Incoming email address",
    de: "Eingangsadresse",
  },
  "settings.inboundAddressHint": {
    tr: "Müşterilerin size yazacağı adres. Buraya gelen e-postalar müşterinin sohbetine düşer.",
    en: "The address customers write to. Mail sent here lands in that customer's conversation.",
    de: "Die Adresse, an die Kunden schreiben. Hier eingehende E-Mails landen im Gespräch des Kunden.",
  },
  // A refused incoming address. Names the reason, because "it did not save"
  // sends the owner back to type the same thing again.
  "settings.inboundAddressTaken": {
    tr: "Bu adres başka bir işletmede kullanılıyor. Başka bir tane deneyin.",
    en: "Another business already uses this address. Try a different one.",
    de: "Diese Adresse wird bereits von einem anderen Betrieb genutzt. Versuchen Sie eine andere.",
  },
  "settings.inboundAddressRejected": {
    tr: "Bu adres kaydedilemedi. Sadece harf ve rakam kullanın.",
    en: "That address could not be saved. Use letters and numbers only.",
    de: "Diese Adresse konnte nicht gespeichert werden. Verwenden Sie nur Buchstaben und Ziffern.",
  },
  "settings.inboundNoDomain": {
    tr: "(alan adı henüz ayarlı değil)",
    en: "(no domain configured yet)",
    de: "(noch keine Domain eingerichtet)",
  },
  "settings.currency": { tr: "Para birimi", en: "Currency", de: "Währung" },
  "settings.currencyHint": {
    tr: "Fiyatların gösterildiği para birimi. Değiştirmek tutarları çevirmez.",
    en: "The currency prices are shown in. Changing it does not convert amounts.",
    de: "Die Währung, in der Preise angezeigt werden. Ein Wechsel rechnet Beträge nicht um.",
  },

  "email.noSubject": {
    tr: "(konu yok)",
    en: "(no subject)",
    de: "(kein Betreff)",
  },
  "email.reply": { tr: "Yanıtla", en: "Reply", de: "Antworten" },
  // The "•••" that reveals the quoted thread under a reply. Only ever a
  // tooltip and a screen-reader label — the control itself stays three dots,
  // the way every mail client draws it.
  "email.showQuoted": {
    tr: "Alıntılanan yazışmayı göster",
    en: "Show quoted text",
    de: "Zitierten Text anzeigen",
  },
  "email.compose": { tr: "E-posta yaz", en: "Compose", de: "Verfassen" },
  // The call card's expander: collected values + transcript unfold in place.
  "calls.details": { tr: "Ayrıntılar", en: "Details", de: "Details" },
  "calls.hideDetails": {
    tr: "Ayrıntıları gizle",
    en: "Hide details",
    de: "Details ausblenden",
  },
  // The clamp on a long email card — measured overflow only, so most cards
  // never show it.
  "email.showMore": { tr: "Devamını göster", en: "Show more", de: "Mehr anzeigen" },
  "email.showLess": { tr: "Daha az göster", en: "Show less", de: "Weniger anzeigen" },
  "email.subject": { tr: "Konu", en: "Subject", de: "Betreff" },
  "email.bodyPlaceholder": {
    tr: "Mesajınızı yazın…",
    en: "Write your message…",
    de: "Ihre Nachricht…",
  },
  "error.missing-email": {
    tr: "Bu müşterinin e-posta adresi yok",
    en: "This customer has no email address",
    de: "Dieser Kunde hat keine E-Mail-Adresse",
  },
  "error.no-from-address": {
    tr: "Gönderen adresi ayarlanmamış (İşletme ayarları)",
    en: "No sender address set (Business settings)",
    de: "Keine Absenderadresse hinterlegt (Betriebseinstellungen)",
  },
  // Meta template approval (convex/waTemplates.ts, the Templates card).
  "template.submit": { tr: "Onaya gönder", en: "Submit for approval", de: "Zur Prüfung senden" },
  "template.resubmit": { tr: "Yeniden gönder", en: "Resubmit", de: "Erneut senden" },
  "template.submitting": { tr: "Gönderiliyor…", en: "Submitting…", de: "Wird gesendet…" },
  "template.sync": { tr: "Meta ile eşitle", en: "Sync with Meta", de: "Mit Meta abgleichen" },
  "template.syncing": { tr: "Eşitleniyor…", en: "Syncing…", de: "Wird abgeglichen…" },
  // Said as a COUNT, because the useful answer to "did it work" is how many
  // of the salon's templates Meta actually recognised.
  "template.syncDone": {
    tr: "{n} şablon eşitlendi.",
    en: "{n} templates synced.",
    de: "{n} Vorlagen abgeglichen.",
  },
  "template.submitFailed": {
    tr: "Şablon gönderilemedi.",
    en: "The template could not be submitted.",
    de: "Die Vorlage konnte nicht gesendet werden.",
  },
  // The WABA id is the account the approval belongs to. Without it there is
  // nowhere to send the template, and the fix is one field on the WhatsApp
  // connection — so the message points at it rather than saying "failed".
  "template.noWabaId": {
    tr: "WhatsApp hesabı kimliği (WABA) eksik. WhatsApp bağlantısında girin.",
    en: "The WhatsApp account id (WABA) is missing. Add it on the WhatsApp connection.",
    de: "Die WhatsApp-Konto-ID (WABA) fehlt. Tragen Sie sie in der WhatsApp-Verbindung ein.",
  },
  "template.noBody": {
    tr: "Önce mesajı yazın.",
    en: "Write the message first.",
    de: "Schreiben Sie zuerst die Nachricht.",
  },
  "template.languageUnsupported": {
    tr: "Bu dil Meta'ya gönderilemiyor.",
    en: "This language can't be submitted to Meta.",
    de: "Diese Sprache kann nicht an Meta gesendet werden.",
  },
  "template.bodyTooLong": {
    tr: "Mesaj çok uzun (Meta sınırı 1024 karakter).",
    en: "The message is too long (Meta allows 1024 characters).",
    de: "Die Nachricht ist zu lang (Meta erlaubt 1024 Zeichen).",
  },
  "template.kindNotTemplated": {
    tr: "Bu mesaj onay gerektirmez — müşteri az önce yazdığı için doğrudan gider.",
    en: "This message needs no approval — the customer just wrote, so it goes straight out.",
    de: "Diese Nachricht braucht keine Freigabe — der Kunde hat gerade geschrieben, sie geht direkt raus.",
  },
  "template.metaUnreachable": {
    tr: "Meta'ya ulaşılamadı. Birazdan tekrar deneyin.",
    en: "Meta could not be reached. Try again shortly.",
    de: "Meta war nicht erreichbar. Versuchen Sie es gleich erneut.",
  },
  "template.metaRefused": {
    tr: "Meta şablonu kabul etmedi:",
    en: "Meta did not accept the template:",
    de: "Meta hat die Vorlage nicht angenommen:",
  },
  // Named, not summarised: the owner has to know WHICH words to take out, and
  // these tokens are legal everywhere else in the same message.
  "template.tokensNotSendable": {
    tr: "Bu alanlar onaylı şablonda kullanılamaz (e-posta ve dükkân telefonunda çalışır):",
    en: "These fields can't be used in an approved template (they still work on email and the shop phone):",
    de: "Diese Felder sind in einer freigegebenen Vorlage nicht möglich (per E-Mail und Ladentelefon funktionieren sie weiterhin):",
  },
  "error.evolution-no-reaction": {
    tr: "Tepkiler yalnızca Meta numarasından gönderilebilir.",
    en: "Reactions can only be sent from the Meta number.",
    de: "Reaktionen können nur über die Meta-Nummer gesendet werden.",
  },
  "error.no-wamid": {
    tr: "Bu mesaja tepki verilemiyor.",
    en: "This message can't be reacted to.",
    de: "Auf diese Nachricht kann nicht reagiert werden.",
  },
  "error.email-not-configured": {
    tr: "E-posta bağlı değil",
    en: "Email is not connected",
    de: "E-Mail ist nicht verbunden",
  },
  "nav.revenue": { tr: "Gelir", en: "Revenue", de: "Umsatz" },
  "revenue.today": { tr: "Bugün", en: "Today", de: "Heute" },
  "revenue.week": { tr: "Son 7 gün", en: "Last 7 days", de: "Letzte 7 Tage" },
  "revenue.month": { tr: "Son 30 gün", en: "Last 30 days", de: "Letzte 30 Tage" },
  "revenue.history": {
    tr: "Gelir geçmişi",
    en: "Revenue history",
    de: "Umsatzverlauf",
  },
  "revenue.none": {
    tr: "Tamamlanmış, fiyatı girilmiş randevu yok.",
    en: "No completed, priced appointments.",
    de: "Keine abgeschlossenen Termine mit Preis.",
  },
  "common.loadMore": { tr: "Daha fazla", en: "Load more", de: "Mehr laden" },
  "statusPill.upcoming": { tr: "Yaklaşan", en: "Upcoming", de: "Anstehend" },
  "statusPill.past": { tr: "Geçti", en: "Past", de: "Vorbei" },
  "statusPill.product": { tr: "Ürün", en: "Product", de: "Produkt" },
  "statusPill.paid": { tr: "Ödendi", en: "Paid", de: "Bezahlt" },
  "revenue.hideCancelled": {
    tr: "İptalleri gizle",
    en: "Hide cancelled",
    de: "Stornierte ausblenden",
  },
  "revenue.selected": {
    tr: "{n} seçildi",
    en: "{n} selected",
    de: "{n} ausgewählt",
  },
  "settings.revenueEnabled": {
    tr: "Gelir sekmesi",
    en: "Revenue tab",
    de: "Umsatz-Tab",
  },
  "settings.revenueEnabledHint": {
    tr: "Tamamlanan randevuların toplamını gösteren sekmeyi açar. Fiyat girmiyorsanız kapalı bırakın.",
    en: "Shows a tab totalling completed appointments. Leave it off if you don't enter prices.",
    de: "Zeigt einen Tab mit der Summe abgeschlossener Termine. Lassen Sie ihn aus, wenn Sie keine Preise erfassen.",
  },
  // The two ways a product order can reach a customer. Only shown to a
  // business that sells products at all — a salon selling hours has nothing to
  // hand over. Both on unless somebody says otherwise, and the last one cannot
  // be switched off: a business offering neither cannot sell a product.
  "settings.fulfillment": {
    tr: "Ürün siparişleri",
    en: "Product orders",
    de: "Produktbestellungen",
  },
  "settings.fulfillmentHint": {
    tr: "Ürünlerinizi müşterilerinizin nasıl alabileceği. Kapattığınız seçenek randevu sayfasında görünmez; ikisini birden kapatamazsınız. Saat gerektiren hizmetleri etkilemez.",
    en: "How customers can get your products. An option you switch off disappears from your booking page; you can't switch off both. Time-bound services are unaffected.",
    de: "Wie Ihre Kundschaft Ihre Produkte erhalten kann. Eine abgeschaltete Option verschwindet von Ihrer Buchungsseite; beide abschalten geht nicht. Zeitgebundene Leistungen bleiben unberührt.",
  },
  "forms.title": { tr: "Form", en: "Form", de: "Formular" },
  "forms.name": { tr: "Adınız", en: "Your name", de: "Ihr Name" },
  "forms.phone": { tr: "Telefon", en: "Phone", de: "Telefon" },
  "forms.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  // The public booking page (/book/<slug>) and the manage page (/appt/<token>).
  // Singular ("Choose a service") until the step went multi-select, where it
  // both undercounted and collided with the "Services" group heading directly
  // beneath it. Phrased as the question the customer is actually answering, so
  // it covers a shampoo as readily as a haircut and stops naming the thing its
  // own subheadings name.
  "booking.pickService": {
    tr: "Ne yaptırmak istersiniz?",
    en: "What would you like?",
    de: "Was darf es sein?",
  },
  // The two kinds of thing a salon sells, as section headings on the booking
  // page. Only drawn when it sells both.
  "booking.services": { tr: "Hizmetler", en: "Services", de: "Leistungen" },
  "booking.products": { tr: "Ürünler", en: "Products", de: "Produkte" },
  // The collapsed basket, for two lines or more — one line just names itself.
  // "kalem" and "Positionen" are what a receipt calls its lines in Turkish and
  // German; "items" covers a haircut and a shampoo in one word, which "service"
  // does not.
  // The booking page's note box. Phrased as a question rather than labelled
  // "Notes": a blank box under a noun gets left blank, and what the salon
  // actually wants is the allergy, the parking question, the second person
  // coming along.
  "booking.noMatches": {
    tr: "Bu aramaya uyan bir şey yok.",
    en: "Nothing matches that search.",
    de: "Dazu passt nichts.",
  },
  "booking.note": { tr: "Not", en: "Note", de: "Notiz" },
  "booking.notePlaceholder": {
    tr: "Bilmemiz gereken bir şey var mı?",
    en: "Anything we should know?",
    de: "Etwas, das wir wissen sollten?",
  },
  "booking.itemCount": { tr: "{n} kalem", en: "{n} items", de: "{n} Positionen" },
  // Shown once the basket is full, in place of nothing at all. The server caps
  // a booking at MAX_LINES_PER_BOOKING; without this the page let a customer
  // tick past it and the refusal arrived after they had typed their phone
  // number, as a generic failure.
  "booking.maxLines": {
    tr: "Tek seferde en fazla {n} kalem seçebilirsiniz.",
    en: "You can book up to {n} items at a time.",
    de: "Sie können bis zu {n} Positionen auf einmal buchen.",
  },
  // The sticky bar's action on the first step. It exists because that step
  // became multi-select — the other two still advance on the tap.
  "booking.continue": { tr: "Devam", en: "Continue", de: "Weiter" },
  "booking.pickTime": {
    tr: "Gün ve saat seçin",
    en: "Pick a day and time",
    de: "Tag und Uhrzeit wählen",
  },
  "booking.noSlots": {
    tr: "Bu gün için uygun saat yok. Başka bir gün deneyin.",
    en: "No free times on this day. Try another one.",
    de: "An diesem Tag ist nichts frei. Versuchen Sie einen anderen.",
  },
  // The slot grid's three shelves. Cut at 12:00 and 17:00 — coarse on
  // purpose; the labels group, they do not define working hours.
  "booking.morning": { tr: "Sabah", en: "Morning", de: "Vormittag" },
  "booking.afternoon": {
    tr: "Öğleden sonra",
    en: "Afternoon",
    de: "Nachmittag",
  },
  "booking.evening": { tr: "Akşam", en: "Evening", de: "Abend" },
  // The goods-only fork. A basket with no time-bound line books no chair, so
  // instead of the calendar it is asked how the order reaches its customer —
  // picked up or delivered — and then when: right away, or a chosen time.
  "booking.fulfillmentTitle": {
    tr: "Siparişinizi nasıl alırsınız?",
    en: "How would you like to get your order?",
    de: "Wie möchten Sie Ihre Bestellung erhalten?",
  },
  "booking.pickup": { tr: "Gel al", en: "Pickup", de: "Abholung" },
  "booking.delivery": { tr: "Teslimat", en: "Delivery", de: "Lieferung" },
  "booking.pickupHint": {
    tr: "Siparişinizi gelip teslim alın",
    en: "Come by and collect your order",
    de: "Bestellung vor Ort abholen",
  },
  "booking.deliveryHint": {
    tr: "Adresinize gönderelim",
    en: "We bring it to your address",
    de: "Wir liefern an Ihre Adresse",
  },
  // The goods time step's heading and its first option. ASAP books at the
  // moment of ordering — no calendar involved — which is why it sits above
  // the day strip rather than inside it.
  "booking.whenTitle": {
    tr: "Ne zaman olsun?",
    en: "When would you like it?",
    de: "Wann darf es sein?",
  },
  "booking.asap": {
    tr: "En kısa sürede",
    en: "As soon as possible",
    de: "So bald wie möglich",
  },
  // Delivery only. The address is a fact about THIS order and lands on it,
  // never on the customer record.
  "booking.address": { tr: "Adres", en: "Address", de: "Adresse" },
  "booking.addressPlaceholder": {
    tr: "Teslimat adresiniz",
    en: "Where should we deliver?",
    de: "Wohin dürfen wir liefern?",
  },
  // Order wording for the goods-only lane. "Randevuyu al" over a towel is a
  // category error — nothing was scheduled, something was ordered.
  "booking.order": {
    tr: "Siparişi ver",
    en: "Place order",
    de: "Bestellung aufgeben",
  },
  "booking.ordered": {
    tr: "Siparişiniz alındı!",
    en: "Order received!",
    de: "Ihre Bestellung ist eingegangen!",
  },
  "booking.manageOrder": {
    tr: "Siparişi görüntüle, değiştir veya iptal et",
    en: "View, change or cancel this order",
    de: "Bestellung ansehen, ändern oder stornieren",
  },
  // The race: the business switched pickup or delivery off while this page was
  // open. Rare, and worth its own words — "something went wrong" over a choice
  // the page itself offered reads as the product breaking.
  "booking.notOffered": {
    tr: "Bu teslim seçeneği artık sunulmuyor. Lütfen diğerini seçin.",
    en: "That option isn't offered any more. Please pick the other one.",
    de: "Diese Option wird nicht mehr angeboten. Bitte wählen Sie die andere.",
  },
  "booking.cancelOrder": {
    tr: "Siparişi iptal et",
    en: "Cancel order",
    de: "Bestellung stornieren",
  },
  "booking.orderCancelled": {
    tr: "Bu sipariş iptal edildi.",
    en: "This order is cancelled.",
    de: "Diese Bestellung ist storniert.",
  },
  "booking.book": {
    tr: "Randevuyu al",
    en: "Book it",
    de: "Termin buchen",
  },
  "booking.booked": {
    tr: "Randevunuz alındı!",
    en: "You're booked!",
    de: "Ihr Termin ist gebucht!",
  },
  // Under "You're booked!" and under a move on the manage page, naming the
  // channel the confirmation is really coming by (booking.book /
  // booking.reschedule return it as confirmBy, from the send path's own
  // predicates). Nothing is shown when none is coming: no live booking rule,
  // no consent on record, or no channel that can carry it. The single line
  // these replaced promised "WhatsApp or email" in every one of those cases.
  "booking.confirmationWhatsApp": {
    tr: "Onay mesajınız WhatsApp ile geliyor.",
    en: "Your confirmation is on its way by WhatsApp.",
    de: "Ihre Bestätigung kommt per WhatsApp.",
  },
  "booking.confirmationEmail": {
    tr: "Onay mesajınız e-postayla geliyor.",
    en: "Your confirmation is on its way by email.",
    de: "Ihre Bestätigung kommt per E-Mail.",
  },
  "booking.confirmationBoth": {
    tr: "Onay mesajınız WhatsApp ve e-postayla geliyor.",
    en: "Your confirmation is on its way by WhatsApp and email.",
    de: "Ihre Bestätigung kommt per WhatsApp und E-Mail.",
  },
  "booking.manageThis": {
    tr: "Randevuyu görüntüle, değiştir veya iptal et",
    en: "View, change or cancel this appointment",
    de: "Termin ansehen, verschieben oder stornieren",
  },
  "booking.slotTaken": {
    tr: "Bu saat az önce doldu. Lütfen başka bir saat seçin.",
    en: "That time just filled up. Please pick another.",
    de: "Diese Zeit wurde gerade vergeben. Bitte wählen Sie eine andere.",
  },
  // Not the same as slotTaken, and saying so matters: the salon has room, the
  // person does not. Told plainly, the reader knows to pick a later time
  // rather than assume the shop is full.
  // The manage page, past the daily change cap (lib/agentChange.ts): every
  // move re-sends the confirmation, so changes stop for the day.
  "booking.tooManyChanges": {
    tr: "Bu randevu bugün yeterince değiştirildi. Yeni bir değişiklik için lütfen işletmeyi arayın.",
    en: "This appointment has been changed enough times today. To change it again, please call the business.",
    de: "Dieser Termin wurde heute schon oft genug geändert. Für eine weitere Änderung rufen Sie bitte den Betrieb an.",
  },
  "booking.customerBusy": {
    tr: "Bu saatte zaten bir randevunuz var. Lütfen daha sonrası için bir saat seçin.",
    en: "You already have an appointment at that time. Please pick a later one.",
    de: "Sie haben zu dieser Zeit bereits einen Termin. Bitte wählen Sie eine spätere Zeit.",
  },
  "booking.tooMany": {
    tr: "Bu numarada zaten birçok açık randevu var. Lütfen bizi arayın.",
    en: "This number already holds several open bookings. Please call us.",
    de: "Unter dieser Nummer laufen bereits mehrere Termine. Bitte rufen Sie uns an.",
  },
  "booking.callInstead": {
    tr: "Online randevu şu anda kapalı. Lütfen bizi arayın veya mesaj atın.",
    en: "Online booking isn't available right now. Please call or message us.",
    de: "Die Online-Buchung ist derzeit nicht verfügbar. Bitte rufen Sie uns an oder schreiben Sie uns.",
  },
  "booking.reschedule": {
    tr: "Saati değiştir",
    en: "Reschedule",
    de: "Verschieben",
  },
  "booking.cancel": {
    tr: "Randevuyu iptal et",
    en: "Cancel appointment",
    de: "Termin stornieren",
  },
  "booking.cancelConfirm": {
    tr: "Evet, iptal et",
    en: "Yes, cancel it",
    de: "Ja, stornieren",
  },
  "booking.cancelled": {
    tr: "Bu randevu iptal edildi.",
    en: "This appointment is cancelled.",
    de: "Dieser Termin ist storniert.",
  },
  // The confirmation it re-sends is the booking.confirmation* line under it,
  // shown only when one is really coming.
  "booking.moved": {
    tr: "Randevunuz yeni saate taşındı.",
    en: "Your appointment has been moved.",
    de: "Ihr Termin wurde verschoben.",
  },
  "booking.callToChange": {
    tr: "Bu randevuyu değiştirmek için lütfen bizi arayın:",
    en: "To change this appointment, please call us:",
    de: "Um diesen Termin zu ändern, rufen Sie uns bitte an:",
  },
  // Worn by /book and /appt when the link resolves to nothing — a stale link,
  // or a page the business switched off. Neither surface is a "form".
  "forms.notFound": {
    tr: "Bu sayfa şu anda kullanılamıyor.",
    en: "This page isn't available.",
    de: "Diese Seite ist nicht verfügbar.",
  },
  "forms.badPhone": {
    tr: "Telefon numarası geçerli görünmüyor.",
    en: "That phone number doesn't look right.",
    de: "Diese Telefonnummer sieht nicht korrekt aus.",
  },
  "forms.failed": {
    tr: "Gönderilemedi, lütfen tekrar deneyin.",
    en: "Couldn't send — please try again.",
    de: "Konnte nicht gesendet werden — bitte erneut versuchen.",
  },
  "notes.title": { tr: "Notlar", en: "Notes", de: "Notizen" },
  "notes.none": {
    tr: "Henüz not yok",
    en: "No notes yet",
    de: "Noch keine Notizen",
  },
  "notes.placeholder": {
    tr: "Not yaz…",
    en: "Write a note…",
    de: "Notiz schreiben…",
  },
  "notes.add": { tr: "Not ekle", en: "Add note", de: "Notiz hinzufügen" },
  // Every note names who wrote it. When the author's record carries no name
  // and no email there is still something true to say, and it beats a blank
  // byline on a record three people share.
  "notes.systemAuthor": { tr: "Sistem", en: "System", de: "System" },
  "notes.edit": { tr: "Düzenle", en: "Edit", de: "Bearbeiten" },
  "notes.edited": { tr: "düzenlendi", en: "edited", de: "bearbeitet" },
  "notes.deleteConfirm": {
    tr: "Bu not silinsin mi?",
    en: "Delete this note?",
    de: "Diese Notiz löschen?",
  },
  // Delivery state and failure reasons in the reader's language. The stored
  // values stay the English slugs; these are what a salon owner reads.
  "message.queued": { tr: "sırada", en: "queued", de: "in Warteschlange" },
  "message.sent": { tr: "gönderildi", en: "sent", de: "gesendet" },
  "message.delivered": { tr: "iletildi", en: "delivered", de: "zugestellt" },
  "message.read": { tr: "okundu", en: "read", de: "gelesen" },
  "message.failed": {
    tr: "gönderilemedi",
    en: "not sent",
    de: "nicht gesendet",
  },
  "message.react": { tr: "Tepki ver", en: "React", de: "Reagieren" },
  "message.reactionRemove": {
    tr: "Tepkiyi kaldır",
    en: "Remove reaction",
    de: "Reaktion entfernen",
  },
  // Why a reaction refused to send. The window is Meta's rule, not ours, and
  // the person clicking an emoji deserves the reason rather than a shrug.
  "message.reactionFailed": {
    tr: "Tepki gönderilemedi.",
    en: "The reaction could not be sent.",
    de: "Die Reaktion konnte nicht gesendet werden.",
  },
  // Any attachment, not only a photo — the row exists before the bytes do
  // whatever kind of file is on its way.
  "message.mediaLoading": {
    tr: "Dosya yükleniyor…",
    en: "Loading attachment…",
    de: "Anhang wird geladen…",
  },
  "message.scheduleAt": {
    tr: "Sonra gönder",
    en: "Send later",
    de: "Später senden",
  },
  "message.scheduleHint": {
    tr: "Boş bırakırsanız hemen gönderilir.",
    en: "Leave empty to send now.",
    de: "Leer lassen, um sofort zu senden.",
  },
  "message.quoteYou": { tr: "Siz", en: "You", de: "Sie" },
  "message.reply": { tr: "Yanıtla", en: "Reply", de: "Antworten" },
  "message.quoteMedia": { tr: "Medya", en: "Media", de: "Medien" },
  "message.template": {
    tr: "Şablon mesajı",
    en: "Template message",
    de: "Vorlagennachricht",
  },
  "error.wa-not-configured": {
    tr: "WhatsApp bağlı değil",
    en: "WhatsApp not connected",
    de: "WhatsApp nicht verbunden",
  },
  "error.no-consent": {
    tr: "Müşteri izni yok",
    en: "No consent from customer",
    de: "Keine Einwilligung des Kunden",
  },
  // Sending a suggested reply that would also book, move or cancel: the
  // change is made FIRST and the reply goes only if it took (2026-10-13).
  // Each of these but the last means nothing went to the customer.
  "error.change-slot-taken": {
    tr: "Randevu değiştirilmedi: o saat artık dolu. Yanıt gönderilmedi.",
    en: "The appointment was not changed: that time is no longer free. The reply was not sent.",
    de: "Der Termin wurde nicht geändert: Die Zeit ist nicht mehr frei. Die Antwort wurde nicht gesendet.",
  },
  "error.change-customer-busy": {
    tr: "Randevu değiştirilmedi: müşterinin o saatte başka bir randevusu var. Yanıt gönderilmedi.",
    en: "The appointment was not changed: the customer already has an appointment at that time. The reply was not sent.",
    de: "Der Termin wurde nicht geändert: Der Kunde hat zu dieser Zeit schon einen Termin. Die Antwort wurde nicht gesendet.",
  },
  "error.change-time-not-allowed": {
    tr: "Randevu değiştirilmedi: o saat çalışma saatlerinizin dışında ya da artık mümkün değil. Yanıt gönderilmedi.",
    en: "The appointment was not changed: that time is outside your opening hours or no longer possible. The reply was not sent.",
    de: "Der Termin wurde nicht geändert: Die Zeit liegt außerhalb Ihrer Öffnungszeiten oder ist nicht mehr möglich. Die Antwort wurde nicht gesendet.",
  },
  "error.change-appointment-changed": {
    tr: "Randevu, taslak yazıldıktan sonra değişti. Hiçbir şey değiştirilmedi ve yanıt gönderilmedi.",
    en: "The appointment changed after the draft was written. Nothing was changed and the reply was not sent.",
    de: "Der Termin hat sich geändert, nachdem der Entwurf geschrieben wurde. Es wurde nichts geändert und die Antwort nicht gesendet.",
  },
  "error.change-too-many": {
    tr: "Bu müşterinin randevuları bugün asistan üzerinden çok kez değiştirildi. Yanıt gönderilmedi; değişikliği takvimden kendiniz yapabilirsiniz.",
    en: "This customer's appointments were changed through the assistant too many times today. The reply was not sent; you can make the change yourself in the calendar.",
    de: "Die Termine dieses Kunden wurden heute zu oft über den Assistenten geändert. Die Antwort wurde nicht gesendet; Sie können die Änderung selbst im Kalender vornehmen.",
  },
  "error.change-too-many-upcoming": {
    tr: "Randevu oluşturulmadı: müşterinin yaklaşan randevu sayısı üst sınırda. Yanıt gönderilmedi.",
    en: "The appointment was not booked: the customer already holds as many upcoming appointments as one person can. The reply was not sent.",
    de: "Der Termin wurde nicht gebucht: Der Kunde hat bereits so viele anstehende Termine, wie eine Person haben kann. Die Antwort wurde nicht gesendet.",
  },
  "error.change-failed": {
    tr: "Takvimdeki değişiklik yapılamadı, bu yüzden yanıt gönderilmedi.",
    en: "The calendar change could not be made, so the reply was not sent.",
    de: "Die Änderung im Kalender war nicht möglich, deshalb wurde die Antwort nicht gesendet.",
  },
  "error.change-needs-plain-send": {
    tr: "Bu taslak bir randevuyu da değiştiriyor. Değişiklikle göndermek için eki, alıntıyı ya da zamanlamayı kaldırın; değişiklik olmadan göndermek için önce × ile değişikliği kaldırın.",
    en: "This draft also changes an appointment. To send it with the change, remove the attachment, quote or schedule. To send without it, remove the change with × first.",
    de: "Dieser Entwurf ändert auch einen Termin. Um ihn mit der Änderung zu senden, entfernen Sie Anhang, Zitat oder Zeitplanung. Um ihn ohne Änderung zu senden, entfernen Sie die Änderung zuerst mit ×.",
  },
  "error.changed-not-sent": {
    tr: "Randevu değişikliği yapıldı ama yanıt gönderilemedi. Müşteriye kendiniz yazın.",
    en: "The appointment change was made, but the reply did not send. Write to the customer yourself.",
    de: "Die Terminänderung wurde vorgenommen, aber die Antwort ging nicht raus. Schreiben Sie dem Kunden selbst.",
  },
  "error.session-window-closed": {
    tr: "24 saatlik pencere kapalı",
    en: "24h window closed",
    de: "24-Stunden-Fenster geschlossen",
  },
  "error.no-template": {
    tr: "Onaylı şablon yok",
    en: "No approved template",
    de: "Keine genehmigte Vorlage",
  },
  "error.missing-phone": {
    tr: "Telefon numarası yok",
    en: "No phone number",
    de: "Keine Telefonnummer",
  },
  "error.agent-not-configured": {
    tr: "Sesli asistan bağlı değil",
    en: "Voice agent not connected",
    de: "Sprachassistent nicht verbunden",
  },
  "error.no-calendar-connected": {
    tr: "cal.com bağlı değil",
    en: "cal.com not connected",
    de: "cal.com nicht verbunden",
  },

  "settings.title": { tr: "Ayarlar", en: "Settings", de: "Einstellungen" },
  // Settings section chips reuse their card titles (Reminders, WhatsApp,
  // Bookings, Voice agent) so a chip and its card never disagree.
  // The tab is already called Business, and the first field on the card is
  // "Business name" — a chip and a card title saying it again put the word on
  // screen four times for three different scopes. General is what the rest of
  // the industry calls this card, and it leaves "Business" meaning one thing.
  "settings.general": { tr: "Genel", en: "General", de: "Allgemein" },
  "settings.logo": { tr: "Logo", en: "Logo", de: "Logo" },
  "settings.logoHint": {
    tr: "Randevu sayfanızın başında görünür. Kare ve en az 200×200 piksel bir görsel en iyi sonucu verir.",
    en: "Shown at the top of your booking page. A square image of at least 200×200 pixels works best.",
    de: "Erscheint oben auf Ihrer Buchungsseite. Am besten ein quadratisches Bild mit mindestens 200×200 Pixeln.",
  },
  "settings.logoUpload": {
    tr: "Logo yükle",
    en: "Upload logo",
    de: "Logo hochladen",
  },
  "settings.logoRemove": { tr: "Kaldır", en: "Remove", de: "Entfernen" },
  // Services and contact fields under one chip because they are one surface:
  // both are what this business's own vocabulary is, and both hand the voice
  // agent a key it books or writes by. Splitting them would put half of the
  // agent's contract on another screen.
  "settings.catalogue": {
    tr: "Hizmetler ve alanlar",
    en: "Services & fields",
    de: "Leistungen & Felder",
  },
  "settings.business": { tr: "İşletme", en: "Business", de: "Betrieb" },
  "settings.businessName": {
    tr: "İşletme adı",
    en: "Business name",
    de: "Betriebsname",
  },
  // Says the consequence before the owner discovers it. The link is derived
  // from this field, so a rename moves the page — and the link is already out
  // there, in sent messages and on a card.
  "settings.businessNameHint": {
    tr: "Online randevu sayfanızın adresi bu isimden türetilir. İsmi değiştirirseniz link de değişir ve eski link artık açılmaz.",
    en: "Your online booking page address comes from this name. Change the name and the link changes with it — the old one stops opening.",
    de: "Die Adresse Ihrer Online-Buchungsseite entsteht aus diesem Namen. Ändern Sie den Namen, ändert sich der Link mit — der alte öffnet dann nicht mehr.",
  },
  // Names the real reason. "That name is taken" alone reads as petty
  // gatekeeping; the booking page is why it cannot be shared.
  "settings.nameTaken": {
    tr: "Bu ismi başka bir işletme kullanıyor. Randevu sayfanızın adresi isminizden türediği için isimler benzersiz olmalı — ayırt edici bir şey ekleyin.",
    en: "Another business already uses this name. Booking page addresses come from the name, so names have to be unique — add something that tells yours apart.",
    de: "Diesen Namen nutzt bereits ein anderer Betrieb. Die Adresse der Buchungsseite entsteht aus dem Namen, deshalb müssen Namen eindeutig sein — ergänzen Sie etwas Unterscheidendes.",
  },
  "settings.nameRejected": {
    tr: "İsim kaydedilemedi. Lütfen tekrar deneyin.",
    en: "That name could not be saved. Please try again.",
    de: "Der Name konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
  },
  "settings.timezone": { tr: "Saat dilimi", en: "Timezone", de: "Zeitzone" },
  "settings.timezoneHint": {
    tr: "Randevu saatleri, hatırlatmalar ve gün sonu bu saat dilimine göre hesaplanır.",
    en: "Appointment times, reminders and the end of the day are all worked out in this zone.",
    de: "Terminzeiten, Erinnerungen und das Tagesende richten sich nach dieser Zeitzone.",
  },
  "settings.timezoneSearch": {
    tr: "Şehir veya bölge ara…",
    en: "Search city or region…",
    de: "Stadt oder Region suchen…",
  },
  "settings.timezoneNone": {
    tr: "Eşleşen saat dilimi yok.",
    en: "No timezones found.",
    de: "Keine Zeitzonen gefunden.",
  },
  // Not "Language": that is what the account menu now calls the interface
  // setting, and the two were indistinguishable while sharing a word. This one
  // reaches customers.
  // "Message language" until 2026-08-20, which named one of its jobs. It is
  // the language of everything a CUSTOMER meets — the messages, the booking
  // page, the page they manage the appointment from — while the owner reads
  // the app in whatever their account menu says. The old name let the booking
  // page drift onto the viewer's setting for months without anyone reading
  // this row and noticing it should have covered that too.
  "settings.language": {
    tr: "Müşteri dili",
    en: "Customer language",
    de: "Kundensprache",
  },
  "settings.languageHint": {
    tr: "Müşterilerinizin gördüğü dil: gönderilen mesajlar, randevu sayfanız ve randevu yönetim sayfası. Onaylı WhatsApp şablonunu da bu seçer — bu dilde onaylı şablon yoksa gönderim yapılamaz. Uygulamayı kendi dilinizde görmek için hesap menüsündeki dil ayarını kullanın.",
    en: "The language your customers see: the messages you send, your booking page, and the page they manage an appointment from. It also selects the approved WhatsApp template, so a language with no approved template cannot send. To read the app in your own language, use the language setting in your account menu.",
    de: "Die Sprache, die Ihre Kundschaft sieht: gesendete Nachrichten, Ihre Buchungsseite und die Seite zur Terminverwaltung. Sie wählt auch die freigegebene WhatsApp-Vorlage — ohne Vorlage in dieser Sprache kann nichts gesendet werden. Für die App in Ihrer eigenen Sprache nutzen Sie die Spracheinstellung im Kontomenü.",
  },
  "settings.languageChange": {
    tr: "Müşteri dilini değiştir",
    en: "Change customer language",
    de: "Kundensprache ändern",
  },
  "settings.languageChangeBody": {
    tr: "Bu ayar, asistanın dilini bilmediği müşterilere hangi dilde yanıt vereceğini, otomatik mesajların dilini ve kampanya şablonunu değiştirir. Onaylı şablonlar ve mevcut randevular olduğu gibi kalır.",
    en: "This changes which language the assistant falls back to for customers it doesn't know yet, the language of your automated messages, and the campaign template. Approved templates and existing appointments stay as they are.",
    de: "Diese Einstellung ändert, in welcher Sprache der Assistent unbekannten Kundinnen und Kunden antwortet, die Sprache der automatischen Nachrichten und die Kampagnenvorlage. Genehmigte Vorlagen und bestehende Termine bleiben unverändert.",
  },
  "settings.languageChangeConfirm": {
    tr: "Değiştir",
    en: "Change",
    de: "Ändern",
  },
  // Three words. It sits inline beside the currency select, where the example
  // it used to carry ("₺350.00 rather than ₺350") made the row read as a
  // sentence rather than a control — and the switch demonstrates itself the
  // moment anyone flips it.
  "settings.priceDecimals": {
    tr: "Kuruşları göster",
    en: "Show decimals",
    de: "Nachkommastellen",
  },
  "settings.sendConfirmation": {
    tr: "Randevu alındığında onay mesajı gönder",
    en: "Send a confirmation when a booking is made",
    de: "Bestätigung senden, sobald ein Termin gebucht wird",
  },

  // Notification rules table. Column headers stay one word each — they sit
  // above a row that already reads as a sentence ("1 gün önce · Hatırlatma ·
  // WhatsApp"), so a longer header would only compete with it.
  "settings.rulesHint": {
    tr: "Her satır bir kural: ne zaman gönderileceği, hangi mesaj, hangi kanal. Kapatılan hatırlatma satırı listeden çıkar.",
    en: "Each row is a rule — when it fires, which message, which channel. Switching a reminder off removes its row.",
    de: "Jede Zeile ist eine Regel: wann sie ausgelöst wird, welche Nachricht, welcher Kanal. Wird eine Erinnerung ausgeschaltet, verschwindet ihre Zeile.",
  },
  "settings.rulesWhen": { tr: "Ne zaman", en: "When", de: "Wann" },
  "settings.rulesWhat": { tr: "Mesaj", en: "Message", de: "Nachricht" },
  "settings.rulesWhere": { tr: "Kanal", en: "Channel", de: "Kanal" },
  "settings.ruleConfirmation": {
    tr: "Onay",
    en: "Confirmation",
    de: "Bestätigung",
  },
  "settings.ruleReminder": {
    tr: "Hatırlatma",
    en: "Reminder",
    de: "Erinnerung",
  },
  "settings.ruleWinback": {
    tr: "Geri kazanım",
    en: "Win-back",
    de: "Rückgewinnung",
  },
  "settings.ruleWhenBooked": {
    tr: "Randevu alındığında",
    en: "When booked",
    de: "Bei der Buchung",
  },
  // The unit beside an editable number, so it agrees with the number: "1 day
  // after a no-show", never "1 days".
  "settings.ruleDaysAfterNoShow.one": {
    tr: "gün sonra, gelmeyen müşteriye",
    en: "day after a no-show",
    de: "Tag nach einem Nichterscheinen",
  },
  "settings.ruleDaysAfterNoShow.other": {
    tr: "gün sonra, gelmeyen müşteriye",
    en: "days after a no-show",
    de: "Tage nach einem Nichterscheinen",
  },
  "settings.ruleWinbackHint": {
    tr: "Randevusuna gelmeyen müşteriye tek bir mesaj gider. Zaten gönderilmiş bir geri kazanım tekrarlanmaz.",
    en: "One message to a customer who didn't show up. A win-back already sent is never repeated.",
    de: "Eine einzige Nachricht an Kundinnen und Kunden, die nicht erschienen sind. Eine bereits gesendete Rückgewinnung wird nicht wiederholt.",
  },
  // "Add reminder" until 2026-08-19, and wrong for the same reason the tab
  // was: five of the six things this sheet adds are not reminders. "Add
  // message" until 2026-08-26, when the tab became Automations — the button
  // and the sheet it opens follow the tab's vocabulary.
  "settings.ruleAdd": {
    tr: "Otomasyon ekle",
    en: "Add automation",
    de: "Automatisierung hinzufügen",
  },
  // The add sheet. It replaced a row of preset chips ("+ 2 days before",
  // "+ 1 hour before"), which could only ever offer the handful of timings
  // somebody guessed in advance — a salon that wants 36 hours had no way in.
  // So: pick the message, then type the number and choose the unit.
  "settings.ruleAddPick": {
    tr: "Hangi otomasyon",
    en: "Which automation",
    de: "Welche Automatisierung",
  },
  "settings.ruleAddTiming": {
    tr: "Ne zaman gönderilsin",
    en: "When it sends",
    de: "Wann sie gesendet wird",
  },
  // Options of the unit picker beside the typed amount, so "1" reads "1 hour".
  "settings.ruleUnitHours.one": { tr: "saat", en: "hour", de: "Stunde" },
  "settings.ruleUnitHours.other": { tr: "saat", en: "hours", de: "Stunden" },
  "settings.ruleUnitDays.one": { tr: "gün", en: "day", de: "Tag" },
  "settings.ruleUnitDays.other": { tr: "gün", en: "days", de: "Tage" },
  "settings.ruleBeforeAppointment": {
    tr: "Randevudan önce",
    en: "Before the appointment",
    de: "Vor dem Termin",
  },
  "settings.ruleAfterAppointment": {
    tr: "Randevu bittikten sonra",
    en: "After the appointment",
    de: "Nach dem Termin",
  },
  "settings.ruleAfterNoShow": {
    tr: "Randevusuna gelmeyen müşteriye",
    en: "After a no-show",
    de: "Nach einem Nichterscheinen",
  },
  // Shown on a type that can only exist once and already does. Greyed rather
  // than dropped: a list whose entries vanish never teaches anyone what the
  // list contains.
  "settings.ruleAlreadyAdded": {
    tr: "Zaten eklendi",
    en: "Already added",
    de: "Bereits hinzugefügt",
  },
  "settings.ruleExists": {
    tr: "Bu zamanlamada bir kural zaten var.",
    en: "A rule already sends at that time.",
    de: "Zu diesem Zeitpunkt sendet bereits eine Regel.",
  },
  "settings.ruleRange": {
    tr: "{min} ile {max} {unit} arasında olmalı.",
    en: "Must be between {min} and {max} {unit}.",
    de: "Muss zwischen {min} und {max} {unit} liegen.",
  },
  "settings.ruleFollowup": {
    tr: "Randevu sonrası",
    en: "Follow-up",
    de: "Nach dem Termin",
  },
  "settings.ruleCancellation": {
    tr: "İptal bildirimi",
    en: "Cancellation notice",
    de: "Stornomitteilung",
  },
  "settings.ruleWhenCancelled": {
    tr: "Randevu iptal edildiğinde",
    en: "When cancelled",
    de: "Bei Stornierung",
  },
  "settings.ruleOutOfHours": {
    tr: "Kapalıyken otomatik yanıt",
    en: "Away reply",
    de: "Abwesenheitsantwort",
  },
  "settings.ruleWhenClosed": {
    tr: "Kapalıyken mesaj gelince",
    en: "When a message arrives while closed",
    de: "Bei Nachricht außerhalb der Öffnungszeiten",
  },
  // What actually gates the send: opening hours have to exist (Business →
  // Hours), and each customer gets at most one reply per day per channel.
  "settings.ruleOutOfHoursHint": {
    tr: "Çalışma saatleri dışında yazan müşteriye tek bir otomatik yanıt gider — kanal başına günde en fazla bir kez. Business → Saatler'de çalışma saatleri tanımlı olmalı.",
    en: "One automatic reply to a customer who writes outside opening hours — at most once a day per channel. Opening hours must be set in Business → Hours.",
    de: "Eine automatische Antwort an Kundinnen und Kunden, die außerhalb der Öffnungszeiten schreiben — höchstens einmal täglich pro Kanal. Die Öffnungszeiten müssen unter Business → Öffnungszeiten hinterlegt sein.",
  },
  "settings.ruleHoursAfterEnd.one": {
    tr: "saat sonra, randevu bitince",
    en: "hour after the appointment",
    de: "Stunde nach dem Termin",
  },
  "settings.ruleHoursAfterEnd.other": {
    tr: "saat sonra, randevu bitince",
    en: "hours after the appointment",
    de: "Stunden nach dem Termin",
  },
  "settings.ruleHoursBefore.one": {
    tr: "saat önce",
    en: "hour before",
    de: "Stunde vorher",
  },
  "settings.ruleHoursBefore.other": {
    tr: "saat önce",
    en: "hours before",
    de: "Stunden vorher",
  },
  // The list rows' whole sentences (Serdar, 2026-08-28: "Randevudan 2 saat
  // önce" over "2 saat önce" — the row must say what the clock counts from).
  // Pairs since a one-day win-back read "1 days after a no-show".
  "settings.ruleWhenBeforeFull.one": {
    tr: "Randevudan {n} saat önce",
    en: "{n} hour before the appointment",
    de: "{n} Stunde vor dem Termin",
  },
  "settings.ruleWhenBeforeFull.other": {
    tr: "Randevudan {n} saat önce",
    en: "{n} hours before the appointment",
    de: "{n} Stunden vor dem Termin",
  },
  "settings.ruleWhenAfterEndFull.one": {
    tr: "Randevu bittikten {n} saat sonra",
    en: "{n} hour after the appointment",
    de: "{n} Stunde nach dem Termin",
  },
  "settings.ruleWhenAfterEndFull.other": {
    tr: "Randevu bittikten {n} saat sonra",
    en: "{n} hours after the appointment",
    de: "{n} Stunden nach dem Termin",
  },
  "settings.ruleWhenNoShowFull.one": {
    tr: "Gelmeyen müşteriye {n} gün sonra",
    en: "{n} day after a no-show",
    de: "{n} Tag nach einem Nichterscheinen",
  },
  "settings.ruleWhenNoShowFull.other": {
    tr: "Gelmeyen müşteriye {n} gün sonra",
    en: "{n} days after a no-show",
    de: "{n} Tage nach einem Nichterscheinen",
  },
  // The follow-up needs the visit marked done before it can count from the
  // end — the hourly sweep does that the next day, a same-day nudge needs the
  // owner to complete the appointment themselves.
  "settings.ruleFollowupHint": {
    tr: "Yalnızca tamamlanan randevulardan sonra gönderilir. Randevu 'tamamlandı' olarak işaretlenince sayaç başlar; gece otomatik işaretlenir, daha erken göndermek için randevuyu kendiniz tamamlayın.",
    en: "Sends only after completed appointments. The clock starts when the appointment is marked completed — that happens automatically overnight, so for a same-day message mark it completed yourself.",
    de: "Wird nur nach abgeschlossenen Terminen gesendet. Die Zeit läuft, sobald der Termin als abgeschlossen markiert ist — das passiert automatisch über Nacht; für eine Nachricht am selben Tag markieren Sie ihn selbst.",
  },
  "settings.ruleEditMessage": {
    tr: "Mesajı düzenle",
    en: "Edit message",
    de: "Nachricht bearbeiten",
  },
  "settings.rulePreview": { tr: "Önizleme", en: "Preview", de: "Vorschau" },
  // Shown in the editor while a Cloud number is connected: the authored text
  // rides email and the shop phone, but Meta's lane sends only what Meta
  // approved. Without this line the owner rewrites a reminder, gets the old
  // wording on WhatsApp, and reasonably concludes saving is broken.
  "settings.ruleCloudNote": {
    tr: "WhatsApp işletme hattı Meta onaylı şablon metnini gönderir; buraya yazdıklarınız e-posta ve dükkan telefonundan gider.",
    en: "The WhatsApp business line sends the Meta-approved template text; what you write here goes out by email and the shop phone.",
    de: "Die WhatsApp-Businessnummer sendet den von Meta genehmigten Vorlagentext; was Sie hier schreiben, geht per E-Mail und über das Ladentelefon raus.",
  },
  // In the campaign composer. One subject for all campaign mail, stored on
  // the campaign template row — not per campaign.
  "campaign.subjectHint": {
    tr: "Kampanya e-postalarının konu satırı. Boş kalırsa işletme adı kullanılır. [name] gibi değişkenler burada da çalışır.",
    en: "The subject line on campaign emails. Left empty, the business name is used. Tokens like [name] work here too.",
    de: "Die Betreffzeile von Kampagnen-E-Mails. Bleibt sie leer, wird der Betriebsname verwendet. Platzhalter wie [name] funktionieren auch hier.",
  },
  // The appointment facts the variable dropdown offers beside the org's own
  // contact fields — things that are true of the booking, not the person.
  // [name] resolves but is deliberately absent from the insert menu (the stock
  // templates already open with it). It earns a label here because it is the
  // token most worth a fallback: a customer with no first name on file turns
  // "Hello [name]!" into "Hello!", and "there" reads better than nothing.
  "vars.firstName": { tr: "Ad", en: "First name", de: "Vorname" },
  "vars.business": { tr: "İşletme adı", en: "Business name", de: "Betriebsname" },
  "vars.date": { tr: "Randevu tarihi", en: "Appointment date", de: "Termindatum" },
  "vars.service": { tr: "Hizmet", en: "Service", de: "Leistung" },
  "vars.price": { tr: "Toplam tutar", en: "Total price", de: "Gesamtpreis" },
  "vars.priceList": {
    tr: "Fiyatlı hizmet listesi",
    en: "Services with prices",
    de: "Leistungen mit Preisen",
  },
  "settings.statSent": { tr: "Gönderim", en: "Sent", de: "Gesendet" },
  "settings.statOpens": { tr: "Açılma", en: "Opens", de: "Öffnungen" },
  "settings.statReplies": { tr: "Yanıt", en: "Replies", de: "Antworten" },
  "vars.staff": { tr: "Personel", en: "Staff", de: "Mitarbeiter" },
  "vars.bookingLink": {
    tr: "Randevu linki",
    en: "Booking link",
    de: "Buchungslink",
  },
  "vars.phone": {
    tr: "İşletme telefonu",
    en: "Business phone",
    de: "Telefonnummer des Betriebs",
  },
  "vars.manageLink": {
    tr: "Randevu yönetim linki",
    en: "Manage-appointment link",
    de: "Termin-Verwaltungslink",
  },
  // Group headings in the Insert-variable menu. Built-ins come from the
  // appointment or the business and are nearly always there; a contact field
  // comes from one customer's record and is blank for anyone who never
  // answered it. One flat list hid that difference.
  "settings.ruleOff": { tr: "Kapalı", en: "Off", de: "Aus" },
  "settings.rulesBack": {
    tr: "Tüm kurallar",
    en: "All rules",
    de: "Alle Regeln",
  },
  "editor.varDefaults": {
    tr: "Boş kalırsa ne yazsın",
    en: "When empty, print…",
    de: "Wenn leer, schreibe…",
  },
  "editor.varDefaultsHint": {
    tr: "Bir değişkenin o müşteride karşılığı yoksa mesajdan sessizce düşer ve cümle eksik gider. Buraya yazdığınız kelime onun yerine geçer. Boş bırakırsanız bugünkü davranış sürer: değişken kaybolur. Yalnızca yukarıda kullandığınız değişkenler listelenir.",
    en: "A variable with no value for that customer drops out of the message and the sentence goes short. What you type here stands in for it. Leave a box empty and today's behaviour continues: the variable simply disappears. Only the variables you used above are listed.",
    de: "Eine Variable ohne Wert für diese Kundin oder diesen Kunden fällt aus der Nachricht heraus und der Satz bleibt unvollständig. Was Sie hier eintragen, tritt an ihre Stelle. Lassen Sie ein Feld leer, bleibt es beim heutigen Verhalten: die Variable verschwindet. Aufgeführt sind nur die oben verwendeten Variablen.",
  },
  "editor.varDefaultsPlaceholder": {
    tr: "şöyle yazsın…",
    en: "prints as…",
    de: "erscheint als…",
  },
  "editor.varsBuiltIn": {
    tr: "Randevu ve işletme",
    en: "Appointment & business",
    de: "Termin & Betrieb",
  },
  "editor.varsCustom": {
    tr: "Kişi alanları",
    en: "Contact fields",
    de: "Kontaktfelder",
  },
  "editor.previewPlaceholder": {
    tr: "⟨Köşeli⟩ gösterilen değişkenlerin bu önizlemede dolduracak verisi yok; gerçek gönderimde yerlerini alır ya da satırdan sessizce çıkar.",
    en: "Variables shown in ⟨brackets⟩ have no data to fill in this preview. On a real send they either fill or drop out of the line quietly.",
    de: "Variablen in ⟨spitzen Klammern⟩ haben in dieser Vorschau keine Daten. Beim echten Versand werden sie entweder gefüllt oder verschwinden still aus der Zeile.",
  },
  "editor.insertVariable": {
    tr: "Değişken ekle",
    en: "Insert variable",
    de: "Variable einfügen",
  },
  "editor.searchVariables": {
    tr: "Değişken ara…",
    en: "Search variables…",
    de: "Variablen suchen…",
  },
  "editor.noVariableMatch": {
    tr: "Eşleşen değişken yok.",
    en: "No variables match.",
    de: "Keine passende Variable.",
  },
  "editor.insertEmoji": { tr: "Emoji ekle", en: "Insert emoji", de: "Emoji einfügen" },
  // The email editor's three views of one body (EmailBodyEditor). They were
  // English literals in every language until 2026-10-13; HTML is a word in
  // all three. The preview tab's label is usually the caller's own.
  "editor.modeVisual": { tr: "Görsel", en: "Visual", de: "Visuell" },
  "editor.modeHtml": { tr: "HTML", en: "HTML", de: "HTML" },
  "editor.modes": { tr: "Düzenleme görünümü", en: "Editor view", de: "Editoransicht" },
  "editor.bold": { tr: "Kalın", en: "Bold", de: "Fett" },
  "editor.italic": { tr: "İtalik", en: "Italic", de: "Kursiv" },
  "editor.underline": { tr: "Altı çizili", en: "Underline", de: "Unterstrichen" },
  "editor.bulletList": { tr: "Madde listesi", en: "Bullet list", de: "Aufzählung" },
  "editor.numberedList": {
    tr: "Numaralı liste",
    en: "Numbered list",
    de: "Nummerierte Liste",
  },
  "editor.link": { tr: "Bağlantı ekle", en: "Add / edit link", de: "Link einfügen" },
  "editor.linkPrompt": { tr: "Bağlantı adresi", en: "Link URL", de: "Link-Adresse" },
  "editor.textColor": { tr: "Yazı rengi", en: "Text color", de: "Textfarbe" },
  "editor.clearColor": { tr: "Rengi kaldır", en: "Clear color", de: "Farbe entfernen" },
  "editor.clearFormatting": {
    tr: "Biçimi temizle",
    en: "Clear formatting",
    de: "Formatierung entfernen",
  },
  // The preview's contact picker. Not optional any more: the preview renders
  // ONE customer's real booking or it renders nothing, so this is the switch
  // that turns it on.
  // Why the preview pane is empty. Sample names and invented prices used to
  // fill it, and an owner reading "€350,00" for a haircut they charge €35 for
  // cannot tell a template bug from a made-up number.
  // Operator-facing: the org predates the rules table and the one-shot
  // migration has not run yet. A salon owner should never see this for more
  // than a deploy window.
  "settings.rulesMigrationPending": {
    tr: "Mesaj kuralları eski modelde çalışıyor. Yeni kural listesi için geçiş bekleniyor.",
    en: "Message rules are still running on the old model. The new rules list is waiting on the migration.",
    de: "Die Nachrichtenregeln laufen noch im alten Modell. Die neue Regelliste wartet auf die Migration.",
  },
  // Column header over the pause switch. "Active" rather than "Pause" because
  // the switch is green when the rule IS sending, and a green switch under a
  // header reading Pause parses backwards.
  "settings.ruleActive": { tr: "Aktif", en: "Active", de: "Aktiv" },
  "settings.ruleEmail": { tr: "E-posta", en: "Email", de: "E-Mail" },
  "settings.sendChannel": {
    tr: "Gönderim kanalı",
    en: "Send by",
    de: "Versandweg",
  },
  "settings.sendChannelHint": {
    tr: "Onay, hatırlatma ve geri kazanım mesajlarının hangi kanaldan gideceği. E-posta için müşterinin kayıtlı bir e-posta adresi olmalı.",
    en: "Which channel confirmations, reminders and win-backs go out on. Email needs an address on the customer's record.",
    de: "Über welchen Weg Bestätigungen, Erinnerungen und Rückgewinnungen gesendet werden. Für E-Mail braucht die Kundin oder der Kunde eine hinterlegte Adresse.",
  },
  "settings.channelBoth": { tr: "İkisi de", en: "Both", de: "Beide" },
  "settings.ruleNoChannel": {
    tr: "Gönderilmiyor",
    en: "Not sending",
    de: "Kein Versand",
  },
  // Per-row, and only shown when OTHER rows are sending — otherwise the cause
  // is the org having no channel at all and the line below says so once.
  // Names the language rule because it is the trap nobody finds alone: a
  // Turkish template on an English business matches nothing.
  "settings.ruleNoChannelHint": {
    tr: "Bu mesajın işletme dilinde onaylı bir WhatsApp şablonu yok. Şablonun dili işletme diliyle birebir eşleşmeli. Başka dildeki şablon yedek olarak kullanılmaz.",
    en: "This message has no approved WhatsApp template in the business language. The template's language must match exactly. A template in another language is never used as a fallback.",
    de: "Für diese Nachricht gibt es keine genehmigte WhatsApp-Vorlage in der Sprache des Betriebs. Die Sprache der Vorlage muss exakt übereinstimmen. Eine Vorlage in einer anderen Sprache wird nicht ersatzweise verwendet.",
  },
  // The preview's invented customer. A NAME is safe to make up — it claims
  // nothing about the business — where a price is not; the services and their
  // prices in the preview come from the salon's own catalogue. Per language so
  // a Turkish salon does not read its own messages addressed to "Alex".
  "settings.previewFirstName": { tr: "Ayşe", en: "Alex", de: "Alex" },
  "settings.previewLastName": { tr: "Yılmaz", en: "Morgan", de: "Schmidt" },
  "settings.previewEmail": {
    tr: "ayse@ornek.com",
    en: "alex@example.com",
    de: "alex@beispiel.de",
  },
  "settings.templateSubjectHint": {
    tr: "Yalnızca e-postada görünür. WhatsApp mesajının konu satırı yoktur.",
    en: "Email only. A WhatsApp message has no subject line.",
    de: "Nur in der E-Mail. Eine WhatsApp-Nachricht hat keine Betreffzeile.",
  },
  "settings.templateUnsaved": {
    tr: "Kaydedilmedi",
    en: "Unsaved",
    de: "Nicht gespeichert",
  },
  "settings.templateUnsavedHint": {
    tr: "Bu metin henüz yayında değil. Kaydedene kadar müşterilere en son kaydettiğiniz sürüm gider.",
    en: "These words are not live yet. Customers keep getting the last version you saved until you press Save.",
    de: "Dieser Text ist noch nicht live. Bis Sie speichern, erhalten Kundinnen und Kunden weiterhin die zuletzt gespeicherte Fassung.",
  },
  "settings.templateNotLive": {
    tr: "Taslak kaydedildi · henüz yayında değil",
    en: "Draft saved · not live yet",
    de: "Entwurf gespeichert · noch nicht live",
  },
  "settings.templateDiscard": {
    tr: "Değişiklikleri at",
    en: "Discard",
    de: "Verwerfen",
  },
  "settings.templateDiscardConfirm": {
    tr: "Kaydedilmemiş değişiklikler silinsin mi? En son kaydettiğiniz sürüm yayında kalır.",
    en: "Throw away the unsaved changes? The last version you saved stays live.",
    de: "Nicht gespeicherte Änderungen verwerfen? Die zuletzt gespeicherte Fassung bleibt live.",
  },
  "settings.ruleAddMessage": {
    tr: "Gönderilecek mesaj",
    en: "The message it sends",
    de: "Die Nachricht, die gesendet wird",
  },
  "settings.ruleAddMessageHint": {
    tr: "Hazır metinle başlar. Şimdi düzenleyebilir veya sonradan kuralın kendi sayfasından değiştirebilirsiniz.",
    en: "Starts from the stock wording. Edit it now, or change it later on the rule's own page.",
    de: "Beginnt mit dem Standardtext. Passen Sie ihn jetzt an oder später auf der Seite der Regel.",
  },
  "settings.deleteRule": {
    tr: "Kuralı sil",
    en: "Delete rule",
    de: "Regel löschen",
  },
  "settings.deleteRuleConfirm": {
    tr: "Bu kural ve ona yazdığınız özel metin silinir. Aynı kuralı sonra yeniden ekleyebilirsiniz; metin hazır varsayılandan başlar.",
    en: "This removes the rule and the custom text you wrote for it. You can add the same rule again later; its text starts from the stock wording.",
    de: "Diese Regel und der eigene Text dazu werden gelöscht. Sie können die Regel später wieder hinzufügen; der Text beginnt dann mit dem Standardtext.",
  },
  "settings.ruleSendWindow": {
    tr: "Gönderim saatleri",
    en: "Sending hours",
    de: "Versandzeiten",
  },
  "settings.emailFrom": {
    tr: "E-posta gönderen adresi",
    en: "Email from address",
    de: "Absenderadresse",
  },
  // Deliberately says "optional" first. E-mail already works from the incoming
  // address above; this field only swaps the sender to the salon's own domain,
  // which needs DNS records they will not have. Reading it as a requirement is
  // what left the whole lane looking broken.
  // Read-only now: the operator installs this, because it needs a domain
  // verified with the mail provider. Says what it IS, not how to fill it in.
  "settings.emailFromHint": {
    tr: "Bu işletmeye özel gönderen adresi. Kendi alan adınızdan gönderim için kurulumu biz yapıyoruz; boşsa e-postalar yukarıdaki adresinizden gider.",
    en: "This business's own sender address. We set up sending from your own domain; when it is empty, email goes out from your incoming address above.",
    de: "Die eigene Absenderadresse dieses Betriebs. Den Versand über Ihre eigene Domain richten wir ein; ist sie leer, gehen E-Mails von Ihrer oben genannten Adresse raus.",
  },
  "settings.whatsapp": { tr: "WhatsApp", en: "WhatsApp", de: "WhatsApp" },
  "settings.waConnected": { tr: "Bağlı", en: "Connected", de: "Verbunden" },
  "settings.waNotConnected": {
    tr: "Bağlı değil",
    en: "Not connected",
    de: "Nicht verbunden",
  },
  "settings.waPhoneNumberId": {
    tr: "Telefon numarası ID",
    en: "Phone number ID",
    de: "Telefonnummer-ID",
  },
  "settings.waToken": {
    tr: "Erişim anahtarı",
    en: "Access token",
    de: "Zugriffstoken",
  },
  "settings.waConnect": { tr: "Bağla", en: "Connect", de: "Verbinden" },
  "settings.waDisconnect": {
    tr: "Bağlantıyı kes",
    en: "Disconnect",
    de: "Trennen",
  },
  "settings.templates": {
    tr: "Mesaj şablonları",
    en: "Message templates",
    de: "Nachrichtenvorlagen",
  },
  "settings.templatesHint": {
    tr: "Kuralların gönderdiği mesajları burada yazarsınız. Köşeli parantezli alanlar gönderim anında müşterinin bilgileriyle doldurulur.",
    en: "This is where you write what the rules send. Fields in square brackets are filled with the customer's details at send time.",
    de: "Hier schreiben Sie die Texte, die die Regeln versenden. Felder in eckigen Klammern werden beim Versand mit den Daten der Kundin oder des Kunden gefüllt.",
  },
  "settings.templateName": {
    tr: "Şablon adı",
    en: "Template name",
    de: "Vorlagenname",
  },
  "settings.templateStatus": { tr: "Durum", en: "Status", de: "Status" },
  "settings.templateKindCampaign": {
    tr: "Kampanya",
    en: "Campaign",
    de: "Kampagne",
  },
  "settings.templateBody": {
    tr: "Mesaj metni",
    en: "Message text",
    de: "Nachrichtentext",
  },
  "settings.templateBodyPlaceholder": {
    tr: "Merhaba [name]! [business] randevunuz [date].",
    en: "Hello [name]! Your appointment with [business] is on [date].",
    de: "Hallo [name]! Ihr Termin bei [business]: [date].",
  },
  "settings.templateSubject": {
    tr: "E-posta konusu",
    en: "Email subject",
    de: "E-Mail-Betreff",
  },
  "settings.templateTokens": {
    tr: "Alanlar",
    en: "Fields",
    de: "Felder",
  },
  // ONE vocabulary, English, in all three interfaces — a token is stored text
  // inside a message body, and a name that followed the interface language
  // would read as broken the day the interface changed. The labels around it
  // translate; the names do not. (The Turkish and German aliases in
  // convex/lib/renderTokens stay valid forever, so bodies already written
  // with them keep working.)
  "settings.templateTokensList": {
    tr: "[name] [business] [date] [service] [lastname] [staff] [phone]",
    en: "[name] [business] [date] [service] [lastname] [staff] [phone]",
    de: "[name] [business] [date] [service] [lastname] [staff] [phone]",
  },
  // The lane a template's WhatsApp send actually leaves on, in the salon's
  // words. Vendor names (Evolution, Cloud API, Meta Business Manager) never
  // reach this screen — "Meta's approval" is the one exception, because the
  // approval wait is a real thing the owner experiences and has no other name.
  "settings.templateLaneShopPhone": {
    tr: "Dükkan telefonunuzdan gönderilir.",
    en: "Sends from your shop phone.",
    de: "Wird von Ihrem Betriebstelefon gesendet.",
  },
  // Winback open rate, with the honesty caveat built into the tooltip: mail
  // relays prefetch tracking pixels, so this is a trend line, not a ledger.
  "settings.templateEmailOpens": {
    tr: "Açılan e-postalar",
    en: "Emails opened",
    de: "Geöffnete E-Mails",
  },
  "settings.templateEmailOpensHint": {
    tr: "Yaklaşık bir orandır: bazı e-posta uygulamaları mesajı kimse okumadan da açılmış gösterebilir.",
    en: "An approximate rate: some mail apps can register an open even when nobody read the message.",
    de: "Ein Näherungswert: Manche Mail-Apps melden ein Öffnen, auch wenn niemand die Nachricht gelesen hat.",
  },
  "settings.templateLaneCloud": {
    tr: "WhatsApp Business numaranızdan gönderilir. Metnin önce Meta onayından geçmesi gerekir.",
    en: "Sends from your WhatsApp Business number. The wording needs Meta's approval first.",
    de: "Wird über Ihre WhatsApp-Business-Nummer gesendet. Der Text braucht zuerst Metas Freigabe.",
  },
  // Meta's approval states, in the reader's language. The stored value stays
  // the English slug.
  "template.draft": { tr: "Taslak", en: "Draft", de: "Entwurf" },
  "template.pending": { tr: "Onay bekliyor", en: "Pending", de: "In Prüfung" },
  "template.approved": { tr: "Onaylandı", en: "Approved", de: "Genehmigt" },
  "template.rejected": { tr: "Reddedildi", en: "Rejected", de: "Abgelehnt" },
  // Channels — one conversation, three lanes. Labels are the accessible names
  // behind the icon-only controls in the inbox.
  "channel.whatsapp": { tr: "WhatsApp", en: "WhatsApp", de: "WhatsApp" },
  "channel.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  "channel.call": { tr: "Arama", en: "Call", de: "Anruf" },

  "inbox.empty": {
    tr: "Henüz konuşma yok. Bir müşteri yazdığında ya da aradığında burada görünür.",
    en: "No conversations yet. When a customer writes or calls, it lands here.",
    de: "Noch keine Unterhaltungen. Sobald ein Kunde schreibt oder anruft, sehen Sie es hier.",
  },
  // The sidebar badge. It counts mail that arrived since this person last had
  // the tab open, which is a different question from the row markers below:
  // this one is "there is something new in there", they are "this one is why".
  "inbox.needsAttention": {
    tr: "Yeni mesaj var",
    en: "New messages",
    de: "Neue Nachrichten",
  },
  "inbox.search": {
    tr: "Konuşmalarda ara",
    en: "Search conversations",
    de: "Unterhaltungen durchsuchen",
  },
  // Row marker, three states in one control. The labels name the STATE for a
  // screen reader; the hints add what a click will do, because that differs by
  // state — a lit pin unpins, and everything else pins.
  // Preview-line prefix when the newest message in the thread is OURS. The
  // German column keeps the house Sie rather than WhatsApp's "Du:" — the
  // label addresses the business owner reading the screen, and this app
  // never drops into du.
  // The inbox's call arrow, as its title and its screen-reader label. A call
  // is the one row whose preview cannot imply its own direction — "Arama" is
  // the same word whoever dialled — and these were the visible text until
  // Serdar pointed out that a phone's call log has never needed more than an
  // arrow to say it. Not deleted with the words: the arrow is a shape, and a
  // shape with no accessible name is a shape nobody can read.
  "inbox.calledOut": { tr: "Aradınız", en: "You called", de: "Sie haben angerufen" },
  "inbox.calledIn": { tr: "Aradı", en: "They called", de: "Hat angerufen" },
  "inbox.pinned": { tr: "Sabitlendi", en: "Pinned", de: "Angeheftet" },
  // The green state of the row's gutter dot. It names the STATE; the hint
  // below it says what clicking does, since the same dot is the pin control.
  "inbox.unseen": { tr: "Yeni mesaj", en: "New reply", de: "Neue Nachricht" },
  // The list-filter chips. Their own keys rather than reusing the two above:
  // those name a row's STATE for a screen reader ("Sabitlendi" = this one is
  // pinned), and a chip names an ACTION on the list ("show me the pinned
  // ones"). Turkish separates the two where English happens not to.
  "inbox.filterUnread": { tr: "Okunmamış", en: "Unread", de: "Ungelesen" },
  "inbox.filterPinned": { tr: "Sabitlenenler", en: "Pinned", de: "Angeheftet" },
  "inbox.menu": {
    tr: "Diğer işlemler",
    en: "More actions",
    de: "Weitere Aktionen",
  },
  "inbox.markAllRead": {
    tr: "Tümünü okundu işaretle",
    en: "Mark all as read",
    de: "Alle als gelesen markieren",
  },
  "inbox.noUnread": {
    tr: "Okunmamış konuşma yok.",
    en: "Nothing unread.",
    de: "Nichts Ungelesenes.",
  },
  // Doubles as discovery for the affordance: the pin is a dot on the row and
  // an empty list is the best place to say so.
  "inbox.noPinned": {
    tr: "Sabitlenmiş konuşma yok. Sonra dönmek istediğiniz konuşmanın yanındaki noktaya tıklayın.",
    en: "Nothing pinned. Click the dot on a conversation to keep it here for later.",
    de: "Nichts angeheftet. Klicken Sie auf den Punkt einer Unterhaltung, um sie für später hier zu behalten.",
  },
  "inbox.notPinned": {
    tr: "Sabitlenmedi",
    en: "Not pinned",
    de: "Nicht angeheftet",
  },
  "inbox.pinnedHint": {
    tr: "Yanıtlamanız için sabitlendi. Kaldırmak için tıklayın",
    en: "Pinned for you to answer. Click to unpin",
    de: "Zum Beantworten angeheftet. Zum Lösen klicken",
  },
  "inbox.pinHint": {
    tr: "Sonrası için sabitlemek üzere tıklayın",
    en: "Click to pin this for later",
    de: "Zum Merken anheften",
  },
  // Green rows get their own hint rather than reusing the one above: the state
  // the reader is hovering already says something ("they wrote"), so the hint
  // has to name it before it offers the click, or it reads as a description of
  // the green.
  "inbox.unseenPinHint": {
    tr: "Yeni mesaj. Sonrası için sabitlemek üzere tıklayın",
    en: "New reply. Click to pin it for later",
    de: "Neue Nachricht. Zum Merken anheften",
  },
  // The right pane before anything is picked. Says what to DO, not "no
  // conversation selected" — the reader can see that nothing is selected.
  // "Open", not "select". Since 2026-08-22 a row does not fill this pane, it
  // leaves for the contact record — so a line telling the reader to select
  // something is describing a screen that no longer exists.
  "inbox.selectConversation": {
    tr: "Kaydını açmak ve yanıtlamak için bir konuşmaya tıklayın.",
    en: "Open a conversation to see the contact and reply.",
    de: "Öffnen Sie eine Unterhaltung, um den Kontakt zu sehen und zu antworten.",
  },
  "inbox.openContact": {
    tr: "Müşteriyi aç",
    en: "Open contact",
    de: "Kunde öffnen",
  },

  "calls.inbound": {
    tr: "Gelen arama",
    en: "Inbound call",
    de: "Eingehender Anruf",
  },
  "calls.outbound": {
    tr: "Giden arama",
    en: "Outbound call",
    de: "Ausgehender Anruf",
  },
  "calls.none": {
    tr: "Henüz arama yok",
    en: "No calls yet",
    de: "Noch keine Anrufe",
  },
  // Placing a call from the inbox. The confirm names the NUMBER, because "call
  // this customer" and "call +90 533…" are different amounts of certainty — and
  // this rings a real phone and bills real minutes.
  "calls.place": { tr: "Ara", en: "Place call", de: "Anrufen" },
  "calls.placing": { tr: "Aranıyor…", en: "Calling…", de: "Wird angerufen…" },
  "calls.placeConfirm": {
    tr: "{number} numarası aransın mı?",
    en: "Call {number}?",
    de: "{number} anrufen?",
  },
  // Place call on a customer who asked not to be called by the AI. Replaces
  // the usual body; the confirm button becomes "calls.callAnyway".
  "calls.noAiCallsWarning": {
    tr: "Bu müşteri sesli asistanın kendisini aramamasını istedi. Toplu aramalar onu atlar. Yalnızca bu aramayı kabul ettiyse yine de arayın; telefon gerçekten çalar ve dakikalar faturalanır.",
    en: "This customer asked not to be called by the voice agent, and bulk call runs skip them. Call anyway only if they agreed to this call. The phone really rings and the minutes are billed.",
    de: "Dieser Kunde möchte nicht vom Sprachassistenten angerufen werden; Sammelaktionen per Anruf überspringen ihn. Rufen Sie nur an, wenn er diesem Anruf zugestimmt hat. Das Telefon klingelt wirklich und die Minuten werden berechnet.",
  },
  "calls.callAnyway": { tr: "Yine de ara", en: "Call anyway", de: "Trotzdem anrufen" },
  // The server refused because the request landed after the page loaded.
  "calls.noAiCallsRefused": {
    tr: "Aranmadı: müşteri az önce sesli asistanla aranmak istemediğini bildirdi.",
    en: "Not called: the customer has just asked not to be called by the voice agent.",
    de: "Nicht angerufen: Der Kunde hat gerade gebeten, nicht vom Sprachassistenten angerufen zu werden.",
  },
  "calls.placeConfirmBody": {
    tr: "Sesli asistan şimdi arayacak. Telefon gerçekten çalar ve dakikalar faturalanır.",
    en: "The voice agent will call now. The phone really rings and the minutes are billed.",
    de: "Der Sprachassistent ruft jetzt an. Das Telefon klingelt wirklich und die Minuten werden berechnet.",
  },
  "calls.transcript": {
    tr: "Konuşma dökümü",
    en: "Transcript",
    de: "Transkript",
  },
  "calls.recording": { tr: "Kayıt", en: "Recording", de: "Aufnahme" },
  "calls.summary": { tr: "Özet", en: "Summary", de: "Zusammenfassung" },
  "calls.unknown": {
    tr: "Bilinmeyen numara",
    en: "Unknown number",
    de: "Unbekannte Nummer",
  },
  "calls.loadMore": { tr: "Daha fazla", en: "Load more", de: "Mehr laden" },
  "calls.caller": { tr: "Arayan", en: "Caller", de: "Anrufer" },
  "calls.when": { tr: "Zaman", en: "When", de: "Zeit" },
  "calls.duration": { tr: "Süre", en: "Duration", de: "Dauer" },
  "calls.outcome": { tr: "Sonuç", en: "Outcome", de: "Ergebnis" },
  // The per-call price line in the expanded detail. {amount} is pre-formatted
  // ("$0.42") — USD because the meter runs in USD, whatever the org currency.
  "calls.billedLine": {
    tr: "Arama tutarı: {amount}",
    en: "Call cost: {amount}",
    de: "Anrufkosten: {amount}",
  },
  // The owner's Usage section on the voice page (convex/billing.ts). Spend is
  // owner-only; staff never see this strip entry.
  "voiceBilling.title": { tr: "Kullanım", en: "Usage", de: "Nutzung" },
  "voiceBilling.rateLine": {
    tr: "Dakika başı {rate}, saniye bazında ücretlendirilir.",
    en: "{rate} per minute, billed per second.",
    de: "{rate} pro Minute, sekundengenau abgerechnet.",
  },
  "voiceBilling.month": { tr: "Ay", en: "Month", de: "Monat" },
  "voiceBilling.calls": { tr: "Arama", en: "Calls", de: "Anrufe" },
  "voiceBilling.talkTime": {
    tr: "Konuşma süresi",
    en: "Talk time",
    de: "Gesprächszeit",
  },
  "voiceBilling.amount": { tr: "Tutar", en: "Amount", de: "Betrag" },
  "voiceBilling.budget": {
    tr: "Aylık bütçe (USD)",
    en: "Monthly budget (USD)",
    de: "Monatsbudget (USD)",
  },
  "voiceBilling.budgetHint": {
    tr: "İsteğe bağlı. Harcama bütçenin %80'ine ve %100'üne ulaştığında e-posta ile haber veririz. Aramalar hiçbir zaman kesilmez. Boş bırakmak uyarıları kapatır.",
    en: "Optional. We email you when spend reaches 80% and 100% of it. Calls are never cut off. Leave it empty to turn the alerts off.",
    de: "Optional. Wir benachrichtigen Sie per E-Mail, wenn die Kosten 80 % und 100 % des Budgets erreichen. Anrufe werden nie unterbrochen. Leer lassen schaltet die Hinweise aus.",
  },
  "voiceBilling.empty": {
    tr: "Henüz ücretlendirilen arama yok.",
    en: "No metered calls yet.",
    de: "Noch keine abgerechneten Anrufe.",
  },
  // The chat/WhatsApp half of the meter (BillingView, convex/billing.ts
  // messagingOverview). Same owner-only rule as the voice strip.
  "aiBilling.title": {
    tr: "Yapay zeka ve WhatsApp",
    en: "AI & WhatsApp",
    de: "KI & WhatsApp",
  },
  // Not "at Meta's rates": a template message is billed at Meta's cost plus
  // the operator's markup percent (orgs.waMarkupPercent, falling back to the
  // platform's), applied in messages.applySendResult via lib/waPricing.
  "aiBilling.hint": {
    tr: "Yapay zeka, gönderilen yanıt başına ücretlendirilir. WhatsApp'ta yalnızca şablon mesajları ücretlidir ve ücret mesaj başına alıcının ülkesine göre belirlenir: o ülke için Meta'nın fiyatı, varsa üzerine bir hizmet payı. Müşterinizin mesajına 24 saat içinde verilen yanıtlar ücretsizdir.",
    en: "AI is billed per sent reply. On WhatsApp only template messages cost money, per message by the recipient's country: Meta's price for that country, plus a markup where one applies. Replies within 24 hours of a customer's message are free.",
    de: "KI wird pro gesendeter Antwort abgerechnet. Bei WhatsApp kosten nur Vorlagen-Nachrichten Geld, pro Nachricht nach dem Land des Empfängers: Metas Preis für dieses Land, gegebenenfalls zuzüglich eines Aufschlags. Antworten innerhalb von 24 Stunden auf eine Kundennachricht sind kostenlos.",
  },
  "aiBilling.rateLine": {
    tr: "Yapay zeka yanıtı başına {rate}.",
    en: "{rate} per AI reply.",
    de: "{rate} pro KI-Antwort.",
  },
  "aiBilling.replies": {
    tr: "YZ yanıtı",
    en: "AI replies",
    de: "KI-Antworten",
  },
  "aiBilling.waMessages": {
    tr: "Şablon mesajı",
    en: "Template messages",
    de: "Vorlagen-Nachrichten",
  },
  "aiBilling.total": { tr: "Toplam", en: "Total", de: "Gesamt" },
  // The prepaid wallet (BillingView, prepaid orgs only). "Bakiye" over any
  // coined word: it is what every prepaid product in Türkiye calls this.
  "nav.billing": { tr: "Faturalama", en: "Billing", de: "Abrechnung" },
  "wallet.balance": {
    tr: "Mevcut bakiye",
    en: "Current balance",
    de: "Aktuelles Guthaben",
  },
  // Everything the balance card used to say out loud, now one hover away: the
  // rate, how it is counted, and where the card details go. A returning owner
  // reads none of it twice, and the number they came for is the only thing
  // left on the card.
  "wallet.balanceHint": {
    tr: "Dakika başı {rate}, saniye bazında ücretlendirilir. Ödeme Stripe'ın güvenli sayfasında kartla yapılır; bakiyeniz ödemeden hemen sonra güncellenir.",
    en: "{rate} per minute, billed per second. Payment is by card on Stripe's secure page; your balance updates right after.",
    de: "{rate} pro Minute, sekundengenau abgerechnet. Die Zahlung erfolgt per Karte auf der sicheren Stripe-Seite; Ihr Guthaben wird direkt danach aktualisiert.",
  },
  // What the balance BUYS, which is the question the balance was standing in
  // for. Minutes, because that is the unit the rate is quoted in and the unit
  // a call is billed in.
  "wallet.runway.one": {
    tr: "Yaklaşık {n} dakika görüşme",
    en: "About {n} minute of talk time",
    de: "Etwa {n} Gesprächsminute",
  },
  "wallet.runway.other": {
    tr: "Yaklaşık {n} dakika görüşme",
    en: "About {n} minutes of talk time",
    de: "Etwa {n} Gesprächsminuten",
  },
  "wallet.topUpWith": {
    tr: "{amount} yükle",
    en: "Add {amount}",
    de: "{amount} aufladen",
  },
  "wallet.starting": {
    tr: "Stripe'a yönlendiriliyorsunuz…",
    en: "Taking you to Stripe…",
    de: "Sie werden zu Stripe weitergeleitet…",
  },
  "wallet.error": {
    tr: "Ödeme başlatılamadı. Lütfen tekrar deneyin.",
    en: "Could not start the payment. Please try again.",
    de: "Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.",
  },
  "wallet.paid": {
    tr: "Ödeme alındı, bakiyeniz güncellendi.",
    en: "Payment received, your balance is updated.",
    de: "Zahlung eingegangen, Ihr Guthaben wurde aktualisiert.",
  },
  "wallet.low": {
    tr: "Bakiyeniz azalıyor. Aramaların kesilmemesi için yükleme yapın.",
    en: "Your balance is running low. Top up to keep calls coming in.",
    de: "Ihr Guthaben wird knapp. Laden Sie auf, damit Anrufe weiter ankommen.",
  },
  "wallet.paused": {
    tr: "Bakiyeniz bitti. Telefon asistanı yeni aramaları yanıtlamıyor; yükleme yaptığınız anda kaldığı yerden devam eder.",
    en: "Your balance ran out. The phone agent is not answering new calls; it resumes the moment you top up.",
    de: "Ihr Guthaben ist aufgebraucht. Der Telefonassistent nimmt keine neuen Anrufe an; nach dem Aufladen geht es sofort weiter.",
  },
  "wallet.topups": { tr: "Yüklemeler", en: "Top-ups", de: "Aufladungen" },
  "wallet.noTopups": {
    tr: "Henüz yükleme yok.",
    en: "No top-ups yet.",
    de: "Noch keine Aufladungen.",
  },
  "wallet.sourceStripe": { tr: "Kart", en: "Card", de: "Karte" },
  "wallet.sourceManual": { tr: "Manuel", en: "Manual", de: "Manuell" },
  "wallet.invoiceLine": {
    tr: "Kullanım fatura ile tahsil edilir; ödeme uygulama dışında yapılır.",
    en: "Usage is billed by invoice and settled outside the app.",
    de: "Die Nutzung wird per Rechnung abgerechnet und außerhalb der App beglichen.",
  },
  "wallet.sourceTrial": {
    tr: "Deneme kredisi",
    en: "Trial credit",
    de: "Startguthaben",
  },
  // Per-call, so "what was collected", not the agent card's "what it collects".
  "calls.collected": {
    tr: "Toplanan bilgiler",
    en: "Collected",
    de: "Erfasste Angaben",
  },
  "calls.nothingCaptured": {
    tr: "Bu arama için kayıt veya döküm yok.",
    en: "No recording or transcript for this call.",
    de: "Keine Aufnahme oder kein Transkript für diesen Anruf.",
  },
  // Speaker labels above the transcript bubbles. The customer's own name is
  // used when the call is bound to a contact; this is the fallback for a first
  // -time caller whose row is still just a phone number.
  "calls.agent": { tr: "Asistan", en: "Agent", de: "Assistent" },
  // Retell's call_successful, said out loud. "Unsuccessful" is not a failure —
  // the caller may simply have said no.
  "calls.successful": { tr: "Başarılı", en: "Successful", de: "Erfolgreich" },
  "calls.unsuccessful": {
    tr: "Sonuçsuz",
    en: "Unsuccessful",
    de: "Ohne Ergebnis",
  },
  "calls.theCaller": { tr: "Arayan kişi", en: "Caller", de: "Anrufer" },

  // Retell's disconnect codes, said the way an owner would say them. A call
  // that nobody answered has no summary and no transcript, so this line is the
  // whole story of that row — it is not decoration.
  "calls.end.agent_hangup": {
    tr: "Aramayı asistan sonlandırdı",
    en: "Agent ended the call",
    de: "Der Assistent hat das Gespräch beendet",
  },
  "calls.end.user_hangup": {
    tr: "Arayan telefonu kapattı",
    en: "Caller hung up",
    de: "Anrufer hat aufgelegt",
  },
  "calls.end.dial_no_answer": {
    tr: "Cevap yok",
    en: "No answer",
    de: "Keine Antwort",
  },
  "calls.end.dial_busy": { tr: "Hat meşgul", en: "Line busy", de: "Leitung besetzt" },
  "calls.end.dial_failed": {
    tr: "Arama bağlanamadı",
    en: "Call failed to connect",
    de: "Anruf konnte nicht verbunden werden",
  },
  "calls.end.voicemail_reached": {
    tr: "Telesekretere düştü",
    en: "Reached voicemail",
    de: "Mailbox erreicht",
  },
  "calls.end.call_transfer": {
    tr: "Arama aktarıldı",
    en: "Call transferred",
    de: "Anruf weitergeleitet",
  },
  "calls.end.inactivity": {
    tr: "Sessizlik nedeniyle sonlandı",
    en: "Ended after silence",
    de: "Nach Stille beendet",
  },
  "calls.end.machine_detected": {
    tr: "Telesekreter algılandı",
    en: "Answering machine detected",
    de: "Anrufbeantworter erkannt",
  },
  "calls.end.max_duration_reached": {
    tr: "Azami arama süresine ulaşıldı",
    en: "Hit the maximum call length",
    de: "Maximale Gesprächsdauer erreicht",
  },
  "calls.end.concurrency_limit_reached": {
    tr: "Eşzamanlı arama sınırına takıldı",
    en: "Hit the concurrent call limit",
    de: "Limit gleichzeitiger Anrufe erreicht",
  },
  "calls.end.error": { tr: "Arama hatası", en: "Call error", de: "Anruffehler" },
  // The sidebar destination. Was "Sesli asistan / Voice agent"; the qualifier
  // came off (Serdar, 2026-08-26) when the chat lane started composing over
  // the same Talimat — one agent, two channels, and a door named after one
  // channel misdescribes the thing behind it. The phone bar's short form made
  // this exact call first and the sidebar now simply agrees with it.
  // Never "Retell": the vendor is an implementation detail nobody chose.
  "nav.voice": {
    tr: "Asistan",
    en: "Agent",
    de: "Assistent",
  },
  "nav.voiceShort": { tr: "Asistan", en: "Agent", de: "Assistent" },
  "voice.agents": { tr: "Asistanlar", en: "Agents", de: "Assistenten" },
  // "Automations", not "Messages" (2026-08-25): the page draws each rule as
  // the flow it runs, and the label should sell what the page does — this
  // works while you sleep — rather than name the artefact it sends. The key
  // keeps its historical id, like the tab's id before it.
  "nav.messages": {
    tr: "Otomasyonlar",
    en: "Automations",
    de: "Automatisierungen",
  },

  "settings.voice": {
    tr: "Asistan",
    en: "Agent",
    de: "Assistent",
  },
  // An agent with one field read "1 fields" in the agents table.
  "settings.voiceCollectsCount.one": {
    tr: "{n} alan",
    en: "{n} field",
    de: "{n} Feld",
  },
  "settings.voiceCollectsCount.other": {
    tr: "{n} alan",
    en: "{n} fields",
    de: "{n} Felder",
  },
  // Shown instead of connector details when the resolved site URL is a
  // loopback address on a deployed page.
  "settings.voiceEndpointsBroken": {
    tr: "Bu dağıtımda adresler çözümlenemiyor (yerel adrese işaret ediyor). NEXT_PUBLIC_CONVEX_SITE_URL ayarlanmalı.",
    en: "These URLs can't be resolved on this deployment — they point at a local address. NEXT_PUBLIC_CONVEX_SITE_URL needs to be set.",
    de: "Diese URLs lassen sich in dieser Umgebung nicht auflösen — sie zeigen auf eine lokale Adresse. NEXT_PUBLIC_CONVEX_SITE_URL muss gesetzt werden.",
  },
  // The salon's word for the thing, not the vendor's — "Retell agent" is an
  // implementation detail they never chose. Qualifier dropped with the rest
  // of the surface: this column now sits beside a Chat toggle, and a header
  // calling the row voice-only would be contradicted two cells to its right.
  "settings.voiceAgent": {
    tr: "Asistan",
    en: "Agent",
    de: "Assistent",
  },
  "settings.voiceAgentChoose": {
    tr: "Asistan seçin",
    en: "Choose an agent",
    de: "Assistent auswählen",
  },
  // Retell calls these post-call analysis variables. A salon owner reads the
  // question "what does it write down", so ask that.
  "settings.voiceCollects": {
    tr: "Topladığı bilgiler",
    en: "What it collects",
    de: "Erfasste Angaben",
  },
  "settings.waShopPhone": {
    tr: "Dükkan telefonu",
    en: "Shop phone",
    de: "Betriebstelefon",
  },
  "settings.waLinkPhone": {
    tr: "Telefonu bağla",
    en: "Link phone",
    de: "Telefon verbinden",
  },
  "settings.waScanHint": {
    tr: "WhatsApp > Bağlı cihazlar > Cihaz bağla, sonra bu kodu okutun.",
    en: "WhatsApp > Linked devices > Link a device, then scan this code.",
    de: "WhatsApp > Verknüpfte Geräte > Gerät verknüpfen, dann diesen Code scannen.",
  },
  "settings.waWaitingScan": {
    tr: "Okutulması bekleniyor…",
    en: "Waiting for the scan…",
    de: "Warten auf den Scan…",
  },
  "settings.waNotLinked": {
    tr: "Bağlı değil",
    en: "Not linked",
    de: "Nicht verbunden",
  },
  "settings.voiceRefresh": { tr: "Yenile", en: "Refresh", de: "Aktualisieren" },
  "settings.voiceConnect": {
    tr: "Asistan ekle",
    en: "Add agent",
    de: "Assistent hinzufügen",
  },
  "settings.voiceConnectHint": {
    tr: "Yeni bir randevu asistanı oluşturun veya bu işletme için hazırlanmış bir asistanı bağlayın.",
    en: "Create a new booking agent or connect one already prepared for this business.",
    de: "Erstellen Sie einen neuen Terminassistenten oder verbinden Sie einen bereits für diesen Betrieb vorbereiteten Assistenten.",
  },
  "voiceCreate.new": {
    tr: "Yeni oluştur",
    en: "Create new",
    de: "Neu erstellen",
  },
  "voiceCreate.existing": {
    tr: "Hazır asistanı bağla",
    en: "Connect existing",
    de: "Vorhandenen verbinden",
  },
  "voiceCreate.name": { tr: "Asistan adı", en: "Agent name", de: "Name des Assistenten" },
  "voiceCreate.defaultName": {
    tr: "Randevu asistanı",
    en: "Booking assistant",
    de: "Terminassistent",
  },
  "voiceCreate.voice": { tr: "Ses", en: "Voice", de: "Stimme" },
  "voicePicker.search": {
    tr: "Ses ara (isim, aksan, cinsiyet)",
    en: "Search voices (name, accent, gender)",
    de: "Stimmen suchen (Name, Akzent, Geschlecht)",
  },
  "voicePicker.none": {
    tr: "Eşleşen ses yok.",
    en: "No matching voice.",
    de: "Keine passende Stimme.",
  },
  "voiceCreate.savedVoice": {
    tr: "Seçili ses",
    en: "Selected voice",
    de: "Ausgewählte Stimme",
  },
  "voiceCreate.preview": {
    tr: "Sesi dinle",
    en: "Preview voice",
    de: "Stimme anhören",
  },
  "voiceCreate.stopPreview": {
    tr: "Önizlemeyi durdur",
    en: "Stop preview",
    de: "Vorschau stoppen",
  },
  "voiceCreate.lineHint": {
    tr: "İsteğe bağlıdır. Yalnızca henüz başka bir asistana atanmamış hatlar gösterilir.",
    en: "Optional. Only lines not already assigned to another agent are shown.",
    de: "Optional. Es werden nur Leitungen angezeigt, die noch keinem anderen Assistenten zugewiesen sind.",
  },
  "voiceCreate.noLine": {
    tr: "Şimdilik hat bağlama",
    en: "No line for now",
    de: "Vorerst keine Leitung",
  },
  "voiceCreate.submit": {
    tr: "Asistan oluştur",
    en: "Create agent",
    de: "Assistent erstellen",
  },
  "voiceCreate.retry": {
    tr: "Kurulumu yeniden dene",
    en: "Retry setup",
    de: "Einrichtung erneut versuchen",
  },
  "voiceCreate.creating": {
    tr: "Asistan oluşturuluyor…",
    en: "Creating agent…",
    de: "Assistent wird erstellt…",
  },
  "voiceCreate.failed": {
    tr: "Kurulum tamamlanamadı. Bilgileri kontrol edip yeniden deneyin.",
    en: "Setup could not finish. Check the details and try again.",
    de: "Die Einrichtung konnte nicht abgeschlossen werden. Prüfen Sie die Angaben und versuchen Sie es erneut.",
  },
  "voiceCreate.resume": {
    tr: "Asistan oluşturuldu ancak bağlantı tamamlanmadı. Kurulumu yeniden deneyin.",
    en: "The agent was created but its connection did not finish. Retry setup.",
    de: "Der Assistent wurde erstellt, aber die Verbindung wurde nicht abgeschlossen. Versuchen Sie die Einrichtung erneut.",
  },
  "voiceCreate.inProgress": {
    tr: "Kurulum başka bir pencerede devam ediyor.",
    en: "Setup is already continuing in another window.",
    de: "Die Einrichtung wird bereits in einem anderen Fenster fortgesetzt.",
  },
  "settings.voiceLanguage": { tr: "Dil", en: "Language", de: "Sprache" },
  "settings.voiceLine": { tr: "Telefon hattı", en: "Phone line", de: "Telefonleitung" },
  "settings.voiceMultipleLanguages": {
    tr: "Birden fazla dil",
    en: "Multiple languages",
    de: "Mehrere Sprachen",
  },
  // "Delete", not "Disconnect" (Serdar, 2026-08-21). Disconnect described the
  // MECHANISM — the app's row goes, the provider agent survives — which is
  // an implementation detail the owner has no word for, and Retell is a name
  // this UI never says. From where they sit the agent is gone, so the button
  // says so; the confirmation still states exactly what is kept and what is
  // lost, which is where that honesty belongs.
  "settings.voiceDisconnect": {
    tr: "Sil",
    en: "Delete",
    de: "Löschen",
  },
  "settings.voiceDisconnectConfirm": {
    tr: "{name} silinsin mi? Arama geçmişi Resepta'da kalır, ancak asistan artık bu işletmede görünmez.",
    en: "Delete {name}? Its call history stays in Resepta, but the agent will no longer appear for this business.",
    de: "{name} löschen? Der Anrufverlauf bleibt in Resepta, der Assistent wird für diesen Betrieb jedoch nicht mehr angezeigt.",
  },
  "settings.voiceUnreachable": {
    tr: "Sesli asistana şu anda ulaşılamıyor. Bizimle iletişime geçin.",
    en: "Can't reach your voice agent right now. Get in touch with us.",
    de: "Ihr Sprachassistent ist derzeit nicht erreichbar. Bitte wenden Sie sich an uns.",
  },
  "settings.voiceUnavailable": {
    tr: "Kullanılamayan asistan",
    en: "Unavailable agent",
    de: "Nicht verfügbarer Assistent",
  },
  "settings.voiceActionFailed": {
    tr: "Sesli asistan güncellenemedi. Lütfen tekrar deneyin.",
    en: "The voice agent could not be updated. Please try again.",
    de: "Der Sprachassistent konnte nicht aktualisiert werden. Bitte versuchen Sie es erneut.",
  },
  // The four ways opening an agent's editor refuses for a REASON, as opposed
  // to the provider having a bad minute. voiceActionFailed above ends in
  // "please try again", which is right for a network blip and wrong for every
  // one of these: none of them change on a retry, and the reader is owed the
  // cause instead (Serdar, 2026-08-26).
  "settings.voiceAgentMissing": {
    tr: "Bu asistan artık bu iş yerine bağlı değil. Bağlantısı kesilmiş veya silinmiş olabilir.",
    en: "This agent is no longer connected to this business. It may have been disconnected or deleted.",
    de: "Dieser Assistent ist nicht mehr mit diesem Betrieb verbunden. Möglicherweise wurde die Verbindung getrennt oder er wurde gelöscht.",
  },
  "settings.voiceDemoWorkspace": {
    tr: "Bu demo iş yeri. Sesli asistan bilgileri burada tutulmuyor.",
    en: "This is the demo business. It holds no voice credentials.",
    de: "Dies ist der Demo-Betrieb. Hier sind keine Zugangsdaten für Sprachassistenten hinterlegt.",
  },
  "settings.voiceNoKey": {
    tr: "Bu iş yeri için henüz Retell API anahtarı tanımlanmadı.",
    en: "No Retell API key is set for this business yet.",
    de: "Für diesen Betrieb ist noch kein Retell-API-Schlüssel hinterlegt.",
  },
  "settings.voiceOwnerOnly": {
    tr: "Sesli asistan ayarlarını yalnızca iş yeri sahibi açabilir.",
    en: "Only an owner can open the voice agent settings.",
    de: "Nur Inhaber können die Einstellungen des Sprachassistenten öffnen.",
  },
  "settings.voiceNoAgents": {
    tr: "Bu hesapta asistan yok.",
    en: "No agents in this account.",
    de: "Keine Assistenten in diesem Konto.",
  },
  "settings.inboundNumber": {
    tr: "Gelen arama numarası",
    en: "Inbound number",
    de: "Eingehende Rufnummer",
  },
  "settings.outboundNumber": {
    tr: "Giden arama numarası",
    en: "Outbound number",
    de: "Ausgehende Rufnummer",
  },
  "settings.transferNumber": {
    tr: "Aktarma numarası",
    en: "Transfer number",
    de: "Weiterleitungsnummer",
  },
  "settings.voiceEnabled": { tr: "Etkin", en: "Enabled", de: "Aktiv" },
  "settings.voiceDetails": { tr: "ayrıntılar", en: "details", de: "Details" },
  "settings.voiceConnectedAt": {
    tr: "Bağlandı: {date}",
    en: "Connected {date}",
    de: "Verbunden seit {date}",
  },
  "settings.voiceCalls": { tr: "Aramalar", en: "Calls", de: "Anrufe" },
  "settings.voiceStatToday": { tr: "{n} bugün", en: "{n} today", de: "{n} heute" },
  "settings.voiceStatTotal": { tr: "{n} toplam", en: "{n} total", de: "{n} gesamt" },
  "settings.voiceStatLast": {
    tr: "son arama {when}",
    en: "last call {when}",
    de: "letzter Anruf {when}",
  },
  "settings.voiceNoCalls": {
    tr: "Henüz arama yok.",
    en: "No calls yet.",
    de: "Noch keine Anrufe.",
  },
  "settings.voiceNoNumber": { tr: "— Yok —", en: "— None —", de: "— Keine —" },
  // The number multi-selects' resting label, when a direction has no line.
  "settings.voiceAddNumber": {
    tr: "+ Numara ekle",
    en: "+ Add number",
    de: "+ Nummer hinzufügen",
  },
  // Broken-plumbing notice in the salon's words. Deliberately no "webhook":
  // the owner should read a symptom and a fix, not our vocabulary.
  "settings.voiceNotReceiving": {
    tr: "Bu asistanın arama sonuçları uygulamaya ulaşmıyor.",
    en: "This agent's call results are not reaching the app.",
    de: "Die Anrufergebnisse dieses Assistenten erreichen die App nicht.",
  },
  "settings.voiceNotFullyConnected": {
    tr: "Bu asistan Resepta'ya tam olarak bağlı değil.",
    en: "This agent is not fully connected to Resepta.",
    de: "Dieser Assistent ist nicht vollständig mit Resepta verbunden.",
  },
  "settings.voiceUpdateIncomplete": {
    tr: "Yakın tarihli bir aramanın verileri güvende, ancak bazı müşteri bilgileri eksik olabilir.",
    en: "A recent call is safely stored, but some customer details may still be missing.",
    de: "Ein kürzliches Gespräch ist sicher gespeichert, aber einige Kundendaten könnten noch fehlen.",
  },
  "settings.voiceFix": { tr: "Düzelt", en: "Fix", de: "Beheben" },
  "settings.voiceFixed": {
    tr: "Düzeltildi.",
    en: "Fixed.",
    de: "Behoben.",
  },
  "settings.voiceEnabledHint": {
    tr: "Açıkken asistan aramaları yanıtlar ve randevu alır. Telefonu aynı anda tek asistan yürütür; birini açmak diğerini kapatır. Kapatınca bağlantı korunur ama randevu alamaz; tatile çıkarken kapatmanız yeterli.",
    en: "On, the agent answers and books. Only one agent holds the phone at a time; switching one on switches the other off. Off keeps the connection but stops bookings; just switch it off for holidays.",
    de: "Eingeschaltet nimmt der Assistent Anrufe an und vergibt Termine. Das Telefon führt immer nur ein Assistent; einen einzuschalten schaltet den anderen aus. Ausgeschaltet bleibt die Verbindung bestehen, aber es wird nichts gebucht; für den Urlaub einfach ausschalten.",
  },
  // The platform-owned wording (lib/templateTexts LOCKED_TEMPLATE_KINDS):
  // what the salon reads where the message editor used to be.
  "settings.wordingLocked": {
    tr: "Standart mesaj",
    en: "Standard message",
    de: "Standardnachricht",
  },
  "settings.channelUnavailable": {
    tr: "Bu kanal henüz bağlı değil",
    en: "This channel isn't connected yet",
    de: "Dieser Kanal ist noch nicht verbunden",
  },
  "settings.ruleWontSend": {
    tr: "Gönderilmez, bağlı kanal yok",
    en: "Won't send, no channel connected",
    de: "Wird nicht gesendet, kein Kanal verbunden",
  },
  "settings.wordingLockedHint": {
    tr: "Bu metni Resepta yazar ve tüm işletmelerde aynıdır. WhatsApp metni önceden onaylar, bu yüzden burada değiştirilemez.",
    en: "Resepta writes this text and it is the same for every business. WhatsApp approves it in advance, so it cannot be edited here.",
    de: "Diesen Text schreibt Resepta, er ist für alle Betriebe gleich. WhatsApp genehmigt ihn vorab, deshalb lässt er sich hier nicht ändern.",
  },
  "settings.chatEnabled": { tr: "Sohbet", en: "Chat", de: "Chat" },
  "settings.chatEnabledHint": {
    tr: "WhatsApp sohbet asistanı bu asistanın talimatıyla yanıt verir. Sohbeti aynı anda tek asistan yürütür; birini açmak diğerini kapatır. Telefon kapalıyken de çalışır.",
    en: "The WhatsApp chat assistant answers with this agent's instructions. Only one agent holds chat at a time; switching one on switches the other off. Works even while the phone is off.",
    de: "Der WhatsApp-Chat-Assistent antwortet mit den Anweisungen dieses Agenten. Den Chat führt immer nur ein Agent; einen einzuschalten schaltet den anderen aus. Funktioniert auch bei ausgeschaltetem Telefon.",
  },
  "settings.voiceArchive": { tr: "Arşivle", en: "Archive", de: "Archivieren" },
  "settings.voiceRestore": {
    tr: "Geri getir",
    en: "Restore",
    de: "Wiederherstellen",
  },
  "settings.voiceShowArchived": {
    tr: "Arşivlenenleri göster ({n})",
    en: "Show archived ({n})",
    de: "Archivierte anzeigen ({n})",
  },
  "settings.voiceHideArchived": {
    tr: "Arşivlenenleri gizle",
    en: "Hide archived",
    de: "Archivierte ausblenden",
  },

  // The agent detail sheet. Same register as the rest of settings: the salon's
  // words, not Retell's. "Prompt" stays untranslated jargon nowhere: it is
  // "talimat"/"Anweisung", what the agent is told to do.
  "voiceDetail.webhook": {
    tr: "Arama sonuçları",
    en: "Call results",
    de: "Anrufergebnisse",
  },
  "voiceDetail.webhookHint": {
    tr: "Her aramadan sonra kayıtların, özetlerin ve toplanan bilgilerin Resepta'ya ulaşmasını sağlar.",
    en: "Keeps recordings, summaries and collected details in Resepta after every call.",
    de: "Sorgt dafür, dass Aufzeichnungen, Zusammenfassungen und erfasste Angaben nach jedem Anruf in Resepta ankommen.",
  },
  "voiceDetail.webhookWired": {
    tr: "Sonuçlar Resepta'ya ulaşıyor.",
    en: "Results are reaching Resepta.",
    de: "Ergebnisse erreichen Resepta.",
  },
  "voiceDetail.webhookElsewhere": {
    tr: "Başka bir adrese işaret ediyor. Arama sonuçları bu uygulamaya ulaşmıyor.",
    en: "Points somewhere else, so call results are not reaching this app.",
    de: "Zeigt auf eine andere Adresse. Anrufergebnisse erreichen diese App nicht.",
  },
  "voiceDetail.webhookMissing": {
    tr: "Ayarlanmamış. Arama sonuçları bu uygulamaya ulaşmıyor.",
    en: "Not set, so call results are not reaching this app.",
    de: "Nicht gesetzt. Anrufergebnisse erreichen diese App nicht.",
  },
  "voiceDetail.signatureRejected": {
    tr: "Aramalar ulaşıyor ama reddediliyor: Retell anahtarı doğrulanmıyor.",
    en: "Calls are reaching Resepta but being rejected: the Retell key does not verify.",
    de: "Anrufe erreichen Resepta, werden aber abgewiesen: Der Retell-Schlüssel wird nicht verifiziert.",
  },
  "voiceDetail.signatureRejectedHint": {
    tr: "Bu iş yeri için kayıtlı Retell anahtarı, o çalışma alanının imzalama anahtarı değil. Retell → Settings → API Keys içinde Webhook rozetli anahtarı kopyalayıp yönetici konsolundan güncelleyin. Düzeltilene kadar randevular arama sırasında kaydedilemez.",
    en: "The Retell key stored for this business is not that workspace's signing key. Copy the key badged Webhook in Retell → Settings → API Keys and update it in the admin console. Until then bookings cannot be saved during a call.",
    de: "Der für dieses Unternehmen gespeicherte Retell-Schlüssel ist nicht der Signaturschlüssel dieses Workspace. Kopieren Sie den mit Webhook gekennzeichneten Schlüssel unter Retell → Settings → API Keys und aktualisieren Sie ihn in der Admin-Konsole. Bis dahin können Termine während eines Anrufs nicht gespeichert werden.",
  },
  "voiceDetail.webhookFix": {
    tr: "Düzelt",
    en: "Fix",
    de: "Beheben",
  },
  "voiceDetail.wiring": {
    tr: "Düzeltiliyor…",
    en: "Fixing…",
    de: "Wird behoben…",
  },
  "voiceDetail.wired": {
    tr: "Bağlantı düzeltildi.",
    en: "Connection fixed.",
    de: "Verbindung behoben.",
  },
  // "The agent", never "her": the persona picks any name and any voice, and
  // the UI must not assign it a gender the owner did not.
  "voiceDetail.canEndCall": {
    tr: "Asistan görüşmeyi kapatabilsin",
    en: "Let the agent end the call",
    de: "Agent darf das Gespräch beenden",
  },
  "voiceDetail.canEndCallHint": {
    tr: "Açıkken asistan, arayan vedalaştıktan sonra kısaca veda edip telefonu kapatır. Kapalıyken hattı arayan kapatana kadar açık tutar. Değişiklik hemen yayınlanır.",
    en: "On, the agent says a short goodbye and hangs up once the caller is done. Off, the line stays open until the caller hangs up. The change publishes straight away.",
    de: "An verabschiedet sich der Agent kurz und legt auf, sobald der Anrufer fertig ist. Aus bleibt die Leitung offen, bis der Anrufer auflegt. Die Änderung wird sofort veröffentlicht.",
  },
  // IDENTICAL to voiceVariables.agentName below, on purpose (Serdar,
  // 2026-08-26): this field fills the {{agent_name}} pill the Talimat shows
  // as "Asistanın adı", and two spellings for one thing made the connection
  // invisible — "Ajan" was also the old vocabulary this surface shed when it
  // became Asistan.
  "voiceDetail.persona": {
    tr: "Asistanın adı",
    en: "Agent's name",
    de: "Name des Agenten",
  },
  "voiceDetail.personaHint": {
    tr: "Arayana kendini bu isimle tanıtır. Boş bırakırsanız isim uydurmaz, randevu görevlisi olduğunu söyler. Değişiklik bir sonraki aramada geçerli olur.",
    en: "The name she gives a caller who asks. Left empty she invents nothing and says she is the appointment desk. A change takes effect on the next call.",
    de: "Der Name, den sie einem Anrufer nennt. Leer erfindet sie keinen und sagt, sie ist die Terminannahme. Eine Änderung gilt ab dem nächsten Anruf.",
  },
  "voiceDetail.personaPlaceholder": {
    tr: "Örneğin Deniz",
    en: "For example Deniz",
    de: "Zum Beispiel Deniz",
  },
  "voiceDetail.templateBehind": {
    tr: "Bu ajan için daha yeni ses ayarları hazır.",
    en: "Newer voice tuning is available for this agent.",
    de: "Für diesen Agenten steht eine neuere Abstimmung bereit.",
  },
  // Names what the CURRENT template version delivers, so it has to be
  // rewritten with every bump that changes the answer — a banner still
  // advertising v11's improvements is a promise about a version nobody is
  // being offered. Its last sentence is the load-bearing one: the sync
  // replaces tools and knobs and never the owner's prompt.
  //
  // The middle sentence is v15: the post-call analysis field
  // resepta_no_ai_calls (retell.markNoAiCallsFromCall). The label in quotes is
  // the record footer's switch, customers.noAiCalls, word for word.
  "voiceDetail.templateBehindHint": {
    tr: "Güncellemeden sonra asistan arayana hangi saatin uygun olduğunu sorar, o saat doluysa en yakın boş saatleri önerir, takvime bakarken sessiz kalmak yerine kısa bir söz söyler, işletme, ekip ve hizmet adlarınızı daha iyi anlar ve on dakikayı geçen aramayı sonlandırır. Asistan tarafından bir daha aranmak istemediğini söyleyen arayanın kaydında “AI aramaz” işaretini kendisi açar. Talimat metnine dokunmaz.",
    en: "After the update the agent asks which time suits the caller, offers the nearest free times when that one is taken, says a few words instead of going quiet while it checks the calendar, hears your business, team and service names more reliably, and ends any call that runs past ten minutes. When a caller asks not to be called by the AI again, it turns on \"No AI calls\" on their record. Your instructions are not touched.",
    de: "Nach dem Update fragt der Agent, welche Uhrzeit passt, bietet bei einer belegten Zeit die nächsten freien an, sagt beim Blick in den Kalender kurz etwas, statt zu schweigen, versteht Ihre Betriebs-, Team- und Leistungsnamen zuverlässiger und beendet Anrufe nach zehn Minuten. Bittet ein Anrufer, nicht mehr von der KI angerufen zu werden, setzt er in dessen Kundenprofil „Kein KI-Anruf“. Ihre Anweisung bleibt unverändert.",
  },
  "voiceDetail.templateUpdate": {
    tr: "Güncelle",
    en: "Update",
    de: "Aktualisieren",
  },
  "voiceDetail.templateUpdating": {
    tr: "Güncelleniyor…",
    en: "Updating…",
    de: "Wird aktualisiert…",
  },
  "voiceDetail.templateUpdated": {
    tr: "Asistan güncellendi.",
    en: "Agent updated.",
    de: "Agent aktualisiert.",
  },
  "voiceDetail.prompt": {
    tr: "Talimat",
    en: "Instructions",
    de: "Anweisung",
  },
  "voiceDetail.promptHint": {
    tr: "Asistana ne yapması söylendiği. Yayınladığınızda bir sonraki aramadan itibaren geçerli olur.",
    en: "What the agent is told to do. Publishing takes effect on the very next call.",
    de: "Was dem Assistenten vorgegeben wird. Nach dem Veröffentlichen gilt es ab dem nächsten Anruf.",
  },
  "voiceDetail.opening": {
    tr: "Açılış cümlesi",
    en: "Opening line",
    de: "Begrüßungssatz",
  },
  "voiceDetail.openingHint": {
    tr: "İlk söylediği cümle. Boş bırakırsanız asistan kendi açılışını yapar.",
    en: "What it says first. Leave empty to have the agent open on its own.",
    de: "Der erste Satz. Leer lassen, damit der Assistent selbst eröffnet.",
  },
  "voiceDetail.publish": {
    tr: "Yayınla",
    en: "Publish",
    de: "Veröffentlichen",
  },
  "voiceDetail.publishing": {
    tr: "Yayınlanıyor…",
    en: "Publishing…",
    de: "Wird veröffentlicht…",
  },
  "voiceDetail.published": {
    tr: "v{n} yayınlandı, bir sonraki aramada geçerli.",
    en: "Published v{n}, live on the next call.",
    de: "v{n} veröffentlicht, gilt ab dem nächsten Anruf.",
  },
  "voiceDetail.undo": {
    tr: "Yayını geri al",
    en: "Undo publish",
    de: "Veröffentlichung rückgängig",
  },
  // The version history (P7): the agent's own changelog, read from the phone
  // provider. A version is restored INTO the editor, never straight to live.
  "voiceDetail.versionHistory": {
    tr: "Sürüm geçmişi",
    en: "Version history",
    de: "Versionsverlauf",
  },
  "voiceDetail.versionLive": {
    tr: "yayında",
    en: "live",
    de: "live",
  },
  "voiceDetail.versionDraft": {
    tr: "taslak",
    en: "draft",
    de: "Entwurf",
  },
  "voiceDetail.versionUntitled": {
    tr: "Not yok",
    en: "No note",
    de: "Ohne Notiz",
  },
  "voiceDetail.versionsEmpty": {
    tr: "Henüz sürüm yok.",
    en: "No versions yet.",
    de: "Noch keine Versionen.",
  },
  "voiceDetail.versionsFailed": {
    tr: "Sürümler okunamadı.",
    en: "Could not read the versions.",
    de: "Die Versionen konnten nicht gelesen werden.",
  },
  "voiceDetail.versionRestore": {
    tr: "Düzenleyiciye al",
    en: "Restore",
    de: "Wiederherstellen",
  },
  "voiceDetail.restored": {
    tr: "v{n} düzenleyicide. Yayına almak için Yayınla'ya basın.",
    en: "v{n} is in the editor. Publish to put it live.",
    de: "v{n} steht im Editor. Mit Veröffentlichen geht sie live.",
  },
  // A draft at the provider that callers do not hear yet: a publish that
  // stopped half way, a staged test, an edit made in the provider's console.
  "voiceDetail.draftPending": {
    tr: "Yayınlanmamış taslak",
    en: "Unpublished draft",
    de: "Unveröffentlichter Entwurf",
  },
  "voiceDetail.draftPendingHint": {
    tr: "Bu asistanda arayanların henüz duymadığı değişiklikler var. Yayınla onları yayına alır, Vazgeç siler.",
    en: "This agent has changes callers do not hear yet. Publish puts them live; Discard throws them away.",
    de: "Dieser Agent hat Änderungen, die Anrufer noch nicht hören. Veröffentlichen schaltet sie live, Verwerfen löscht sie.",
  },
  "voiceDetail.neverPublished": {
    tr: "Bu asistan hiç yayınlanmadı, dönülecek bir sürüm yok. Önce yayınlayın.",
    en: "This agent has never been published, so there is no version to go back to. Publish it first.",
    de: "Dieser Agent wurde nie veröffentlicht, es gibt keine Version zum Zurückgehen. Zuerst veröffentlichen.",
  },
  // What the version note says changed. Joined with ", " into one title.
  "voiceDetail.noteInstructions": {
    tr: "Talimat",
    en: "Instructions",
    de: "Anweisungen",
  },
  "voiceDetail.noteOpening": {
    tr: "Açılış cümlesi",
    en: "Opening line",
    de: "Begrüßung",
  },
  "voiceDetail.noteVoice": {
    tr: "Ses",
    en: "Voice",
    de: "Stimme",
  },
  "voiceDetail.noteVariables": {
    tr: "Değişkenler",
    en: "Variables",
    de: "Variablen",
  },
  "voiceDetail.noteVoicemail": {
    tr: "Sesli mesaj",
    en: "Voicemail",
    de: "Mailbox",
  },
  // Voicemail (Nudge 8782af94): one dropdown naming every answer, because a
  // switch beside a second choice was four answers drawn as two controls.
  "voiceDetail.voicemail": {
    tr: "Telesekreter",
    en: "Voicemail",
    de: "Mailbox",
  },
  "voiceDetail.voicemailHint": {
    tr: "Asistanın aradığı kişi yerine telesekreter açılırsa ne olacağı. Tam metin her seferinde aynı cümleyi bırakır. Talimat ise asistanın mesajı sizin tarifinize göre kendisinin söylemesidir.",
    en: "What happens when a call the agent places reaches an answering machine. Exact words leaves the same sentence every time. Instructions lets the agent say the message itself, following what you describe.",
    de: "Was passiert, wenn ein Anruf des Agenten auf einer Mailbox landet. Genauer Wortlaut hinterlässt jedes Mal denselben Satz. Bei Anweisungen spricht der Agent die Nachricht selbst, nach Ihrer Beschreibung.",
  },
  "voiceDetail.voicemailOff": {
    tr: "Algılama kapalı",
    en: "Don't detect it",
    de: "Nicht erkennen",
  },
  "voiceDetail.voicemailHangup": {
    tr: "Kapat",
    en: "Hang up",
    de: "Auflegen",
  },
  "voiceDetail.voicemailStatic": {
    tr: "Mesaj bırak: tam metin",
    en: "Leave a message: exact words",
    de: "Nachricht hinterlassen: genauer Wortlaut",
  },
  "voiceDetail.voicemailPrompt": {
    tr: "Mesaj bırak: talimatla",
    en: "Leave a message: from instructions",
    de: "Nachricht hinterlassen: nach Anweisung",
  },
  "voiceDetail.voicemailStaticPlaceholder": {
    tr: "Merhaba, randevunuz için aradık. Uygun olduğunuzda bizi geri arayabilirsiniz.",
    en: "Hello, this is the team calling about your appointment. Please call us back when it suits you.",
    de: "Hallo, wir rufen wegen Ihres Termins an. Rufen Sie uns gern zurück, wenn es Ihnen passt.",
  },
  "voiceDetail.voicemailPromptPlaceholder": {
    tr: "Kim olduğunu ve neden aradığını söyle, geri aramalarını rica et. Kısa tut.",
    en: "Say who is calling and why, and ask them to call back. Keep it short.",
    de: "Sag, wer anruft und warum, und bitte um Rückruf. Kurz halten.",
  },
  "voiceDetail.voicemailTextMissing": {
    tr: "Bırakılacak mesajı yazın ya da Kapat'ı seçin.",
    en: "Write the message to leave, or choose Hang up.",
    de: "Schreiben Sie die Nachricht oder wählen Sie Auflegen.",
  },
  // The two agent shapes this sheet cannot edit, said in the owner's terms.
  // Derived from engineType client-side so the copy translates; the backend
  // sends no English for these.
  "voiceDetail.flowAgent": {
    tr: "Bu asistan yönlendirilmiş bir konuşma akışıyla çalışıyor. Senaryosu henüz Resepta'dan düzenlenemiyor.",
    en: "This agent uses a guided call flow. Its script cannot be edited from Resepta yet.",
    de: "Dieser Assistent nutzt einen geführten Gesprächsablauf. Sein Skript kann noch nicht in Resepta bearbeitet werden.",
  },
  "voiceDetail.noPrompt": {
    tr: "Bu asistanın buradan düzenlenebilecek bir talimatı yok.",
    en: "This agent has no prompt that can be edited here.",
    de: "Dieser Assistent hat keine Anweisung, die sich hier bearbeiten lässt.",
  },
  // The three groups are the agent's three behaviours, named as such —
  // knows, asks, learns — because owners think in what the agent DOES, not
  // in the call's timeline (that lives in each group's InfoTip). The
  // sequence also tells the product's whole loop: knows, asks, learns,
  // knows more next time.
  // The variables editor's two sections since 2026-08-25. Two, not the three
  // capture phases (Knows / Asks / Learns) they replace: before/during/after
  // is the RUNTIME's timeline, and reading it back as a taxonomy confused the
  // one person it was for (Serdar: "knows asks learns is still getting me
  // super confused, do we need those distinctions at all?!"). The owner's two
  // real questions are what the agent is told and what it may write down.
  "voiceVariables.sees": {
    tr: "Asistanın gördükleri",
    en: "What the agent sees",
    de: "Was der Assistent sieht",
  },
  "voiceVariables.seesHint": {
    tr: "Her aramada asistana otomatik verilir: arayanın kartı, randevuları, hizmetleriniz, ekip ve işletme bilgileri. Kurulum gerektirmez.",
    en: "Handed to the agent automatically on every call: the caller's card, their appointments, your services, staff and business knowledge. Nothing to set up.",
    de: "Wird dem Assistenten bei jedem Anruf automatisch mitgegeben: die Karte des Anrufers, seine Termine, Ihre Leistungen, das Team und die Betriebsinfos. Keine Einrichtung nötig.",
  },
  // The matrix's switch-column header: whether the ASSISTANT uses the field.
  // One word, because the track is 2.5rem.
  "voiceVariables.colAgent": {
    tr: "Asistan",
    en: "Agent",
    de: "Assistent",
  },
  "voiceVariables.fills": {
    tr: "Asistanın doldurdukları",
    en: "What the agent fills in",
    de: "Was der Assistent ausfüllt",
  },
  "voiceVariables.fillsHint": {
    tr: "Asistanın sorup kaydettiği alanlar. Cevap eksikse konuşma sırasında sorar; gözden kaçanı arama bittiğinde konuşmadan tamamlar.",
    en: "Fields the agent asks about and writes down. It asks during the call when the answer is missing; anything it misses is recovered from the conversation once the call ends.",
    de: "Felder, die der Assistent erfragt und einträgt. Fehlt die Antwort, fragt er im Gespräch; Übersehenes wird nach dem Anruf aus dem Gespräch ergänzt.",
  },
  "voiceDetail.beforeEmpty": {
    tr: "Bilgi verilmiyor.",
    en: "Nothing injected.",
    de: "Keine Angaben.",
  },
  "voiceDetail.duringEmpty": {
    tr: "Fonksiyon yok. Konuşabilir ama randevu alamaz.",
    en: "No functions. It can talk, but not book.",
    de: "Keine Funktionen. Er kann sprechen, aber keine Termine vergeben.",
  },
  "voiceDetail.afterEmpty": {
    tr: "Bilgi çıkarılmıyor.",
    en: "Nothing extracted.",
    de: "Nichts erfasst.",
  },
  "voiceVariables.title": {
    tr: "Değişkenler",
    en: "Variables",
    de: "Variablen",
  },
  "voiceVariables.hint": {
    tr: "Her satır bir bilginin tüm yolunu gösterir: aramadan önce nereden geldiği, konuşmada nasıl toplandığı, sonradan çıkarılıp çıkarılmadığı ve nereye kaydedildiği.",
    en: "Each row shows one value's complete lifecycle: where it comes from before the call, how it is collected during the conversation, whether it is recovered afterward, and where it is saved.",
    de: "Jede Zeile zeigt den gesamten Weg eines Werts: woher er vor dem Anruf kommt, wie er im Gespräch erfasst wird, ob er danach ergänzt wird und wo er gespeichert wird.",
  },
  "voiceVariables.importedHint": {
    tr: "Bunlar asistanın mevcut ayarlarıdır. Yayınladığınızda diğer yetenekleri değişmeden Resepta tarafından yönetilmeye başlar.",
    en: "These are the agent's current settings. Publishing brings them under Resepta management without changing its other abilities.",
    de: "Dies sind die aktuellen Einstellungen des Assistenten. Beim Veröffentlichen übernimmt Resepta ihre Verwaltung, ohne andere Fähigkeiten zu ändern.",
  },
  "voiceVariables.variable": { tr: "Bilgi", en: "Variable", de: "Angabe" },
  "voiceVariables.add": {
    tr: "Değişken ekle",
    en: "Add variable",
    de: "Variable hinzufügen",
  },
  "voiceVariables.edit": {
    tr: "Değişkeni düzenle",
    en: "Edit variable",
    de: "Variable bearbeiten",
  },
  "voiceVariables.editHint": {
    tr: "Arayanın açıkça verdiği bilgi, arama sonrası tahminden önceliklidir. Arama sonrası çıkarım yalnızca eksik müşteri alanlarını doldurur.",
    en: "A value the caller provides directly wins over post-call inference. Post-call extraction only fills an empty customer field.",
    de: "Ein vom Anrufer direkt genannter Wert hat Vorrang vor der Auswertung danach. Die nachträgliche Auswertung füllt nur ein leeres Kundenfeld.",
  },
  "voiceVariables.savedTo": {
    tr: "Kaydedildiği yer",
    en: "Saved to",
    de: "Gespeichert in",
  },
  "voiceVariables.callOnly": {
    tr: "Yalnızca arama",
    en: "Call only",
    de: "Nur Anruf",
  },
  // The disabled placeholder a legacy capture row shows until it is linked
  // somewhere real. Phrased as the unfinished task it is.
  "voiceVariables.choosePlace": {
    tr: "Nereye kaydedileceğini seçin",
    en: "Choose where to save",
    de: "Speicherort wählen",
  },
  "voiceVariables.builtin": {
    tr: "Otomatik",
    en: "Automatic",
    de: "Automatisch",
  },
  "voiceVariables.builtinHint": {
    tr: "Bu bilgiler her aramada kendiliğinden hazırdır. Yeni değişken, aramada toplanacak bilgiler içindir.",
    en: "This information is ready on every call by itself. Add a variable for information the call should collect.",
    de: "Diese Angaben stehen bei jedem Anruf automatisch bereit. Neue Variablen sind für Angaben, die der Anruf erfassen soll.",
  },
  "voiceVariables.servicesList": {
    tr: "Hizmet listesi",
    en: "Service list",
    de: "Leistungsliste",
  },
  "voiceDetail.atHint": {
    tr: "Değişken eklemek için @ yazın",
    en: "Type @ to insert a variable",
    de: "Tippe @, um eine Variable einzufügen",
  },
  "voiceDetail.atEmpty": {
    tr: "Eşleşen değişken yok. Değişkenler sekmesinden ekleyin.",
    en: "No matching variable. Add it in the Variables tab.",
    de: "Keine passende Variable. Füge sie im Tab Variablen hinzu.",
  },
  "voiceVariables.notConfigured": {
    tr: "Henüz tanımlı değil",
    en: "Not set up yet",
    de: "Noch nicht eingerichtet",
  },
  "voiceVariables.saveToCustomer": {
    tr: "Müşteri kartına da kaydet",
    en: "Also save to the customer card",
    de: "Auch im Kundenprofil speichern",
  },
  "voiceVariables.fieldExists": {
    tr: "Bu adla bir müşteri alanı zaten var.",
    en: "A customer field with this name already exists.",
    de: "Ein Kundenfeld mit diesem Namen existiert bereits.",
  },
  "voiceVariables.noFieldsHint": {
    tr: "Aramayla birlikte kaydedilir. Müşteri kartına da yazması için İşletme bölümünde bir alanı sesli asistana açın.",
    en: "Saved with the call. To also write into the customer card, allow a field for the voice agent under Business.",
    de: "Wird mit dem Anruf gespeichert. Damit es auch ins Kundenprofil geschrieben wird, gib unter Betrieb ein Feld für den Sprachassistenten frei.",
  },
  "voiceVariables.label": { tr: "Ad", en: "Name", de: "Name" },
  "voiceVariables.key": { tr: "Değişken anahtarı", en: "Variable key", de: "Variablenschlüssel" },
  "voiceVariables.description": {
    tr: "Ne toplanmalı?",
    en: "What should be captured?",
    de: "Was soll erfasst werden?",
  },
  "voiceVariables.type": { tr: "Tür", en: "Type", de: "Typ" },
  "voiceVariables.text": { tr: "Metin", en: "Text", de: "Text" },
  "voiceVariables.number": { tr: "Sayı", en: "Number", de: "Zahl" },
  "voiceVariables.yesNo": { tr: "Evet veya hayır", en: "Yes or no", de: "Ja oder Nein" },
  "voiceVariables.options": { tr: "Seçenekler", en: "Options", de: "Auswahl" },
  "voiceVariables.none": { tr: "Kullanma", en: "Do not use", de: "Nicht verwenden" },
  "voiceVariables.addRow": {
    tr: "+ Bilgi ekle",
    en: "+ Add variable",
    de: "+ Variable hinzufügen",
  },
  // The before-call group's add link — Nudge's word for pre-call context.
  "voiceVariables.addDefault": {
    tr: "+ Varsayılan ekle",
    en: "+ Add default",
    de: "+ Standard hinzufügen",
  },
  // The read-only rows in "Before the call": context the runtime sends with
  // EVERY call, configured or not. These labels also name the same tokens in
  // the prompt editor, so the two surfaces stop disagreeing about what a
  // variable is.
  "voiceVariables.agentName": {
    tr: "Asistanın adı",
    en: "Agent's name",
    de: "Name des Agenten",
  },
  "voiceVariables.now": {
    tr: "Şu anki tarih ve saat",
    en: "Current date and time",
    de: "Aktuelles Datum und Uhrzeit",
  },
  "voiceVariables.staffList": {
    tr: "Personel adları",
    en: "Staff names",
    de: "Mitarbeiternamen",
  },
  "voiceVariables.informationList": {
    tr: "Toplanabilir bilgiler",
    en: "Collectable fields",
    de: "Erfassbare Felder",
  },
  // What each always-sent variable actually does — the third column of the
  // read-only rows in Before the call. Written as answers to "what will the
  // agent know", not as restated labels.
  "voiceVariables.list": { tr: "Liste", en: "List", de: "Liste" },
  // The capture popover's pre-fill select. It was labelled "Before the call",
  // which restated a group name instead of saying what the control does.
  "voiceVariables.source": {
    tr: "Şuradan doldurulur",
    en: "Filled from",
    de: "Vorbefüllt aus",
  },
  "voiceVariables.descFirstName": {
    tr: "Arayanın müşteri kartındaki adı.",
    en: "The caller's first name, from their customer card.",
    de: "Der Vorname des Anrufers, aus seiner Kundenkarte.",
  },
  "voiceVariables.descLastName": {
    tr: "Arayanın müşteri kartındaki soyadı.",
    en: "The caller's last name, from their customer card.",
    de: "Der Nachname des Anrufers, aus seiner Kundenkarte.",
  },
  "voiceVariables.descPhone": {
    tr: "Arayanın telefon numarası.",
    en: "The caller's phone number.",
    de: "Die Telefonnummer des Anrufers.",
  },
  "voiceVariables.descEmail": {
    tr: "Arayanın kayıtlı e-posta adresi.",
    en: "The caller's saved email address.",
    de: "Die gespeicherte E-Mail-Adresse des Anrufers.",
  },
  "voiceVariables.descLanguage": {
    tr: "Arayanın kayıtlı dili.",
    en: "The caller's saved language.",
    de: "Die gespeicherte Sprache des Anrufers.",
  },
  "voiceVariables.descNextAppointment": {
    tr: "Arayanın bir sonraki randevusu.",
    en: "The caller's next upcoming appointment.",
    de: "Der nächste anstehende Termin des Anrufers.",
  },
  "voiceVariables.descBusinessName": {
    tr: "İşletmenizin adı.",
    en: "Your business's name.",
    de: "Der Name Ihres Betriebs.",
  },
  "voiceVariables.descServices": {
    tr: "Sunduğunuz hizmetler, fiyat ve süreleriyle.",
    en: "Every service you offer, with prices and durations.",
    de: "Alle angebotenen Leistungen, mit Preisen und Dauer.",
  },
  "voiceVariables.descAgentName": {
    tr: "Asistanın arayana söylediği kendi adı.",
    en: "The name the agent introduces herself with.",
    de: "Der Name, mit dem sich die Assistentin vorstellt.",
  },
  "voiceVariables.descCustomerName": {
    tr: "Arayanın tam adı.",
    en: "The caller's full name.",
    de: "Der vollständige Name des Anrufers.",
  },
  "voiceVariables.descNow": {
    tr: "İşletmenizin saat dilimindeki güncel tarih ve saat — \"yarın\" buna göre çözülür.",
    en: "Today's date and time in your timezone — \"tomorrow\" resolves against this.",
    de: "Datum und Uhrzeit in Ihrer Zeitzone — \"morgen\" wird daran aufgelöst.",
  },
  "voiceVariables.descStaff": {
    tr: "Aktif personelinizin adları.",
    en: "Your active staff's names.",
    de: "Die Namen Ihres aktiven Personals.",
  },
  "voiceVariables.descContact": {
    tr: "Arayanın müşteri kartının tamamı.",
    en: "The caller's whole customer card.",
    de: "Die vollständige Kundenkarte des Anrufers.",
  },
  "voiceVariables.descInformation": {
    tr: "Asistanın bu aramada doldurabileceği alanlar.",
    en: "The fields the agent may fill on this call.",
    de: "Die Felder, die die Assistentin in diesem Anruf ausfüllen darf.",
  },
  // The type popover's inline choices editor (Nudge's Choices section).
  "voiceVariables.choice": { tr: "Seçenek", en: "Choice", de: "Option" },
  "voiceVariables.addChoice": {
    tr: "+ Seçenek ekle",
    en: "+ Add choice",
    de: "+ Option hinzufügen",
  },
  "voiceVariables.removeChoice": {
    tr: "Seçeneği kaldır",
    en: "Remove choice",
    de: "Option entfernen",
  },
  // The add-variable picker: existing customer fields first, create inline
  // second, call-only as the deliberate exception.
  "voiceVariables.pickerSearch": {
    tr: "Bilgi adı yazın",
    en: "Type a name",
    de: "Namen eingeben",
  },
  "voiceVariables.pickerCreate": {
    tr: "Müşteri alanı oluştur: {name}",
    en: "Create customer field: {name}",
    de: "Kundenfeld anlegen: {name}",
  },
  "voiceVariables.pickerCreateHint": {
    tr: "Hizmetler ve alanlar bölümünde de görünür ve toplanan yanıt müşteri kartına yazılır.",
    en: "Also appears under Services & fields, and the collected answer is written to the customer card.",
    de: "Erscheint auch unter Leistungen & Felder, und die erfasste Antwort wird ins Kundenprofil geschrieben.",
  },
  "voiceVariables.pickerCallOnly": {
    tr: "Yalnızca aramayla kaydet: {name}",
    en: "Just for this call: {name}",
    de: "Nur für diesen Anruf: {name}",
  },
  "voiceVariables.pickerEmpty": {
    tr: "Yeni bir bilgi için adını yazın.",
    en: "Type a name to add a new one.",
    de: "Namen eingeben, um eine neue hinzuzufügen.",
  },
  // The context the runtime injects whether or not anyone configured it, plus
  // customer fields waiting to be captured. Neither is a row you edit.
  "voiceVariables.alwaysAvailable": {
    tr: "Her aramada hazır",
    en: "Always available",
    de: "Immer verfügbar",
  },
  "voiceVariables.capturedWhen": {
    tr: "Ne zaman alınır",
    en: "Captured when",
    de: "Wann erfasst",
  },
  "voiceVariables.removeBody": {
    tr: "“{name}” bu asistandan kaldırılsın mı? Kaydedene kadar geçerli olmaz.",
    en: "Remove “{name}” from this agent? Nothing changes until you save.",
    de: "„{name}“ von diesem Assistenten entfernen? Bis zum Speichern ändert sich nichts.",
  },
  "voiceVariables.defaultValue": {
    tr: "Sabit değer",
    en: "Default value",
    de: "Fester Wert",
  },
  "voiceVariables.businessName": {
    tr: "İşletme adı",
    en: "Business name",
    de: "Betriebsname",
  },
  "voiceVariables.customerName": {
    tr: "Müşteri adı",
    en: "Customer name",
    de: "Kundenname",
  },
  "voiceVariables.customerPhone": {
    tr: "Müşteri telefonu",
    en: "Customer phone",
    de: "Kundentelefon",
  },
  "voiceVariables.customerEmail": {
    tr: "Müşteri e-postası",
    en: "Customer email",
    de: "Kunden-E-Mail",
  },
  "voiceVariables.customerLanguage": {
    tr: "Müşteri dili",
    en: "Customer language",
    de: "Kundensprache",
  },
  "voiceVariables.nextAppointment": {
    tr: "Sonraki randevu",
    en: "Next appointment",
    de: "Nächster Termin",
  },
  "voiceVariables.askMissing": {
    tr: "Eksikse sor",
    en: "Ask if missing",
    de: "Fragen, wenn leer",
  },
  "voiceVariables.confirm": {
    tr: "Teyit et",
    en: "Confirm it",
    de: "Bestätigen lassen",
  },
  "voiceVariables.extract": { tr: "Tamamla", en: "Recover", de: "Ergänzen" },
  "voiceVariables.afterFallback": {
    tr: "Arama sonrası eksikse tamamla",
    en: "Recover if missing after the call",
    de: "Nach dem Anruf ergänzen, wenn leer",
  },
  "voiceVariables.required": { tr: "Zorunlu", en: "Required", de: "Erforderlich" },
  "voiceVariables.empty": {
    tr: "Bu asistan henüz bilgi toplamıyor.",
    en: "This agent does not collect any variables yet.",
    de: "Dieser Assistent erfasst noch keine Variablen.",
  },
  "voiceVariables.remove": {
    tr: "{name} değişkenini kaldır",
    en: "Remove {name}",
    de: "{name} entfernen",
  },
  "voiceVariables.done": { tr: "Bitti", en: "Done", de: "Fertig" },
  "voiceVariables.publish": {
    tr: "Değişiklikleri yayınla",
    en: "Publish changes",
    de: "Änderungen veröffentlichen",
  },
  "voiceVariables.publishing": {
    tr: "Değişkenler yayınlanıyor…",
    en: "Publishing variables…",
    de: "Variablen werden veröffentlicht…",
  },
  "voiceVariables.published": {
    tr: "v{n} yayınlandı",
    en: "Published v{n}",
    de: "v{n} veröffentlicht",
  },
  "voiceDetail.test": {
    tr: "Deneme araması",
    en: "Test call",
    de: "Testanruf",
  },
  // The empty option in the agent page's line picker. Not the list's "— None —":
  // that one sits under an "Inbound number" column header, and this one stands
  // alone in a toolbar where a dash means nothing.
  "voiceDetail.noLine": {
    tr: "Gelen numara yok",
    en: "No inbound number",
    de: "Keine eingehende Nummer",
  },
  "voiceDetail.lineFailed": {
    tr: "Numara değiştirilemedi",
    en: "Couldn't change the number",
    de: "Nummer konnte nicht geändert werden",
  },
  "voiceDetail.testHint": {
    tr: "Girdiğiniz numarayı bu asistanla gerçekten arar. Telefon gerçekten çalar ve dakikalar ücretlendirilir.",
    en: "Places a real call to the number you enter, using this agent. The phone genuinely rings and the minutes are billed.",
    de: "Ruft die eingegebene Nummer mit diesem Assistenten wirklich an. Das Telefon klingelt tatsächlich, und die Minuten werden berechnet.",
  },
  "voiceDetail.callMe": {
    tr: "Beni ara",
    en: "Call me",
    de: "Mich anrufen",
  },
  "voiceDetail.calling": {
    tr: "Aranıyor…",
    en: "Calling…",
    de: "Wird angerufen…",
  },
  "voiceDetail.confirmCall": {
    tr: "{to} şimdi {name} ile aransın mı?",
    en: "Call {to} now with {name}?",
    de: "{to} jetzt mit {name} anrufen?",
  },
  "voiceDetail.testUnsaved": {
    tr: "Kaydedilmemiş değişiklikler bu aramada geçerli değil — önce kaydedin.",
    en: "Unsaved changes are not part of this call — save first to hear them.",
    de: "Nicht gespeicherte Änderungen gelten für diesen Anruf nicht — zuerst speichern.",
  },
  // The header's dirty state. An edited prompt looks live on screen while the
  // agent is still answering the phone with whatever Retell has; this says so.
  // Pill and button drop the word "changes": the amber dot and the pair of
  // actions beside them already say what kind of unsaved is meant.
  "voiceDetail.renameHint": {
    tr: "Adı düzenlemek için tıkla",
    en: "Click to rename",
    de: "Zum Umbenennen klicken",
  },
  "voiceDetail.unsaved": {
    tr: "Kaydedilmedi",
    en: "Unsaved",
    de: "Ungespeichert",
  },
  "voiceDetail.unsavedHint": {
    tr: "Bu değişiklikler henüz yayında değil. Siz kaydedene kadar asistan mevcut ayarlarıyla çalışmaya devam eder.",
    en: "These edits aren't live yet. The agent keeps running its saved settings until you save.",
    de: "Diese Änderungen sind noch nicht live. Der Assistent läuft mit seinen gespeicherten Einstellungen weiter, bis Sie speichern.",
  },
  // "Discard" alone answers nothing — discard WHAT (Serdar, 2026-08-21). It
  // sits beside Publish on the agent editor's header, where the thing being
  // thrown away is the unsaved draft, so the button says so.
  "voiceDetail.discard": {
    tr: "Değişiklikleri geri al",
    en: "Discard changes",
    de: "Änderungen verwerfen",
  },
  "voiceDetail.voice": { tr: "Ses", en: "Voice", de: "Stimme" },
  "voiceDetail.voiceHint": {
    tr: "Asistanın konuştuğu ses. Kaydettiğinizde bir sonraki aramadan itibaren geçerli olur.",
    en: "The voice the agent speaks with. Saving makes it live on the very next call.",
    de: "Die Stimme, mit der der Assistent spricht. Nach dem Speichern gilt sie ab dem nächsten Anruf.",
  },
  "voiceDetail.voicePick": {
    tr: "— bir ses seçin —",
    en: "— pick a voice —",
    de: "— Stimme wählen —",
  },
  "voiceDetail.voicePreview": {
    tr: "Bu sesten bir örnek dinleyin",
    en: "Play a sample of this voice",
    de: "Hörprobe dieser Stimme abspielen",
  },
  "voiceDetail.callingFromTo": {
    tr: "{from} numarasından {to} aranıyor…",
    en: "Calling {to} from {from}…",
    de: "{to} wird von {from} angerufen…",
  },
  "voiceDetail.badNumber": {
    tr: "Numarayı uluslararası biçimde girin, örn. +905321234567.",
    en: "Enter the number in full international form, e.g. +905321234567.",
    de: "Geben Sie die Nummer im internationalen Format ein, z. B. +4915123456789.",
  },
  // A test call to a number filed under a customer who asked not to be called
  // by the AI. The test has nobody to say "call anyway"; the record does.
  "voiceDetail.noAiCalls": {
    tr: "Aranmadı: bu numara, sesli asistanla aranmak istemeyen bir müşteriye ait. Bu aramayı kabul ettiyse müşterinin kaydından arayın.",
    en: "Not called: this number belongs to a customer who asked not to be called by the voice agent. If they agreed to this call, place it from their record.",
    de: "Nicht angerufen: Diese Nummer gehört einem Kunden, der nicht vom Sprachassistenten angerufen werden möchte. Wenn er diesem Anruf zugestimmt hat, rufen Sie aus seinem Kundendatensatz an.",
  },

  // The AI connectors card: keys for talking to this workspace from Claude or
  // ChatGPT. Keys are per person, so this surface is open to staff too — the
  // backend scopes create to self and revoke-others to owners.
  "settings.ai": { tr: "Yapay zekâ", en: "AI", de: "KI" },
  "mcp.intro": {
    tr: "İşletmenizle Claude veya ChatGPT üzerinden konuşun: takvime bakın, müşteri arayın, not bırakın. Her ekip üyesi kendi anahtarıyla bağlanır ve yapılan her işlem etkinlik akışına onun adıyla yazılır.",
    en: "Talk to your business from Claude or ChatGPT: check the calendar, look up customers, leave notes. Each team member connects with their own key, and everything done shows up in the activity feed under their name.",
    de: "Sprechen Sie über Claude oder ChatGPT mit Ihrem Betrieb: Kalender ansehen, Kunden nachschlagen, Notizen hinterlassen. Jedes Teammitglied verbindet sich mit einem eigenen Schlüssel, und alles erscheint unter seinem Namen im Aktivitätsverlauf.",
  },
  // Operator-only, and phrased for the operator: a salon owner never sees it.
  // The key would carry THEIR membership into a business they are only
  // visiting, and the connector re-checks that membership on every call, so
  // the key would be dead the moment it left the screen.
  "mcp.mintFailed": {
    tr: "Anahtar oluşturulamadı. Tekrar deneyin.",
    en: "Couldn't create the key. Try again.",
    de: "Schlüssel konnte nicht erstellt werden. Bitte erneut versuchen.",
  },
  "mcp.endpoint": {
    tr: "Bağlantı adresi",
    en: "Connector URL",
    de: "Connector-Adresse",
  },
  "mcp.endpointHint": {
    tr: "Claude veya ChatGPT'ye özel bağlayıcı eklerken bu adresi yapıştırın. Anahtar, adresle birlikte istenir.",
    en: "Paste this URL when adding a custom connector in Claude or ChatGPT. The key is asked for alongside it.",
    de: "Fügen Sie diese Adresse beim Anlegen eines eigenen Connectors in Claude oder ChatGPT ein. Der Schlüssel wird zusammen mit ihr abgefragt.",
  },
  "mcp.connectClaude": {
    tr: "Claude bağla",
    en: "Connect Claude",
    de: "Claude verbinden",
  },
  "mcp.connectChatgpt": {
    tr: "ChatGPT bağla",
    en: "Connect ChatGPT",
    de: "ChatGPT verbinden",
  },
  "mcp.keyOnce": {
    tr: "Bu anahtarı şimdi kopyalayın. Güvenlik için yalnızca bu kez gösterilir.",
    en: "Copy this key now. For security it is shown only this once.",
    de: "Kopieren Sie diesen Schlüssel jetzt. Aus Sicherheitsgründen wird er nur dieses eine Mal angezeigt.",
  },
  "mcp.instructionsClaude": {
    tr: "Claude'da: Ayarlar → Bağlayıcılar → Özel bağlayıcı ekle. Adresi ve bu anahtarı yapıştırın.",
    en: "In Claude: Settings → Connectors → Add custom connector. Paste the URL and this key.",
    de: "In Claude: Einstellungen → Connectors → Eigenen Connector hinzufügen. Adresse und diesen Schlüssel einfügen.",
  },
  "mcp.instructionsChatgpt": {
    tr: "ChatGPT'de: Ayarlar → Bağlayıcılar → Oluştur. Adresi ve bu anahtarı yapıştırın.",
    en: "In ChatGPT: Settings → Connectors → Create. Paste the URL and this key.",
    de: "In ChatGPT: Einstellungen → Connectors → Erstellen. Adresse und diesen Schlüssel einfügen.",
  },
  "mcp.none": {
    tr: "Henüz bağlayıcı yok.",
    en: "No connectors yet.",
    de: "Noch keine Connectors.",
  },
  "mcp.lastUsed": {
    tr: "son kullanım {when}",
    en: "last used {when}",
    de: "zuletzt verwendet {when}",
  },
  "mcp.neverUsed": {
    tr: "hiç kullanılmadı",
    en: "never used",
    de: "nie verwendet",
  },
  "mcp.revoked": {
    tr: "İptal edildi",
    en: "Revoked",
    de: "Widerrufen",
  },
  "mcp.revoke": {
    tr: "İptal et",
    en: "Revoke",
    de: "Widerrufen",
  },
  "mcp.revokeConfirm": {
    tr: "{name} bağlayıcısı iptal edilsin mi? Bağlantı anında çalışmayı durdurur ve geri alınamaz.",
    en: "Revoke {name}? The connector stops working immediately and cannot be re-enabled.",
    de: "{name} widerrufen? Der Connector funktioniert sofort nicht mehr und kann nicht reaktiviert werden.",
  },
  // The Business section's Hours tab. Short, because it is a tab label.
  "settings.hours": {
    tr: "Saatler",
    en: "Hours",
    de: "Zeiten",
  },
  "settings.businessHours": {
    tr: "Açık olduğunuz günler",
    en: "Days you're open",
    de: "Ihre Öffnungstage",
  },
  "settings.businessHoursHint": {
    tr: "WhatsApp otomatik yanıtı ve sesli asistanın randevu teklifleri bu saatlere göre çalışır — kapalıyken \"kapalıyız\" diyebilmek ve kapalı saatlere randevu önermemek için. Hatırlatmaların saatini bu değil, Hatırlatmalar bölümündeki sessiz saatler belirler.",
    en: "Drives the WhatsApp auto-reply and the voice agent's scheduling — saying \"we're closed\" when you are, and never offering an appointment outside these hours. Reminder timing is set by quiet hours under Reminders, not here.",
    de: "Steuert die WhatsApp-Autoantwort und die Terminvorschläge des Sprachassistenten — \"geschlossen\" nur wenn zu ist, und keine Termine außerhalb dieser Zeiten. Die Zeit für Erinnerungen steuern die Ruhezeiten unter Erinnerungen, nicht dies.",
  },
  // The visible label for the pair, phrased to match "Days you're open" that
  // sits directly above it.
  "settings.openHours": {
    tr: "Açık olduğunuz saatler",
    en: "Hours you're open",
    de: "Ihre Öffnungszeiten",
  },
  // openFrom and openTo are now ACCESSIBLE names on the two inputs rather than
  // visible row labels, so a screen reader still hears which end is which.
  "settings.openFrom": {
    tr: "Açılış",
    en: "Opens",
    de: "Öffnet",
  },
  "settings.openTo": {
    tr: "Kapanış",
    en: "Closes",
    de: "Schließt",
  },
  // The word BETWEEN the two inputs. Its own string because "Closes" reads as
  // nonsense sitting between two times.
  "settings.openUntil": {
    tr: "-",
    en: "to",
    de: "bis",
  },
  // Per-weekday hours (2026-08-29). The seven day chips became seven rows the
  // day a business could open at different times on different days, and the
  // chip's on/off became this switch.
  "settings.dayOpenAria": {
    tr: "Bu gün açık",
    en: "Open this day",
    de: "An diesem Tag geöffnet",
  },
  // Most businesses have one pattern with one or two exceptions, so typing the
  // same pair seven times is the common case this removes.
  "settings.copyToOpenDays": {
    tr: "Bu saatleri açık günlerin tümüne uygula",
    en: "Apply these hours to every open day",
    de: "Diese Zeiten auf alle geöffneten Tage anwenden",
  },
  // The inline form of copyToOpenDays, sitting ON the row it copies from —
  // the row is the context, so the label can drop it.
  "settings.applyToAll": {
    tr: "Tümüne uygula",
    en: "Apply to all",
    de: "Auf alle anwenden",
  },
  "settings.copyToOpenDaysConfirm": {
    tr: "Bu saatler tüm açık günlere uygulansın mı?",
    en: "Apply these hours to every open day?",
    de: "Diese Zeiten auf alle geöffneten Tage anwenden?",
  },
  "settings.copyToOpenDaysNote": {
    tr: "Kapalı günler kapalı kalır.",
    en: "Closed days stay closed.",
    de: "Geschlossene Tage bleiben geschlossen.",
  },
  "settings.closedDay": {
    tr: "Kapalı",
    en: "Closed",
    de: "Geschlossen",
  },

  "closures.edit": {
    tr: "Kapalı saati düzenle",
    en: "Edit closure",
    de: "Schließzeit bearbeiten",
  },
  "closures.add": {
    tr: "Kapalı saat ekle",
    en: "Add closure",
    de: "Schließzeit hinzufügen",
  },
  "closures.allDay": {
    tr: "Tüm gün",
    en: "All day",
    de: "Ganztägig",
  },
  // The calendar quick-create tabs — Google Calendar's Event | Task row. One
  // gesture on the grid, and the first row of the popup asks what you meant.
  "calendar.tabAppointment": {
    tr: "Randevu",
    en: "Appointment",
    de: "Termin",
  },
  "calendar.tabBlock": {
    tr: "Kapalı saat",
    en: "Blocked time",
    de: "Schließzeit",
  },
  // The calendar's side panel (CalendarPanel): its name for a screen reader,
  // the ☰ that shows and hides it, and the toolbar pickers that stand in for
  // its lists on a phone or while it is closed.
  "calendar.panelLabel": {
    tr: "Takvim filtreleri",
    en: "Calendar filters",
    de: "Kalenderfilter",
  },
  "calendar.panelShow": {
    tr: "Yan paneli göster",
    en: "Show side panel",
    de: "Seitenleiste einblenden",
  },
  "calendar.panelHide": {
    tr: "Yan paneli gizle",
    en: "Hide side panel",
    de: "Seitenleiste ausblenden",
  },
  // The last ticked row of a list, which cannot be unticked.
  "calendar.lastShown": {
    tr: "En az biri takvimde kalmalı",
    en: "At least one stays on the calendar",
    de: "Mindestens einer bleibt im Kalender",
  },
  "calendar.allTeam": { tr: "Tüm ekip", en: "Whole team", de: "Ganzes Team" },
  "calendar.allServices": {
    tr: "Tüm hizmetler",
    en: "All services",
    de: "Alle Leistungen",
  },
  // The team picker's count. Not "people": Unassigned is on the same list.
  // Never under two (one shown is printed by name).
  "calendar.nSelected": { tr: "{n} seçili", en: "{n} selected", de: "{n} ausgewählt" },
  "calendar.nServices.one": { tr: "{n} hizmet", en: "{n} service", de: "{n} Leistung" },
  "calendar.nServices.other": { tr: "{n} hizmet", en: "{n} services", de: "{n} Leistungen" },
  // The kind switch's accessible name: what the two tabs above choose between.
  "calendar.kindLabel": {
    tr: "Ne eklenecek",
    en: "What to add",
    de: "Was hinzufügen",
  },
  // The block sheet's recurrence chips: once on the drawn date, weekly on
  // chosen days, or daily (weekdays 0-6 under the hood — not a new row shape).
  "closures.once": {
    tr: "Bir kez",
    en: "Once",
    de: "Einmalig",
  },
  "closures.everyWeek": {
    tr: "Her hafta",
    en: "Every week",
    de: "Jede Woche",
  },
  "closures.everyDay": {
    tr: "Her gün",
    en: "Every day",
    de: "Jeden Tag",
  },
  // The last day of a one-off block — the ten-day holiday as one row.
  "closures.lastDay": {
    tr: "Son gün",
    en: "Last day",
    de: "Letzter Tag",
  },
  // The block sheet's row labels (one question per row, Nudge's layout) and
  // the date range's own names for its two ends.
  "closures.repeats": { tr: "Tekrar", en: "Repeats", de: "Wiederholung" },
  "closures.dates": { tr: "Tarih", en: "Dates", de: "Zeitraum" },
  "closures.days": { tr: "Günler", en: "Days", de: "Tage" },
  "closures.time": { tr: "Saat", en: "Time", de: "Uhrzeit" },
  "closures.firstDay": { tr: "İlk gün", en: "First day", de: "Erster Tag" },
  // Under the month while the range waits for its end.
  "closures.pickLastDay": {
    tr: "Son günü seçin",
    en: "Pick the last day",
    de: "Letzten Tag wählen",
  },
  "closures.errRange": {
    tr: "Bitiş tarihi başlangıçtan önce olamaz.",
    en: "The last day can't come before the first.",
    de: "Der letzte Tag kann nicht vor dem ersten liegen.",
  },
  // The chip a blocked band wears on the grid when nobody typed a reason.
  "closures.blockLabel": {
    tr: "Kapalı",
    en: "Closed",
    de: "Geschlossen",
  },
  "closures.reason": {
    tr: "Açıklama",
    en: "Reason",
    de: "Grund",
  },
  "closures.reasonPlaceholder": {
    tr: "Öğle arası, bayram…",
    en: "Lunch, holiday…",
    de: "Mittagspause, Feiertag…",
  },
  // Shown in the sheet before saving. Nothing is moved or cancelled — this
  // says what is already there and leaves the decision alone.
  "closures.appointmentsInside.one": {
    tr: "Bu saatlerde zaten {n} randevu var. İptal edilmez, taşınmaz.",
    en: "There is already {n} appointment in this time. It is not cancelled or moved.",
    de: "In diesem Zeitraum gibt es bereits {n} Termin. Er wird nicht abgesagt oder verschoben.",
  },
  "closures.appointmentsInside.other": {
    tr: "Bu saatlerde zaten {n} randevu var. Hiçbiri iptal edilmez veya taşınmaz.",
    en: "There are already {n} appointments in this time. None are cancelled or moved.",
    de: "In diesem Zeitraum gibt es bereits {n} Termine. Keiner wird abgesagt oder verschoben.",
  },
  "closures.removeConfirm": {
    tr: "Bu kapalı saat kaldırılsın mı? O saatler yeniden randevuya açılır.",
    en: "Remove this closure? Those times become bookable again.",
    de: "Diese Schließzeit entfernen? Diese Zeiten werden wieder buchbar.",
  },
  "closures.errKind": {
    tr: "Tekrarlayan bir kapanış için gün, tek seferlik için tarih seçin.",
    en: "Pick days for a weekly closure, or a date for a one-off.",
    de: "Wählen Sie Tage für eine wöchentliche Schließzeit oder ein Datum für einen Einzeltag.",
  },
  "closures.errWindow": {
    tr: "Bitiş saati başlangıçtan sonra olmalı.",
    en: "The end has to come after the start.",
    de: "Das Ende muss nach dem Beginn liegen.",
  },
  // closures.add refuses a block whose every minute an existing block already
  // covers — the row would change nothing. Clicking the shaded band opens the
  // existing block instead.
  "closures.errCovered": {
    tr: "Bu saatler zaten kapalı.",
    en: "This time is already blocked.",
    de: "Diese Zeit ist bereits blockiert.",
  },
  // The booking page was part of a card called "Message variables" until
  // 2026-08-14. The name described the [booking_link] token rather than the
  // thing itself. It lives in Business settings now and the token simply
  // reads it. (Its sibling, the public phone field, went entirely on
  // 2026-08-19 — [phone] resolves from the voice agent's inbound line.)
  "settings.bookingMode": {
    tr: "Randevu alma",
    en: "Taking bookings",
    de: "Terminbuchung",
  },
  "settings.bookingPage": {
    tr: "Online randevu sayfası",
    en: "Online booking page",
    de: "Online-Buchungsseite",
  },
  "settings.bookingPageHint": {
    tr: "Müşterilerinizin hizmet ve saat seçip randevu aldığı herkese açık sayfa; randevu doğrudan takviminize düşer. Çalışma saatlerinin tanımlı olması gerekir. Mesajlarınızdaki randevu linki bu sayfayı gösterir; kapalıyken link gönderilmez.",
    en: "The public page where customers pick a service and a time; the appointment lands straight on your calendar. Your opening hours have to be set. The booking link in your messages points at this page — switched off, no link is sent.",
    de: "Die öffentliche Seite, auf der Ihre Kundschaft Leistung und Uhrzeit wählt; der Termin landet direkt in Ihrem Kalender. Dafür müssen Ihre Öffnungszeiten hinterlegt sein. Der Buchungslink in Ihren Nachrichten zeigt auf diese Seite — ist sie aus, wird kein Link gesendet.",
  },
  // The business's minimum notice (lib/minNotice), a number and its unit on
  // the General card. The unit words are plural pairs read with the number
  // in the box, so it says "1 hour" and "2 hours".
  "settings.minNotice": {
    tr: "En az önceden haber süresi",
    en: "Minimum notice",
    de: "Mindestvorlauf",
  },
  "settings.minNoticeHint": {
    tr: "Online randevu sayfası, telefon asistanı ve WhatsApp asistanı bundan daha yakın bir saate randevu vermez, var olan bir randevuyu da oraya taşımaz. Ekibiniz takvimden yine her saate randevu ekleyebilir. 0 girerseniz sınır kalmaz.",
    en: "The booking page, the phone agent and the WhatsApp assistant never book or move an appointment to a time sooner than this. Your team can still book any time from the calendar. Enter 0 for no minimum.",
    de: "Buchungsseite, Telefonassistent und WhatsApp-Assistent buchen oder verschieben nie auf eine Zeit, die näher liegt. Ihr Team kann im Kalender weiterhin jede Zeit buchen. Mit 0 gibt es keine Untergrenze.",
  },
  "settings.minNoticeUnit": { tr: "Birim", en: "Unit", de: "Einheit" },
  "settings.noticeHours.one": { tr: "saat", en: "hour", de: "Stunde" },
  "settings.noticeHours.other": { tr: "saat", en: "hours", de: "Stunden" },
  "settings.noticeDays.one": { tr: "gün", en: "day", de: "Tag" },
  "settings.noticeDays.other": { tr: "gün", en: "days", de: "Tage" },
  "settings.calcomApiKey": {
    tr: "cal.com API anahtarı",
    en: "cal.com API key",
    de: "cal.com API-Schlüssel",
  },
  "settings.calcomEventType": {
    tr: "cal.com event type ID",
    en: "cal.com event type ID",
    de: "cal.com Event-Type-ID",
  },

  "settings.bookings": {
    tr: "Rezervasyonlar",
    en: "Bookings",
    de: "Buchungen",
  },
  "settings.calcomWebhook": {
    tr: "Webhook adresi",
    en: "Webhook URL",
    de: "Webhook-Adresse",
  },
  "settings.calcomHint": {
    tr: "Bu adresi cal.com webhook ayarlarına yapıştırın (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED).",
    en: "Paste this URL into your cal.com webhook settings (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED).",
    de: "Fügen Sie diese Adresse in den Webhook-Einstellungen von cal.com ein (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED).",
  },
  "settings.calcomGenerate": {
    tr: "Adres oluştur",
    en: "Generate URL",
    de: "Adresse erzeugen",
  },
  "settings.calcomRotate": { tr: "Yenile", en: "Rotate", de: "Erneuern" },

  "contact.typeMessage": {
    tr: "Mesaj yazın…",
    en: "Type a message…",
    de: "Nachricht schreiben…",
  },
  "contact.send": { tr: "Gönder", en: "Send", de: "Senden" },
  // The composer's + button: everything added to a message that is not
  // typing (emoji, photo, scheduled send), as a drop-up.
  "contact.composerMore": { tr: "Ekle", en: "Add", de: "Hinzufügen" },
  "contact.waNotConnectedShort": {
    tr: "WhatsApp bağlı değil",
    en: "WhatsApp not connected",
    de: "WhatsApp nicht verbunden",
  },
  // What the disabled box itself says — the whole story now, since the prose
  // line above the composer is gone (Serdar, 2026-08-31). Still one
  // phone-width line: the two-sentence version clipped mid-word here once,
  // which is why the fact stays this short.
  "contact.sessionClosedShort": {
    tr: "24 saatlik pencere kapalı",
    en: "24h window closed",
    de: "24-Stunden-Fenster geschlossen",
  },

  "services.title": { tr: "Hizmetler", en: "Services", de: "Leistungen" },
  // The other half of what a salon sells, as its own card. "Products" rather
  // than "Goods": it is the word on the shelf, and the one the booking page
  // already shows the customer.
  "services.products": { tr: "Ürünler", en: "Products", de: "Produkte" },
  "services.productsHint": {
    tr: "Sattığınız, süre almayan şeyler. Takvimde yer kaplamaz ve randevu sayfanızda ayrı listelenir. Eklemek için yukarıdaki butonu kullanıp Tür'ü Ürün seçin.",
    en: "Things you sell rather than book time for. They take no time on the calendar and list separately on your booking page. To add one, use the button above and set Type to Product.",
    de: "Was Sie verkaufen, statt Zeit dafür zu buchen. Ohne Dauer im Kalender, auf Ihrer Buchungsseite getrennt gelistet. Zum Hinzufügen die Schaltfläche oben nutzen und Art auf Produkt stellen.",
  },
  "services.hint": {
    tr: "İşletmenizin sunduğu hizmetler. Randevu açarken bu listeden seçilir ve takvimdeki randevu süresini belirler.",
    en: "What your business offers. Bookings pick from this list, and the duration sets how long the appointment runs on the calendar.",
    de: "Was Ihr Betrieb anbietet. Beim Buchen wird aus dieser Liste gewählt, und die Dauer bestimmt, wie viel Zeit der Termin im Kalender einnimmt.",
  },
  "services.name": {
    tr: "Hizmet adı",
    en: "Service name",
    de: "Name der Leistung",
  },
  // A product is not a service, and the column header over "Hair gel" said
  // "Hizmet adı". Same label, one word swapped, in the two places a good is
  // named: the Products card's header row and the sheet when Type is Product.
  "services.productName": {
    tr: "Ürün adı",
    en: "Product name",
    de: "Name des Produkts",
  },
  "services.duration": { tr: "Süre", en: "Duration", de: "Dauer" },
  // Same word the fields table uses for the same idea: the name an integration
  // says, as opposed to the name a person reads.
  "services.key": {
    tr: "Hizmet anahtarı",
    en: "Service key",
    de: "Leistungsschlüssel",
  },
  "services.keyEditHint": {
    tr: "Anahtarı düzenlemek için tıklayın. Yeniden adlandırmak anahtarı değiştirmez.",
    en: "Click to edit the key. Renaming the service never changes it.",
    de: "Zum Bearbeiten des Schlüssels klicken. Ein Umbenennen ändert ihn nie.",
  },
  "services.keyExists": {
    tr: "Bu anahtar başka bir hizmete ait.",
    en: "Another service already uses that key.",
    de: "Ein anderer Dienst verwendet diesen Schlüssel bereits.",
  },
  "services.deleteConfirm": {
    tr: "\"{name}\" silinsin mi? Geçmiş randevular kendi kayıtlarını korur.",
    en: "Delete \"{name}\"? Past appointments keep their own record.",
    de: "\"{name}\" löschen? Vergangene Termine behalten ihre eigenen Angaben.",
  },
  "services.add": {
    tr: "Hizmet ekle",
    en: "Add service",
    de: "Leistung hinzufügen",
  },
  // Its own key rather than composing "Add" + services.kindGood: German puts
  // the verb last ("Produkt hinzufügen") and Turkish inflects the noun, so a
  // concatenated label is wrong in two of the three columns.
  "services.addProduct": {
    tr: "Ürün ekle",
    en: "Add product",
    de: "Produkt hinzufügen",
  },
  "services.active": { tr: "Kullanımda", en: "Active", de: "Aktiv" },
  "services.minutes": { tr: "dk", en: "min", de: "Min." },
  "services.hours": { tr: "sa", en: "hr", de: "Std." },

  "fields.title": {
    tr: "Kişi alanları",
    en: "Contact fields",
    de: "Kundenfelder",
  },
  "fields.hint": {
    tr: "İşletmenize özel müşteri alanları (örn. saç tipi, alerji notu). Kişi sayfasının sol panelinde görünür.",
    en: "Customer fields specific to your business (e.g. hair type, allergy note). Shown on the contact page's left pane.",
    de: "Kundenfelder, die es nur in Ihrem Betrieb gibt (z. B. Haartyp, Allergiehinweis). Sie stehen links auf der Kundenseite.",
  },
  "fields.add": { tr: "Alan ekle", en: "Add field", de: "Feld hinzufügen" },
  // The card under the contact fields listing each service's key. Keys left
  // the Services price list (owner-facing) and this tab is where key-minded
  // readers already are.
  "fields.system": { tr: "Sistem", en: "System", de: "System" },
  "fields.systemHint": {
    tr: "Her müşteride hazır olan kimlik alanları. Sesli asistan bunları okuyabilir ama değiştiremez; aramada ad ve soyad tek bir Müşteri adı (customer_name) değişkeni olarak görünür.",
    en: "Identity fields every customer has. The voice agent can read them but never change them; on calls the name appears as one Customer name (customer_name) variable.",
    de: "Identitätsfelder, die jeder Kunde hat. Der Sprachassistent kann sie lesen, aber nie ändern; im Anruf erscheint der Name als eine Variable Kundenname (customer_name).",
  },
  "fields.usedByAgents": {
    tr: "{agents} kullanıyor",
    en: "Used by {agents}",
    de: "Genutzt von {agents}",
  },
  "voiceVariables.customerCard": {
    tr: "Müşteri kartı",
    en: "Customer card",
    de: "Kundenprofil",
  },
  "voiceVariables.use": { tr: "Kullan", en: "Use", de: "Verwenden" },
  "fields.label": { tr: "Etiket", en: "Label", de: "Bezeichnung" },
  "fields.typeLabel": { tr: "Tür", en: "Type", de: "Typ" },
  // Org-defined fields are how one deployment fits a salon, a dentist and a
  // garage: plate number, last cleaning, insurance are data, not code.
  // "Dolduran", not "Kaynak": the two options are Ekip and Sesli asistan, so
  // the label asks who fills the field in. "Kaynak" already means where an
  // appointment came from (appointments.source), and one word for two ideas
  // reads as the same column twice.
  // The column answers ONE question, from the agent's side: may the phone
  // agent write this field? "Locked" is the safe default — a misheard answer
  // on a bad call must not overwrite what a person typed.
  "fields.source": { tr: "Sesli asistan", en: "Voice agent", de: "Sprachassistent" },
  "fields.source.manual": { tr: "Kilitli", en: "Locked", de: "Gesperrt" },
  "fields.phoneLockedHint": {
    tr: "Arayan bu numarayla eşleştirilir; telefon numarası aramadan değiştirilemez.",
    en: "Callers are matched by this number, so a call cannot change it.",
    de: "Anrufer werden über diese Nummer zugeordnet; ein Anruf kann sie nicht ändern.",
  },
  "fields.source.voice": {
    tr: "Düzenleyebilir",
    en: "Can edit",
    de: "Darf bearbeiten",
  },
  "fields.voiceGroup": {
    tr: "Aramalardan gelen",
    en: "From calls",
    de: "Aus Anrufen",
  },
  "fields.voiceHint": {
    tr: "Bu bilgileri sesli asistanın Değişkenler tablosundan seçin. Aramada doğrulanan değerler otomatik olarak buraya kaydedilir.",
    en: "Choose these fields from the voice agent's Variables table. Values confirmed during a call are saved here automatically.",
    de: "Wählen Sie diese Felder in der Variablen-Tabelle des Sprachassistenten. Im Anruf bestätigte Werte werden hier automatisch gespeichert.",
  },
  // Same group heading, different reader. On the customer record nobody is
  // configuring anything; they want to know why this value is here and whether
  // they may correct it.
  "fields.voiceRecordHint": {
    tr: "Bu alanları sesli asistan arama sırasında doldurur. Yanlış duyulmuşsa elle düzeltebilirsiniz.",
    en: "The voice agent fills these during a call. Correct any of them by hand if it misheard.",
    de: "Diese Felder füllt der Sprachassistent während eines Anrufs. Bei einem Hörfehler können Sie sie von Hand korrigieren.",
  },
  "common.show": { tr: "Göster", en: "Show", de: "Anzeigen" },
  "common.hide": { tr: "Gizle", en: "Hide", de: "Ausblenden" },
  "fields.key": { tr: "Alan anahtarı", en: "Field key", de: "Feldschlüssel" },
  "fields.lockHint": {
    tr: "Sesli asistan bu alanı yazamaz. Asistana açmak için tıklayın.",
    en: "The voice agent can't write this field. Click to let it.",
    de: "Der Sprachassistent kann dieses Feld nicht schreiben. Klicken, um es freizugeben.",
  },
  "fields.unlockHint": {
    tr: "Sesli asistan bu alanı yazabilir. Kilitlemek için tıklayın.",
    en: "The voice agent can write this field. Click to lock it.",
    de: "Der Sprachassistent kann dieses Feld schreiben. Klicken, um es zu sperren.",
  },
  "fields.keyEditHint": {
    tr: "Anahtarı düzenle. Yalnızca hiçbir asistan bu alanı kullanmıyorken değişir.",
    en: "Edit the key. It can only change while no agent uses this field.",
    de: "Schlüssel bearbeiten. Er kann sich nur ändern, solange kein Assistent dieses Feld nutzt.",
  },
  "fields.keyReserved": {
    tr: "Bu anahtar sistem alanları için ayrılmış.",
    en: "This key is reserved for system fields.",
    de: "Dieser Schlüssel ist für Systemfelder reserviert.",
  },
  "fields.keyInUse": {
    tr: "Bir asistan bu alanı kullanırken anahtar değiştirilemez.",
    en: "The key can't change while an agent uses this field.",
    de: "Der Schlüssel kann sich nicht ändern, solange ein Assistent dieses Feld nutzt.",
  },
  "fields.deleteInUse": {
    tr: "{agents} bu alanı topluyor. Önce asistanda bağlantısını kaldırın, sonra silinebilir.",
    en: "{agents} collects this field. Unlink it on the agent first, then it can be deleted.",
    de: "{agents} erfasst dieses Feld. Heben Sie die Verknüpfung zuerst im Assistenten auf, dann kann es gelöscht werden.",
  },
  "fields.deleteConfirm": {
    tr: "\"{name}\" silinsin mi? Kayıtlı değerler müşteri kartlarında kalır.",
    en: "Delete \"{name}\"? Values already saved stay on customer cards.",
    de: "\"{name}\" löschen? Bereits gespeicherte Werte bleiben auf den Kundenkarten.",
  },
  // The Knowledge tab (docs/chat-agent.md): the prose every agent recites,
  // sitting under the service list in the sidebar destination of the same
  // name. Doubles as that tab's label.
  //
  // The hint carries the one rule that keeps the card honest — structured
  // facts live in their own tables and are not repeated here — and names
  // WHERE those tables are now that one of them is directly above. "Don't
  // repeat prices, the app already reads them" was true and useless while the
  // price list was a tab away.
  "knowledge.section": { tr: "Bilgi", en: "Knowledge", de: "Wissen" },
  "knowledge.title": {
    tr: "İşletme bilgisi",
    en: "Business knowledge",
    de: "Betriebswissen",
  },
  "knowledge.hint": {
    tr: "Asistanlarınızın tablolardaki bilgilerin ötesinde söyleyebilecekleri. Yukarıdaki karttaki hizmet ve fiyatları ya da İşletme'deki çalışma saatlerini buraya tekrar yazmayın — asistanlar onları oradan okuyor. Burası politikalar, otopark, sık sorulan sorular ve müşterilerin arayıp sorduğu diğer her şey için.",
    en: "What your agents can say beyond what the tables already hold. Don't retype the services and prices from the card above, or the hours from Business — the agents read those there. This is for policies, parking, frequent questions and anything else people ring up to ask.",
    de: "Was Ihre Assistenten über die Tabellen hinaus sagen können. Leistungen und Preise aus der Karte darüber und Öffnungszeiten aus Betrieb gehören nicht hierher — die lesen die Assistenten dort. Hier stehen Richtlinien, Parken, häufige Fragen und alles andere, wonach Kunden am Telefon fragen.",
  },
  "knowledge.add": {
    tr: "Bilgi ekle",
    en: "Add knowledge",
    de: "Wissen hinzufügen",
  },
  "knowledge.addHint": {
    tr: "Bir konu başlığı ve müşterilere söylenebilecek bilgi.",
    en: "One topic, and what customers should be told about it.",
    de: "Ein Thema und was Kunden dazu erfahren dürfen.",
  },
  "knowledge.titlePlaceholder": { tr: "Otopark", en: "Parking", de: "Parken" },
  "knowledge.bodyPlaceholder": {
    tr: "Salonun arkasında ücretsiz otopark var; giriş Çınar Sokak'tan.",
    en: "Free parking behind the salon; entrance on Elm Street.",
    de: "Kostenlose Parkplätze hinter dem Salon; Einfahrt über die Lindenstraße.",
  },
  "knowledge.empty": {
    tr: "Henüz bilgi eklenmedi.",
    en: "No knowledge added yet.",
    de: "Noch kein Wissen hinterlegt.",
  },
  "knowledge.deleteConfirm": {
    tr: "\"{name}\" silinsin mi?",
    en: "Delete \"{name}\"?",
    de: "\"{name}\" löschen?",
  },

  // The chat-agent strip above the composer (docs/chat-agent.md §5).
  //
  // The four keys that used to live here — answering / takeOver / paused /
  // handBack — went with the bar they belonged to. That bar was a status
  // sentence PLUS a Take over button, two controls for one state, and the
  // words had to carry the difference between them. Three pills carry it
  // instead, so what is left to translate is the three states themselves.
  //
  // The three modes. One vocabulary for both places they are chosen — the
  // business default in Settings and the per-conversation control above the
  // composer — because they are the same three states and two sets of words
  // would read as two features.
  "agent.mode.off": { tr: "Kapalı", en: "Off", de: "Aus" },
  "agent.mode.suggest": { tr: "Öneriyor", en: "Suggests", de: "Schlägt vor" },
  "agent.mode.live": { tr: "Yanıtlıyor", en: "Answers", de: "Antwortet" },
  "agent.mode.offHint": {
    tr: "Asistan bu sohbete hiç karışmaz.",
    en: "The assistant does nothing here.",
    de: "Der Assistent tut hier nichts.",
  },
  "agent.mode.suggestHint": {
    tr: "Her mesaj için yanıt taslağı hazırlar; göndermeden önce siz karar verirsiniz.",
    en: "It drafts a reply to every message. Nothing is sent until you send it.",
    de: "Er entwirft zu jeder Nachricht eine Antwort. Gesendet wird erst, wenn Sie senden.",
  },
  "agent.mode.liveHint": {
    tr: "Müşteriye kendisi yanıt verir.",
    en: "It replies to the customer by itself.",
    de: "Er antwortet dem Kunden selbst.",
  },
  // "in this chat" is load-bearing. Without it the pills read as the business
  // setting, and someone muting one awkward conversation would think they had
  // switched the assistant off for everybody.
  "agent.inThisChat": {
    tr: "Bu sohbette asistan",
    en: "Assistant in this chat",
    de: "Assistent in diesem Chat",
  },
  "agent.needsPerson": {
    tr: "Asistan bu sohbet için bir kişi gerektiğini söyledi",
    en: "The assistant says this one needs a person",
    de: "Der Assistent sagt, hier wird ein Mensch gebraucht",
  },
  // The toast when Send finds the draft already retired under it.
  "agent.draftGone": {
    tr: "Bu taslak artık geçerli değil — müşteri yeni bir mesaj gönderdi.",
    en: "That draft is out of date — the customer has sent something newer.",
    de: "Dieser Entwurf ist überholt — der Kunde hat inzwischen geschrieben.",
  },
  // The live reply counting down in the composer. {s} is whole seconds.
  "agent.autoSendIn": {
    tr: "{s} saniye içinde gönderilecek",
    en: "Sends in {s}s",
    de: "Sendet in {s} s",
  },
  "agent.autoSendNow": {
    tr: "Gönderiliyor…",
    en: "Sending…",
    de: "Wird gesendet…",
  },
  // Stops the countdown, keeps the text as an editable draft.
  "agent.autoSendStop": { tr: "Durdur", en: "Stop", de: "Stoppen" },
  // What sending a suggested reply will ALSO do (2026-10-13). A draft that
  // books, moves, cancels or saves changes nothing until it is sent, so the
  // person sending it has to see the change before they press Send.
  // {when}, {from}, {to}: a date and time. {services}, {fields}: a list.
  "agent.change.book": {
    tr: "Gönderdiğinizde randevu oluşturulur: {when}",
    en: "Sending this books {when}",
    de: "Beim Senden wird gebucht: {when}",
  },
  "agent.change.bookAsap": {
    tr: "Gönderdiğinizde sipariş hemen verilir",
    en: "Sending this places the order now",
    de: "Beim Senden wird die Bestellung sofort aufgegeben",
  },
  "agent.change.move": {
    tr: "Gönderdiğinizde randevu taşınır: {from} → {to}",
    en: "Sending this moves the appointment from {from} to {to}",
    de: "Beim Senden wird der Termin verschoben: {from} → {to}",
  },
  "agent.change.cancel": {
    tr: "Gönderdiğinizde {when} randevusu iptal edilir",
    en: "Sending this cancels the appointment on {when}",
    de: "Beim Senden wird der Termin am {when} abgesagt",
  },
  // The × on that line: drops the change by retiring the draft. Words the
  // reader has edited stay in the box.
  "agent.change.drop": {
    tr: "Bu değişikliği yapma",
    en: "Don't make this change",
    de: "Diese Änderung nicht vornehmen",
  },
  "agent.change.save": {
    tr: "Gönderdiğinizde kaydedilir: {fields}",
    en: "Sending this saves {fields}",
    de: "Beim Senden wird gespeichert: {fields}",
  },

  // Settings → Messages: the business default and the handover policy.
  "settings.chatAgent": { tr: "WhatsApp asistanı", en: "WhatsApp assistant", de: "WhatsApp-Assistent" },
  // "by default" is the whole reason this reads correctly: a heading that
  // sounded absolute would make the per-conversation override look like a bug
  // the first time somebody met one.
  "settings.chatAgentHint": {
    tr: "Gelen WhatsApp mesajlarında asistan ne yapsın — varsayılan olarak. Her sohbeti tek tek değiştirebilirsiniz.",
    en: "What the assistant does with incoming WhatsApp messages, by default. Any single chat can be set differently.",
    de: "Was der Assistent standardmäßig mit eingehenden WhatsApp-Nachrichten macht. Jeder Chat lässt sich einzeln anders einstellen.",
  },
  "settings.chatAgentHandover": {
    tr: "Bir kişi gerektiğinde",
    en: "When a person is needed",
    de: "Wenn ein Mensch gebraucht wird",
  },
  "settings.chatAgentHandoverHint": {
    tr: "Asistan yapamayacağı bir şeyle karşılaştığında sohbetten tamamen çekilsin mi, yoksa yanıtlayabildiklerini yanıtlamaya devam mı etsin?",
    en: "When the assistant hits something it cannot do, should it leave the conversation entirely, or keep answering the parts it can?",
    de: "Wenn der Assistent an etwas stößt, das er nicht kann: soll er das Gespräch ganz abgeben oder weiter beantworten, was er kann?",
  },
  "settings.chatAgentKeepAnswering": {
    tr: "Yanıtlamaya devam etsin",
    en: "Keep answering",
    de: "Weiter antworten",
  },
  "settings.chatAgentStop": {
    tr: "Sohbeti devretsin",
    en: "Hand the chat over",
    de: "Chat übergeben",
  },

  "fields.reorder": {
    tr: "Sürükleyip sırala",
    en: "Drag to reorder",
    de: "Zum Sortieren ziehen",
  },
  "fields.showOptions": {
    tr: "Seçenekleri göster",
    en: "Show the options",
    de: "Optionen anzeigen",
  },
  "fields.optionsFor": {
    tr: "{name} seçenekleri.",
    en: "Options for {name}.",
    de: "Optionen für {name}.",
  },
  // The list field's options editor (TagPillsEditor): the dashed pill that
  // opens the input, and each pill's ×, for screen readers.
  "fields.addOption": {
    tr: "+ Seçenek ekle",
    en: "+ Add option",
    de: "+ Option hinzufügen",
  },
  "fields.removeOption": {
    tr: "Seçeneği kaldır: {option}",
    en: "Remove option: {option}",
    de: "Option entfernen: {option}",
  },
  "fields.optionPlaceholder": {
    tr: "Seçenek ekle…",
    en: "Add an option…",
    de: "Option hinzufügen…",
  },
  "fields.type.text": { tr: "Metin", en: "Text", de: "Text" },
  "fields.type.select": { tr: "Seçim", en: "Select", de: "Auswahl" },
  "fields.type.number": { tr: "Sayı", en: "Number", de: "Zahl" },
  // System-row shapes; identity columns, not creatable field types.
  "fields.type.phone": { tr: "Telefon", en: "Phone", de: "Telefon" },
  "fields.type.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  "fields.type.date": { tr: "Tarih", en: "Date", de: "Datum" },
  "fields.options": {
    tr: "Seçenekler (virgülle)",
    en: "Options (comma-separated)",
    de: "Optionen (kommagetrennt)",
  },

  "workspace.switch": {
    tr: "İşletme değiştir",
    en: "Switch business",
    de: "Betrieb wechseln",
  },
  "workspace.add": {
    tr: "İşletme ekle",
    en: "Add business",
    de: "Betrieb hinzufügen",
  },
  // The wizard's exit for a SECOND business: discards the draft workspace and
  // lands back in the previous one. Phrased as plain cancel because to the
  // owner nothing was created yet — the draft org is an implementation detail.
  // An unnamed org in the switcher. It used to fall back to the product name,
  // so a draft somebody abandoned mid-wizard read as a business called
  // "Resepta" — and a list of them read as the app having invented seven
  // businesses. The row still works: opening it resumes the wizard.
  "workspace.draft": {
    tr: "Yeni işletme (tamamlanmadı)",
    en: "New business (unfinished)",
    de: "Neuer Betrieb (unfertig)",
  },
  "workspace.discard": {
    tr: "Vazgeç",
    en: "Cancel",
    de: "Abbrechen",
  },

  // Shown when somebody else added this login to a workspace. The business name
  // is rendered beside these rather than interpolated, so no string here has to
  // carry a placeholder.
  "workspace.added": {
    tr: "Şu işletmeye eklendiniz:",
    en: "You were added to:",
    de: "Sie wurden hinzugefügt zu:",
  },
  "workspace.open": { tr: "Aç", en: "Open", de: "Öffnen" },
  "workspace.dismiss": { tr: "Tamam", en: "Got it", de: "Verstanden" },

  // Not "Ekip": staff.title already is, one card below on the same page, and
  // two cards with one title is how the two concepts got confused in the first
  // place. This card is logins; Ekip is the people you can book.
  "team.title": { tr: "Kullanıcılar", en: "Users", de: "Benutzer" },
  "team.inviteHint": {
    tr: "Davet edilen kişi bu e-posta adresiyle Google üzerinden giriş yaptığında ekibinize katılır. Hesabı zaten varsa hemen eklenir. Bilgilendirme e-postası gönderilir.",
    en: "The invitee joins your team when they sign in with Google using this email. If they already have an account they are added right away. They get an email letting them know.",
    de: "Die eingeladene Person kommt in Ihr Team, sobald sie sich mit dieser E-Mail-Adresse über Google anmeldet. Hat sie bereits ein Konto, wird sie sofort hinzugefügt. Sie erhält eine Benachrichtigung per E-Mail.",
  },
  "team.invite": { tr: "Davet et", en: "Invite", de: "Einladen" },
  // One roster, the way Fresha, Booksy and Square all show it: a person is a
  // row, and being bookable and being able to log in are two facts about that
  // row rather than two separate lists.
  "roster.person": { tr: "Üye", en: "Member", de: "Mitglied" },
  "roster.bookable": { tr: "Müsait", en: "Available", de: "Verfügbar" },
  "roster.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  "roster.access": { tr: "Erişim", en: "Access", de: "Zugriff" },
  "roster.noAccess": { tr: "Giriş yok", en: "No login", de: "Kein Zugang" },
  "roster.removeAccess": {
    tr: "Erişimi kaldır",
    en: "Remove access",
    de: "Zugriff entziehen",
  },
  "roster.hint": {
    tr: "Randevu alan herkesin girişi olmak zorunda değil, giriş yapan herkes de randevu almaz. Muhasebeciniz giriş yapar ama takvimde yer almaz; çırağınız takvimdedir ama hiç giriş yapmaz.",
    en: "Not everyone who takes appointments needs a login, and not everyone with a login takes appointments. Your bookkeeper signs in but is never booked; your apprentice is on the calendar but never signs in.",
    de: "Nicht jede Person mit Terminen braucht einen Zugang, und nicht jede mit Zugang nimmt Termine an. Die Buchhaltung meldet sich an, steht aber nie im Kalender; der Lehrling steht im Kalender und meldet sich nie an.",
  },
  "roster.lastAdmin": {
    tr: "Son yöneticiyi kaldıramazsınız. Önce başka birini yönetici yapın.",
    en: "You can't remove the last admin. Make somebody else an admin first.",
    de: "Die letzte Administratorin oder der letzte Administrator kann nicht entfernt werden. Machen Sie zuerst jemand anderen zum Administrator.",
  },
  "roster.remove": {
    tr: "{name} listeden kaldırılsın mı?",
    en: "Remove {name} from the list?",
    de: "{name} aus der Liste entfernen?",
  },
  "roster.grantLogin": {
    tr: "{name} için giriş ekle",
    en: "Give {name} a login",
    de: "{name} einen Zugang geben",
  },
  "roster.grantLoginHint": {
    tr: "Davet e-postası gider. Bu Google adresiyle giriş yaptığında hesabı bu üyeye bağlanır — ikinci bir satır oluşmaz.",
    en: "An invite is emailed. When they sign in with that Google address, the account attaches to this member rather than appearing as a second row.",
    de: "Eine Einladung wird per E-Mail gesendet. Meldet sich die Person mit dieser Google-Adresse an, wird das Konto diesem Mitglied zugeordnet statt als zweite Zeile zu erscheinen.",
  },
  "roster.linkExisting": {
    tr: "Ya da zaten giriş yapmış bir hesabı bağlayın:",
    en: "Or attach an account that has already signed in:",
    de: "Oder ein bereits angemeldetes Konto zuordnen:",
  },
  "roster.emailOptional": {
    tr: "E-posta (isteğe bağlı) — bu adresle giriş yapabilir",
    en: "Email (optional) — lets them sign in with this address",
    de: "E-Mail (optional) — ermöglicht die Anmeldung mit dieser Adresse",
  },
  "roster.addHint": {
    tr: "Adı zorunlu, e-posta değil. E-posta girerseniz o Google adresiyle giriş yapabilir; sonradan da ekleyebilirsiniz.",
    en: "The name is required, the address isn't. Give an address and they can sign in with that Google account — you can also add one later.",
    de: "Der Name ist erforderlich, die Adresse nicht. Mit einer Adresse kann sich die Person über dieses Google-Konto anmelden — Sie können sie auch später hinzufügen.",
  },
  "roster.deactivate": {
    tr: "{name} pasife alınsın",
    en: "Deactivate {name}",
    de: "{name} deaktivieren",
  },
  "roster.restore": {
    tr: "{name} yeniden aktif edilsin",
    en: "Reactivate {name}",
    de: "{name} reaktivieren",
  },
  "roster.deactivatedTitle": {
    tr: "Pasif üyeler",
    en: "Deactivated",
    de: "Deaktiviert",
  },
  "roster.deactivatedHint": {
    tr: "Artık randevu almayan üyeler. Geçmiş randevuları adlarını korur. Buradan geri alabilir ya da tamamen silebilirsiniz.",
    en: "Members who no longer take bookings. Their past appointments keep their name. Reactivate them here, or remove them for good.",
    de: "Mitglieder, die keine Termine mehr annehmen. Vergangene Termine behalten ihren Namen. Hier reaktivieren oder endgültig entfernen.",
  },
  "roster.deactivateFirst": {
    tr: "Önce \"Randevu alır\" kapatılmalı. Kapattığınızda yeni randevu almaz; ardından tamamen kaldırabilirsiniz.",
    en: "Switch off Bookable first. They stop taking new bookings straight away, and then you can remove them for good.",
    de: "Schalten Sie zuerst \"Buchbar\" aus. Sie nimmt sofort keine neuen Termine mehr an und kann danach ganz entfernt werden.",
  },
  "roster.removeWithHistory": {
    tr: "{name} kaldırılsın mı? Randevuları kalır ama artık kimin yaptığını göstermez. Geri alınamaz.",
    en: "Remove {name}? Their appointments stay, but will no longer show who did them. This can't be undone.",
    de: "{name} entfernen? Die Termine bleiben, zeigen aber nicht mehr, wer sie ausgeführt hat. Nicht widerrufbar.",
  },
  "roster.noLoginToLink": {
    tr: "Bağlanacak giriş yok",
    en: "No unlinked login",
    de: "Kein freier Zugang",
  },
  "roster.add": { tr: "Üye ekle", en: "Add member", de: "Mitglied hinzufügen" },

  // The two tabs in Add person. Previously the org's staff label ("Kuaför")
  // against the verb "Davet et", which is a category next to an action and
  // reads as two ways of doing one thing rather than two different things.
  // Both are now verb phrases describing what the person will DO, which is the
  // question the owner is actually answering. Neither mentions logins: "takes
  // bookings" and "signs in" is the distinction in the owner's own terms.
  "team.pending": {
    tr: "Bekleyen davetler",
    en: "Pending invites",
    de: "Offene Einladungen",
  },
  "team.revoke": { tr: "İptal et", en: "Revoke", de: "Zurückziehen" },
  "team.you": { tr: "siz", en: "you", de: "Sie" },
  // The two access tiers. Named for the PERMISSION, not the person: the
  // backend lets several people hold the top tier (team.invite takes a role),
  // so "Sahip"/"Owner" was naming a human being where it meant a capability.
  //
  // And the lower tier is deliberately not "Personel" any more. That word is
  // the default label for the bookable person (appointments.staff), and the
  // two are genuinely different things — a barber can be bookable with no
  // login at all, and a bookkeeper can log in and never be booked. While the
  // role wore the same word, the Business page ran two cards both titled
  // "Ekip", one labelling its rows Personel and one whose people were called
  // Personel. Personel now means the bookable person and nothing else.
  // The card under Team, for an owner who runs more than one business. It
  // shares the roster's vocabulary on purpose — the two roles are the same two
  // roles — so only the sentences around it are new.
  "share.title": {
    tr: "Diğer işletmeleriniz",
    en: "Your other businesses",
    de: "Ihre anderen Betriebe",
  },
  // Says all three things somebody needs before touching a row: who can be
  // shared, what happens to the person, and that it is not silent.
  "share.hint": {
    tr: "Bu ekipteki kişilere, yönettiğiniz diğer işletmelerde de erişim verin. Yalnızca girişi olan kişiler paylaşılabilir. Eklenen kişiye bilgilendirme e-postası gider ve işletmeyi kendi hesabında görür.",
    en: "Give people on this team access to the other businesses you run. Only people with a login can be shared. Whoever you add gets an email and sees the business in their own account.",
    de: "Geben Sie Personen aus diesem Team Zugriff auf Ihre anderen Betriebe. Teilen können Sie nur Personen mit Zugang. Wer hinzugefügt wird, erhält eine E-Mail und sieht den Betrieb in seinem eigenen Konto.",
  },
  // The summary line on a business nobody from HERE can get into. Says "from
  // this team" rather than "nobody", because that business has its own people
  // and this card never claims otherwise.
  // The wizard's team step. Its own strings rather than the card's: the card
  // acts on a business that exists, this one asks a question about one being
  // founded, and "not coming" is a sentence you can only say before the fact.
  "onboarding.teamTitle": {
    tr: "Ekibinizi getirin",
    en: "Bring your team",
    de: "Ihr Team mitnehmen",
  },
  "onboarding.teamHint": {
    tr: "Diğer işletmelerinizdeki kişiler. Seçtikleriniz bu işletmeye de girebilir ve bilgilendirme e-postası alır. Sonra Diğer işletmeleriniz kartından da ekleyebilirsiniz.",
    en: "The people in your other businesses. Whoever you pick can sign in here too and gets an email. You can also add them later from the Other businesses card.",
    de: "Die Personen in Ihren anderen Betrieben. Wen Sie auswählen, kann sich auch hier anmelden und erhält eine E-Mail. Sie können später ebenso über die Karte „Ihre anderen Betriebe“ ergänzen.",
  },
  // The third value of the step's role control, and its default. Names the
  // OUTCOME rather than the click ("kimseyi ekleme"), because it is also the
  // state every row starts in.
  "share.notComing": {
    tr: "Gelmiyor",
    en: "Not coming",
    de: "Nicht dabei",
  },
  "share.nobody": {
    tr: "Bu ekipten kimse yok",
    en: "Nobody from this team",
    de: "Niemand aus diesem Team",
  },
  "share.noTeam": {
    tr: "Bu işletmede sizden başka girişi olan kimse yok.",
    en: "Nobody here but you has a login.",
    de: "Außer Ihnen hat hier niemand einen Zugang.",
  },
  "role.owner": { tr: "Yönetici", en: "Admin", de: "Administrator" },
  "role.staff": { tr: "Üye", en: "Member", de: "Mitglied" },
  // The pill a member sees on a page only an admin can change (ViewOnlyPill);
  // settings.ownerOnly below is its tooltip. Nudge's own three words.
  "common.viewOnly": {
    tr: "Salt görüntüleme",
    en: "View only",
    de: "Nur Ansicht",
  },
  // Follows role.owner: the gate is the tier, not the person who owns the
  // salon, and several people can hold it.
  "settings.ownerOnly": {
    tr: "Bu ayarları yalnızca yöneticiler değiştirebilir.",
    en: "Only admins can change these settings.",
    de: "Diese Einstellungen können nur Administratoren ändern.",
  },

  // Table chrome. Shared by every list that adopts the DataTable primitives,
  // so the words stay identical from one view to the next.
  "table.columns": { tr: "Sütunlar", en: "Columns", de: "Spalten" },
  "table.searchColumns": {
    tr: "Sütun ara",
    en: "Search columns",
    de: "Spalten suchen",
  },
  "table.filterColumn": {
    tr: "Sütunu filtrele",
    en: "Filter column",
    de: "Spalte filtern",
  },
  "table.noMatches": { tr: "Eşleşme yok", en: "No matches", de: "Keine Treffer" },
  // The funnel entry for rows with nothing in that column.
  "table.blank": { tr: "Boş", en: "Blank", de: "Leer" },
  "table.resizeColumn": {
    tr: "Sütun genişliğini değiştir",
    en: "Resize column",
    de: "Spaltenbreite ändern",
  },
  // Offered only once the layout has actually been changed, so it isn't a
  // permanent invitation to undo something nobody did.
  "table.resetLayout": {
    tr: "Sütun düzenini sıfırla",
    en: "Reset column layout",
    de: "Spaltenlayout zurücksetzen",
  },
  "table.clearFilters": {
    tr: "Filtreleri temizle",
    en: "Clear filters",
    de: "Filter zurücksetzen",
  },
  "table.exportCsv": {
    tr: "CSV olarak indir",
    en: "Download CSV",
    de: "Als CSV herunterladen",
  },
  // Relative dates stop at yesterday; older rows read as a real date, so
  // nobody has to count back from "16 days ago".

  "common.save": { tr: "Kaydet", en: "Save", de: "Speichern" },
  "common.saving": {
    tr: "Kaydediliyor…",
    en: "Saving…",
    de: "Wird gespeichert…",
  },
  "common.saved": { tr: "Kaydedildi", en: "Saved", de: "Gespeichert" },
  "common.add": { tr: "Ekle", en: "Add", de: "Hinzufügen" },
  "common.error": {
    tr: "Bir şeyler ters gitti. Tekrar deneyin.",
    en: "Something went wrong. Try again.",
    de: "Etwas ist schiefgelaufen. Versuchen Sie es erneut.",
  },
  // The two boundaries (components/ErrorBoundary, app/error.tsx). Title only:
  // the buttons under it carry the instruction.
  "common.errorTitle": {
    tr: "Bu ekran yüklenemedi",
    en: "This screen didn't load",
    de: "Diese Ansicht konnte nicht geladen werden",
  },
  "common.retry": { tr: "Tekrar dene", en: "Try again", de: "Erneut versuchen" },
  "common.reload": {
    tr: "Sayfayı yenile",
    en: "Reload the page",
    de: "Seite neu laden",
  },
  "common.cancel": { tr: "Vazgeç", en: "Cancel", de: "Abbrechen" },
  "common.close": { tr: "Kapat", en: "Close", de: "Schließen" },
  "common.delete": { tr: "Sil", en: "Delete", de: "Löschen" },
  "common.copy": { tr: "Kopyala", en: "Copy", de: "Kopieren" },
  "common.copied": { tr: "Kopyalandı", en: "Copied", de: "Kopiert" },
  "common.loading": { tr: "Yükleniyor…", en: "Loading…", de: "Wird geladen…" },
  // For rendering a collected boolean. Retell answers true/false; "Wants to
  // proceed: false" is a developer's sentence, not an owner's.
  "common.yes": { tr: "Evet", en: "Yes", de: "Ja" },
  "common.no": { tr: "Hayır", en: "No", de: "Nein" },
  // Deliberately short and generic. The box sizes itself to its longest text,
  // so a 19-character "Resepta ara" would pin it at the clamp ceiling on every
  // tab; the page title beside it already says what you are searching.
  "common.search": { tr: "Ara…", en: "Search…", de: "Suchen…" },
  // The header search's jump list (CustomerJump). "Recent" heads the
  // last-opened customers shown on focus with an empty box; the other two
  // head and empty-state the live match list.
  "search.recent": { tr: "Son açılanlar", en: "Recent", de: "Zuletzt geöffnet" },
  "search.goToCustomer": { tr: "Müşteriye git", en: "Go to customer", de: "Zu Kunde wechseln" },
  "search.noCustomers": {
    tr: "Eşleşen müşteri yok.",
    en: "No customers match.",
    de: "Keine passenden Kunden.",
  },
  "common.back": { tr: "Geri", en: "Back", de: "Zurück" },
  "common.optional": { tr: "isteğe bağlı", en: "optional", de: "optional" },

  // The showroom.
  "auth.tryDemo": {
    tr: "Önce bir bakın",
    en: "Have a look around first",
    de: "Erst einmal umsehen",
  },
  "auth.tryDemoHint": {
    tr: "Örnek bir kuaförün hesabı. Kayıt gerekmez, hiçbir mesaj gerçekten gönderilmez.",
    en: "An example salon's account. No signup, and nothing is really sent.",
    de: "Das Konto eines Beispielsalons. Ohne Anmeldung, es wird nichts wirklich gesendet.",
  },
  "demo.banner": {
    tr: "Bu bir örnek hesap. Mesajlar gerçekten gönderilmez ve her gece sıfırlanır.",
    en: "This is an example account. Nothing is really sent, and it resets each night.",
    de: "Dies ist ein Beispielkonto. Es wird nichts wirklich gesendet, und es wird jede Nacht zurückgesetzt.",
  },
  "demo.entryTitle": {
    tr: "Resepta’yı çalışan bir örnekle deneyin",
    en: "Try Resepta with a working example",
    de: "Resepta mit einem funktionierenden Beispiel testen",
  },
  "demo.entryBody": {
    tr: "Moda Hair Salon’ın örnek hesabında dolu bir takvimi, müşteri kayıtlarını ve gerçekçi konuşmaları keşfedin.",
    en: "Explore a full calendar, customer records and realistic conversations inside Moda Hair Salon’s fictional account.",
    de: "Entdecken Sie einen vollen Kalender, Kundendaten und realistische Unterhaltungen im fiktiven Konto von Moda Hair Salon.",
  },
  "demo.entryCta": {
    tr: "Demoyu aç",
    en: "Open the demo",
    de: "Demo öffnen",
  },
  "demo.entryNoSignup": {
    tr: "Kayıt gerekmez",
    en: "No signup required",
    de: "Keine Anmeldung nötig",
  },
  "demo.entrySimulated": {
    tr: "Tüm gönderimler simüle edilir",
    en: "Every send is simulated",
    de: "Jeder Versand wird simuliert",
  },
  "demo.entryReset": {
    tr: "Örnek veriler her gece yenilenir",
    en: "Example data resets nightly",
    de: "Beispieldaten werden nachts zurückgesetzt",
  },
  "demo.entryProduct": {
    tr: "Resepta hakkında",
    en: "About Resepta",
    de: "Über Resepta",
  },

  // Campaigns. "Kampanya" is what a Turkish salon already calls this, so the
  // product uses their word rather than coining "toplu mesaj".
  "campaign.title": { tr: "Kampanyalar", en: "Campaigns", de: "Kampagnen" },
  "campaign.new": { tr: "Yeni kampanya", en: "New campaign", de: "Neue Kampagne" },
  "campaign.name": { tr: "Ad", en: "Name", de: "Name" },
  "campaign.nameHint": {
    tr: "Sadece sizin listeniz için. Müşteriye gitmez.",
    en: "For your list only. Never sent to anyone.",
    de: "Nur für Ihre Liste. Wird nie versendet.",
  },
  "campaign.body": { tr: "Mesaj", en: "Message", de: "Nachricht" },
  "campaign.bodyHint": {
    tr: "WhatsApp'ta onaylı şablonunuzun {{3}} yerine geçer. [name] yazarsanız müşterinin adı gelir.",
    en: "This becomes {{3}} in your approved WhatsApp template. Write [name] to drop in the customer's name.",
    de: "Wird zu {{3}} in Ihrer genehmigten WhatsApp-Vorlage. Mit [name] wird der Kundenname eingesetzt.",
  },
  "campaign.segment": { tr: "Kimlere", en: "Who gets it", de: "Wer es erhält" },
  "campaign.notSeenFor": {
    tr: "Şu kadar gündür gelmeyenler",
    en: "Not seen for this many days",
    de: "Seit so vielen Tagen nicht da gewesen",
  },
  "campaign.notSeenHint": {
    tr: "Yaklaşan randevusu olanlar listeye girmez — zaten geliyorlar.",
    en: "Anyone with an upcoming booking is left out — they're already coming back.",
    de: "Wer bereits einen Termin hat, bleibt außen vor — er kommt ohnehin.",
  },
  "campaign.neverBooked": {
    tr: "Hiç gelmemiş olanlar",
    en: "Never actually came",
    de: "War noch nie da",
  },
  "campaign.hadService": {
    tr: "Şu hizmeti almış olanlar",
    en: "Have had this service",
    de: "Hatten diese Leistung",
  },
  "campaign.recipients": {
    tr: "kişiye gidecek",
    en: "people will get this",
    de: "Personen erhalten dies",
  },
  "campaign.noRecipients": {
    tr: "Bu filtreye uyan, izni olan müşteri yok.",
    en: "Nobody with consent matches this.",
    de: "Niemand mit Einwilligung passt darauf.",
  },
  "campaign.consentNote": {
    tr: "Yalnızca WhatsApp izni vermiş müşterilere gönderilir.",
    en: "Only customers who gave WhatsApp consent are included.",
    de: "Nur Kunden mit WhatsApp-Einwilligung werden einbezogen.",
  },
  "campaign.send": { tr: "Gönder", en: "Send", de: "Senden" },
  "campaign.sendConfirm": {
    tr: "Gönderilsin mi? Geri alınamaz.",
    en: "Send it? This can't be taken back.",
    de: "Senden? Das lässt sich nicht rückgängig machen.",
  },
  "campaign.sent": { tr: "gönderildi", en: "sent", de: "gesendet" },
  "campaign.opened": { tr: "açıldı", en: "opened", de: "geöffnet" },
  "campaign.pending": { tr: "sırada", en: "in the queue", de: "in der Warteschlange" },
  "campaign.failed": { tr: "başarısız", en: "failed", de: "fehlgeschlagen" },
  "campaign.draft": { tr: "Taslak", en: "Draft", de: "Entwurf" },
  "campaign.empty": {
    tr: "Henüz kampanya yok.",
    en: "No campaigns yet.",
    de: "Noch keine Kampagnen.",
  },
  // Rewritten 2026-08-26: the old text described the two-window flow — get it
  // approved at Meta, then mark it approved by hand — that the in-app
  // submission replaced. The templates card this points at now sits on the
  // same page, right above these cards.
  "campaign.needsTemplate": {
    tr: "Kampanya göndermek için Meta'nın onayladığı bir kampanya şablonu gerekir. Taslağı oluşturun ve yukarıdaki şablonlar kartından onaya gönderin; sonuç aynı karta kendiliğinden düşer.",
    en: "Sending campaigns needs a Meta-approved campaign template. Create the draft and submit it from the templates card above; the verdict lands on that card by itself.",
    de: "Für Kampagnen ist eine von Meta genehmigte Kampagnenvorlage nötig. Entwurf anlegen und über die Vorlagen-Karte oben zur Genehmigung einreichen; das Ergebnis erscheint dort von selbst.",
  },
  "campaign.createTemplate": {
    tr: "Şablon taslağı oluştur",
    en: "Create template draft",
    de: "Vorlagenentwurf anlegen",
  },
  "campaign.whyTemplate": {
    tr: "WhatsApp, size yazmamış birine serbest metin göndermenize izin vermez. Onaylı şablon bu yüzden gerekli — {{3}} kısmı her kampanyada değişebildiği için tek onay tüm kampanyalarınıza yeter.",
    en: "WhatsApp won't let you send free text to someone who hasn't written to you. That's why an approved template is required — and because its {{3}} changes per campaign, one approval covers all of them.",
    de: "WhatsApp erlaubt keinen freien Text an jemanden, der Ihnen nicht geschrieben hat. Darum ist eine genehmigte Vorlage nötig — und da sich {{3}} je Kampagne ändert, genügt eine Genehmigung für alle.",
  },

  // Outbound images.
  "media.attach": { tr: "Dosya ekle", en: "Attach a file", de: "Datei anhängen" },
  "media.library": { tr: "Dosyalar", en: "Files", de: "Dateien" },
  "media.upload": { tr: "Yükle", en: "Upload", de: "Hochladen" },
  "media.empty": {
    tr: "Henüz dosya yok. Fiyat listesi, önce-sonra fotoğrafı: bir kez yükleyin, hep kullanın.",
    en: "No files yet. A price list, a before-and-after: upload once, send it forever.",
    de: "Noch keine Dateien. Eine Preisliste, ein Vorher-Nachher: einmal hochladen, immer senden.",
  },
  "media.remove": { tr: "Kaldır", en: "Remove", de: "Entfernen" },
  // Two ceilings, one sentence. Naming both beats naming the one that happens
  // to be wrong for the file somebody just picked.
  "media.tooLarge": {
    tr: "Dosya çok büyük (görsel en fazla 2 MB, belge 5 MB).",
    en: "That file is too large (2 MB for an image, 5 MB for a document).",
    de: "Die Datei ist zu groß (Bild maximal 2 MB, Dokument 5 MB).",
  },
  "media.unsupported": {
    tr: "Yalnızca JPG, PNG, WebP, PDF, Word ve Excel gönderilebilir.",
    en: "Only JPG, PNG, WebP, PDF, Word and Excel can be sent.",
    de: "Es können nur JPG, PNG, WebP, PDF, Word und Excel gesendet werden.",
  },
  "media.inUse": {
    tr: "Bu dosya gönderilmiş bir mesajda var, silinemez.",
    en: "This file is in a message already sent, so it can't be deleted.",
    de: "Diese Datei steht in einer bereits gesendeten Nachricht und kann nicht gelöscht werden.",
  },

  // What arrived, in one word, for the surfaces that cannot show the thing
  // itself — an inbox line, a failed download's bubble. WhatsApp's own Turkish
  // wording, because the salon reads this next to the app it already uses.
  "media.kind.image": { tr: "Fotoğraf", en: "Photo", de: "Foto" },
  "media.kind.voice": { tr: "Sesli mesaj", en: "Voice message", de: "Sprachnachricht" },
  "media.kind.audio": { tr: "Ses dosyası", en: "Audio file", de: "Audiodatei" },
  "media.kind.video": { tr: "Video", en: "Video", de: "Video" },
  "media.kind.document": { tr: "Belge", en: "Document", de: "Dokument" },
  "media.openHint": {
    tr: "yeni sekmede açılır",
    en: "opens in a new tab",
    de: "öffnet in neuem Tab",
  },
  // The download failed or the file was over the ceiling. Naming what it WAS
  // is the whole point — "a voice message we could not load" is a thing the
  // salon can act on (open WhatsApp on the phone), a blank bubble is not.
  "media.unavailable": {
    tr: "yüklenemedi",
    en: "could not be loaded",
    de: "konnte nicht geladen werden",
  },

  // Activity log. The kind labels are written as things that HAPPENED, not as
  // commands — the reader is looking back at a record, so "Termin verschoben"
  // rather than "Termin verschieben".
  "activity.title": { tr: "Son işlemler", en: "Recent activity", de: "Letzte Aktivität" },
  "activity.hint": {
    tr: "Kim ne yaptı. Mesajlar burada değil, onlar müşterinin kendi yazışmasında.",
    en: "Who did what. Messages are not here: they live in the customer's own thread.",
    de: "Wer was getan hat. Nachrichten stehen nicht hier, sondern im Verlauf des Kunden.",
  },
  "activity.empty": {
    tr: "Henüz kayıt yok.",
    en: "Nothing recorded yet.",
    de: "Noch nichts aufgezeichnet.",
  },
  "activity.system": { tr: "Sistem", en: "System", de: "System" },
  "activity.appointment_created": {
    tr: "Randevu oluşturuldu",
    en: "Appointment created",
    de: "Termin erstellt",
  },
  "activity.appointment_status": {
    tr: "Randevu durumu değişti",
    en: "Appointment status changed",
    de: "Terminstatus geändert",
  },
  "activity.appointment_moved": {
    tr: "Randevu taşındı",
    en: "Appointment moved",
    de: "Termin verschoben",
  },
  "activity.appointment_deleted": {
    tr: "Randevu silindi",
    en: "Appointment deleted",
    de: "Termin gelöscht",
  },
  "activity.customer_created": {
    tr: "Müşteri eklendi",
    en: "Customer added",
    de: "Kunde hinzugefügt",
  },
  "activity.customer_deleted": {
    tr: "Müşteri silindi",
    en: "Customer deleted",
    de: "Kunde gelöscht",
  },
  "activity.settings_changed": {
    tr: "Ayarlar değiştirildi",
    en: "Settings changed",
    de: "Einstellungen geändert",
  },
  "activity.member_invited": {
    tr: "Ekibe kişi eklendi",
    en: "Team member added",
    de: "Teammitglied hinzugefügt",
  },
  "activity.member_removed": {
    tr: "Ekipten kişi çıkarıldı",
    en: "Team member removed",
    de: "Teammitglied entfernt",
  },
  "activity.whatsapp_connected": {
    tr: "WhatsApp bağlandı",
    en: "WhatsApp connected",
    de: "WhatsApp verbunden",
  },
  // Says what the salon has to DO, not what the system did. "Booking dropped"
  // is our word for it; the owner's problem is that somebody is coming and
  // will not be reminded, and the number is right there in the detail.
  "activity.booking_dropped": {
    tr: "Randevu eklenemedi, numara okunamadı",
    en: "Booking not added, number unreadable",
    de: "Termin nicht übernommen, Nummer unlesbar",
  },
} as const;

export type TranslationKey = keyof typeof dictionary;

export function translate(language: Language, key: TranslationKey): string {
  const entry = dictionary[key];
  return entry[language] ?? entry[DEFAULT_LANGUAGE];
}

export function isLanguage(value: string | null | undefined): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

// ── Values and plurals ──────────────────────────────────────────────────────
//
// The placeholder names come from the dictionary's literal types, all three
// languages at once, so a value one translation asks for and the caller left
// out fails the typecheck instead of printing "{n}" on screen.

type PlaceholdersIn<S> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholdersIn<Rest>
  : never;

export type PlaceholderOf<K extends TranslationKey> = PlaceholdersIn<
  (typeof dictionary)[K][Language]
>;

export type TranslationValue = string | number;

// The values a key takes. `never` for a key with no placeholders, so handing
// one values it would ignore is an error too.
export type TranslationVars<K extends TranslationKey> = [PlaceholderOf<K>] extends [never]
  ? never
  : Record<PlaceholderOf<K>, TranslationValue>;

// "{name}" → its value. A replacer function rather than a replacement string,
// because String.replace reads `$&` and `$'` inside a replacement string as
// patterns, and these values are customer names. A placeholder with no value
// is left as written: the types make that unreachable, and a visible "{x}"
// beats a silently missing word if a string ever drifts past them.
export function interpolate(
  template: string,
  vars: Readonly<Record<string, TranslationValue>>,
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

// The bases of every `<base>.one` + `<base>.other` pair.
type PluralBase<K> = K extends `${infer Base}.other`
  ? `${Base}.one` extends TranslationKey
    ? Base
    : never
  : never;
export type PluralKey = PluralBase<TranslationKey>;

type PluralPair<B extends PluralKey> = Extract<`${B}.one` | `${B}.other`, TranslationKey>;

// {n} is the count and is always supplied. Anything else a pair names is the
// caller's to pass, and is required exactly when the pair has one.
type PluralExtra<B extends PluralKey> = Exclude<PlaceholderOf<PluralPair<B>>, "n">;
export type PluralRest<B extends PluralKey> = [PluralExtra<B>] extends [never]
  ? []
  : [vars: Record<PluralExtra<B>, TranslationValue>];

const pluralRules = new Map<Language, Intl.PluralRules>();
const countFormats = new Map<Language, Intl.NumberFormat>();

// The language's own rule, from the platform (CLDR). For tr, en and de that is
// "one" for exactly 1 and "other" for everything else, 0 included; a language
// added later with more forms (few, many) still lands on .other until it gets
// keys of its own.
function pluralForm(language: Language, count: number): "one" | "other" {
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  return rules.select(count) === "one" ? "one" : "other";
}

// A count in the reader's own digits: 1,500 in English, 1.500 in Turkish and
// German.
function formatCount(language: Language, count: number): string {
  let format = countFormats.get(language);
  if (!format) {
    format = new Intl.NumberFormat(language);
    countFormats.set(language, format);
  }
  return format.format(count);
}

export function translatePlural<B extends PluralKey>(
  language: Language,
  base: B,
  count: number,
  ...rest: PluralRest<B>
): string {
  const key = `${base}.${pluralForm(language, count)}` as TranslationKey;
  const vars: Record<string, TranslationValue> = rest[0] ?? {};
  return interpolate(translate(language, key), { ...vars, n: formatCount(language, count) });
}

// What useT() hands a component, and what the public pages build for the
// visitor's language. A plain key reads as it always has; a key with values
// takes them; t.plural picks the form.
export type Translator = {
  (key: TranslationKey): string;
  <K extends TranslationKey>(key: K, vars: TranslationVars<K>): string;
  plural: <B extends PluralKey>(base: B, count: number, ...rest: PluralRest<B>) => string;
};

export function createTranslator(language: Language): Translator {
  const t = ((key: TranslationKey, vars?: Record<string, TranslationValue>) =>
    vars ? interpolate(translate(language, key), vars) : translate(language, key)) as Translator;
  t.plural = (base, count, ...rest) => translatePlural(language, base, count, ...rest);
  return t;
}

// The public booking and manage pages' confirmation line, keyed by the
// `confirmBy` that booking.book and booking.reschedule return. No key, no
// line: a confirmation that is not coming is never promised.
export const CONFIRMATION_LINE = {
  whatsapp: "booking.confirmationWhatsApp",
  email: "booking.confirmationEmail",
  both: "booking.confirmationBoth",
} as const satisfies Record<string, TranslationKey>;
