import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.RUN_SUPABASE_INTEGRATION_TESTS === "1";

function required(name: string) {
  const value = process.env[name];
  assert.ok(value, `${name} is required when RUN_SUPABASE_INTEGRATION_TESTS=1`);
  return value;
}

async function sessionFor(url: string, key: string, email: string, password: string) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.ok(data.session, `No session for ${email}`);
  return { client, token: data.session.access_token };
}

test("dedicated fictional Supabase environment enforces visibility and clinician-only feedback", { skip: !enabled }, async () => {
  const url = required("SUPABASE_TEST_URL");
  const key = required("SUPABASE_TEST_ANON_KEY");
  const api = required("CAREVOICE_TEST_API_URL");
  const updateId = required("CAREVOICE_TEST_UPDATE_ID");
  const patient = await sessionFor(url, key, required("CAREVOICE_TEST_PATIENT_EMAIL"), required("CAREVOICE_TEST_PATIENT_PASSWORD"));
  const caregiver = await sessionFor(url, key, required("CAREVOICE_TEST_CAREGIVER_EMAIL"), required("CAREVOICE_TEST_CAREGIVER_PASSWORD"));
  const clinician = await sessionFor(url, key, required("CAREVOICE_TEST_CLINICIAN_EMAIL"), required("CAREVOICE_TEST_CLINICIAN_PASSWORD"));
  const outsider = await sessionFor(url, key, required("CAREVOICE_TEST_OUTSIDER_CAREGIVER_EMAIL"), required("CAREVOICE_TEST_OUTSIDER_CAREGIVER_PASSWORD"));

  for (const identity of [patient, caregiver, clinician]) {
    const { data, error } = await identity.client.from("care_updates").select("id, agent_summary, status, priority_reasons").eq("id", updateId);
    assert.ifError(error);
    assert.equal(data?.length, 1, "assigned role should see the fictional test update");
  }
  const before = await clinician.client.from("care_updates").select("agent_summary, status, priority_reasons").eq("id", updateId).single();
  assert.ifError(before.error);

  const denied = await fetch(`${api}/api/care-updates/${updateId}/handover-feedback`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${outsider.token}` }, body: JSON.stringify({ outcome: "useful_as_is" }),
  });
  assert.equal(denied.status, 403, "unassigned caregiver must not record feedback");

  const accepted = await fetch(`${api}/api/care-updates/${updateId}/handover-feedback`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${clinician.token}` }, body: JSON.stringify({ outcome: "useful_as_is", note: "Fictional integration check" }),
  });
  assert.equal(accepted.status, 201, "assigned clinician should record feedback");

  const after = await clinician.client.from("care_updates").select("agent_summary, status, priority_reasons").eq("id", updateId).single();
  assert.ifError(after.error);
  assert.deepEqual(after.data, before.data, "feedback must not alter the care update");
});
