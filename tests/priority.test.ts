import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePriority } from "@carevoice/core-engine/priority";

test("requests priority only for configured deterministic rules", () => {
  assert.deepEqual(evaluatePriority({ authorRole: "patient", caregiverRequestedCallback: false, message: "This feels urgent." }), []);
  assert.deepEqual(evaluatePriority({ authorRole: "patient", caregiverRequestedCallback: true, message: "Please call." }), []);
  assert.deepEqual(evaluatePriority({ authorRole: "patient", caregiverRequestedCallback: false, message: "They are not unable to continue normal daily care." }), []);
  assert.deepEqual(evaluatePriority({ authorRole: "caregiver", caregiverRequestedCallback: true, message: "Please call." }), ["Caregiver explicitly requested a priority callback."]);
  assert.deepEqual(evaluatePriority({ authorRole: "patient", caregiverRequestedCallback: false, message: "Normal daily care cannot continue." }), ["Clinician-owned deterministic rule: normal daily care cannot continue."]);
});
