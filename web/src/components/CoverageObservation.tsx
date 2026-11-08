import type { SecurityView } from "../data.ts";

export function CoverageObservation({ view }: { view?: SecurityView }) {
  if (!view?.coverage) {
    return view?.row.status === "completed" && view.row.coverage ? (
      <p className="app-limit">
        Coverage evidence unavailable. Inventory generation and vulnerability
        scanning remain independent.
      </p>
    ) : null;
  }
  const { summary, url } = view.coverage;
  return (
    <section
      className="vulnerability-observation"
      aria-label="Inventory coverage"
    >
      <h4>Content inspection coverage</h4>
      <dl className="inventory-counts">
        {(["app", "runtime"] as const).map((scope) => (
          <div key={scope}>
            <dt>{scope === "app" ? "App" : "Runtime"} content inspection</dt>
            <dd>
              {summary.scopes[scope].content_scan};{" "}
              {summary.scopes[scope].content_packages} package records;{" "}
              {summary.scopes[scope].gaps} recorded gaps
            </dd>
          </div>
        ))}
      </dl>
      <p>
        Acquisition {summary.acquisition_complete ? "completed" : "incomplete"};
        dependency inventory remains incomplete.{" "}
        {summary.completeness_limitations.join("; ")}.
      </p>
      <a href={url} download>
        Download coverage evidence
      </a>
    </section>
  );
}
