import { useEffect, useState } from "react";
import { Theme } from "./components/Theme.tsx";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { QuestionIcon } from "@phosphor-icons/react/dist/ssr/Question";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { MinusIcon } from "@phosphor-icons/react/dist/ssr/Minus";
import type { ReportRow, Status } from "../../scripts/model.ts";
import type { PageData } from "./data.ts";
import { dateLabel } from "./data.ts";
import { Badge } from "./components/ui/badge.tsx";
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

function OutcomeBadge({ status }: { status: Status }) {
  const { label, icon: Icon, variant } = outcomes[status];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {label}
    </Badge>
  );
}

function AppResult({
  row,
  images,
  runUrl,
  index,
  enhanced,
}: {
  row: ReportRow;
  images: string[];
  runUrl: string;
  index: number;
  enhanced: boolean;
}) {
  const id = row.app.app_id;
  const tested = "tested_at" in row ? row.tested_at : undefined;
  const details =
    "tested_at" in row
      ? { resolved: row.resolved, runner: row.runner, phases: row.phases }
      : { error: row.error, phases: row.phases };
  return (
    <article id={`app-${id}`} aria-labelledby={`title-${id}`} tabIndex={-1}>
      <div className="apphead">
        <div className="app-identity">
          <span className="app-number" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3 id={`title-${id}`}>{row.app.name}</h3>
            <code>{id}</code>
          </div>
        </div>
        <div className="tested">
          <span>TESTED</span>
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
              <OutcomeBadge status={row.phases[key].status} />
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
      <div className="card-footer">
        <PhaseDetails details={details} enhanced={enhanced} />
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
            <span aria-hidden="true">✳</span> FLATHUB HEALTH
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
            <p className="eyebrow">RELEASED APPS / SMOKE TESTS</p>
            <h1>
              A window into
              <br />
              app <em>health.</em>
            </h1>
          </div>
          <div className="hero-note">
            <span className="edition">THE RELEASE CHECK</span>
            <p>
              Do they install?
              <br />
              Do they open?
              <br />
              <span>Here’s what the tests saw.</span>
            </p>
            <p className="hero-description">
              Independent startup and recipe results for a small selection of
              released Flathub apps.
            </p>
          </div>
        </div>
        <Freshness testedAt={latest} hasRows={rows.length > 0} />
        {rows.length ? (
          <dl className="overview">
            <div>
              <dt>Apps in this report</dt>
              <dd>
                {rows.length}
                <span>selected apps</span>
              </dd>
            </div>
            <div>
              <dt>Startup passed</dt>
              <dd>
                {count("verify")}
                <span>/ {rows.length} checks</span>
              </dd>
            </div>
            <div>
              <dt>Recipes passed</dt>
              <dd>
                {count("screenshots")}
                <span>/ {requested} requested</span>
              </dd>
            </div>
          </dl>
        ) : null}
      </header>
      <main id="results" tabIndex={-1}>
        <div className="section-heading">
          <h2>Latest observations</h2>
          <span>STARTUP · RECIPES · EVIDENCE</span>
        </div>
        <div className="report-layout">
          {rows.length ? (
            <nav className="app-index" aria-label="Apps in this report">
              <p className="eyebrow">IN THIS REPORT</p>
              {rows.map((row, i) => (
                <a key={row.app.app_id} href={`#app-${row.app.app_id}`}>
                  <span className="index-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {row.app.name}
                  <span className="index-arrow" aria-hidden="true">
                    ↘
                  </span>
                </a>
              ))}
              <p className="index-note">
                Results describe the tested versions, not every installation.
              </p>
              <a
                className="source-link"
                href="https://github.com/razzeee/flathub-health"
              >
                Project on GitHub ↗
              </a>
            </nav>
          ) : null}
          <div className="results-list">
            {rows.length ? (
              rows.map((row, index) => (
                <AppResult
                  key={row.app.app_id}
                  row={row}
                  images={images[row.app.app_id] ?? []}
                  runUrl={runUrl}
                  index={index}
                  enhanced={enhanced}
                />
              ))
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Waiting for evidence.</EmptyTitle>
                  <EmptyDescription>
                    No app results are available. Check the workflow for missing
                    or expired artifacts.
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
          <p className="eyebrow">READING THESE RESULTS</p>
          <h2 id="limits-title">A smoke test, not a guarantee.</h2>
          <div>
            <p>
              A startup pass checks that an app opens. It does not verify every
              feature. A recipe failure can mean its steps no longer match the
              app.
            </p>
            <p>
              Screenshots are test evidence, not app-store images. At most three
              captures per app, 2 MiB each and 30 MiB total, are kept in this
              deployment. Workflow diagnostics expire after 14 days.
            </p>
          </div>
        </aside>
      </main>
      <footer>
        <span>
          Flathub health <span aria-hidden="true">/</span> Read-only
          observations
        </span>
        <a href="https://github.com/razzeee/flathub-health">
          Source &amp; methodology ↗
        </a>
      </footer>
    </>
  );
}
