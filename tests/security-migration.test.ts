import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve("database/supabase/migrations/202609200009_server_owned_care_updates.sql");
const escalationMigrationPath = path.resolve("database/supabase/migrations/202609200012_caregiver_priority_escalation.sql");

test("secure-write migration removes browser writes and adds scoped review controls", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /revoke insert, update, delete on public\.care_updates from authenticated/i);
  assert.match(sql, /drop policy if exists "patients and caregivers create permitted updates"/i);
  assert.match(sql, /create table public\.clinician_patient_assignments/i);
  assert.match(sql, /create table public\.care_update_events/i);
  assert.match(sql, /current_update\.status = 'new' and p_next_status = 'acknowledged'/i);
  assert.match(sql, /current_update\.status = 'acknowledged' and p_next_status = 'closed'/i);
  assert.match(sql, /grant execute .* to service_role/i);
  assert.doesNotMatch(sql, /grant execute .* to authenticated/i);
});

test("caregiver escalation is explicit, auditable, and server-only", async () => {
  const sql = await readFile(escalationMigrationPath, "utf8");
  assert.match(sql, /create or replace function public\.request_care_update_priority_from_server/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /profile\.role = 'caregiver'/i);
  assert.match(sql, /assignment\.caregiver_id = p_actor_id/i);
  assert.match(sql, /caregiver_requested_priority_review/i);
  assert.match(sql, /revoke all on function public\.request_care_update_priority_from_server.*from public, anon, authenticated/is);
  assert.match(sql, /grant execute on function public\.request_care_update_priority_from_server.*to service_role/is);
});
