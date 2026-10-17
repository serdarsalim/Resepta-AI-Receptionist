// Which language a customer wrote or spoke in (convex/lib/textLanguage.ts,
// P30). Run: node --test scripts/text-language.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { customerSpokenText, detectTextLanguage } from "../convex/lib/textLanguage.ts";

test("reads a typed reply in each language", () => {
  assert.equal(detectTextLanguage("Merhaba, yarın saat 3 müsait misiniz?"), "tr");
  assert.equal(detectTextLanguage("yarin gelebilir miyim"), "tr");
  assert.equal(detectTextLanguage("Hi, can I move my appointment to tomorrow?"), "en");
  assert.equal(detectTextLanguage("Hallo, ich kann morgen leider nicht kommen"), "de");
  assert.equal(detectTextLanguage("Grüße, schöne Straße"), "de");
});

test("says nothing when the words do not say enough", () => {
  for (const text of ["ok", "👍", "1", "iptal", "İPTAL", "ja", "", null, "10:30", "https://x.y/z ok"]) {
    assert.equal(detectTextLanguage(text), null, String(text));
  }
  // A script none of the three languages uses: no template exists for it.
  assert.equal(detectTextLanguage("مرحبا كيف حالك اليوم"), null);
  assert.equal(detectTextLanguage("Привет как дела"), null);
});

test("a close call between two languages is no answer", () => {
  assert.equal(detectTextLanguage("ja ok yes"), null);
});

test("takes only what the customer said on a call", () => {
  const turns = [
    { role: "agent", content: "Merhaba, Bella Salon, size nasıl yardımcı olabilirim?" },
    { role: "user", content: "Hi, I would like to book for tomorrow" },
  ];
  assert.equal(detectTextLanguage(customerSpokenText(turns, undefined)), "en");
  const plain = "Agent: Guten Tag, wie kann ich helfen?\nUser: Merhaba, randevumu iptal etmek istiyorum";
  assert.equal(detectTextLanguage(customerSpokenText(undefined, plain)), "tr");
  assert.equal(customerSpokenText(undefined, undefined), "");
});
