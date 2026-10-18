// The agent's first sentence and the two clocks (convex/lib/opener.ts, P34).
// Run: node --test scripts/opener.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseOpener,
  clockVariables,
  openerFallback,
  renderOpener,
  usesOpener,
  whenPhrase,
} from "../convex/lib/opener.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 18, 12, 0); // Sunday

test("says the gap the way a person would, in three languages", () => {
  assert.equal(whenPhrase(0, "en"), "earlier today");
  assert.equal(whenPhrase(1, "tr"), "dün");
  assert.equal(whenPhrase(1, "de"), "gestern");
  assert.equal(whenPhrase(3, "en", NOW, "UTC"), "on Thursday");
  assert.equal(whenPhrase(3, "tr", NOW, "UTC"), "Perşembe günü");
  assert.equal(whenPhrase(3, "de", NOW, "UTC"), "am Donnerstag");
  assert.equal(whenPhrase(10, "en"), "last week");
  // Six weeks is a month and a bit, never "a couple of weeks".
  assert.equal(whenPhrase(42, "en"), "about a month ago");
  assert.equal(whenPhrase(400, "tr"), "bir yıldan uzun süre önce");
  assert.equal(whenPhrase(-1, "en"), "");
});

test("fills tokens and drops a clause whose value is blank", () => {
  const template = "Hi {{customer_first_name}}, [[about your {{next_appointment}} visit, ]]we spoke {{when}}.";
  assert.equal(
    renderOpener(template, { customer_first_name: "Ayşe", next_appointment: "Monday", when: "yesterday" }),
    "Hi Ayşe, about your Monday visit, we spoke yesterday.",
  );
  assert.equal(
    renderOpener(template, { customer_first_name: "Ayşe", when: "yesterday" }),
    "Hi Ayşe, we spoke yesterday.",
  );
  // An unknown name never reads as itself, and the gap closes.
  assert.equal(renderOpener("Hi {{nobody}}, welcome.", {}), "Hi, welcome.");
});

test("the clocks exist only when something happened", () => {
  assert.deepEqual(clockVariables(null, "en", "UTC", NOW), {});
  const vars = clockVariables(
    { lastConversationAt: NOW - 2 * DAY, lastCallAttemptAt: NOW - 30 * 60_000 },
    "en",
    "UTC",
    NOW,
  );
  assert.equal(vars.days_since_last_call, "2");
  assert.equal(vars.when_we_spoke, "on Friday");
  assert.equal(vars.days_since_last_attempt, "0");
  assert.equal(vars.minutes_since_last_attempt, "30");
  assert.equal(vars.when_we_tried, "earlier today");
});

const openers = {
  cold: "I'm calling from {{business_name}} about your booking.",
  followUp: "we spoke {{when}}, just checking in.",
  missed: "I tried you {{when}}.",
  inbound: "thanks for calling {{business_name}}.",
};
const base = { business_name: "Bella" };

test("a conversation on record earns the follow-up", () => {
  const out = chooseOpener({
    direction: "outbound",
    openers,
    vars: { ...base, days_since_last_call: "1", when_we_spoke: "yesterday", days_since_last_attempt: "0" },
    language: "en",
  });
  assert.deepEqual(out, { kind: "followUp", text: "we spoke yesterday, just checking in." });
});

test("only attempts on record earn the missed opener, never 'we spoke'", () => {
  const out = chooseOpener({
    direction: "outbound",
    openers,
    vars: { ...base, days_since_last_attempt: "2", when_we_tried: "on Friday" },
    language: "en",
  });
  assert.deepEqual(out, { kind: "missed", text: "I tried you on Friday." });
});

test("a ring that comes in takes the inbound opener, history or not", () => {
  const out = chooseOpener({
    direction: "inbound",
    openers,
    vars: { ...base, days_since_last_call: "1", when_we_spoke: "yesterday" },
    language: "en",
  });
  assert.deepEqual(out, { kind: "inbound", text: "thanks for calling Bella." });
});

test("an empty choice falls to cold, then to the template's own greeting", () => {
  assert.equal(
    chooseOpener({ direction: "inbound", openers: { cold: openers.cold }, vars: base, language: "en" }).kind,
    "cold",
  );
  assert.deepEqual(
    chooseOpener({ direction: "outbound", openers: {}, vars: base, language: "tr", personaName: "Deniz" }),
    { kind: "default", text: "ben Deniz. Buyurun." },
  );
});

test("the provider's fallback carries no variables", () => {
  assert.equal(openerFallback(openers, "en"), "I'm calling from about your booking.");
  assert.equal(openerFallback({}, "de"), "guten Tag.");
  assert.equal(usesOpener("{{business_name}}, {{ opener }}"), true);
  assert.equal(usesOpener("{{business_name}}, buyurun."), false);
});
