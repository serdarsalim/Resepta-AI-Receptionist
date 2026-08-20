// What a new business starts with, per industry, in the org's language.
//
// The product's standing position is that verticalization is ORG DATA — the
// vertical's own vocabulary (plate number, hair type, insurance) lives in
// `services` and `contactFields` rows, never in a schema concept. This module
// does not change that: a preset is nothing but a starter set of those same
// rows, applied once at onboarding (convex/onboarding.ts) and re-applicable
// from Business settings behind a confirmation. After application the rows
// are the org's own; nothing ever syncs back to this file.
//
// PURE module, like templateTexts.ts: no Convex imports, so the onboarding
// wizard can read industry names and preview content in the browser without
// dragging server code into the bundle.
//
// Deliberately NO PRICES. A price is a claim about the business — a seeded
// ₺500 haircut in a shop charging ₺150 reads as the product lying — while a
// duration is a good-enough guess the owner corrects in seconds. Services
// arrive priced empty and the price list nudges the owner to fill them in
// (a service with no price shows duration alone on the booking page).
//
// Field KEYS are fixed here, not derived from the label: the key is the
// address agents and stored values are written against, and it must not
// depend on which language the org onboarded in.

export type IndustryKey =
  | "hair_salon"
  | "beauty_salon"
  | "dentist"
  | "clinic"
  | "law_firm"
  | "auto_service"
  | "restaurant"
  | "other";

export type PresetLanguage = "tr" | "en" | "de";

export const INDUSTRY_KEYS: IndustryKey[] = [
  "hair_salon",
  "beauty_salon",
  "dentist",
  "clinic",
  "law_firm",
  "auto_service",
  "restaurant",
  "other",
];

type Localised = Record<PresetLanguage, string>;

export type PresetService = {
  name: Localised;
  durationMinutes: number;
};

export type PresetField = {
  key: string;
  label: Localised;
  type: "text" | "select" | "number" | "date";
  options?: Record<PresetLanguage, string[]>;
  // Every preset field is voice-sourced: the whole point of seeding it is
  // that the phone agent collects it. Staff can edit it regardless.
  source: "voice";
};

export type IndustryPreset = {
  name: Localised;
  services: PresetService[];
  fields: PresetField[];
};

const ALLERGIES: PresetField = {
  key: "allergies",
  label: {
    tr: "Alerji ve hassasiyetler",
    en: "Allergies and sensitivities",
    de: "Allergien und Empfindlichkeiten",
  },
  type: "text",
  source: "voice",
};

export const INDUSTRY_PRESETS: Record<IndustryKey, IndustryPreset> = {
  hair_salon: {
    name: { tr: "Kuaför / Berber", en: "Hair salon / Barber", de: "Friseur / Barbier" },
    services: [
      { name: { tr: "Saç kesimi", en: "Haircut", de: "Haarschnitt" }, durationMinutes: 45 },
      { name: { tr: "Fön", en: "Blow-dry", de: "Föhnen" }, durationMinutes: 30 },
      { name: { tr: "Saç boyama", en: "Hair colour", de: "Haare färben" }, durationMinutes: 120 },
      { name: { tr: "Röfle", en: "Highlights", de: "Strähnchen" }, durationMinutes: 150 },
      { name: { tr: "Sakal tıraşı", en: "Beard trim", de: "Bartschnitt" }, durationMinutes: 20 },
    ],
    fields: [
      {
        key: "hair_type",
        label: { tr: "Saç tipi", en: "Hair type", de: "Haartyp" },
        type: "select",
        options: {
          tr: ["Düz", "Dalgalı", "Kıvırcık"],
          en: ["Straight", "Wavy", "Curly"],
          de: ["Glatt", "Wellig", "Lockig"],
        },
        source: "voice",
      },
      ALLERGIES,
    ],
  },
  beauty_salon: {
    name: { tr: "Güzellik salonu", en: "Beauty salon", de: "Kosmetikstudio" },
    services: [
      { name: { tr: "Manikür", en: "Manicure", de: "Maniküre" }, durationMinutes: 45 },
      { name: { tr: "Pedikür", en: "Pedicure", de: "Pediküre" }, durationMinutes: 60 },
      { name: { tr: "Cilt bakımı", en: "Facial", de: "Gesichtsbehandlung" }, durationMinutes: 60 },
      { name: { tr: "Kaş alımı", en: "Eyebrow shaping", de: "Augenbrauen zupfen" }, durationMinutes: 15 },
      { name: { tr: "Ağda", en: "Waxing", de: "Waxing" }, durationMinutes: 30 },
    ],
    fields: [
      {
        key: "skin_type",
        label: { tr: "Cilt tipi", en: "Skin type", de: "Hauttyp" },
        type: "select",
        options: {
          tr: ["Normal", "Kuru", "Yağlı", "Karma", "Hassas"],
          en: ["Normal", "Dry", "Oily", "Combination", "Sensitive"],
          de: ["Normal", "Trocken", "Fettig", "Mischhaut", "Empfindlich"],
        },
        source: "voice",
      },
      ALLERGIES,
    ],
  },
  dentist: {
    name: { tr: "Diş kliniği", en: "Dental practice", de: "Zahnarztpraxis" },
    services: [
      { name: { tr: "Muayene", en: "Check-up", de: "Kontrolluntersuchung" }, durationMinutes: 30 },
      { name: { tr: "Diş temizliği", en: "Teeth cleaning", de: "Zahnreinigung" }, durationMinutes: 45 },
      { name: { tr: "Dolgu", en: "Filling", de: "Füllung" }, durationMinutes: 60 },
      { name: { tr: "Diş beyazlatma", en: "Whitening", de: "Bleaching" }, durationMinutes: 90 },
      { name: { tr: "Kanal tedavisi", en: "Root canal", de: "Wurzelbehandlung" }, durationMinutes: 90 },
    ],
    fields: [
      {
        key: "insurance",
        label: { tr: "Sigorta", en: "Insurance", de: "Versicherung" },
        type: "text",
        source: "voice",
      },
      ALLERGIES,
    ],
  },
  clinic: {
    name: { tr: "Klinik / Muayenehane", en: "Clinic / Practice", de: "Praxis" },
    services: [
      { name: { tr: "Muayene", en: "Consultation", de: "Sprechstunde" }, durationMinutes: 30 },
      { name: { tr: "Kontrol", en: "Follow-up", de: "Kontrolltermin" }, durationMinutes: 20 },
      { name: { tr: "Aşı", en: "Vaccination", de: "Impfung" }, durationMinutes: 15 },
      { name: { tr: "Check-up", en: "Check-up", de: "Check-up" }, durationMinutes: 60 },
    ],
    fields: [
      {
        key: "insurance",
        label: { tr: "Sigorta", en: "Insurance", de: "Versicherung" },
        type: "text",
        source: "voice",
      },
      {
        key: "date_of_birth",
        label: { tr: "Doğum tarihi", en: "Date of birth", de: "Geburtsdatum" },
        type: "date",
        source: "voice",
      },
      ALLERGIES,
    ],
  },
  law_firm: {
    name: { tr: "Hukuk bürosu", en: "Law firm", de: "Kanzlei" },
    services: [
      { name: { tr: "İlk görüşme", en: "Initial consultation", de: "Erstberatung" }, durationMinutes: 60 },
      { name: { tr: "Danışmanlık", en: "Consultation", de: "Beratung" }, durationMinutes: 60 },
      { name: { tr: "Sözleşme incelemesi", en: "Contract review", de: "Vertragsprüfung" }, durationMinutes: 60 },
    ],
    fields: [
      {
        key: "matter_type",
        label: { tr: "Dosya türü", en: "Matter type", de: "Rechtsgebiet" },
        type: "select",
        options: {
          tr: ["Aile", "Ceza", "Ticaret", "İş", "Gayrimenkul", "Diğer"],
          en: ["Family", "Criminal", "Commercial", "Employment", "Real estate", "Other"],
          de: ["Familienrecht", "Strafrecht", "Handelsrecht", "Arbeitsrecht", "Immobilienrecht", "Sonstiges"],
        },
        source: "voice",
      },
      {
        key: "company",
        label: { tr: "Şirket", en: "Company", de: "Firma" },
        type: "text",
        source: "voice",
      },
    ],
  },
  auto_service: {
    name: { tr: "Oto servis", en: "Auto service", de: "Kfz-Werkstatt" },
    services: [
      { name: { tr: "Periyodik bakım", en: "Scheduled service", de: "Inspektion" }, durationMinutes: 120 },
      { name: { tr: "Yağ değişimi", en: "Oil change", de: "Ölwechsel" }, durationMinutes: 45 },
      { name: { tr: "Lastik değişimi", en: "Tyre change", de: "Reifenwechsel" }, durationMinutes: 60 },
      { name: { tr: "Ekspertiz", en: "Vehicle inspection", de: "Fahrzeugprüfung" }, durationMinutes: 60 },
    ],
    fields: [
      {
        key: "plate_number",
        label: { tr: "Plaka", en: "Plate number", de: "Kennzeichen" },
        type: "text",
        source: "voice",
      },
      {
        key: "car_model",
        label: { tr: "Araç modeli", en: "Car model", de: "Fahrzeugmodell" },
        type: "text",
        source: "voice",
      },
    ],
  },
  restaurant: {
    name: { tr: "Restoran", en: "Restaurant", de: "Restaurant" },
    services: [
      { name: { tr: "Masa rezervasyonu", en: "Table reservation", de: "Tischreservierung" }, durationMinutes: 90 },
      { name: { tr: "Grup rezervasyonu", en: "Group reservation", de: "Gruppenreservierung" }, durationMinutes: 120 },
      { name: { tr: "Özel etkinlik", en: "Private event", de: "Private Veranstaltung" }, durationMinutes: 180 },
    ],
    fields: [
      {
        key: "party_size",
        label: { tr: "Kişi sayısı", en: "Party size", de: "Personenzahl" },
        type: "number",
        source: "voice",
      },
      ALLERGIES,
    ],
  },
  // "Other" exists so the wizard's industry question always has an honest
  // answer. It seeds nothing: an industry we cannot name is an industry we
  // cannot guess services for.
  other: {
    name: { tr: "Diğer", en: "Other", de: "Andere" },
    services: [],
    fields: [],
  },
};

export function isIndustryKey(raw: string): raw is IndustryKey {
  return (INDUSTRY_KEYS as string[]).includes(raw);
}

// The org's message language folded onto a preset language; anything unknown
// reads English, matching the app's own fallback direction.
export function presetLanguage(raw: string | undefined | null): PresetLanguage {
  const key = (raw ?? "").toLowerCase().slice(0, 2);
  return key === "tr" ? "tr" : key === "de" ? "de" : "en";
}
