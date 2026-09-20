# CareVoice Relay: evaluator guide

This guide lets a reviewer verify the core workflow from a fresh local setup using fictional data only. CareVoice Relay is a hackathon prototype, not a clinical service.

## What to assess

The project addresses a specific handover problem: a caregiver can describe a change in plain language, but a clinician needs a quick, reviewable view without losing the caregiver's original meaning. The system's answer is constrained organisation, not diagnosis.

The expected outcome is a handover made from exact submitted sentences, a visible original-message trail, an explicit caregiver confirmation, and an assigned-clinician review workflow.

## Reproduce the fictional demo

1. Copy `.env.example` to `.env.local`.
2. Set the Supabase URL, publishable key, and server-only service-role key in `.env.local`.
3. Set `CAREVOICE_DEMO_MODE=1`. This makes the demo deterministic and does not call an AI model.
4. Apply the SQL migrations in `database/supabase/migrations/` to the selected Supabase project.
5. Install dependencies and create the fictional accounts:

   ```bash
   npm install
   npm run seed:demo -- --reset-password
   npm run dev
   ```

6. Copy the generated password from the seed command's terminal output. It is intentionally not committed.
7. Sign in with `demo.caregiver@carevoice.test`, select **Load detailed fictional update**, select consent and **Request a priority callback**, then choose **Prepare review**.
8. Verify that the review page shows the caregiver's original text and an organised handover composed of exact source sentences.
9. Confirm and share the update. Sign in with `demo.clinician@carevoice.test` using the same generated password to review, acknowledge, close, and optionally record feedback.

## What the fictional demo proves

- Long, ordinary caregiver language is accepted without requiring medical terminology.
- Each displayed handover line is tied to a complete submitted sentence.
- The caregiver can edit the message before confirmation; draft preparation alone does not persist an update.
- A priority callback is a visible, explicit request. It is not a medical urgency decision.
- Only a linked clinician can complete the review workflow or submit handover-quality feedback.

## Run the evidence suite

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` contains fictional unit and static-security checks. Two opt-in tests are skipped by default: a live OpenAI selector evaluation and a dedicated Supabase RLS integration check. They require separately configured test services and are intentionally not presented as completed clinical validation.

## Verify OpenAI-backed extraction separately

To exercise the constrained model path rather than the deterministic demonstration, set `CAREVOICE_DEMO_MODE=0`, provide `OPENAI_API_KEY`, restart the backend, and use the same fictional update. The model receives numbered source sentences and may return only sentence IDs plus predefined tags. The backend rejects output that cannot be exactly materialised from the source.

For the optional live fictional evaluation, use a non-production key and run:

```bash
RUN_OPENAI_EVALS=1 npm test
```

The live test measures grounding and expected-tag coverage across 25 fictional updates. It is a reliability check, not a clinical efficacy claim.
