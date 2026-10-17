// What a call came to, read from the provider's disconnect code
// (convex/lib/callOutcome.ts). Run: node --test scripts/call-outcome.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { callOutcome, reachedPhone } from "../convex/lib/callOutcome.ts";

test("reads the provider's codes before the duration", () => {
  assert.equal(callOutcome("voicemail_reached", 41), "voicemail");
  assert.equal(callOutcome("machine_detected", 12), "voicemail");
  assert.equal(callOutcome("dial_busy"), "busy");
  assert.equal(callOutcome("user_declined"), "declined");
  // An unanswered leg never starts, so it carries no duration at all: the
  // case that used to fall through to "Sent".
  assert.equal(callOutcome("dial_no_answer", undefined), "no-answer");
  assert.equal(callOutcome("user_hangup", 95), "answered");
  assert.equal(callOutcome("agent_hangup", undefined), "answered");
  assert.equal(callOutcome("inactivity", 600), "answered");
});

test("a call the network refused never reached the phone", () => {
  for (const code of [
    "telephony_provider_permission_denied",
    "telephony_provider_unavailable",
    "invalid_destination",
    "marked_as_spam",
    "concurrency_limit_reached",
  ]) {
    assert.equal(callOutcome(code), "refused", code);
    assert.equal(reachedPhone("refused"), false);
  }
  assert.equal(callOutcome("dial_failed"), "failed");
  assert.equal(callOutcome("error_llm_websocket_open", 3), "failed");
  assert.equal(reachedPhone("failed"), false);
  for (const outcome of ["answered", "voicemail", "busy", "declined", "no-answer"]) {
    assert.equal(reachedPhone(outcome), true, outcome);
  }
});

test("an unknown or missing code falls back to the duration", () => {
  assert.equal(callOutcome("some_new_code", 30), "answered");
  assert.equal(callOutcome(undefined, 0), "no-answer");
  assert.equal(callOutcome(null, 12), "answered");
  assert.equal(callOutcome(undefined, undefined), undefined);
  assert.equal(callOutcome("constructor", undefined), undefined);
  assert.equal(callOutcome("  Dial_Busy "), "busy");
});
