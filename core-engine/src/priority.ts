import type { PriorityInput } from "./contracts.js";

const normalDailyCareCannotContinue = /(?:\b(?:cannot|can['’]?t|unable to|not able to)\s+(?:continue|provide)\s+(?:normal\s+)?(?:daily\s+)?care\b|\b(?:normal\s+)?daily\s+care\s+(?:cannot|can['’]?t|is not able to)\s+continue\b)/i;

function removeExplicitNegation(message: string) {
  return message.replace(/\bnot\s+unable to\s+(?:continue|provide)\s+(?:normal\s+)?(?:daily\s+)?care\b/gi, "");
}

/**
 * This list is intentionally code-owned rather than model-owned. Adding a
 * rule requires a clinical-governance review and a matching database migration.
 */
export const clinicianOwnedPriorityRules = [
  {
    id: "normal-daily-care-cannot-continue",
    reason: "Clinician-owned deterministic rule: normal daily care cannot continue.",
    matches: (message: string) => normalDailyCareCannotContinue.test(removeExplicitNegation(message)),
  },
] as const;

export function evaluatePriority(input: PriorityInput): string[] {
  const reasons: string[] = [];
  if (input.authorRole === "caregiver" && input.caregiverRequestedCallback) {
    reasons.push("Caregiver explicitly requested a priority callback.");
  }
  for (const rule of clinicianOwnedPriorityRules) if (rule.matches(input.message)) reasons.push(rule.reason);
  return reasons;
}
