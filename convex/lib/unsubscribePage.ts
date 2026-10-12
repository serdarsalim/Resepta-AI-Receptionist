// The page behind "Unsubscribe" in a marketing mail (convex/http.ts, /e/u/).
// Plain HTML from the deployment's own site, in the customer's language
// (customers.language, else the business's), because the person reading it
// is a business's customer with no account and no reason to load an app.
//
// Two steps, Nudge's shape: the GET (what link scanners and mail previews
// follow) only asks; the button's POST, or the mail client's one-click POST,
// is what unsubscribes. The page names the one business the token resolves
// to and nobody else: every business sends from the same domain, so the page
// must never be a way to learn about another one. An unknown token gets a
// page that names no business at all.

export type UnsubscribePageState = "confirm" | "done" | "unknown";

type Copy = {
  pageTitle: string;
  confirmTitle: string;
  confirmBody: (business: string) => string;
  button: string;
  doneTitle: string;
  doneBody: (business: string) => string;
  unknownTitle: string;
  unknownBody: string;
  // What stands in for a business that has no name yet.
  someBusiness: string;
};

const COPY: Record<"tr" | "en" | "de", Copy> = {
  tr: {
    pageTitle: "E-posta tercihleri",
    confirmTitle: "Abonelikten çıkmak istiyor musunuz?",
    confirmBody: (b) =>
      `${b} size kampanya ve tanıtım e-postası göndermeyi bırakacak. Randevu onayları ve hatırlatmalar gelmeye devam eder.`,
    button: "Abonelikten çık",
    doneTitle: "Abonelikten çıktınız",
    doneBody: (b) =>
      `${b} size artık kampanya ve tanıtım e-postası göndermeyecek. Randevu onayları ve hatırlatmalar gelmeye devam eder.`,
    unknownTitle: "Bu bağlantı artık çalışmıyor",
    unknownBody:
      "Bu e-postaları almak istemiyorsanız birini yanıtlayıp işletmeye doğrudan yazabilirsiniz.",
    someBusiness: "İşletme",
  },
  en: {
    pageTitle: "Email preferences",
    confirmTitle: "Unsubscribe from marketing email?",
    confirmBody: (b) =>
      `${b} will stop sending you campaign and promotional email. Appointment confirmations and reminders still arrive.`,
    button: "Unsubscribe",
    doneTitle: "You're unsubscribed",
    doneBody: (b) =>
      `${b} won't send you campaign or promotional email any more. Appointment confirmations and reminders still arrive.`,
    unknownTitle: "This link no longer works",
    unknownBody: "To stop these emails, reply to one of them and ask the business directly.",
    someBusiness: "The business",
  },
  de: {
    pageTitle: "E-Mail-Einstellungen",
    confirmTitle: "Werbe-E-Mails abbestellen?",
    confirmBody: (b) =>
      `${b} schickt Ihnen dann keine Kampagnen- und Werbe-E-Mails mehr. Terminbestätigungen und Erinnerungen kommen weiterhin.`,
    button: "Abmelden",
    doneTitle: "Sie sind abgemeldet",
    doneBody: (b) =>
      `${b} schickt Ihnen keine Kampagnen- und Werbe-E-Mails mehr. Terminbestätigungen und Erinnerungen kommen weiterhin.`,
    unknownTitle: "Dieser Link funktioniert nicht mehr",
    unknownBody:
      "Um diese E-Mails abzubestellen, antworten Sie auf eine davon und schreiben Sie dem Betrieb direkt.",
    someBusiness: "Der Betrieb",
  },
};

function pick(language: string | undefined): "tr" | "en" | "de" {
  const lang = (language ?? "").trim().toLowerCase().slice(0, 2);
  return lang === "en" || lang === "de" || lang === "tr" ? lang : "tr";
}

// For a token that resolves to nobody: the visitor's own browser language,
// first of tr/en/de it names, else Turkish, the product's default.
export function languageFromAcceptHeader(header: string | null): string {
  for (const part of (header ?? "").split(",")) {
    const lang = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (lang === "tr" || lang === "en" || lang === "de") return lang;
  }
  return "tr";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function unsubscribePage(args: {
  state: UnsubscribePageState;
  language: string | undefined;
  // The business the token resolved to. Absent for an unknown token.
  business?: string;
  // The POST target for the confirm state's button: this same path.
  action?: string;
}): string {
  const lang = pick(args.language);
  const copy = COPY[lang];
  const business = escapeHtml(args.business?.trim() || copy.someBusiness);
  const body =
    args.state === "confirm"
      ? `<h1>${copy.confirmTitle}</h1><p>${copy.confirmBody(business)}</p>` +
        `<form method="POST" action="${escapeHtml(args.action ?? "")}"><button type="submit">${copy.button}</button></form>`
      : args.state === "done"
        ? `<h1>${copy.doneTitle}</h1><p>${copy.doneBody(business)}</p>`
        : `<h1>${copy.unknownTitle}</h1><p>${copy.unknownBody}</p>`;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${copy.pageTitle}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f4;color:#1c1917;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px;box-sizing:border-box}
main{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px 28px;max-width:26rem;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#57534e;margin:0 0 20px;line-height:1.5}p:last-child{margin-bottom:0}
button{background:#1c1917;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:14px;cursor:pointer}</style>
</head><body><main>${body}</main></body></html>`;
}
