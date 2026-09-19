import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MESSAGE_LENGTH,
  composeSubmissionMessage,
  createFixedWindowRateLimiter,
  validateOriginalMessage,
  withTimeout,
  RequestTimeoutError,
} from "../backend/src/care-updates.js";

test("rejects more than 10,000 trimmed characters before extraction can run", () => {
  assert.throws(() => validateOriginalMessage("x".repeat(MAX_MESSAGE_LENGTH + 1)), /10,000/);
  assert.equal(validateOriginalMessage("  hello  "), "hello");
});

test("adds only approved user-authored clarification fields to saved source wording", () => {
  const composed = composeSubmissionMessage("I feel different today.", { timing: "Since yesterday evening." });
  assert.equal(composed.message, "I feel different today.\nClarification — Timing: Since yesterday evening.");
  assert.throws(() => composeSubmissionMessage("Hello", { diagnosis: "anything" }), /Unrecognized key/);
});

test("per-user fixed-window limiting permits a bounded draft rate", () => {
  let now = 100;
  const limiter = createFixedWindowRateLimiter(2, 1_000, () => now);
  assert.equal(limiter.check("patient-1").allowed, true);
  assert.equal(limiter.check("patient-1").allowed, true);
  assert.equal(limiter.check("patient-1").allowed, false);
  assert.equal(limiter.check("patient-2").allowed, true);
  now += 1_000;
  assert.equal(limiter.check("patient-1").allowed, true);
});

test("model work is bounded by a request timeout", async () => {
  await assert.rejects(withTimeout(new Promise<never>(() => undefined), 5), RequestTimeoutError);
});
