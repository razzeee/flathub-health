import type { Outcome } from "../../../scripts/model.ts";

export function PhaseObservation({ outcome }: { outcome: Outcome }) {
  const failed = !["passed", "not_requested", "incomplete"].includes(
    outcome.status,
  );
  const execution = outcome.execution;
  return (
    <div className="phase-observation">
      {failed ? (
        <p className="failure-category">
          {outcome.category === "infrastructure"
            ? "Runner identified infrastructure trouble."
            : outcome.category === "expectation"
              ? "Unmet expectation; app or recipe cause is not established."
              : outcome.category
                ? `Unclassified category: ${outcome.category}`
                : "Unclassified by runner; this verdict does not establish the cause."}
        </p>
      ) : null}
      {outcome.reason ? <code>{outcome.reason}</code> : null}
      {outcome.message ? <p>{outcome.message}</p> : null}
      {execution ? (
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
      ) : outcome.status !== "not_requested" ? (
        <p className="execution-missing">Execution diagnostics unavailable.</p>
      ) : null}
    </div>
  );
}
