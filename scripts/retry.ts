import { message } from "./model.ts";
import type { Outcome } from "./model.ts";
import { CommandError } from "./process.ts";

// No hosted failure has yet established a narrow, retry-safe signature.
const retryable = (_outcome: Outcome): boolean => false;

function safeToRetry(outcome: Outcome): boolean {
  const execution = outcome.execution;
  return Boolean(
    outcome.status === "infrastructure_failed" &&
    outcome.category === "infrastructure" &&
    outcome.reason &&
    outcome.exit_code != null &&
    outcome.exit_code !== 0 &&
    execution?.status === "completed" &&
    execution.exit_code === outcome.exit_code &&
    !execution.signal &&
    execution.cleanup?.remove &&
    Object.values(execution.cleanup).every(({ status }) =>
      ["ok", "absent"].includes(status),
    ),
  );
}

export async function retryPhase(
  run: (attempt: 1 | 2) => Promise<Outcome>,
  save: (outcome: Outcome) => void,
  eligible: (outcome: Outcome) => boolean = retryable,
): Promise<Outcome> {
  const attempts: NonNullable<Outcome["attempts"]> = [];
  for (const attempt of [1, 2] as const) {
    let outcome: Outcome;
    let cancelled: CommandError | undefined;
    try {
      outcome = await run(attempt);
    } catch (error) {
      outcome = { status: "infrastructure_failed", message: message(error) };
      if (error instanceof CommandError && error.cancelled) cancelled = error;
    }
    attempts.push(structuredClone(outcome));
    const result = { ...outcome, attempts: [...attempts] };
    save(result);
    if (cancelled) throw cancelled;
    if (attempt === 2 || !safeToRetry(outcome) || !eligible(outcome))
      return result;
  }
  throw new Error("unreachable attempt limit");
}
