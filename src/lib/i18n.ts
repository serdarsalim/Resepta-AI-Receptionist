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

export const LANGUAGES = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: Language = "tr";
export const LANGUAGE_STORAGE_KEY = "randevu.lang";

const dictionary = {
  "app.name": { tr: "Randevu", en: "Randevu", de: "Randevu" },
  "app.tagline": {
    tr: "WhatsApp randevu hatırlatmaları",
    en: "WhatsApp appointment reminders",
    de: "Terminerinnerungen über WhatsApp",
  },

  "menu.appearance": { tr: "Görünüm", en: "Appearance", de: "Darstellung" },
  "menu.account": {
    tr: "Hesap menüsü",
    en: "Account menu",
    de: "Kontomenü",
  },
  "theme.light": { tr: "Açık", en: "Light", de: "Hell" },
  "theme.dark": { tr: "Koyu", en: "Dark", de: "Dunkel" },
  "theme.auto": { tr: "Otomatik", en: "Auto", de: "Automatisch" },

  "nav.today": { tr: "Bugün", en: "Today", de: "Heute" },
  "nav.appointments": { tr: "Randevular", en: "Appointments", de: "Termine" },
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
  "account.notifications": {
    tr: "Bildirimler",
    en: "Notifications",
    de: "Benachrichtigungen",
  },
  "account.notifyInbound": {
    tr: "Müşteri yanıt yazdığında e-posta gönder",
    en: "Email me when a customer replies",
    de: "E-Mail schicken, wenn ein Kunde antwortet",
  },
  "account.notifyInboundHint": {
    tr: "Bir müşteri WhatsApp'tan yazdığında e-posta adresinize haber verilir. Her mesaj için bir e-posta.",
    en: "You get an email at your account address when a customer writes on WhatsApp. One email per message.",
    de: "Sie bekommen eine E-Mail an Ihre Kontoadresse, sobald ein Kunde über WhatsApp schreibt. Eine E-Mail pro Nachricht.",
  },
  "account.notifyFailed": {
    tr: "Bir mesaj gönderilemediğinde e-posta gönder",
    en: "Email me when a message fails to send",
    de: "E-Mail schicken, wenn eine Nachricht nicht ankommt",
  },
  "account.notifyFailedHint": {
    tr: "Hatırlatma veya onay mesajı gönderilemediğinde haber verilir. İşletmenin sessizce mesajsız kalmaması için açık tutun.",
    en: "Tells you when a reminder or confirmation could not be delivered, so your business never goes quiet without anyone noticing.",
    de: "Meldet, wenn eine Erinnerung oder Bestätigung nicht zugestellt werden konnte. So merken Sie es, bevor ein Kunde ohne Nachricht dasteht.",
  },
  "account.role": { tr: "Rolünüz", en: "Your role", de: "Ihre Rolle" },
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

  "onboarding.title": {
    tr: "Hoş geldiniz!",
    en: "Welcome!",
    de: "Willkommen!",
  },
  "onboarding.prompt": {
    tr: "İşletmenizin adı ne? Müşterilerinize giden mesajlarda görünecek.",
    en: "What's your business called? It appears in messages to your customers.",
    de: "Wie heißt Ihr Betrieb? Der Name steht in den Nachrichten an Ihre Kunden.",
  },
  "onboarding.businessName": {
    tr: "İşletme adı",
    en: "Business name",
    de: "Betriebsname",
  },
  "onboarding.start": { tr: "Başla", en: "Get started", de: "Loslegen" },

  "appointments.edit": { tr: "Randevuyu düzenle", en: "Edit appointment", de: "Termin bearbeiten" },
  "appointments.duration": { tr: "Süre (dk)", en: "Duration (min)", de: "Dauer (Min.)" },
  "appointments.bookAnyway": {
    tr: "Yine de kaydet",
    en: "Book anyway",
    de: "Trotzdem buchen",
  },
  "appointments.cancelAppointment": {
    tr: "Randevuyu iptal et",
    en: "Cancel appointment",
    de: "Termin stornieren",
  },
  "appointments.moveFailed": {
    tr: "Takvim bu değişikliği kabul etmedi, randevu eski yerinde kaldı.",
    en: "The calendar refused this change, so the appointment stayed where it was.",
    de: "Der Kalender hat diese Änderung abgelehnt, der Termin blieb unverändert.",
  },
  "staff.title": { tr: "Ekip", en: "People", de: "Personen" },
  "staff.hint": {
    tr: "Randevuyu kim veriyor. Gün görünümü herkese bir sütun açar. Ayrılan biri silinmez, pasife alınır — geçmiş randevuları bir isme bağlı kalmalı.",
    en: "Who delivers the appointment. Day view gives each person a column. Somebody who leaves is deactivated, not deleted — their past appointments still need a name.",
    de: "Wer den Termin ausführt. Die Tagesansicht gibt jeder Person eine Spalte. Wer geht, wird deaktiviert statt gelöscht — vergangene Termine brauchen weiterhin einen Namen.",
  },
  "staff.label": {
    tr: "Bu kişilere ne diyorsunuz?",
    en: "What do you call these people?",
    de: "Wie nennen Sie diese Personen?",
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
  "appointments.when": { tr: "Tarih", en: "When", de: "Datum" },
  "appointments.service": { tr: "Hizmet", en: "Service", de: "Leistung" },
  "appointments.staff": { tr: "Personel", en: "Staff", de: "Mitarbeiter" },
  "appointments.status": { tr: "Durum", en: "Status", de: "Status" },
  "appointments.notes": { tr: "Not", en: "Notes", de: "Notiz" },
  "appointments.source": { tr: "Kaynak", en: "Source", de: "Quelle" },
  "appointments.cancel": {
    tr: "Randevuyu iptal et",
    en: "Cancel appointment",
    de: "Termin absagen",
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
  "customers.new": {
    tr: "Yeni müşteri",
    en: "New customer",
    de: "Neuer Kunde",
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
  "customers.consentHint": {
    tr: "Müşterinin WhatsApp ve e-posta mesajlarına KVKK onayı. İzin kaydı olmadan hiçbir kanaldan mesaj gönderilmez.",
    en: "The customer's KVKK consent to WhatsApp and email messages. Without it, no channel sends anything.",
    de: "Die Einwilligung des Kunden nach DSGVO für Nachrichten über WhatsApp und E-Mail. Ohne sie sendet kein Kanal etwas.",
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
  // Column header, where "Messaging consent" truncates to "Messagin…". A
  // header labels its column, and the column only ever says one thing.
  "customers.consentShort": { tr: "İzin", en: "Consent", de: "Einwilligung" },
  "customers.added": { tr: "Eklendi", en: "Added", de: "Angelegt" },
  "customers.lastActivity": {
    tr: "Son hareket",
    en: "Last activity",
    de: "Letzter Kontakt",
  },

  "messages.none": {
    tr: "Henüz mesaj yok",
    en: "No messages yet",
    de: "Noch keine Nachrichten",
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
  "settings.business": { tr: "İşletme", en: "Business", de: "Betrieb" },
  "settings.businessName": {
    tr: "İşletme adı",
    en: "Business name",
    de: "Betriebsname",
  },
  "settings.timezone": { tr: "Saat dilimi", en: "Timezone", de: "Zeitzone" },
  "settings.language": { tr: "Dil", en: "Language", de: "Sprache" },
  "settings.reminders": {
    tr: "Hatırlatmalar",
    en: "Reminders",
    de: "Erinnerungen",
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
  "settings.ruleDaysAfterNoShow": {
    tr: "gün sonra, gelmeyen müşteriye",
    en: "days after a no-show",
    de: "Tage nach einem Nichterscheinen",
  },
  "settings.ruleWinbackHint": {
    tr: "Randevusuna gelmeyen müşteriye tek bir mesaj gider. Zaten gönderilmiş bir geri kazanım tekrarlanmaz.",
    en: "One message to a customer who didn't show up. A win-back already sent is never repeated.",
    de: "Eine einzige Nachricht an Kundinnen und Kunden, die nicht erschienen sind. Eine bereits gesendete Rückgewinnung wird nicht wiederholt.",
  },
  "settings.ruleAdd": {
    tr: "Hatırlatma ekle",
    en: "Add reminder",
    de: "Erinnerung hinzufügen",
  },
  "settings.ruleEmail": { tr: "E-posta", en: "Email", de: "E-Mail" },
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
  "settings.rulesNoChannel": {
    tr: "Ne WhatsApp bağlı ne de gönderen e-posta adresi var, bu yüzden listedeki hiçbir kural şu anda mesaj göndermiyor. WhatsApp'ı WhatsApp bölümünden bağlayın ya da İşletme sayfasında bir e-posta adresi girin.",
    en: "No WhatsApp connection and no sender email address, so nothing on this list is going out yet. Connect WhatsApp in the WhatsApp section, or set an email address on the Business page.",
    de: "Weder ist WhatsApp verbunden noch ist eine Absenderadresse hinterlegt, daher sendet derzeit keine dieser Regeln. Verbinden Sie WhatsApp im WhatsApp-Bereich oder hinterlegen Sie eine E-Mail-Adresse auf der Seite Betrieb.",
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
  "settings.emailFromHint": {
    tr: "Doluysa onay ve hatırlatmalar e-posta adresi olan müşterilere e-postayla da gider (n8n üzerinden).",
    en: "When set, confirmations and reminders also go by email to customers with an address (via n8n).",
    de: "Ist sie hinterlegt, gehen Bestätigungen und Erinnerungen zusätzlich per E-Mail an alle Kunden mit E-Mail-Adresse (über n8n).",
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
    tr: "Şablonlar Meta tarafından onaylanmalıdır. Onaylanan şablon adını buraya yazın.",
    en: "Templates must be approved by Meta. Enter the approved template name here.",
    de: "Vorlagen müssen von Meta genehmigt sein. Tragen Sie hier den genehmigten Vorlagennamen ein.",
  },
  "settings.templateName": {
    tr: "Şablon adı",
    en: "Template name",
    de: "Vorlagenname",
  },
  "settings.templateStatus": { tr: "Durum", en: "Status", de: "Status" },
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

  "inbox.all": { tr: "Tümü", en: "All", de: "Alle" },
  "inbox.empty": {
    tr: "Henüz konuşma yok. Bir müşteri yazdığında ya da aradığında burada görünür.",
    en: "No conversations yet. When a customer writes or calls, it lands here.",
    de: "Noch keine Unterhaltungen. Sobald ein Kunde schreibt oder anruft, sehen Sie es hier.",
  },
  "inbox.needsReply": {
    tr: "Yanıt bekliyor",
    en: "Needs reply",
    de: "Antwort offen",
  },
  // The sidebar badge and the row dot say the same thing, so they share a
  // string: somebody still has to look at this.
  "inbox.needsAttention": {
    tr: "İlgi bekliyor",
    en: "Needs attention",
    de: "Wartet auf Sie",
  },
  "inbox.failedSend": {
    tr: "Gönderilemedi",
    en: "Failed to send",
    de: "Nicht gesendet",
  },
  "inbox.search": {
    tr: "Konuşmalarda ara",
    en: "Search conversations",
    de: "Unterhaltungen durchsuchen",
  },
  "inbox.dismiss": {
    tr: "İlgilenildi olarak işaretle",
    en: "Mark as handled",
    de: "Als erledigt markieren",
  },
  "inbox.restore": { tr: "Geri getir", en: "Bring back", de: "Zurückholen" },
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
  "calls.transcript": {
    tr: "Konuşma dökümü",
    en: "Transcript",
    de: "Transkript",
  },
  "calls.recording": { tr: "Kayıt", en: "Recording", de: "Aufnahme" },

  "settings.voice": {
    tr: "Sesli asistan",
    en: "Voice agent",
    de: "Sprachassistent",
  },
  "settings.voiceEndpoints": {
    tr: "Webhook adresleri",
    en: "Webhook URLs",
    de: "Webhook-Adressen",
  },
  "settings.voiceHint": {
    tr: "Retell agent'ınız işletmenin telefonunu yanıtlar ve randevu alır. Fonksiyon adresi ve arama-sonu webhook'unu Retell panosunda bu URL'lere yönlendirin.",
    en: "Your Retell agent answers your business phone and books appointments. Point the function URL and call-ended webhook at these endpoints in the Retell dashboard.",
    de: "Ihr Retell-Agent nimmt die Anrufe im Betrieb entgegen und vergibt Termine. Richten Sie die Funktions-URL und den Webhook für beendete Anrufe im Retell-Dashboard auf diese Adressen.",
  },
  "settings.retellAgentId": {
    tr: "Retell agent ID",
    en: "Retell agent ID",
    de: "Retell-Agent-ID",
  },
  "settings.inboundNumber": {
    tr: "Gelen arama numarası",
    en: "Inbound number",
    de: "Eingehende Rufnummer",
  },
  "settings.transferNumber": {
    tr: "Aktarma numarası",
    en: "Transfer number",
    de: "Weiterleitungsnummer",
  },
  "settings.voiceEnabled": { tr: "Etkin", en: "Enabled", de: "Aktiv" },
  "settings.businessHours": {
    tr: "Açık olduğunuz günler",
    en: "Days you're open",
    de: "Ihre Öffnungstage",
  },
  "settings.businessHoursHint": {
    tr: "Sadece WhatsApp otomatik yanıtı için kullanılır — hangi saatlerde kapalı olduğunuzu bilmeden \"şu anda kapalıyız\" yazamayız. Randevu hatırlatmalarının saatini bu değil, Hatırlatmalar bölümündeki sessiz saatler belirler.",
    en: "Used only by the WhatsApp auto-reply — we can't say \"we're closed\" without knowing when you are. Reminder timing is set by quiet hours under Reminders, not here.",
    de: "Wird nur für die WhatsApp-Autoantwort verwendet — ohne Ihre Zeiten können wir nicht \"geschlossen\" schreiben. Die Zeit für Erinnerungen steuern die Ruhezeiten unter Erinnerungen, nicht dies.",
  },
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
  "settings.autoReply": {
    tr: "Kapalıyken otomatik yanıt",
    en: "Auto-reply when closed",
    de: "Autoantwort bei geschlossen",
  },
  "settings.autoReplyHint": {
    tr: "Kapalı olduğunuz saatlerde yazan müşteriye bir kez randevu linkinizi gönderir. Açıkken kapalıdır: mesajı zaten siz okuyorsunuz ve beş dakikada cevap veren bir insanın üzerine gelen robot yanıtı kötü görünür.",
    en: "Sends your booking link once to anyone who writes while you're closed. Off during opening hours on purpose: you're reading those messages, and a bot replying on top of a human who answers in five minutes reads badly.",
    de: "Sendet Ihren Buchungslink einmal an alle, die außerhalb der Öffnungszeiten schreiben. Während der Öffnungszeiten absichtlich aus: Sie lesen diese Nachrichten selbst, und eine Bot-Antwort über einem Menschen wirkt schlecht.",
  },
  "settings.autoReplyText": {
    tr: "Kendi metniniz",
    en: "Your own wording",
    de: "Ihr eigener Text",
  },
  "settings.autoReplyTextHint": {
    tr: "Boş bırakırsanız müşterinin kendi diline göre hazır metin gönderilir. Doldurursanız aynen bu metin gider — tek dilde, yani farklı dillerde müşteriniz varsa boş bırakın.",
    en: "Left blank, each customer gets the default in their own language. Filled in, exactly this text is sent — in one language only, so leave it blank if your customers don't share one.",
    de: "Leer gelassen erhält jeder Kunde die Vorlage in seiner Sprache. Ausgefüllt wird genau dieser Text gesendet — einsprachig, also leer lassen bei gemischtsprachigen Kunden.",
  },
  "settings.bookingUrl": {
    tr: "Randevu linki",
    en: "Booking link",
    de: "Buchungslink",
  },
  "settings.bookingUrlHint": {
    tr: "cal.com sayfanızın adresi. Otomatik yanıtta ilk sırada bu gider — gece yarısı bir telefon numarası çıkmaz yol, link çalışır.",
    en: "Your cal.com page. The auto-reply offers this first: a phone number is a dead end at midnight, a link isn't.",
    de: "Ihre cal.com-Seite. Die Autoantwort nennt zuerst diesen Link — eine Telefonnummer führt um Mitternacht nirgendwohin.",
  },
  "settings.publicPhone": {
    tr: "Müşteriye verilecek telefon",
    en: "Phone to give customers",
    de: "Telefonnummer für Kunden",
  },
  "settings.autoReplyInactive": {
    tr: "Şu anda hiçbir şey gönderilmiyor: otomatik yanıt için en az bir açık gün veya saat ile bir link ya da telefon gerekiyor.",
    en: "Nothing is being sent right now: the auto-reply needs at least one open day or hour, plus a link or a phone number.",
    de: "Derzeit wird nichts gesendet: die Autoantwort braucht mindestens einen Öffnungstag oder eine Zeit sowie einen Link oder eine Telefonnummer.",
  },
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
  "contact.sessionClosed": {
    tr: "24 saatlik pencere kapalı. Müşteri yazana kadar yalnızca şablon mesajı gönderilebilir.",
    en: "The 24h window is closed. Only template messages until the customer writes.",
    de: "Das 24-Stunden-Fenster ist geschlossen. Bis der Kunde schreibt, sind nur Vorlagennachrichten möglich.",
  },

  "services.title": { tr: "Hizmetler", en: "Services", de: "Leistungen" },
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
  "services.duration": { tr: "Süre", en: "Duration", de: "Dauer" },
  "services.add": {
    tr: "Hizmet ekle",
    en: "Add service",
    de: "Leistung hinzufügen",
  },
  "services.active": { tr: "Kullanımda", en: "Active", de: "Aktiv" },
  "services.minutes": { tr: "dk", en: "min", de: "Min." },

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
  "fields.label": { tr: "Etiket", en: "Label", de: "Bezeichnung" },
  "fields.typeLabel": { tr: "Tür", en: "Type", de: "Typ" },
  // Org-defined fields are how one deployment fits a salon, a dentist and a
  // garage: plate number, last cleaning, insurance are data, not code.
  // "Dolduran", not "Kaynak": the two options are Ekip and Sesli asistan, so
  // the label asks who fills the field in. "Kaynak" already means where an
  // appointment came from (appointments.source), and one word for two ideas
  // reads as the same column twice.
  "fields.source": { tr: "Dolduran", en: "Filled by", de: "Ausgefüllt von" },
  "fields.source.manual": { tr: "Ekip", en: "Staff", de: "Mitarbeiter" },
  "fields.source.voice": {
    tr: "Sesli asistan",
    en: "Voice agent",
    de: "Sprachassistent",
  },
  "fields.voiceGroup": {
    tr: "Aramalardan gelen",
    en: "From calls",
    de: "Aus Anrufen",
  },
  // Honest version. Randevu does not own the Retell agent's prompt, so marking
  // a field "voice" cannot make the agent ask for it. What Randevu does own is
  // the endpoint that accepts the answer, so the copy says exactly that and the
  // block below the list is the configuration the owner still has to paste in.
  "fields.voiceHint": {
    tr: "Randevu, sesli asistanın konuşma metnini yazmaz. Bu alanlar ancak anahtarlarını Retell'deki update_contact fonksiyonuna verdiğinizde dolar. Aşağıdaki bloğu kopyalayıp agent yapılandırmanıza yapıştırın.",
    en: "Randevu does not write your voice agent's prompt. These fields only get filled once you give their keys to the update_contact function in Retell. Copy the block below into your agent configuration.",
    de: "Randevu schreibt den Prompt Ihres Sprachassistenten nicht. Diese Felder werden erst befüllt, wenn Sie ihre Schlüssel in Retell bei der Funktion update_contact hinterlegen. Kopieren Sie den Block unten in Ihre Agent-Konfiguration.",
  },
  // Same group heading, different reader. On the customer record nobody is
  // configuring anything; they want to know why this value is here and whether
  // they may correct it.
  "fields.voiceRecordHint": {
    tr: "Bu alanları sesli asistan arama sırasında doldurur. Yanlış duyulmuşsa elle düzeltebilirsiniz.",
    en: "The voice agent fills these during a call. Correct any of them by hand if it misheard.",
    de: "Diese Felder füllt der Sprachassistent während eines Anrufs. Bei einem Hörfehler können Sie sie von Hand korrigieren.",
  },
  "fields.voiceSetup": {
    tr: "Retell yapılandırması",
    en: "Retell configuration",
    de: "Retell-Konfiguration",
  },
  // Heads the field list inside the pasteable block, so the block still makes
  // sense once it is sitting in Retell with no Randevu around it.
  "fields.voiceSetupFields": {
    tr: "Bu işletmenin alanları:",
    en: "Fields this business collects:",
    de: "Felder dieses Betriebs:",
  },
  "fields.key": { tr: "Alan anahtarı", en: "Field key", de: "Feldschlüssel" },
  "fields.type.text": { tr: "Metin", en: "Text", de: "Text" },
  "fields.type.select": { tr: "Seçim", en: "Select", de: "Auswahl" },
  "fields.type.number": { tr: "Sayı", en: "Number", de: "Zahl" },
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

  "team.title": { tr: "Ekip", en: "Team", de: "Team" },
  "team.inviteHint": {
    tr: "Davet edilen kişi bu e-posta adresiyle Google üzerinden giriş yaptığında ekibinize katılır. E-posta gönderilmez, adresi siz iletin.",
    en: "The invitee joins your team when they sign in with Google using this email. No email is sent, so share the address yourself.",
    de: "Die eingeladene Person kommt in Ihr Team, sobald sie sich mit dieser E-Mail-Adresse über Google anmeldet. Es wird keine E-Mail verschickt, geben Sie die Adresse selbst weiter.",
  },
  "team.invite": { tr: "Davet et", en: "Invite", de: "Einladen" },
  "team.pending": {
    tr: "Bekleyen davetler",
    en: "Pending invites",
    de: "Offene Einladungen",
  },
  "team.revoke": { tr: "İptal et", en: "Revoke", de: "Zurückziehen" },
  "team.you": { tr: "siz", en: "you", de: "Sie" },
  "role.owner": { tr: "Sahip", en: "Owner", de: "Inhaber" },
  "role.staff": { tr: "Personel", en: "Staff", de: "Mitarbeiter" },
  "settings.ownerOnly": {
    tr: "Bu ayarları yalnızca işletme sahibi değiştirebilir.",
    en: "Only the business owner can change these settings.",
    de: "Diese Einstellungen kann nur der Inhaber des Betriebs ändern.",
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
  "common.cancel": { tr: "Vazgeç", en: "Cancel", de: "Abbrechen" },
  "common.close": { tr: "Kapat", en: "Close", de: "Schließen" },
  "common.delete": { tr: "Sil", en: "Delete", de: "Löschen" },
  "common.copy": { tr: "Kopyala", en: "Copy", de: "Kopieren" },
  "common.copied": { tr: "Kopyalandı", en: "Copied", de: "Kopiert" },
  "common.loading": { tr: "Yükleniyor…", en: "Loading…", de: "Wird geladen…" },
  "common.back": { tr: "Geri", en: "Back", de: "Zurück" },
  "common.optional": { tr: "isteğe bağlı", en: "optional", de: "optional" },
} as const;

export type TranslationKey = keyof typeof dictionary;

export function translate(language: Language, key: TranslationKey): string {
  const entry = dictionary[key];
  return entry[language] ?? entry[DEFAULT_LANGUAGE];
}

export function isLanguage(value: string | null | undefined): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}
