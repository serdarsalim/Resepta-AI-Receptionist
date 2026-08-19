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
  "app.name": { tr: "Resepta", en: "Resepta", de: "Resepta" },
  "app.tagline": {
    tr: "WhatsApp randevu hatırlatmaları",
    en: "WhatsApp appointment reminders",
    de: "Terminerinnerungen über WhatsApp",
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
  "appointments.addForCustomer": {
    tr: "Randevu ekle",
    en: "Add appointment",
    de: "Termin hinzufügen",
  },
  // The record card's appointments block (Nudge's deal block, in a salon's
  // terms). The count rides the heading, and the visits that are over sit
  // behind a disclosure rather than pushing the record off the screen.
  "appointments.upcomingCount": {
    tr: "yaklaşan",
    en: "upcoming",
    de: "bevorstehend",
  },
  "appointments.noUpcoming": {
    tr: "Yaklaşan randevu yok",
    en: "No upcoming appointments",
    de: "Keine bevorstehenden Termine",
  },
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
  // The public booking page (/book/<slug>) and the manage page (/appt/<token>).
  "booking.pickService": {
    tr: "Hizmet seçin",
    en: "Choose a service",
    de: "Leistung wählen",
  },
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
  "booking.confirmationHint": {
    tr: "Onay mesajınız WhatsApp veya e-posta ile geliyor.",
    en: "Your confirmation is on its way by WhatsApp or email.",
    de: "Ihre Bestätigung kommt per WhatsApp oder E-Mail.",
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
  "booking.moved": {
    tr: "Randevunuz yeni saate taşındı. Onay mesajınız yolda.",
    en: "Your appointment has been moved. A new confirmation is on its way.",
    de: "Ihr Termin wurde verschoben. Eine neue Bestätigung ist unterwegs.",
  },
  "booking.callToChange": {
    tr: "Bu randevuyu değiştirmek için lütfen bizi arayın:",
    en: "To change this appointment, please call us:",
    de: "Um diesen Termin zu ändern, rufen Sie uns bitte an:",
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
  // The add sheet. It replaced a row of preset chips ("+ 2 days before",
  // "+ 1 hour before"), which could only ever offer the handful of timings
  // somebody guessed in advance — a salon that wants 36 hours had no way in.
  // So: pick the message, then type the number and choose the unit.
  "settings.ruleAddPick": {
    tr: "Hangi mesaj",
    en: "Which message",
    de: "Welche Nachricht",
  },
  "settings.ruleAddTiming": {
    tr: "Ne zaman gönderilsin",
    en: "When it sends",
    de: "Wann sie gesendet wird",
  },
  "settings.ruleUnitHours": { tr: "saat", en: "hours", de: "Stunden" },
  "settings.ruleUnitDays": { tr: "gün", en: "days", de: "Tage" },
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
  "settings.ruleHoursAfterEnd": {
    tr: "saat sonra, randevu bitince",
    en: "hours after the appointment",
    de: "Stunden nach dem Termin",
  },
  "settings.ruleHoursBefore": {
    tr: "saat önce",
    en: "hours before",
    de: "Stunden vorher",
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
  "settings.previewPickContact": {
    tr: "Müşteri seçin…",
    en: "Pick a contact…",
    de: "Kontakt wählen…",
  },
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
  // Shown when NO channel is wired. The wiring is the operator's job, so this
  // reassures rather than instructs: the rules above it already show that
  // reminders exist, and this says why nothing sends yet and whose move it is.
  "settings.rulesNoChannel": {
    tr: "Hatırlatmalarınız hazır, kurulum bekliyor. WhatsApp ve e-posta bağlantısını biz yapıyoruz, bize ulaşmanız yeterli.",
    en: "Your reminders are ready and waiting on setup. We wire up WhatsApp and email for you, just get in touch.",
    de: "Ihre Erinnerungen stehen bereit und warten auf die Einrichtung. WhatsApp und E-Mail richten wir für Sie ein, melden Sie sich einfach.",
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
  // screen reader; the hints add what a click will do, because the two differ
  // (clicking grey pins it, clicking green unpins).
  "inbox.pinned": { tr: "Sabitlendi", en: "Pinned", de: "Angeheftet" },
  "inbox.unseen": { tr: "Yeni mesaj", en: "New reply", de: "Neue Nachricht" },
  // The list-filter chips. Their own keys rather than reusing the two above:
  // those name a row's STATE for a screen reader ("Sabitlendi" = this one is
  // pinned), and a chip names an ACTION on the list ("show me the pinned
  // ones"). Turkish separates the two where English happens not to.
  "inbox.filterAll": { tr: "Tümü", en: "All", de: "Alle" },
  "inbox.filterUnread": { tr: "Okunmamış", en: "Unread", de: "Ungelesen" },
  "inbox.filterPinned": { tr: "Sabitlenenler", en: "Pinned", de: "Angeheftet" },
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
  "inbox.unseenHint": {
    tr: "Yeni mesaj. Sonrası için sabitlemek üzere tıklayın",
    en: "New reply. Click to pin it for later",
    de: "Neue Nachricht. Zum Merken anheften",
  },
  "inbox.pinHint": {
    tr: "Sonrası için sabitlemek üzere tıklayın",
    en: "Click to pin this for later",
    de: "Zum Merken anheften",
  },
  // The right pane before anything is picked. Says what to DO, not "no
  // conversation selected" — the reader can see that nothing is selected.
  "inbox.selectConversation": {
    tr: "Okumak ve yanıtlamak için bir konuşma seçin.",
    en: "Select a conversation to read and reply.",
    de: "Wählen Sie eine Unterhaltung zum Lesen und Antworten.",
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
  // The prepaid wallet (BillingView, prepaid orgs only). "Bakiye" over any
  // coined word: it is what every prepaid product in Türkiye calls this.
  "nav.balance": { tr: "Bakiye", en: "Balance", de: "Guthaben" },
  "wallet.balance": {
    tr: "Mevcut bakiye",
    en: "Current balance",
    de: "Aktuelles Guthaben",
  },
  "wallet.topUpLine": {
    tr: "Ödeme Stripe'ın güvenli sayfasında kartla yapılır; bakiyeniz ödemeden hemen sonra güncellenir.",
    en: "Payment is by card on Stripe's secure page; your balance updates right after.",
    de: "Die Zahlung erfolgt per Karte auf der sicheren Stripe-Seite; Ihr Guthaben wird direkt danach aktualisiert.",
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
  // The phone tab bar's version. Six labels share the width of a phone, so the
  // qualifier goes and the noun stays: nothing else in the bar is an agent, so
  // "Voice" was never the load-bearing half.
  "nav.voiceShort": { tr: "Asistan", en: "Agent", de: "Assistent" },
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
    tr: "{name} bağlantısı kesilsin mi? Arama geçmişi Resepta'da kalır, ancak asistan artık bu işletmede görünmez.",
    en: "Disconnect {name}? Its call history stays in Resepta, but the agent will no longer appear for this business.",
    de: "{name} trennen? Der Anrufverlauf bleibt in Resepta, der Assistent wird für diesen Betrieb jedoch nicht mehr angezeigt.",
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
  "voiceDetail.persona": {
    tr: "Ajanın adı",
    en: "Agent name",
    de: "Name der Agentin",
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
  "voiceDetail.templateBehindHint": {
    tr: "Güncelleme ajanın yanıt hızını iyileştirir, takvime bakarken konuşmasını sağlar ve arama özetlerini kendi dilinizde yazdırır. Talimat metnine dokunmaz.",
    en: "Updating makes the agent answer faster, talk while it checks the calendar, and write call summaries in your language. Your instructions are not touched.",
    de: "Die Aktualisierung lässt den Agenten schneller antworten, beim Kalenderblick weitersprechen und Anrufzusammenfassungen in Ihrer Sprache schreiben. Ihre Anweisung bleibt unverändert.",
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
    tr: "Ajan güncellendi.",
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
  "voiceDetail.before": {
    tr: "Bilir",
    en: "Knows",
    de: "Weiß",
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
    tr: "Sorar",
    en: "Asks",
    de: "Fragt",
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
    tr: "Öğrenir",
    en: "Learns",
    de: "Lernt",
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
  "voiceDetail.discard": {
    tr: "Vazgeç",
    en: "Discard",
    de: "Verwerfen",
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
  // The explanation. It reads as a line above the composer, not inside it —
  // see contact.sessionClosedShort.
  // The WhatsApp tab shows on every org now, so the composer has to answer for
  // one with no number connected. Names the fix and where it lives — "not
  // configured" tells somebody a fact about the software; this tells them what
  // to go and do.
  "contact.waNotConnected": {
    tr: "WhatsApp numarası bağlı değil. Bağlamak için İşletme sekmesine gidin.",
    en: "No WhatsApp number connected. Connect one in the Business tab.",
    de: "Keine WhatsApp-Nummer verbunden. Im Tab \u201eBetrieb\u201c verbinden.",
  },
  "contact.waNotConnectedShort": {
    tr: "WhatsApp bağlı değil",
    en: "WhatsApp not connected",
    de: "WhatsApp nicht verbunden",
  },
  "contact.sessionClosed": {
    tr: "24 saatlik pencere kapalı. Müşteri yazana kadar yalnızca şablon mesajı gönderilebilir.",
    en: "The 24h window is closed. Only template messages until the customer writes.",
    de: "Das 24-Stunden-Fenster ist geschlossen. Bis der Kunde schreibt, sind nur Vorlagennachrichten möglich.",
  },
  // What the disabled box itself says. A placeholder has one line and no way to
  // scroll it, so the sentence above cannot live here: on a phone it clipped
  // mid-word and grew a scrollbar nobody could use.
  "contact.sessionClosedShort": {
    tr: "Pencere kapalı",
    en: "Window closed",
    de: "Fenster geschlossen",
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
  "fields.serviceKeys": {
    tr: "Hizmet anahtarları",
    en: "Service keys",
    de: "Leistungsschlüssel",
  },
  "fields.serviceKeysHint": {
    tr: "Sesli asistanın ve otomasyonların hizmetlere başvururken kullandığı sabit adresler. Hizmetin adı değişse de anahtarı değişmez, ona bağlı hiçbir şey kopmaz.",
    en: "Fixed addresses the voice agent and automations use to refer to services. Renaming a service keeps its key, so nothing pointing at it breaks.",
    de: "Feste Adressen, über die Sprachassistent und Automationen Leistungen ansprechen. Wird eine Leistung umbenannt, bleibt ihr Schlüssel erhalten – nichts, was darauf zeigt, geht kaputt.",
  },
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
  // Business → Knowledge (docs/chat-agent.md): the prose the chat agent
  // knows. The hint carries the one rule that keeps the card honest —
  // structured facts live in their own tables and are not repeated here.
  "knowledge.section": { tr: "Bilgi", en: "Knowledge", de: "Wissen" },
  "knowledge.title": {
    tr: "İşletme bilgisi",
    en: "Business knowledge",
    de: "Betriebswissen",
  },
  "knowledge.hint": {
    tr: "Sohbet asistanının işletmeniz hakkında bildikleri. Hizmetleri, fiyatları ve çalışma saatlerini buraya yazmayın — asistan onları zaten uygulamadan okur. Politikalar, otopark, sık sorulan sorular gibi serbest bilgiler buraya girer.",
    en: "What the chat assistant knows about your business. Don't repeat services, prices or opening hours — the assistant already reads those from the app. This is for policies, parking, frequent questions and anything else customers ask.",
    de: "Was der Chat-Assistent über Ihren Betrieb weiß. Leistungen, Preise und Öffnungszeiten gehören nicht hierher — die liest der Assistent bereits aus der App. Hier stehen Richtlinien, Parken, häufige Fragen und Ähnliches.",
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

  // The chat-agent takeover chip above the composer (docs/chat-agent.md §5).
  "agent.answering": {
    tr: "Asistan bu sohbeti yanıtlıyor",
    en: "The assistant is answering this chat",
    de: "Der Assistent beantwortet diesen Chat",
  },
  "agent.takeOver": { tr: "Devral", en: "Take over", de: "Übernehmen" },
  "agent.paused": {
    tr: "Asistan duraklatıldı — sohbet sizde",
    en: "Assistant paused — this chat is yours",
    de: "Assistent pausiert — dieser Chat gehört Ihnen",
  },
  "agent.handBack": {
    tr: "Asistana geri ver",
    en: "Hand back to assistant",
    de: "An den Assistenten zurückgeben",
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
  "common.error": {
    tr: "Bir şeyler ters gitti. Tekrar deneyin.",
    en: "Something went wrong. Try again.",
    de: "Etwas ist schiefgelaufen. Versuchen Sie es erneut.",
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
