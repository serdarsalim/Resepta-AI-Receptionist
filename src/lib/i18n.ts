// UI translations. A typed dictionary, deliberately not next-intl: this is a
// logged-in app with no locale-prefixed routes and no SEO surface, so the
// routing/SEO machinery would be dead weight. Adding a language = adding a
// column here. If a PUBLIC booking page ever ships, that page can adopt
// next-intl on its own without touching this.
//
// The active language comes from the signed-in org (orgs.language); the
// sign-in screen reads a browser/localStorage preference since no org exists
// yet.

export const LANGUAGES = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: Language = "tr";
export const LANGUAGE_STORAGE_KEY = "randevu.lang";

const dictionary = {
  "app.name": { tr: "Randevu", en: "Randevu" },
  "app.tagline": {
    tr: "WhatsApp randevu hatırlatmaları",
    en: "WhatsApp appointment reminders",
  },

  "menu.appearance": { tr: "Görünüm", en: "Appearance" },
  "theme.light": { tr: "Açık", en: "Light" },
  "theme.dark": { tr: "Koyu", en: "Dark" },
  "theme.auto": { tr: "Otomatik", en: "Auto" },

  "nav.today": { tr: "Bugün", en: "Today" },
  "nav.appointments": { tr: "Randevular", en: "Appointments" },
  "nav.customers": { tr: "Müşteriler", en: "Customers" },
  "nav.inbox": { tr: "Gelen Kutusu", en: "Inbox" },
  "nav.collapse": { tr: "Menüyü daralt", en: "Collapse sidebar" },
  "nav.expand": { tr: "Menüyü genişlet", en: "Expand sidebar" },
  "nav.settings": { tr: "Ayarlar", en: "Settings" },
  "nav.signOut": { tr: "Çıkış", en: "Sign out" },

  "auth.continueWithGoogle": {
    tr: "Google ile devam et",
    en: "Continue with Google",
  },
  "auth.googleHint": {
    tr: "İlk girişte işletmeniz otomatik oluşturulur.",
    en: "Your business is created on first sign-in.",
  },
  "auth.failed": {
    tr: "Giriş başarısız. Tekrar deneyin.",
    en: "Sign-in failed. Try again.",
  },

  "onboarding.title": { tr: "Hoş geldiniz!", en: "Welcome!" },
  "onboarding.prompt": {
    tr: "İşletmenizin adı ne? Müşterilerinize giden mesajlarda görünecek.",
    en: "What's your business called? It appears in messages to your customers.",
  },
  "onboarding.businessName": { tr: "İşletme adı", en: "Business name" },
  "onboarding.start": { tr: "Başla", en: "Get started" },

  "appointments.title": { tr: "Randevular", en: "Appointments" },
  "appointments.new": { tr: "Yeni randevu", en: "New appointment" },
  "appointments.none": { tr: "Randevu yok", en: "No appointments" },
  "appointments.customer": { tr: "Müşteri", en: "Customer" },
  "appointments.when": { tr: "Tarih", en: "When" },
  "appointments.service": { tr: "Hizmet", en: "Service" },
  "appointments.staff": { tr: "Personel", en: "Staff" },
  "appointments.status": { tr: "Durum", en: "Status" },
  "appointments.notes": { tr: "Not", en: "Notes" },
  "appointments.source": { tr: "Kaynak", en: "Source" },
  "appointments.cancel": { tr: "Randevuyu iptal et", en: "Cancel appointment" },
  "appointments.complete": {
    tr: "Tamamlandı olarak işaretle",
    en: "Mark as completed",
  },
  "appointments.noShow": {
    tr: "Gelmedi olarak işaretle",
    en: "Mark as no-show",
  },
  "appointments.reopen": { tr: "Yeniden planla", en: "Reopen" },
  "appointments.list": { tr: "Liste", en: "List" },
  "appointments.day": { tr: "Gün", en: "Day" },
  "appointments.week": { tr: "Hafta", en: "Week" },
  "appointments.today": { tr: "Bugün", en: "Today" },
  "appointments.previous": { tr: "Önceki", en: "Previous" },
  "appointments.next": { tr: "Sonraki", en: "Next" },

  "status.scheduled": { tr: "Planlandı", en: "Scheduled" },
  "status.confirmed": { tr: "Onaylandı", en: "Confirmed" },
  "status.cancelled": { tr: "İptal", en: "Cancelled" },
  "status.completed": { tr: "Tamamlandı", en: "Completed" },
  "status.no_show": { tr: "Gelmedi", en: "No-show" },

  "customers.title": { tr: "Müşteriler", en: "Customers" },
  "customers.new": { tr: "Yeni müşteri", en: "New customer" },
  "customers.none": { tr: "Müşteri yok", en: "No customers" },
  "customers.firstName": { tr: "Ad", en: "First name" },
  "customers.lastName": { tr: "Soyad", en: "Last name" },
  "customers.phone": { tr: "Telefon", en: "Phone" },
  "customers.email": { tr: "E-posta", en: "Email" },
  "customers.consent": {
    tr: "İletişim izni (KVKK)",
    en: "Messaging consent (KVKK)",
  },
  "customers.consentHint": {
    tr: "Müşterinin WhatsApp ve e-posta mesajlarına onayı. İzin kaydı olmadan hiçbir kanaldan mesaj gönderilmez.",
    en: "The customer's consent to WhatsApp and email messages. Without it, no channel sends anything.",
  },
  "customers.noConsent": { tr: "İzin yok", en: "No consent" },

  "messages.none": { tr: "Henüz mesaj yok", en: "No messages yet" },

  "settings.title": { tr: "Ayarlar", en: "Settings" },
  // Settings section chips. The rest reuse their card titles (Reminders,
  // WhatsApp, Bookings, Voice agent) so a chip and its card never disagree.
  "settings.section.workspace": { tr: "Çalışma alanı", en: "Workspace setup" },
  "settings.business": { tr: "İşletme", en: "Business" },
  "settings.businessName": { tr: "İşletme adı", en: "Business name" },
  "settings.timezone": { tr: "Saat dilimi", en: "Timezone" },
  "settings.language": { tr: "Dil", en: "Language" },
  "settings.reminders": { tr: "Hatırlatmalar", en: "Reminders" },
  "settings.reminderOffsets": {
    tr: "Hatırlatma zamanları",
    en: "Reminder times",
  },
  "settings.reminderOffsetsHint": {
    tr: "Her seçili zaman için ayrı bir hatırlatma mesajı gönderilir.",
    en: "One reminder message is sent for each selected time.",
  },
  "settings.sendConfirmation": {
    tr: "Randevu alındığında onay mesajı gönder",
    en: "Send a confirmation when a booking is made",
  },
  "settings.emailFrom": { tr: "E-posta gönderen adresi", en: "Email from address" },
  "settings.emailFromHint": {
    tr: "Doluysa onay ve hatırlatmalar e-posta adresi olan müşterilere e-postayla da gider (n8n üzerinden).",
    en: "When set, confirmations and reminders also go by email to customers with an address (via n8n).",
  },
  "settings.whatsapp": { tr: "WhatsApp", en: "WhatsApp" },
  "settings.waConnected": { tr: "Bağlı", en: "Connected" },
  "settings.waNotConnected": { tr: "Bağlı değil", en: "Not connected" },
  "settings.waPhoneNumberId": { tr: "Telefon numarası ID", en: "Phone number ID" },
  "settings.waToken": { tr: "Erişim anahtarı", en: "Access token" },
  "settings.waConnect": { tr: "Bağla", en: "Connect" },
  "settings.waDisconnect": { tr: "Bağlantıyı kes", en: "Disconnect" },
  "settings.templates": { tr: "Mesaj şablonları", en: "Message templates" },
  "settings.templatesHint": {
    tr: "Şablonlar Meta tarafından onaylanmalıdır. Onaylanan şablon adını buraya yazın.",
    en: "Templates must be approved by Meta. Enter the approved template name here.",
  },
  "settings.templateName": { tr: "Şablon adı", en: "Template name" },
  "settings.templateStatus": { tr: "Durum", en: "Status" },
  // Meta's approval states, in the reader's language. The stored value stays
  // the English slug.
  "template.draft": { tr: "Taslak", en: "Draft" },
  "template.pending": { tr: "Onay bekliyor", en: "Pending" },
  "template.approved": { tr: "Onaylandı", en: "Approved" },
  "template.rejected": { tr: "Reddedildi", en: "Rejected" },
  // Channels — one conversation, three lanes. Labels are the accessible names
  // behind the icon-only controls in the inbox.
  "channel.whatsapp": { tr: "WhatsApp", en: "WhatsApp" },
  "channel.email": { tr: "E-posta", en: "Email" },
  "channel.call": { tr: "Arama", en: "Call" },

  "inbox.all": { tr: "Tümü", en: "All" },
  "inbox.empty": {
    tr: "Henüz konuşma yok. Bir müşteri yazdığında ya da aradığında burada görünür.",
    en: "No conversations yet. When a customer writes or calls, it lands here.",
  },
  "inbox.needsReply": { tr: "Yanıt bekliyor", en: "Needs reply" },
  "inbox.failedSend": { tr: "Gönderilemedi", en: "Failed to send" },
  "inbox.openContact": { tr: "Müşteriyi aç", en: "Open contact" },

  "calls.inbound": { tr: "Gelen arama", en: "Inbound call" },
  "calls.outbound": { tr: "Giden arama", en: "Outbound call" },
  "calls.none": { tr: "Henüz arama yok", en: "No calls yet" },
  "calls.transcript": { tr: "Konuşma dökümü", en: "Transcript" },
  "calls.recording": { tr: "Kayıt", en: "Recording" },

  "settings.voice": { tr: "Sesli asistan", en: "Voice agent" },
  "settings.voiceEndpoints": { tr: "Webhook adresleri", en: "Webhook URLs" },
  "settings.voiceHint": {
    tr: "Retell agent'ınız salonun telefonunu yanıtlar ve randevu alır. Fonksiyon adresi ve arama-sonu webhook'unu Retell panosunda bu URL'lere yönlendirin.",
    en: "Your Retell agent answers the salon's phone and books appointments. Point the function URL and call-ended webhook at these endpoints in the Retell dashboard.",
  },
  "settings.retellAgentId": { tr: "Retell agent ID", en: "Retell agent ID" },
  "settings.inboundNumber": { tr: "Gelen arama numarası", en: "Inbound number" },
  "settings.transferNumber": { tr: "Aktarma numarası", en: "Transfer number" },
  "settings.voiceEnabled": { tr: "Etkin", en: "Enabled" },
  "settings.calcomApiKey": { tr: "cal.com API anahtarı", en: "cal.com API key" },
  "settings.calcomEventType": { tr: "cal.com event type ID", en: "cal.com event type ID" },

  "settings.bookings": { tr: "Rezervasyonlar", en: "Bookings" },
  "settings.calcomWebhook": { tr: "Webhook adresi", en: "Webhook URL" },
  "settings.calcomHint": {
    tr: "Bu adresi cal.com webhook ayarlarına yapıştırın (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED).",
    en: "Paste this URL into your cal.com webhook settings (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED).",
  },
  "settings.calcomGenerate": { tr: "Adres oluştur", en: "Generate URL" },
  "settings.calcomRotate": { tr: "Yenile", en: "Rotate" },

  "contact.typeMessage": { tr: "Mesaj yazın…", en: "Type a message…" },
  "contact.send": { tr: "Gönder", en: "Send" },
  "contact.sessionClosed": {
    tr: "24 saatlik pencere kapalı. Müşteri yazana kadar yalnızca şablon mesajı gönderilebilir.",
    en: "The 24h window is closed. Only template messages until the customer writes.",
  },

  "fields.title": { tr: "Kişi alanları", en: "Contact fields" },
  "fields.hint": {
    tr: "İşletmenize özel müşteri alanları (örn. saç tipi, alerji notu). Kişi sayfasının sol panelinde görünür.",
    en: "Customer fields specific to your business (e.g. hair type, allergy note). Shown on the contact page's left pane.",
  },
  "fields.add": { tr: "Alan ekle", en: "Add field" },
  "fields.label": { tr: "Etiket", en: "Label" },
  "fields.typeLabel": { tr: "Tür", en: "Type" },
  "fields.type.text": { tr: "Metin", en: "Text" },
  "fields.type.select": { tr: "Seçim", en: "Select" },
  "fields.type.number": { tr: "Sayı", en: "Number" },
  "fields.type.date": { tr: "Tarih", en: "Date" },
  "fields.options": { tr: "Seçenekler (virgülle)", en: "Options (comma-separated)" },

  "workspace.switch": { tr: "İşletme değiştir", en: "Switch business" },

  "team.title": { tr: "Ekip", en: "Team" },
  "team.inviteHint": {
    tr: "Davet edilen kişi bu e-posta adresiyle Google üzerinden giriş yaptığında ekibinize katılır. E-posta gönderilmez, adresi siz iletin.",
    en: "The invitee joins your team when they sign in with Google using this email. No email is sent, so share the address yourself.",
  },
  "team.invite": { tr: "Davet et", en: "Invite" },
  "team.pending": { tr: "Bekleyen davetler", en: "Pending invites" },
  "team.revoke": { tr: "İptal et", en: "Revoke" },
  "team.you": { tr: "siz", en: "you" },
  "role.owner": { tr: "Sahip", en: "Owner" },
  "role.staff": { tr: "Personel", en: "Staff" },
  "settings.ownerOnly": {
    tr: "Bu ayarları yalnızca işletme sahibi değiştirebilir.",
    en: "Only the business owner can change these settings.",
  },

  "common.save": { tr: "Kaydet", en: "Save" },
  "common.saving": { tr: "Kaydediliyor…", en: "Saving…" },
  "common.saved": { tr: "Kaydedildi", en: "Saved" },
  "common.add": { tr: "Ekle", en: "Add" },
  "common.cancel": { tr: "Vazgeç", en: "Cancel" },
  "common.delete": { tr: "Sil", en: "Delete" },
  "common.copy": { tr: "Kopyala", en: "Copy" },
  "common.copied": { tr: "Kopyalandı", en: "Copied" },
  "common.loading": { tr: "Yükleniyor…", en: "Loading…" },
  "common.back": { tr: "Geri", en: "Back" },
  "common.optional": { tr: "isteğe bağlı", en: "optional" },
} as const;

export type TranslationKey = keyof typeof dictionary;

export function translate(language: Language, key: TranslationKey): string {
  const entry = dictionary[key];
  return entry[language] ?? entry[DEFAULT_LANGUAGE];
}

export function isLanguage(value: string | null | undefined): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}
