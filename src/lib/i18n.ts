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
  "account.notifyNewContact": {
    tr: "Yeni bir kişi eklendiğinde e-posta gönder",
    en: "Email me when a new contact is added",
    de: "E-Mail senden, wenn ein neuer Kontakt hinzukommt",
  },
  // The second sentence is the one that matters: without it the switch reads
  // as "email me every time I type a customer in", which nobody wants and
  // which is not what it does.
  "account.notifyNewContactHint": {
    tr: "Sesli asistan, talep formu, WhatsApp veya cal.com üzerinden yeni bir kişi eklendiğinde haber verilir. Ekipten biri kişiyi kendi eklediğinde e-posta gönderilmez.",
    en: "Tells you when someone new arrives through the voice agent, your request form, WhatsApp or cal.com. Contacts you or your team type in yourselves never send an email.",
    de: "Meldet neue Kontakte über den Sprachagenten, Ihr Anfrageformular, WhatsApp oder cal.com. Von Ihnen oder Ihrem Team selbst angelegte Kontakte lösen keine E-Mail aus.",
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
  "staff.title": { tr: "Ekip", en: "Team", de: "Team" },
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
  "appointments.existingCustomer": { tr: "Kayıtlı", en: "Existing", de: "Vorhanden" },
  "appointments.newCustomer": { tr: "Yeni", en: "New", de: "Neu" },
  "appointments.findCustomer": { tr: "Müşteri ara", en: "Find customer", de: "Kunde suchen" },
  "appointments.findCustomerHint": {
    tr: "İsim veya telefon",
    en: "Name or phone",
    de: "Name oder Telefon",
  },
  "appointments.addForCustomer": {
    tr: "Randevu ekle",
    en: "Add appointment",
    de: "Termin hinzufügen",
  },
  "appointments.when": { tr: "Tarih", en: "When", de: "Datum" },
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
  "customers.consentHint": {
    tr: "Müşterinin WhatsApp ve e-posta mesajlarına KVKK onayı. İzin kaydı olmadan hiçbir kanaldan mesaj gönderilmez.",
    en: "The customer's KVKK consent to WhatsApp and email messages. Without it, no channel sends anything.",
    de: "Die Einwilligung des Kunden nach DSGVO für Nachrichten über WhatsApp und E-Mail. Ohne sie sendet kein Kanal etwas.",
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
  "settings.formEnabled": {
    tr: "Talep formu",
    en: "Request form",
    de: "Anfrageformular",
  },
  "settings.formEnabledHint": {
    tr: "Müşterilerin doldurup size ulaşabileceği herkese açık sayfa. Gelen talepler müşterinin sohbetine düşer; randevu otomatik oluşturulmaz.",
    en: "A public page customers fill in to reach you. Requests land in that customer's conversation; no appointment is created automatically.",
    de: "Eine öffentliche Seite, über die Kunden Sie erreichen. Anfragen landen im Gespräch des Kunden; ein Termin wird nicht automatisch angelegt.",
  },
  "settings.formEmbed": {
    tr: "Web sitesine ekle",
    en: "Embed on your website",
    de: "Auf Ihrer Website einbetten",
  },
  "settings.formEmbedHint": {
    tr: "Formu kendi sitenizin içinde gösterir.",
    en: "Shows the form inside your own website.",
    de: "Zeigt das Formular in Ihrer eigenen Website.",
  },
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
  "email.compose": { tr: "E-posta yaz", en: "Compose", de: "Verfassen" },
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
  "error.email-not-configured": {
    tr: "E-posta bağlı değil",
    en: "Email is not connected",
    de: "E-Mail ist nicht verbunden",
  },
  "nav.revenue": { tr: "Gelir", en: "Revenue", de: "Umsatz" },
  "revenue.today": { tr: "Bugün", en: "Today", de: "Heute" },
  "revenue.week": { tr: "Son 7 gün", en: "Last 7 days", de: "Letzte 7 Tage" },
  "revenue.month": { tr: "Son 30 gün", en: "Last 30 days", de: "Letzte 30 Tage" },
  "revenue.recent": {
    tr: "Bu haftaki tamamlanan randevular",
    en: "Completed this week",
    de: "Diese Woche abgeschlossen",
  },
  "revenue.none": {
    tr: "Bu hafta tamamlanmış, fiyatı girilmiş randevu yok.",
    en: "No completed, priced appointments this week.",
    de: "Diese Woche keine abgeschlossenen Termine mit Preis.",
  },
  "revenue.unpriced": {
    tr: "{n} tamamlanmış randevunun fiyatı girilmemiş, toplamlara dahil değil.",
    en: "{n} completed appointments have no price and are not counted.",
    de: "{n} abgeschlossene Termine haben keinen Preis und zählen nicht mit.",
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
  "forms.title": { tr: "Form", en: "Form", de: "Formular" },
  "forms.name": { tr: "Adınız", en: "Your name", de: "Ihr Name" },
  "forms.phone": { tr: "Telefon", en: "Phone", de: "Telefon" },
  "forms.email": { tr: "E-posta", en: "Email", de: "E-Mail" },
  "forms.services": {
    tr: "Ne yaptırmak istersiniz?",
    en: "What would you like booked?",
    de: "Was möchten Sie buchen?",
  },
  "forms.note": { tr: "Not", en: "Note", de: "Notiz" },
  "forms.send": { tr: "Gönder", en: "Send request", de: "Anfrage senden" },
  "forms.thanks": {
    tr: "Teşekkürler, talebiniz bize ulaştı. En kısa sürede sizi arayacağız.",
    en: "Thanks — we've got your request and will be in touch to confirm a time.",
    de: "Danke, Ihre Anfrage ist angekommen. Wir melden uns zur Terminbestätigung.",
  },
  "forms.notFound": {
    tr: "Bu form bulunamadı.",
    en: "This form isn't available.",
    de: "Dieses Formular ist nicht verfügbar.",
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
  "message.imageLoading": {
    tr: "Görsel yükleniyor…",
    en: "Loading image…",
    de: "Bild wird geladen…",
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
  // The tab is already called Business, and the first field on the card is
  // "Business name" — a chip and a card title saying it again put the word on
  // screen four times for three different scopes. General is what the rest of
  // the industry calls this card, and it leaves "Business" meaning one thing.
  "settings.general": { tr: "Genel", en: "General", de: "Allgemein" },
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
  "settings.language": {
    tr: "Mesaj dili",
    en: "Message language",
    de: "Nachrichtensprache",
  },
  "settings.languageHint": {
    tr: "Müşterilere gönderilen mesajların dili. Onaylı WhatsApp şablonunu da bu seçer — bu dilde onaylı şablon yoksa gönderim yapılamaz. Uygulamayı kendi dilinizde görmek için hesap menüsündeki dil ayarını kullanın.",
    en: "The language customers are messaged in. It also selects the approved WhatsApp template, so a language with no approved template cannot send. To read the app in your own language, use the language setting in your account menu.",
    de: "Die Sprache der Kundennachrichten. Sie wählt auch die freigegebene WhatsApp-Vorlage — ohne Vorlage in dieser Sprache kann nichts gesendet werden. Für die App in Ihrer eigenen Sprache nutzen Sie die Spracheinstellung im Kontomenü.",
  },
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
    tr: "Doluysa onay ve hatırlatmalar, e-posta adresi olan müşterilere e-postayla da gider.",
    en: "When set, confirmations and reminders also go by email to customers who have an address.",
    de: "Ist sie hinterlegt, gehen Bestätigungen und Erinnerungen zusätzlich per E-Mail an alle Kunden mit E-Mail-Adresse.",
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
  // The sidebar destination and its two sections. "Voice agent" — what the
  // industry calls these, and what a salon owner now hears elsewhere too. It
  // was "Phone agent", which described the channel rather than the thing.
  // Never "Retell": the vendor is an implementation detail nobody chose.
  "nav.voice": {
    tr: "Sesli asistan",
    en: "Voice agent",
    de: "Sprachassistent",
  },
  "voice.agents": { tr: "Asistanlar", en: "Agents", de: "Assistenten" },
  "nav.reminders": {
    tr: "Hatırlatmalar",
    en: "Reminders",
    de: "Erinnerungen",
  },

  "settings.voice": {
    tr: "Sesli asistan",
    en: "Voice agent",
    de: "Sprachassistent",
  },
  "settings.voiceCollectsCount": {
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
  // The salon's word for the thing, not the vendor's. They bought a phone that
  // gets answered; "Retell agent" is an implementation detail they never chose.
  "settings.voiceAgent": {
    tr: "Sesli asistan",
    en: "Voice agent",
    de: "Sprachassistent",
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
  "settings.voiceDisconnect": {
    tr: "Bağlantıyı kes",
    en: "Disconnect",
    de: "Trennen",
  },
  "settings.voiceDisconnectConfirm": {
    tr: "{name} bağlantısı kesilsin mi? Arama geçmişi Randevu'da kalır, ancak asistan artık bu işletmede görünmez.",
    en: "Disconnect {name}? Its call history stays in Randevu, but the agent will no longer appear for this business.",
    de: "{name} trennen? Der Anrufverlauf bleibt in Randevu, der Assistent wird für diesen Betrieb jedoch nicht mehr angezeigt.",
  },
  "settings.voiceNotProvisioned": {
    tr: "Sesli asistanınız henüz kurulmadı. Kurulumu biz yapıyoruz.",
    en: "Your voice agent isn't set up yet. We handle setup.",
    de: "Ihr Sprachassistent ist noch nicht eingerichtet. Die Einrichtung übernehmen wir.",
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
  // Broken-plumbing notice in the salon's words. Deliberately no "webhook":
  // the owner should read a symptom and a fix, not our vocabulary.
  "settings.voiceNotReceiving": {
    tr: "Bu asistanın arama sonuçları uygulamaya ulaşmıyor.",
    en: "This agent's call results are not reaching the app.",
    de: "Die Anrufergebnisse dieses Assistenten erreichen die App nicht.",
  },
  "settings.voiceNotFullyConnected": {
    tr: "Bu asistan Randevu'ya tam olarak bağlı değil.",
    en: "This agent is not fully connected to Randevu.",
    de: "Dieser Assistent ist nicht vollständig mit Randevu verbunden.",
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
    tr: "Açıkken asistan aramaları yanıtlar ve randevu alır. Kapatınca bağlantı korunur ama randevu alamaz; tatile çıkarken kapatmanız yeterli.",
    en: "On, the agent answers and books. Off keeps the connection but stops bookings; just switch it off for holidays.",
    de: "Eingeschaltet nimmt der Assistent Anrufe an und vergibt Termine. Ausgeschaltet bleibt die Verbindung bestehen, aber es wird nichts gebucht; für den Urlaub einfach ausschalten.",
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
    tr: "Her aramadan sonra kayıtların, özetlerin ve toplanan bilgilerin Randevu'ya ulaşmasını sağlar.",
    en: "Keeps recordings, summaries and collected details in Randevu after every call.",
    de: "Sorgt dafür, dass Aufzeichnungen, Zusammenfassungen und erfasste Angaben nach jedem Anruf in Randevu ankommen.",
  },
  "voiceDetail.webhookWired": {
    tr: "Sonuçlar Randevu'ya ulaşıyor.",
    en: "Results are reaching Randevu.",
    de: "Ergebnisse erreichen Randevu.",
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
  "voiceDetail.reverting": {
    tr: "Geri alınıyor…",
    en: "Reverting…",
    de: "Wird zurückgesetzt…",
  },
  "voiceDetail.reverted": {
    tr: "Önceki talimata geri dönüldü.",
    en: "Reverted to the previous prompt.",
    de: "Auf die vorherige Anweisung zurückgesetzt.",
  },
  // The two agent shapes this sheet cannot edit, said in the owner's terms.
  // Derived from engineType client-side so the copy translates; the backend
  // sends no English for these.
  "voiceDetail.flowAgent": {
    tr: "Bu asistan yönlendirilmiş bir konuşma akışıyla çalışıyor. Senaryosu henüz Randevu'dan düzenlenemiyor.",
    en: "This agent uses a guided call flow. Its script cannot be edited from Randevu yet.",
    de: "Dieser Assistent nutzt einen geführten Gesprächsablauf. Sein Skript kann noch nicht in Randevu bearbeitet werden.",
  },
  "voiceDetail.noPrompt": {
    tr: "Bu asistanın buradan düzenlenebilecek bir talimatı yok.",
    en: "This agent has no prompt that can be edited here.",
    de: "Dieser Assistent hat keine Anweisung, die sich hier bearbeiten lässt.",
  },
  "voiceDetail.before": {
    tr: "Arama öncesi",
    en: "Before the call",
    de: "Vor dem Anruf",
  },
  "voiceDetail.beforeHint": {
    tr: "Arama başlarken asistana verilen bilgiler; kimi aradığını böylece önceden bilir.",
    en: "Values handed to the agent when the call is placed, so it already knows who it is calling.",
    de: "Angaben, die der Assistent beim Start des Anrufs erhält, damit er schon weiß, wen er anruft.",
  },
  "voiceDetail.beforeEmpty": {
    tr: "Bilgi verilmiyor.",
    en: "Nothing injected.",
    de: "Keine Angaben.",
  },
  "voiceDetail.during": {
    tr: "Arama sırasında",
    en: "During the call",
    de: "Während des Anrufs",
  },
  "voiceDetail.duringHint": {
    tr: "Asistanın konuşma sırasında çağırabildiği fonksiyonlar. Takvime bakıp randevu almasını bunlar sağlar.",
    en: "Functions the agent can call mid-conversation. This is how it checks the diary and books.",
    de: "Funktionen, die der Assistent im Gespräch aufrufen kann. Damit prüft er den Kalender und vergibt Termine.",
  },
  "voiceDetail.duringEmpty": {
    tr: "Fonksiyon yok. Konuşabilir ama randevu alamaz.",
    en: "No functions. It can talk, but not book.",
    de: "Keine Funktionen. Er kann sprechen, aber keine Termine vergeben.",
  },
  "voiceDetail.after": {
    tr: "Arama sonrası",
    en: "After the call",
    de: "Nach dem Anruf",
  },
  "voiceDetail.afterHint": {
    tr: "Arama bittiğinde konuşmadan tamamlanan bilgiler.",
    en: "Information recovered from the conversation once the call ends.",
    de: "Angaben, die nach dem Anruf aus dem Gespräch ergänzt werden.",
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
    tr: "Bunlar asistanın mevcut ayarlarıdır. Yayınladığınızda diğer yetenekleri değişmeden Randevu tarafından yönetilmeye başlar.",
    en: "These are the agent's current settings. Publishing brings them under Randevu management without changing its other abilities.",
    de: "Dies sind die aktuellen Einstellungen des Assistenten. Beim Veröffentlichen übernimmt Randevu ihre Verwaltung, ohne andere Fähigkeiten zu ändern.",
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
  "voiceDetail.unsaved": {
    tr: "Kaydedilmemiş değişiklikler",
    en: "Unsaved changes",
    de: "Nicht gespeicherte Änderungen",
  },
  "voiceDetail.unsavedHint": {
    tr: "Bu değişiklikler henüz yayında değil. Siz kaydedene kadar asistan mevcut ayarlarıyla çalışmaya devam eder.",
    en: "These edits aren't live yet. The agent keeps running its saved settings until you save.",
    de: "Diese Änderungen sind noch nicht live. Der Assistent läuft mit seinen gespeicherten Einstellungen weiter, bis Sie speichern.",
  },
  "voiceDetail.discard": {
    tr: "Değişiklikleri at",
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

  // The AI connectors card: keys for talking to this workspace from Claude or
  // ChatGPT. Keys are per person, so this surface is open to staff too — the
  // backend scopes create to self and revoke-others to owners.
  "settings.ai": { tr: "Yapay zekâ", en: "AI", de: "KI" },
  "mcp.intro": {
    tr: "İşletmenizle Claude veya ChatGPT üzerinden konuşun: takvime bakın, müşteri arayın, not bırakın. Her ekip üyesi kendi anahtarıyla bağlanır ve yapılan her işlem etkinlik akışına onun adıyla yazılır.",
    en: "Talk to your business from Claude or ChatGPT: check the calendar, look up customers, leave notes. Each team member connects with their own key, and everything done shows up in the activity feed under their name.",
    de: "Sprechen Sie über Claude oder ChatGPT mit Ihrem Betrieb: Kalender ansehen, Kunden nachschlagen, Notizen hinterlassen. Jedes Teammitglied verbindet sich mit einem eigenen Schlüssel, und alles erscheint unter seinem Namen im Aktivitätsverlauf.",
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
    tr: "Boş bırakırsanız müşterinin kendi diline göre hazır metin gönderilir. Doldurursanız aynen bu metin gider — tek dilde, yani farklı dillerde müşteriniz varsa boş bırakın. [ad] ve [isletme] yazarsanız yerine müşterinin adı ve işletmenizin adı geçer.",
    en: "Left blank, each customer gets the default in their own language. Filled in, exactly this text is sent — in one language only, so leave it blank if your customers don't share one. Write [ad] or [isletme] to drop in the customer's name or your business name.",
    de: "Leer gelassen erhält jeder Kunde die Vorlage in seiner Sprache. Ausgefüllt wird genau dieser Text gesendet — einsprachig, also leer lassen bei gemischtsprachigen Kunden. Mit [ad] oder [isletme] werden Kundenname und Betriebsname eingesetzt.",
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
  "role.owner": { tr: "Yönetici", en: "Admin", de: "Administrator" },
  "role.staff": { tr: "Üye", en: "Member", de: "Mitglied" },
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
  // so a 19-character "Randevu ara" would pin it at the clamp ceiling on every
  // tab; the page title beside it already says what you are searching.
  "common.search": { tr: "Ara…", en: "Search…", de: "Suchen…" },
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
    tr: "WhatsApp'ta onaylı şablonunuzun {{3}} yerine geçer. [ad] yazarsanız müşterinin adı gelir.",
    en: "This becomes {{3}} in your approved WhatsApp template. Write [ad] to drop in the customer's name.",
    de: "Wird zu {{3}} in Ihrer genehmigten WhatsApp-Vorlage. Mit [ad] wird der Kundenname eingesetzt.",
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
  "campaign.pending": { tr: "sırada", en: "in the queue", de: "in der Warteschlange" },
  "campaign.failed": { tr: "başarısız", en: "failed", de: "fehlgeschlagen" },
  "campaign.draft": { tr: "Taslak", en: "Draft", de: "Entwurf" },
  "campaign.empty": {
    tr: "Henüz kampanya yok.",
    en: "No campaigns yet.",
    de: "Noch keine Kampagnen.",
  },
  "campaign.needsTemplate": {
    tr: "Kampanya göndermek için Meta'nın onayladığı bir kampanya şablonu gerekir. Taslağı oluşturup Meta'ya onaylatın, sonra Ayarlar'da onaylandı olarak işaretleyin.",
    en: "Sending campaigns needs a Meta-approved campaign template. Create the draft, get it approved by Meta, then mark it approved in Settings.",
    de: "Für Kampagnen ist eine von Meta genehmigte Kampagnenvorlage nötig. Entwurf anlegen, von Meta genehmigen lassen, dann in den Einstellungen als genehmigt markieren.",
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
  "media.attach": { tr: "Görsel ekle", en: "Attach image", de: "Bild anhängen" },
  "media.library": { tr: "Görseller", en: "Images", de: "Bilder" },
  "media.upload": { tr: "Yükle", en: "Upload", de: "Hochladen" },
  "media.empty": {
    tr: "Henüz görsel yok. Fiyat listesi, önce-sonra fotoğrafı — bir kez yükleyin, hep kullanın.",
    en: "No images yet. A price list, a before-and-after — upload once, send it forever.",
    de: "Noch keine Bilder. Eine Preisliste, ein Vorher-Nachher — einmal hochladen, immer senden.",
  },
  "media.remove": { tr: "Kaldır", en: "Remove", de: "Entfernen" },
  "media.tooLarge": {
    tr: "Dosya çok büyük (en fazla 2 MB).",
    en: "That file is too large (2 MB maximum).",
    de: "Die Datei ist zu groß (maximal 2 MB).",
  },
  "media.unsupported": {
    tr: "Yalnızca JPG, PNG ve WebP gönderilebilir.",
    en: "Only JPG, PNG and WebP can be sent.",
    de: "Es können nur JPG, PNG und WebP gesendet werden.",
  },
  "media.inUse": {
    tr: "Bu görsel gönderilmiş bir mesajda var, silinemez.",
    en: "This image is in a message already sent, so it can't be deleted.",
    de: "Dieses Bild steht in einer bereits gesendeten Nachricht und kann nicht gelöscht werden.",
  },

  // Activity log. The kind labels are written as things that HAPPENED, not as
  // commands — the reader is looking back at a record, so "Termin verschoben"
  // rather than "Termin verschieben".
  "activity.title": { tr: "Son işlemler", en: "Recent activity", de: "Letzte Aktivität" },
  "activity.hint": {
    tr: "Kim ne yaptı. Mesajlar burada değil — onlar müşterinin kendi yazışmasında.",
    en: "Who did what. Messages are not here — they live in the customer's own thread.",
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
