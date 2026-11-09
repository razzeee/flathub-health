import { useEffect, useState } from "react";
import { Theme } from "./components/Theme.tsx";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { QuestionIcon } from "@phosphor-icons/react/dist/ssr/Question";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { MinusIcon } from "@phosphor-icons/react/dist/ssr/Minus";
import { DesktopIcon } from "@phosphor-icons/react/dist/ssr/Desktop";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import type { Outcome, ReportRow } from "../../scripts/model.ts";
import type { Capture, PageData, SecurityView } from "./data.ts";
import { dateLabel } from "./data.ts";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "./components/ui/empty.tsx";
import { Freshness } from "./components/Freshness.tsx";
import { Evidence } from "./components/Evidence.tsx";
import { PhaseDetails } from "./components/PhaseDetails.tsx";
import { PhaseObservation } from "./components/PhaseObservation.tsx";
import { SecurityObservation } from "./components/SecurityObservation.tsx";

const outcomes = {
  passed: { label: "Passed", icon: CheckIcon, variant: "success" },
  incomplete: { label: "Incomplete", icon: QuestionIcon, variant: "warning" },
  infrastructure_failed: {
    label: "Infrastructure failure",
    icon: WarningIcon,
    variant: "destructive",
  },
  app_failed: { label: "App failure", icon: XIcon, variant: "destructive" },
  recipe_failed: {
    label: "Recipe failure",
    icon: XIcon,
    variant: "destructive",
  },
  not_requested: {
    label: "Not requested",
    icon: MinusIcon,
    variant: "secondary",
  },
} as const;

function outcomeLabel(outcome: Outcome) {
  return outcome.status === "infrastructure_failed" &&
    outcome.reason === "screenshot_failed" &&
    outcome.category !== "infrastructure"
    ? "Unclassified failure"
    : outcomes[outcome.status].label;
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const { icon: Icon, variant } = outcomes[outcome.status];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {outcomeLabel(outcome)}
    </Badge>
  );
}

function PhaseSignal({ outcome, phase }: { outcome: Outcome; phase: string }) {
  const { icon: Icon, variant } = outcomes[outcome.status];
  const label = outcomeLabel(outcome);
  return (
    <Badge
      variant={variant}
      size="icon"
      className="phase-signal"
      role="img"
      aria-label={`${phase}: ${label}`}
      title={`${phase}: ${label}`}
    >
      <Icon aria-hidden="true" weight="bold" />
    </Badge>
  );
}

function AppResult({
  row,
  images,
  runUrl,
  enhanced,
  security,
}: {
  row: ReportRow;
  images: Capture[];
  runUrl: string;
  enhanced: boolean;
  security?: SecurityView;
}) {
  const id = row.app.app_id;
  const tested = "tested_at" in row ? row.tested_at : undefined;
  const scan =
    security?.row.status === "completed" ? security.row.scan : undefined;
  const securityStatus =
    scan && scan !== "not_requested"
      ? scan.status === "completed"
        ? security?.scan
          ? `${scan.matches} scanner matches requiring triage`
          : "Vulnerability evidence unavailable"
        : `Vulnerability scan: ${scan.status}`
      : security?.row.status === "failed"
        ? "Inventory generation failed"
        : security?.row.status === "completed"
          ? "Vulnerability scan: not performed"
          : security?.row.status === "not_requested"
            ? "Inventory not requested"
            : "Inventory unavailable";
  return (
    <article id={`app-${id}`} aria-labelledby={`title-${id}`} tabIndex={-1}>
      <div className="apphead">
        <div className="app-identity">
          <div>
            <h3 id={`title-${id}`}>{row.app.name}</h3>
            <code>{id}</code>
          </div>
        </div>
        <div className="tested">
          <span>Tested</span>
          {tested ? (
            <time dateTime={tested}>{dateLabel(tested)}</time>
          ) : (
            "Test time unavailable"
          )}
        </div>
      </div>
      <dl className="outcomes">
        {(
          [
            ["verify", "Startup"],
            ["screenshots", "Recipe"],
            ["prepare", "Preparation"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              <OutcomeBadge outcome={row.phases[key]} />
              {key !== "prepare" || row.phases[key].status !== "passed" ? (
                <PhaseObservation outcome={row.phases[key]} />
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <Evidence
        images={images}
        name={row.app.name}
        startupOnly={row.phases.screenshots.status === "not_requested"}
        enhanced={enhanced}
      />
      <p className="app-limit">
        <strong>Test scope</strong> {row.app.limitations}
      </p>
      <details className="security-details">
        <summary>
          Inventory &amp; security <span>{securityStatus}</span>
        </summary>
        <SecurityObservation health={row} view={security} />
      </details>
      <div className="card-footer">
        <PhaseDetails row={row} enhanced={enhanced} />
        <a className="diagnostics" href={runUrl}>
          Run diagnostics <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}

export function App({ data }: { data: PageData }) {
  const { rows, images, runUrl } = data;
  const [enhanced, setEnhanced] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  useEffect(() => {
    setEnhanced(true);
  }, []);
  const latestTime = Math.max(
    ...rows.map((row) =>
      "tested_at" in row ? Date.parse(row.tested_at) : -Infinity,
    ),
  );
  const latest = Number.isFinite(latestTime)
    ? new Date(latestTime).toISOString()
    : "";
  const count = (phase: "verify" | "screenshots") =>
    rows.filter((row) => row.phases[phase].status === "passed").length;
  const requested = rows.filter((row) => row.app.recipe).length;
  return (
    <>
      <a className="skip" href="#results">
        Skip to results
      </a>
      <header className="masthead">
        <div className="topline">
          <a className="wordmark" href="./">
            <DesktopIcon aria-hidden="true" weight="bold" />
            Flathub health
          </a>
          <div className="topline-actions">
            <a href={runUrl}>
              Workflow run <span aria-hidden="true">↗</span>
            </a>
            {enhanced ? <Theme /> : null}
          </div>
        </div>
        <div className="hero">
          <div>
            <h1>Release checks</h1>
            <p className="hero-description">
              Startup checks and screenshots for released Flathub apps.
            </p>
            <Freshness testedAt={latest} hasRows={rows.length > 0} />
          </div>
          {rows.length ? (
            <dl className="overview">
              <div>
                <dt>Startup passed</dt>
                <dd>
                  {count("verify")}
                  <span>/ {rows.length}</span>
                  <div className="summary-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${(count("verify") / rows.length) * 100}%`,
                      }}
                    />
                  </div>
                </dd>
              </div>
              <div>
                <dt>Recipes passed</dt>
                <dd>
                  {count("screenshots")}
                  <span>/ {requested}</span>
                  <div className="summary-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${requested ? (count("screenshots") / requested) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      </header>
      <main id="results" tabIndex={-1}>
        <div className="section-heading">
          <h2>Results</h2>
          <span>
            {rows.length} {rows.length === 1 ? "app" : "apps"} in this run
          </span>
        </div>
        <div className="report-layout">
          {rows.length ? (
            <div className="app-navigation">
              {enhanced ? (
                <Button
                  variant="outline"
                  className="index-toggle"
                  aria-expanded={indexOpen}
                  aria-controls="app-index"
                  onClick={() => setIndexOpen((open) => !open)}
                >
                  {indexOpen
                    ? "Hide app list"
                    : `Browse ${rows.length} ${rows.length === 1 ? "app" : "apps"}`}
                  <CaretDownIcon data-icon="inline-end" aria-hidden="true" />
                </Button>
              ) : null}
              <nav
                id="app-index"
                className="app-index"
                aria-label="Apps in this report"
                data-collapsed={enhanced && !indexOpen}
              >
                <div className="index-heading">
                  <span>App</span>
                  <span>Startup</span>
                  <span>Recipe</span>
                </div>
                {rows.map((row) => (
                  <a
                    key={row.app.app_id}
                    href={`#app-${row.app.app_id}`}
                    onClick={() => setIndexOpen(false)}
                  >
                    <span className="index-name">{row.app.name}</span>
                    <PhaseSignal outcome={row.phases.verify} phase="Startup" />
                    <PhaseSignal
                      outcome={row.phases.screenshots}
                      phase="Recipe"
                    />
                  </a>
                ))}
                <a
                  className="source-link"
                  href="https://github.com/razzeee/flathub-health"
                >
                  Project on GitHub ↗
                </a>
              </nav>
            </div>
          ) : null}
          <div className="results-list">
            {rows.length ? (
              rows.map((row) => (
                <AppResult
                  key={row.app.app_id}
                  row={row}
                  images={images[row.app.app_id] ?? []}
                  runUrl={runUrl}
                  enhanced={enhanced}
                  security={data.security?.[row.app.app_id]}
                />
              ))
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No results</EmptyTitle>
                  <EmptyDescription>
                    Check the workflow for missing or expired artifacts.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <a href={runUrl}>View workflow runs ↗</a>
                </EmptyContent>
              </Empty>
            )}
          </div>
        </div>
        <aside className="test-notes" aria-labelledby="limits-title">
          <h2 id="limits-title">Test limits</h2>
          <div>
            <p>
              Startup checks can pass on a splash screen or welcome dialog.
              Recipes test only their stated steps. Results apply to the tested
              versions. A failure does not prove the app is broken.
            </p>
            <p>
              Screenshots do not prove app readiness. This site keeps up to
              three captures per app, 2 MiB each and 30 MiB total. Workflow
              diagnostics expire after 14 days.
            </p>
          </div>
        </aside>
      </main>
      <footer>
        <span>Flathub health</span>
        <a href="https://github.com/razzeee/flathub-health">
          Source &amp; methodology ↗
        </a>
      </footer>
    </>
  );
}
