// When a requested callback rings (convex/lib/callbackTime.ts, P36).
// Run: node --test scripts/callback-time.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALLBACK_HORIZON_MS,
  CALLBACK_MIN_LEAD_MS,
  judgeCallbackTime,
} from "../convex/lib/callbackTime.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 18, 12, 0);

// A business on UTC, open 09:00 to 18:00 every day.
const clock = {
  parse: (text) => Date.parse(`${text}Z`),
  openAt: (ms) => {
    const d = new Date(ms);
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (minutes < 9 * 60) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9);
    if (minutes >= 18 * 60) {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 9);
    }
    return ms;
  },
};

test("rings at the time they named when the business is open then", () => {
  const verdict = judgeCallbackTime("2026-10-19T16:00", NOW, clock);
  assert.deepEqual(verdict, {
    ok: true,
    askedFor: Date.UTC(2026, 9, 19, 16),
    dueAt: Date.UTC(2026, 9, 19, 16),
    moved: false,
  });
});

test("moves a time outside the hours to the next open minute, and says so", () => {
  const verdict = judgeCallbackTime("2026-10-19T20:00", NOW, clock);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.dueAt, Date.UTC(2026, 9, 20, 9));
  assert.equal(verdict.moved, true);
});

test("never rings the line straight back", () => {
  const verdict = judgeCallbackTime("2026-10-18T12:00", NOW, clock);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.dueAt, NOW + CALLBACK_MIN_LEAD_MS);
  // The lead is not a move: the business was open then.
  assert.equal(verdict.moved, false);
});

test("refuses what it cannot place", () => {
  assert.deepEqual(judgeCallbackTime("", NOW, clock), { ok: false, reason: "unreadable" });
  assert.deepEqual(judgeCallbackTime(undefined, NOW, clock), { ok: false, reason: "unreadable" });
  assert.deepEqual(judgeCallbackTime("later", NOW, clock), { ok: false, reason: "unreadable" });
  assert.deepEqual(judgeCallbackTime("2026-10-18T09:00", NOW, clock), { ok: false, reason: "past" });
  const far = new Date(NOW + CALLBACK_HORIZON_MS + HOUR).toISOString().slice(0, 16);
  assert.deepEqual(judgeCallbackTime(far, NOW, clock), { ok: false, reason: "too-far" });
  const closed = { ...clock, openAt: () => null };
  assert.deepEqual(judgeCallbackTime("2026-10-19T16:00", NOW, closed), {
    ok: false,
    reason: "no-opening",
  });
});

test("a model rounding 'in five minutes' down is still a request for now", () => {
  const verdict = judgeCallbackTime("2026-10-18T11:55", NOW, clock);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.dueAt, NOW + CALLBACK_MIN_LEAD_MS);
});
