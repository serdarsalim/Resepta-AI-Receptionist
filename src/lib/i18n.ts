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

  "nav.today": { tr: "Bugün", en: "Today" },
  "nav.appointments": { tr: "Randevular", en: "Appointments" },
  "nav.customers": { tr: "Müşteriler", en: "Customers" },
  "nav.messages": { tr: "Mesajlar", en: "Messages" },
  "nav.settings": { tr: "Ayarlar", en: "Settings" },
  "nav.signOut": { tr: "Çıkış", en: "Sign out" },

  "auth.signIn": { tr: "Giriş yap", en: "Sign in" },
  "auth.signUp": { tr: "Kayıt ol", en: "Create account" },
  "auth.email": { tr: "E-posta", en: "Email" },
  "auth.password": { tr: "Şifre", en: "Password" },
  "auth.yourName": { tr: "Adınız", en: "Your name" },
  "auth.businessName": { tr: "İşletme adı", en: "Business name" },
  "auth.haveAccount": { tr: "Hesabınız var mı? Giriş yapın", en: "Have an account? Sign in" },
  "auth.noAccount": { tr: "Hesabınız yok mu? Kayıt olun", en: "No account? Sign up" },
  "auth.failed": {
    tr: "Giriş başarısız. Bilgilerinizi kontrol edin.",
    en: "Sign-in failed. Check your details.",
  },

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
