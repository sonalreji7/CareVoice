import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 10_000;

export const clarificationAnswersSchema = z.object({
  timing: z.string().trim().min(1).max(1_000).optional(),
  comfort_or_daily_impact: z.string().trim().min(1).max(1_000).optional(),
  help_requested: z.string().trim().min(1).max(1_000).optional(),
}).strict();

export type ClarificationAnswers = z.infer<typeof clarificationAnswersSchema>;

export function validateOriginalMessage(value: unknown) {
  if (typeof value !== "string") throw new Error("A message is required.");
  const message = value.trim();
  if (!message) throw new Error("A message is required.");
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`);
  return message;
}

const clarificationLabels: Record<keyof ClarificationAnswers, string> = {
  timing: "Timing",
  comfort_or_daily_impact: "Comfort or daily impact",
  help_requested: "Help requested",
};

/**
 * Clarification answers are user-authored source text. They are appended in a
 * stable form so the extraction can cite them verbatim and the saved record
 * remains reviewable as one immutable original message.
 */
export function composeSubmissionMessage(original: unknown, answers: unknown = {}) {
  const message = validateOriginalMessage(original);
  const parsedAnswers = clarificationAnswersSchema.parse(answers);
  const additions = (Object.entries(parsedAnswers) as Array<[keyof ClarificationAnswers, string | undefined]>)
    .filter((entry): entry is [keyof ClarificationAnswers, string] => Boolean(entry[1]))
    .map(([field, answer]) => `Clarification — ${clarificationLabels[field]}: ${answer}`);
  const combined = [message, ...additions].join("\n");
  if (combined.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Messages including clarification answers must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`);
  }
  return { message: combined, answers: parsedAnswers };
}

type WindowEntry = { count: number; startedAt: number };

/** A small in-process guard for a hackathon server; use shared storage when horizontally scaled. */
export function createFixedWindowRateLimiter(limit: number, windowMs: number, now = () => Date.now()) {
  const entries = new Map<string, WindowEntry>();
  return {
    check(key: string) {
      const current = now();
      const previous = entries.get(key);
      if (!previous || current - previous.startedAt >= windowMs) {
        entries.set(key, { count: 1, startedAt: current });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (previous.count >= limit) return { allowed: false, retryAfterMs: windowMs - (current - previous.startedAt) };
      previous.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

export class RequestTimeoutError extends Error {
  constructor() {
    super("Preparing the handover took too long. Please try again.");
    this.name = "RequestTimeoutError";
  }
}

export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new RequestTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
