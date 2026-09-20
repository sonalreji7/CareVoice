# Deliberate product and safety decisions

CareVoice Relay is designed around a narrow question: how can a caregiver's plain-language update reach an assigned clinician with less information loss and without an AI system turning it into unsupported medical advice?

## 1. Constrained sentence selection instead of AI-written summaries

The model is asked to select source-sentence IDs and allowed labels only. The server reconstructs every clinician-facing sentence from the original submission.

**Why:** fluent medical prose can sound credible even when it contains a missing negation, an invented fact, or an unjustified inference. A constrained selector makes the original language inspectable and lets the application reject output that cannot be grounded.

**Trade-off:** the resulting handover is less polished than a generative summary. This is intentional: fidelity and reviewability matter more than elegant wording in the deployed workflow.

## 2. No AI triage, diagnosis, or treatment

CareVoice does not classify a user's condition as safe, urgent, severe, or emergent. It does not give treatment, medication, or emergency instructions.

**Why:** the application does not yet establish clinical validity, safe thresholds, monitoring responsibility, or escalation accountability. Claiming triage would create a dangerous mismatch between the interface and the evidence.

**What exists instead:** a caregiver can request a priority callback, and one clearly documented, clinician-owned text rule can add a priority reason. Both are queue signals for human review—not medical determinations.

## 3. Explicit review before sharing

Preparing a handover creates a short-lived server draft. Nothing is persisted until the caregiver reviews the original words and selects **Confirm and share**.

**Why:** transcription errors and message misinterpretation are common in caregiver communication. The author must retain control over what reaches the care team.

## 4. Trusted backend writes instead of browser writes

The browser reads only records allowed by Supabase Row Level Security. The backend verifies the signed-in user, role, and patient assignment before calling service-role-only database RPCs for writes, review transitions, or feedback.

**Why:** client-controlled writes would let a browser attempt to forge a handover, change an update lifecycle, or create feedback outside the intended workflow.

## 5. Separate quality feedback from clinical records

Clinician feedback such as “missing relevant detail” is stored separately from the care update and does not rewrite the caregiver's original message or handover.

**Why:** feedback supports future quality evaluation without silently changing the record that the clinician reviewed.

## 6. Deterministic fictional demo mode

`CAREVOICE_DEMO_MODE=1` uses simple exact-source tag rules instead of a model call.

**Why:** a reviewer can run an end-to-end demonstration without an API key or model outage. The interface labels this mode as fictional demonstration only.

**Limit:** it is not evidence that an AI model performed the classification. The separate OpenAI-backed mode and opt-in fictional evaluation exist to test that path.

## What CareVoice deliberately does not claim

- Clinical validation or medical-device certification
- Emergency detection, triage, diagnosis, or prescription
- Guaranteed clinician response times or automated clinician notification
- WhatsApp, SMS, or production communications integration
- Production-scale rate limiting, durable draft storage, or disaster recovery
- Compliance with a particular healthcare law or deployment environment

Those omissions are not hidden. They define the boundary between a reviewable care-communication application and a clinically validated deployment.
