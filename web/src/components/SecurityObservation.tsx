import type { Outcome, ReportRow } from "../../../scripts/model.ts";
import type { Inventory } from "../../../scripts/security-model.ts";
import type { SecurityView } from "../data.ts";
import { Badge } from "./ui/badge.tsx";
import { Freshness } from "./Freshness.tsx";

export function inventoryRelation(
  inventory: Inventory,
  phase: Outcome,
): string {
  const app = phase.metadata?.app;
  const runtimes = phase.metadata?.runtimes;
  if (!app?.commit || !runtimes?.length) return "Unavailable";
  if (app.ref !== inventory.app.ref || app.commit !== inventory.app.commit)
    return "Different app snapshot";
  const runtime = runtimes.find((item) => item.ref === inventory.runtime.ref);
  if (!runtime) return "Runtime comparison unavailable";
  if (!runtime.commit) return "Runtime comparison unavailable";
  return runtime.commit === inventory.runtime.commit
    ? "App and base runtime match"
    : "Different runtime snapshot";
}

export function SecurityObservation({
  health,
  view,
}: {
  health: ReportRow;
  view?: SecurityView;
}) {
  const row = view?.row;
  const inventory = row?.status === "completed" ? row.inventory : undefined;
  return (
    <section className="inventory-observation" aria-label="Manifest inventory">
      <div className="inventory-heading">
        <h4>
          Manifest inventory <span>Experimental pilot</span>
        </h4>
        <Badge variant={inventory ? "outline" : "secondary"}>
          {inventory
            ? "Generated · incomplete coverage"
            : row?.status === "not_requested"
              ? "Not requested"
              : row?.status === "failed"
                ? "Generation failed"
                : "Unavailable"}
        </Badge>
      </div>
      {inventory ? (
        <>
          <Freshness
            id={`inventory-freshness-${health.app.app_id}`}
            testedAt={inventory.generated_at}
            hasRows
            observation="Inventory generated"
          />
          <dl className="inventory-counts">
            {(["app", "runtime"] as const).map((scope) => {
              const counts = inventory.sources[scope];
              return (
                <div key={scope}>
                  <dt>
                    {scope === "app" ? "App" : "Runtime"} source identities
                  </dt>
                  <dd>
                    {counts.identified} of {counts.sources} declared sources{" "}
                    <span>
                      ({counts.versioned} versioned;{" "}
                      {counts.sources - counts.identified} unidentified)
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="app-limit">
            These counts describe manifest sources, not the percentage of
            installed dependencies covered.{" "}
            {inventory.unresolved_extension_groups} extension groups remain
            unresolved.
          </p>
          <details className="provenance">
            <summary>Inventory provenance &amp; smoke comparison</summary>
            <dl>
              {(["app", "runtime"] as const).map((scope) => (
                <div key={scope}>
                  <dt>{scope === "app" ? "App" : "Current remote runtime"}</dt>
                  <dd>
                    <code>{inventory[scope].ref}</code>
                    <br />
                    <code>{inventory[scope].commit}</code>
                    <br />
                    {inventory[scope].manifest}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Startup comparison</dt>
                <dd>{inventoryRelation(inventory, health.phases.verify)}</dd>
              </div>
              <div>
                <dt>Recipe comparison</dt>
                <dd>
                  {health.phases.screenshots.status === "not_requested"
                    ? "Not requested"
                    : inventoryRelation(inventory, health.phases.screenshots)}
                </dd>
              </div>
              {row?.status === "completed" ? (
                <>
                  <div>
                    <dt>Generator</dt>
                    <dd>
                      flatpak-sbom {row.generator.version}
                      <br />
                      <code>{row.generator.revision}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Inventory SHA-256</dt>
                    <dd>
                      <code>{inventory.evidence.sha256}</code>
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
          </details>
          {view?.inventoryUrl ? (
            <a href={view.inventoryUrl} download>
              Download CycloneDX 1.7 inventory
            </a>
          ) : (
            <p>
              Inventory download unavailable; the generation record is retained.
            </p>
          )}
        </>
      ) : row?.status === "failed" ? (
        <p>Failed during {row.stage}. See run diagnostics.</p>
      ) : row?.status === "not_requested" ? (
        <p>Inventory generation was not requested for this app in this run.</p>
      ) : (
        <p>Missing or incomplete evidence cannot establish an inventory.</p>
      )}
      <p className="app-limit">
        <strong>Coverage limits</strong> Vendored dependencies, source archive
        contents, binary extra-data payloads and extensions are not fully
        inventoried. Manifest declarations do not prove what remains after build
        cleanup. The runtime is the current remote runtime, not a particular
        installed system’s runtime.
      </p>
      <p className="app-limit">
        <strong>Vulnerability scan: not performed.</strong> This inventory is
        not proof of safety.
      </p>
    </section>
  );
}
