import assert from "node:assert/strict";
import test from "node:test";
import { bloodPressureReference } from "@carevoice/core-engine/blood-pressure";

test("blood-pressure flags use fixed adult reference ranges without diagnoses", () => {
  assert.equal(bloodPressureReference(118, 76)?.label, "Within general adult reference range");
  assert.equal(bloodPressureReference(124, 78)?.label, "Elevated general adult reference range");
  assert.equal(bloodPressureReference(134, 84)?.label, "High reference range — stage 1 category");
  assert.equal(bloodPressureReference(144, 92)?.label, "High reference range — stage 2 category");
  assert.equal(bloodPressureReference(88, 58)?.label, "Below general adult reference");
  assert.equal(bloodPressureReference(182, 121)?.urgency, "urgent");
  assert.equal(bloodPressureReference(120, null), null);
});
