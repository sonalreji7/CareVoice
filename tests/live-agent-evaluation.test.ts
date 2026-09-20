import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { extractUpdate, isSafeGroundedExtraction } from "@carevoice/core-engine/extraction";
import { fictionalCareUpdateEvaluationSet } from "./evaluation-dataset.js";

test("live OpenAI selector measures fictional V2 sentence IDs and tags", { skip: process.env.RUN_OPENAI_EVALS !== "1" }, async () => {
  const { config } = await import("dotenv");
  config({ path: path.resolve(".env.local") });
  let grounded = 0;
  let safeFallbacks = 0;
  let expectedTags = 0;
  let matchedTags = 0;
  for (const record of fictionalCareUpdateEvaluationSet) {
    const result = await extractUpdate(record.input);
    if (result.mode === "unavailable" || !result.extraction.handover_available) {
      assert.equal(result.extraction.handover_available, false, `${record.id}: fallback must not fabricate a handover`);
      safeFallbacks += 1;
      continue;
    }
    assert.equal(isSafeGroundedExtraction(record.input, result.extraction), true, `${record.id}: output must remain grounded`);
    grounded += 1;
    if (!result.extraction.handover_available || !("handover_version" in result.extraction)) continue;
    const actualTags = new Map(result.extraction.sentences.map((sentence) => [sentence.id, new Set<string>(sentence.tags)]));
    for (const expected of record.expected.selections) {
      expectedTags += expected.tags.length;
      for (const tag of expected.tags) if (actualTags.get(expected.source_sentence_id)?.has(tag)) matchedTags += 1;
    }
  }
  assert.equal(grounded + safeFallbacks, fictionalCareUpdateEvaluationSet.length);
  const coverage = expectedTags ? matchedTags / expectedTags : 1;
  console.info(`Live selector: ${grounded} grounded handovers, ${safeFallbacks} safe fallbacks, ${(coverage * 100).toFixed(1)}% expected-tag coverage (${matchedTags}/${expectedTags})`);
  assert.ok(grounded >= 20, "selector should produce grounded handovers for at least 20 fictional cases");
  assert.ok(coverage >= 0.5, "selector should retain at least half of the expected fictional source tags while staying grounded");
});
