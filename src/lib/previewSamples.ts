// The invented booking every preview renders (Serdar, 2026-08-28: fake
// names over labelled slots, "so we see how it'll look like for sure").
// One stable pretend customer per language, formats mirroring what the send
// path really produces: dates as lib/format writes them, the price list with
// the appended price. Shared by the fleet desk and the salon's rule editors
// so the two products preview the same person.
//
// `real` carries the facts that are true no matter who reads the message —
// the org's own name, phone, booking link — and wins over the sample
// whenever the caller knows them.

import type { TokenValues } from "../../convex/lib/renderTokens";

const SAMPLES: Record<string, TokenValues> = {
  tr: {
    firstName: "Ayşe",
    businessName: "Bella Kuaför",
    appointmentAt: "3 Eylül Çarşamba 14:00",
    staffName: "Elif",
    serviceName: "• Saç kesimi",
    servicePriceList: "• Saç kesimi — ₺350,00",
    price: "₺350,00",
    manageLink: "https://resepta.app/r/x7k2",
    bookingLink: "https://resepta.app/b/bella",
    phone: "+90 212 555 34 12",
    email: "merhaba@bellakuafor.com",
  },
  en: {
    firstName: "Emma",
    businessName: "Bella Salon",
    appointmentAt: "Wednesday, 3 September, 2:00 PM",
    staffName: "Sophie",
    serviceName: "• Haircut",
    servicePriceList: "• Haircut — €35.00",
    price: "€35.00",
    manageLink: "https://resepta.app/r/x7k2",
    bookingLink: "https://resepta.app/b/bella",
    phone: "+353 1 555 0134",
    email: "hello@bellasalon.com",
  },
  de: {
    firstName: "Anna",
    businessName: "Salon Bella",
    appointmentAt: "Mittwoch, 3. September, 14:00",
    staffName: "Lena",
    serviceName: "• Haarschnitt",
    servicePriceList: "• Haarschnitt — 35,00 €",
    price: "35,00 €",
    manageLink: "https://resepta.app/r/x7k2",
    bookingLink: "https://resepta.app/b/bella",
    phone: "+43 1 555 01 34",
    email: "hallo@salonbella.at",
  },
};

export function previewSampleValues(
  language: string,
  real?: { businessName?: string; phone?: string; bookingLink?: string },
): TokenValues {
  const sample = SAMPLES[language] ?? SAMPLES.en;
  return {
    ...sample,
    ...(real?.businessName ? { businessName: real.businessName } : {}),
    ...(real?.phone ? { phone: real.phone } : {}),
    ...(real?.bookingLink ? { bookingLink: real.bookingLink } : {}),
  };
}
