import { z } from "zod";

export const SAFETY_NOTICE = "This update has been sent to the care team. This service is not for emergencies.";

export const clarificationFieldSchema = z.enum([
  "timing",
  "comfort_or_daily_impact",
  "help_requested",
]);

export type ClarificationField = z.infer<typeof clarificationFieldSchema>;

const sourceQuoteSchema = z.string().min(1).max(2_000);

export const extractionSchema = z.object({
  handover_available: z.literal(true),
  change: sourceQuoteSchema.nullable(),
  timing: z.union([sourceQuoteSchema, z.literal("not stated")]),
  comfort_or_daily_impact: z.array(sourceQuoteSchema).max(4),
  help_requested: z.array(sourceQuoteSchema).max(4),
  medication_or_care_question: z.array(sourceQuoteSchema).max(4),
  source_evidence: z.object({
    change: sourceQuoteSchema.nullable(),
    timing: sourceQuoteSchema.nullable(),
    comfort_or_daily_impact: z.array(sourceQuoteSchema).max(4),
    help_requested: z.array(sourceQuoteSchema).max(4),
    medication_or_care_question: z.array(sourceQuoteSchema).max(4),
  }),
  missing_information: z.array(clarificationFieldSchema).max(3),
  safety_notice: z.literal(SAFETY_NOTICE),
});

export type Extraction = z.infer<typeof extractionSchema>;

export const handoverTagSchema = z.enum([
  "change",
  "timing",
  "comfort_or_daily_impact",
  "help_requested",
  "medication_or_care_question",
]);

export type HandoverTag = z.infer<typeof handoverTagSchema>;

const sourceSentenceIdSchema = z.string().regex(/^s[1-9]\d*$/);

export const handoverV2CandidateSchema = z.object({
  selections: z.array(z.object({
    source_sentence_id: sourceSentenceIdSchema,
    tags: z.array(handoverTagSchema).min(1).max(5),
  }).strict()).max(8),
  missing_information: z.array(clarificationFieldSchema).max(3),
}).strict();

export type HandoverV2Candidate = z.infer<typeof handoverV2CandidateSchema>;

export const handoverV2Schema = z.object({
  handover_available: z.literal(true),
  handover_version: z.literal(2),
  sentences: z.array(z.object({
    id: sourceSentenceIdSchema,
    text: sourceQuoteSchema,
    tags: z.array(handoverTagSchema).min(1).max(5),
  }).strict()).max(8),
  missing_information: z.array(clarificationFieldSchema).max(3),
  safety_notice: z.literal(SAFETY_NOTICE),
}).strict();

export type HandoverV2Extraction = z.infer<typeof handoverV2Schema>;

export type UnavailableExtraction = {
  handover_available: false;
  missing_information: ClarificationField[];
  safety_notice: typeof SAFETY_NOTICE;
};

export type CareUpdateExtraction = Extraction | HandoverV2Extraction | UnavailableExtraction;

const patientSummaryLineSchema = z.string().min(1).max(2_000).nullable();

export const patientExperienceSummarySchema = z.object({
  recent_change: patientSummaryLineSchema,
  impact_or_context: patientSummaryLineSchema,
  help_or_report: patientSummaryLineSchema,
});

export type PatientExperienceSummary = z.infer<typeof patientExperienceSummarySchema>;

export type PriorityInput = {
  authorRole: "patient" | "caregiver";
  caregiverRequestedCallback: boolean;
  message: string;
};
