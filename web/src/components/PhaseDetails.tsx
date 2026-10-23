import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible.tsx";
import { Button } from "./ui/button.tsx";
import type { ReportRow } from "../../../scripts/model.ts";

export function PhaseDetails({
  row,
  enhanced,
}: {
  row: ReportRow;
  enhanced: boolean;
}) {
  const content = (
    <div className="provenance">
      <p>Versions recorded during each phase. Missing values stay unknown.</p>
      {(["verify", "screenshots"] as const).map((phase) => {
        const outcome = row.phases[phase];
        const metadata = outcome.metadata;
        return (
          <section
            key={phase}
            aria-label={`${phase === "verify" ? "Startup" : "Recipe"} provenance`}
          >
            <h4>{phase === "verify" ? "Startup" : "Recipe"} provenance</h4>
            {outcome.status === "not_requested" ? (
              <p>Not requested.</p>
            ) : (
              <dl>
                <div>
                  <dt>Runner</dt>
                  <dd>{metadata?.runner_image.version ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>App</dt>
                  <dd>
                    <code>{metadata?.app?.ref ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Runtime &amp; extensions</dt>
                  <dd>
                    {metadata?.runtimes?.length ? (
                      <ul>
                        {metadata.runtimes.map((runtime) => (
                          <li key={runtime.ref}>
                            <code>{runtime.ref}</code>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "Not recorded"
                    )}
                  </dd>
                </div>
                {phase === "screenshots" ? (
                  <div>
                    <dt>Recipe inputs</dt>
                    <dd>
                      {metadata?.recipe?.input_digest
                        ? "Recipe and fixtures hashed"
                        : "Unknown, no recipe and fixture digest"}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
            {metadata ? (
              <details>
                <summary>Full commits &amp; hashes</summary>
                <dl>
                  <div>
                    <dt>App commit</dt>
                    <dd>
                      <code>{metadata.app?.commit ?? "Unknown"}</code>
                    </dd>
                  </div>
                  {metadata.runtimes?.map((runtime) => (
                    <div key={runtime.ref}>
                      <dt>
                        <code>{runtime.ref}</code>
                      </dt>
                      <dd>
                        <code>{runtime.commit ?? "Unknown"}</code>
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt>Runner image</dt>
                    <dd>
                      <code>{metadata.runner_image.image}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Image digest</dt>
                    <dd>
                      <code>{metadata.runner_image.digest ?? "Unknown"}</code>
                    </dd>
                  </div>
                  {phase === "screenshots" ? (
                    <>
                      <div>
                        <dt>Recipe YAML hash</dt>
                        <dd>
                          <code>
                            {metadata.recipe?.content_hash ?? "Unknown"}
                          </code>
                        </dd>
                      </div>
                      <div>
                        <dt>Recipe input digest</dt>
                        <dd>
                          <code>
                            {metadata.recipe?.input_digest ?? "Unknown"}
                          </code>
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              </details>
            ) : null}
          </section>
        );
      })}
      <details>
        <summary>Raw record</summary>
        <pre tabIndex={0} aria-label="Recorded versions and phase details">
          {JSON.stringify(row, null, 2)}
        </pre>
      </details>
    </div>
  );
  // Keep a working disclosure when scripts are disabled or have not loaded yet.
  if (!enhanced)
    return (
      <details>
        <summary>Versions &amp; phase details</summary>
        {content}
      </details>
    );
  return (
    <Collapsible className="min-w-0 flex-1">
      <CollapsibleTrigger asChild>
        <Button variant="link">
          <CaretDownIcon data-icon="inline-start" />
          Versions &amp; phase details
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{content}</CollapsibleContent>
    </Collapsible>
  );
}
