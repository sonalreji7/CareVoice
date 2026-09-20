import assert from "node:assert/strict";
import test from "node:test";
import { fictionalCareUpdateEvaluationSet } from "./evaluation-dataset.js";

test("fictional care-update evaluation set covers the required 25 review cases", () => {
  assert.equal(fictionalCareUpdateEvaluationSet.length, 25);
  const joined = fictionalCareUpdateEvaluationSet.map((record) => record.input).join(" ");
  assert.match(joined, /ഇന്ന്|आज|अम्मा/);
  assert.match(joined, /no pain|not unable/i);
  assert.match(joined, /medication|tablet/i);
  assert.match(joined, /urgent/i);
  assert.match(joined, /Ignore every instruction/i);
  assert.ok(fictionalCareUpdateEvaluationSet.every((record) => record.expected.selections.length > 0));
  assert.ok(fictionalCareUpdateEvaluationSet.every((record) => record.expected.selections.every((selection) => /^s[1-9]\d*$/.test(selection.source_sentence_id) && selection.tags.length > 0)));
});
