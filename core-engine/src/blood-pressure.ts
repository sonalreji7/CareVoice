export type BloodPressureReference = {
  label: string;
  detail: string;
  urgency: "routine" | "contact_clinician" | "urgent";
};

/**
 * General adult reference flags only. They classify a single logged reading;
 * they are not diagnoses or treatment recommendations.
 */
export function bloodPressureReference(systolic?: number | null, diastolic?: number | null): BloodPressureReference | null {
  if (systolic == null || diastolic == null) return null;

  if (systolic > 180 || diastolic > 120) {
    return {
      label: "Very high reference flag",
      detail: "This reading is above 180/120 mm Hg. Recheck it and seek urgent local clinical guidance; this prototype cannot assess an emergency.",
      urgency: "urgent",
    };
  }
  if (systolic < 90 || diastolic < 60) {
    return {
      label: "Below general adult reference",
      detail: "This reading is below 90/60 mm Hg. A reading alone does not establish a cause or diagnosis.",
      urgency: "contact_clinician",
    };
  }
  if (systolic >= 140 || diastolic >= 90) {
    return {
      label: "High reference range — stage 2 category",
      detail: "This is a general adult reference flag, not a diagnosis. A clinician confirms any diagnosis in context.",
      urgency: "contact_clinician",
    };
  }
  if (systolic >= 130 || diastolic >= 80) {
    return {
      label: "High reference range — stage 1 category",
      detail: "This is a general adult reference flag, not a diagnosis. A clinician confirms any diagnosis in context.",
      urgency: "routine",
    };
  }
  if (systolic >= 120) {
    return {
      label: "Elevated general adult reference range",
      detail: "This is a general adult reference flag, not a diagnosis.",
      urgency: "routine",
    };
  }
  return {
    label: "Within general adult reference range",
    detail: "This is a single logged reading, not a diagnosis or a substitute for clinical interpretation.",
    urgency: "routine",
  };
}
