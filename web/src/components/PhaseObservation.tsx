import type { Outcome } from "../../../scripts/model.ts";
import { attemptState } from "../../../scripts/attempts.ts";

export function PhaseObservation({ outcome }: { outcome: Outcome }) {
  const failed = !["passed", "not_requested", "incomplete"].includes(
    outcome.status,
  );
  const execution = outcome.execution;
  const state = attemptState(outcome);
  return (
    <div className="phase-observation">
      {state === "retry_recovered" || state === "retry_failed" ? (
        <p>
          {state === "retry_recovered"
            ? "Recovered after one retry, not a first-attempt pass."
            : "Still failing after one retry."}{" "}
          Both attempts are retained in the raw record and run diagnostics.
        </p>
      ) : state === "first_pass" ? (
        <p>Passed on the first attempt.</p>
      ) : null}
      {failed ? (
        <p className="failure-category">
          {outcome.category === "infrastructure"
            ? "The runner reported an infrastructure failure."
            : outcome.category === "expectation"
              ? "A test expectation failed. The cause is not established."
              : outcome.category
                ? `Unclassified category: ${outcome.category}`
                : "The runner did not classify the cause."}
        </p>
      ) : null}
      {outcome.reason ? <code>{outcome.reason}</code> : null}
      {outcome.message ? <p>{outcome.message}</p> : null}
      {execution ? (
        <details className="execution-disclosure">
          <summary>Execution diagnostics</summary>
          <dl className="execution-details">
            <div>
              <dt>Execution</dt>
              <dd>
                {execution.status === "completed"
                  ? "Finished"
                  : execution.status.replaceAll("_", " ")}
                {execution.exit_code !== null
                  ? ` · exit ${execution.exit_code}`
                  : " · exit unknown"}
              </dd>
            </div>
            <div>
              <dt>Cleanup</dt>
              <dd>
                {execution.cleanup && Object.keys(execution.cleanup).length
                  ? Object.entries(execution.cleanup)
                      .map(
                        ([stage, result]) =>
                          `${stage}: ${result.status === "absent" ? "container already absent" : result.status}`,
                      )
                      .join("; ")
                  : "Not recorded"}
              </dd>
            </div>
          </dl>
        </details>
      ) : outcome.status !== "not_requested" ? (
        <p className="execution-missing">Execution diagnostics unavailable.</p>
      ) : null}
    </div>
  );
}
