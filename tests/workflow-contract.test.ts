import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const portalPath = path.resolve("frontend/components/auth-portal.tsx");
const backendPath = path.resolve("backend/src/server.ts");

test("review workflow cannot persist an update before explicit confirmation", async () => {
  const portal = await readFile(portalPath, "utf8");
  assert.match(portal, /useState<"compose" \| "clarification" \| "review">/);
  assert.match(portal, /setStage\(next\.clarification \? "clarification" : "review"\)/);
  assert.doesNotMatch(portal, /else await share\(next\)/);
  assert.match(portal, /Nothing has been shared yet\./);
  assert.match(portal, /Confirm and share/);
  assert.match(portal, /onConfirm=\{\(\) => void share\(draft\)\}/);
  assert.match(portal, /Skip and continue to review/);
});

test("feedback endpoint is authenticated, assignment-scoped, and server-owned", async () => {
  const backend = await readFile(backendPath, "utf8");
  assert.match(backend, /app\.post\("\/api\/care-updates\/:updateId\/handover-feedback"/);
  assert.match(backend, /requireAuthenticatedUser\(request, response\)/);
  assert.match(backend, /authorizeClinicianAccess\(client, actor, request\.params\.updateId\)/);
  assert.match(backend, /create_care_update_handover_feedback_from_server/);
  assert.doesNotMatch(backend, /handover-feedback[\s\S]{0,2000}from\("care_updates"\)\.update/);
});
