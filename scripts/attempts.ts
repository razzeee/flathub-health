import type { Outcome } from "./model.ts";

export function attemptState(
  outcome: Outcome,
): "retry_recovered" | "retry_failed" | "first_pass" | undefined {
  if (outcome.attempts?.length === 2)
    return outcome.status === "passed" ? "retry_recovered" : "retry_failed";
  if (outcome.attempts?.length === 1 && outcome.status === "passed")
    return "first_pass";
}
