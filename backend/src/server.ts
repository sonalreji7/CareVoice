import { randomUUID } from "node:crypto";
import cors from "cors";
import { config } from "dotenv";
import express from "express";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { z } from "zod";
import {
  extractUpdate,
  isAgentConfigured,
  nextClarification,
} from "@carevoice/core-engine/extraction";
import type { CareUpdateExtraction } from "@carevoice/core-engine/contracts";
import { evaluatePriority } from "@carevoice/core-engine/priority";
import {
  clarificationAnswersSchema,
  composeSubmissionMessage,
  createFixedWindowRateLimiter,
  withTimeout,
} from "./care-updates.js";

config({ path: new URL("../../.env.local", import.meta.url).pathname });

const app = express();
const port = Number(process.env.PORT || 4000);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const authClient = supabaseUrl && publishableKey ? createClient(supabaseUrl, publishableKey) : null;
const serviceClient = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

type CareRole = "patient" | "caregiver" | "clinician" | "admin";
type Actor = { id: string; role: CareRole };
type StoredDraft = {
  id: string;
  userId: string;
  patientId: string;
  originalMessage: string;
  caregiverCallbackRequested: boolean;
  extraction: CareUpdateExtraction;
  priorityReasons: string[];
  mode: "unavailable" | "agent";
  expiresAt: number;
};

const drafts = new Map<string, StoredDraft>();
const draftRateLimiter = createFixedWindowRateLimiter(6, 60_000);
const shareRateLimiter = createFixedWindowRateLimiter(10, 60_000);
const draftRequestSchema = z.object({
  patientId: z.string().uuid(),
  originalMessage: z.unknown(),
  caregiverCallbackRequested: z.boolean().optional().default(false),
  clarificationAnswers: clarificationAnswersSchema.optional().default({}),
}).strict();
const submitRequestSchema = z.object({
  draftId: z.string().uuid(),
  patientId: z.string().uuid(),
  originalMessage: z.string(),
  caregiverCallbackRequested: z.boolean(),
  clarificationAnswers: clarificationAnswersSchema.optional().default({}),
}).strict();
const transitionRequestSchema = z.object({
  status: z.enum(["acknowledged", "closed"]),
  reason: z.string().trim().max(500).optional(),
}).strict();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "100kb" }));

function respondError(response: express.Response, status: number, error: string) {
  response.status(status).json({ error });
}

function configuredService(response: express.Response): SupabaseClient | null {
  if (serviceClient) return serviceClient;
  respondError(response, 503, "Secure update storage is not configured. Add the server-only Supabase service role key before enabling submissions.");
  return null;
}

async function loadActor(client: SupabaseClient, userId: string): Promise<Actor | null> {
  const { data, error } = await client.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  if (!["patient", "caregiver", "clinician", "admin"].includes(data.role)) return null;
  return { id: data.id, role: data.role as CareRole };
}

async function authorizeSubmission(client: SupabaseClient, actor: Actor, patientId: string) {
  if (actor.role !== "patient" && actor.role !== "caregiver") return false;
  const { data: patient, error: patientError } = await client
    .from("patients")
    .select("id, profile_id")
    .eq("id", patientId)
    .maybeSingle();
  if (patientError || !patient) return false;
  if (actor.role === "patient") return patient.profile_id === actor.id;

  const { data: assignment, error: assignmentError } = await client
    .from("caregiver_patient_assignments")
    .select("patient_id")
    .eq("caregiver_id", actor.id)
    .eq("patient_id", patientId)
    .maybeSingle();
  return !assignmentError && Boolean(assignment);
}

async function authorizeClinicianAccess(client: SupabaseClient, actor: Actor, updateId: string) {
  if (actor.role !== "clinician") return null;
  const { data: update, error: updateError } = await client
    .from("care_updates")
    .select("id, patient_id")
    .eq("id", updateId)
    .maybeSingle();
  if (updateError || !update) return null;
  const { data: assignment, error: assignmentError } = await client
    .from("clinician_patient_assignments")
    .select("patient_id")
    .eq("clinician_id", actor.id)
    .eq("patient_id", update.patient_id)
    .maybeSingle();
  return !assignmentError && assignment ? update : null;
}

async function requireAuthenticatedUser(request: express.Request, response: express.Response): Promise<User | null> {
  if (!authClient) {
    respondError(response, 503, "Authentication service is not configured.");
    return null;
  }
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    respondError(response, 401, "Sign in is required.");
    return null;
  }
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    respondError(response, 401, "Your session is not valid. Please sign in again.");
    return null;
  }
  return data.user;
}

function pruneExpiredDrafts() {
  const now = Date.now();
  for (const [id, draft] of drafts) if (draft.expiresAt <= now) drafts.delete(id);
}

app.get("/health", (_, response) => response.json({
  status: "ok",
  service: "carevoice-backend",
  extractionEngine: isAgentConfigured() ? "openai-agents-sdk" : "unavailable",
  secureWritesConfigured: Boolean(serviceClient),
}));

// This route used to expose extraction separately from persistence. Keeping a
// clear failure prevents an old browser bundle from continuing an unsafe flow.
app.post("/api/extract", (_, response) => respondError(response, 410, "This endpoint has been replaced by the secure care-update workflow."));

app.post("/api/care-update-drafts", async (request, response) => {
  const user = await requireAuthenticatedUser(request, response);
  const client = configuredService(response);
  if (!user || !client) return;
  const rate = draftRateLimiter.check(user.id);
  if (!rate.allowed) {
    response.setHeader("Retry-After", Math.ceil(rate.retryAfterMs / 1_000));
    respondError(response, 429, "Please wait a moment before preparing another handover.");
    return;
  }
  try {
    const input = draftRequestSchema.parse(request.body ?? {});
    const actor = await loadActor(client, user.id);
    if (!actor || !await authorizeSubmission(client, actor, input.patientId)) {
      respondError(response, 403, "You are not authorised to submit an update for this person.");
      return;
    }
    const callbackRequested = actor.role === "caregiver" && input.caregiverCallbackRequested;
    const submission = composeSubmissionMessage(input.originalMessage, input.clarificationAnswers);
    const result = await withTimeout(extractUpdate(submission.message), 12_000);
    const draft: StoredDraft = {
      id: randomUUID(),
      userId: user.id,
      patientId: input.patientId,
      originalMessage: submission.message,
      caregiverCallbackRequested: callbackRequested,
      extraction: result.extraction,
      priorityReasons: evaluatePriority({ authorRole: actor.role as "patient" | "caregiver", caregiverRequestedCallback: callbackRequested, message: submission.message }),
      mode: result.mode,
      expiresAt: Date.now() + 10 * 60_000,
    };
    pruneExpiredDrafts();
    drafts.set(draft.id, draft);
    response.json({
      draftId: draft.id,
      originalMessage: draft.originalMessage,
      extraction: draft.extraction,
      clarification: nextClarification(draft.extraction, Object.keys(submission.answers) as Array<keyof typeof submission.answers>),
      priorityReasons: draft.priorityReasons,
      mode: draft.mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "We could not prepare the structured handover.";
    respondError(response, error instanceof z.ZodError ? 400 : 422, message);
  }
});

app.post("/api/care-updates", async (request, response) => {
  const user = await requireAuthenticatedUser(request, response);
  const client = configuredService(response);
  if (!user || !client) return;
  const rate = shareRateLimiter.check(user.id);
  if (!rate.allowed) {
    response.setHeader("Retry-After", Math.ceil(rate.retryAfterMs / 1_000));
    respondError(response, 429, "Please wait a moment before sharing another update.");
    return;
  }
  try {
    const input = submitRequestSchema.parse(request.body ?? {});
    const actor = await loadActor(client, user.id);
    if (!actor || !await authorizeSubmission(client, actor, input.patientId)) {
      respondError(response, 403, "You are not authorised to submit an update for this person.");
      return;
    }
    const draft = drafts.get(input.draftId);
    if (!draft || draft.expiresAt <= Date.now() || draft.userId !== user.id || draft.patientId !== input.patientId) {
      respondError(response, 409, "This draft has expired. Please prepare it again before sharing.");
      return;
    }
    const submitted = composeSubmissionMessage(input.originalMessage, input.clarificationAnswers);
    if (
      draft.originalMessage !== submitted.message
      || draft.caregiverCallbackRequested !== (actor.role === "caregiver" && input.caregiverCallbackRequested)
    ) {
      respondError(response, 409, "This draft no longer matches the words being shared. Please prepare it again.");
      return;
    }
    const { data, error } = await client.rpc("create_care_update_from_server", {
      p_patient_id: draft.patientId,
      p_author_id: actor.id,
      p_original_message: draft.originalMessage,
      p_agent_summary: draft.extraction,
      p_caregiver_callback_requested: draft.caregiverCallbackRequested,
    });
    const update = Array.isArray(data) ? data[0] : data;
    if (error || !update) throw new Error("The trusted update record could not be created.");
    drafts.delete(draft.id);
    response.status(201).json({ update });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.message : "We could not share this update. Please try again.";
    respondError(response, error instanceof z.ZodError ? 400 : 422, message);
  }
});

app.post("/api/care-updates/:updateId/status", async (request, response) => {
  const user = await requireAuthenticatedUser(request, response);
  const client = configuredService(response);
  if (!user || !client) return;
  try {
    const input = transitionRequestSchema.parse(request.body ?? {});
    const actor = await loadActor(client, user.id);
    const update = actor ? await authorizeClinicianAccess(client, actor, request.params.updateId) : null;
    if (!actor || !update) {
      respondError(response, 403, "You are not authorised to review this update.");
      return;
    }
    const { data, error } = await client.rpc("transition_care_update_from_server", {
      p_update_id: update.id,
      p_actor_id: actor.id,
      p_next_status: input.status,
      p_reason: input.reason || null,
    });
    const transitioned = Array.isArray(data) ? data[0] : data;
    if (error?.code === "P0001") {
      respondError(response, 409, "That status change is not allowed for this update.");
      return;
    }
    if (error || !transitioned) throw new Error("The status could not be updated.");
    response.json({ update: transitioned });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.message : "We could not update the review status.";
    respondError(response, error instanceof z.ZodError ? 400 : 422, message);
  }
});

app.listen(port, () => console.log(`CareVoice backend listening on http://localhost:${port}`));
