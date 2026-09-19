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

export type UnavailableExtraction = {
  handover_available: false;
  missing_information: ClarificationField[];
  safety_notice: typeof SAFETY_NOTICE;
};

export type CareUpdateExtraction = Extraction | UnavailableExtraction;

export type PriorityInput = {
  authorRole: "patient" | "caregiver";
  caregiverRequestedCallback: boolean;
  message: string;
};
