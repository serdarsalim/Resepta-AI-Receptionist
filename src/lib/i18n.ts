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
  "nav.messages": { tr: "Mesajlar", en: "Messages" },
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
  "appointments.cancel": { tr: "İptal et", en: "Cancel" },
  "appointments.complete": { tr: "Tamamlandı", en: "Mark complete" },
  "appointments.noShow": { tr: "Gelmedi", en: "No-show" },

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
  "customers.consent": {
    tr: "WhatsApp mesajlarına izin verdi",
    en: "Consented to WhatsApp messages",
  },
  "customers.consentHint": {
    tr: "KVKK gereği izin olmadan mesaj gönderilmez.",
    en: "No messages are sent without recorded consent.",
  },
  "customers.noConsent": { tr: "İzin yok", en: "No consent" },

  "messages.title": { tr: "Mesajlar", en: "Messages" },
  "messages.none": { tr: "Henüz mesaj yok", en: "No messages yet" },
  "messages.out": { tr: "Giden", en: "Sent" },
  "messages.in": { tr: "Gelen", en: "Received" },

  "settings.title": { tr: "Ayarlar", en: "Settings" },
  "settings.business": { tr: "İşletme", en: "Business" },
  "settings.businessName": { tr: "İşletme adı", en: "Business name" },
  "settings.timezone": { tr: "Saat dilimi", en: "Timezone" },
  "settings.language": { tr: "Dil", en: "Language" },
  "settings.reminders": { tr: "Hatırlatmalar", en: "Reminders" },
  "settings.reminderOffsets": {
    tr: "Randevudan kaç saat önce",
    en: "Hours before appointment",
  },
  "settings.sendConfirmation": {
    tr: "Randevu alındığında onay mesajı gönder",
    en: "Send a confirmation when a booking is made",
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
  "settings.bookings": { tr: "Rezervasyonlar", en: "Bookings" },
  "settings.calcomHint": {
    tr: "Bu adresi cal.com webhook ayarlarına yapıştırın (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED).",
    en: "Paste this URL into your cal.com webhook settings (BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED).",
  },
  "settings.calcomGenerate": { tr: "Adres oluştur", en: "Generate URL" },
  "settings.calcomRotate": { tr: "Yenile", en: "Rotate" },

  "contact.typeMessage": { tr: "Mesaj yazın…", en: "Type a message…" },
  "contact.send": { tr: "Gönder", en: "Send" },
  "contact.sessionClosed": {
    tr: "24 saatlik pencere kapalı — müşteri yazana kadar yalnızca şablon mesajı gönderilebilir.",
    en: "The 24h window is closed — only template messages until the customer writes.",
  },

  "fields.title": { tr: "Kişi alanları", en: "Contact fields" },
  "fields.hint": {
    tr: "İşletmenize özel müşteri alanları (örn. saç tipi, alerji notu). Kişi sayfasının sol panelinde görünür.",
    en: "Customer fields specific to your business (e.g. hair type, allergy note). Shown on the contact page's left pane.",
  },
  "fields.add": { tr: "Alan ekle", en: "Add field" },
  "fields.label": { tr: "Etiket", en: "Label" },
  "fields.type.text": { tr: "Metin", en: "Text" },
  "fields.type.select": { tr: "Seçim", en: "Select" },
  "fields.type.number": { tr: "Sayı", en: "Number" },
  "fields.type.date": { tr: "Tarih", en: "Date" },
  "fields.options": { tr: "Seçenekler (virgülle)", en: "Options (comma-separated)" },

  "team.title": { tr: "Ekip", en: "Team" },
  "team.inviteHint": {
    tr: "Davet edilen kişi bu e-posta adresiyle Google üzerinden giriş yaptığında ekibinize katılır. E-posta gönderilmez — adresi siz iletin.",
    en: "The invitee joins your team when they sign in with Google using this email. No email is sent — share the address yourself.",
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
