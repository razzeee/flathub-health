/** Mark missing or invalid job artifacts as incomplete. */
import { isDeepStrictEqual } from "node:util";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "./catalog.ts";
import { argumentsFor, main, readJson, ROOT, writeJson } from "./io.ts";
import { healthSchema, phases, successful } from "./model.ts";
import type { App, Health, ReportRow } from "./model.ts";

function decode(value: unknown, app: App): Health {
  const record = healthSchema.parse(value);
  if (!isDeepStrictEqual(record.app, app)) {
    throw new Error("artifact catalog mismatch");
  }
  return record;
}

export function aggregate(apps: App[], directory: string): ReportRow[] {
  return apps.map((app) => {
    try {
      return decode(readJson(join(directory, app.app_id, "health.json")), app);
    } catch {
      return {
        app,
        phases: {
          prepare: { status: "incomplete" },
          verify: { status: "incomplete" },
          screenshots: { status: "incomplete" },
        },
        error: "missing, invalid, or mismatched job artifact",
      };
    }
  });
}

function cell(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replace(/[\n\r]/g, " ");
}

export function render(rows: ReportRow[]): string {
  const lines = [
    "# Flathub health",
    "",
    "A startup pass does not test every app function. A recipe failure can mean its steps no longer match the app.",
    "",
    "| App | Preparation and downloads | Startup | Recipe |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${[cell(row.app.name), ...phases.map((phase) => cell(row.phases[phase].status))].join(" | ")} |`,
    );
  }
  for (const row of rows) {
    lines.push(
      "",
      `## ${cell(row.app.app_id)}`,
      `Tested: ${cell("tested_at" in row ? row.tested_at : "unavailable")}`,
      `App version details: ${cell(JSON.stringify("resolved" in row ? row.resolved : {}))}`,
      `Runner: ${cell(JSON.stringify("runner" in row ? row.runner : {}))}`,
    );
    for (const phase of phases) {
      const metadata = row.phases[phase].metadata;
      const runner = "runner" in row ? row.runner : undefined;
      const configuredImage =
        phase === "verify"
          ? runner?.verify_image
          : phase === "screenshots"
            ? runner?.screenshots_image
            : undefined;
      const image = metadata?.runner_image.image ?? configuredImage;
      const imageVersion = metadata?.runner_image.version ?? runner?.version;
      const imageDigest =
        metadata?.runner_image.digest ??
        (phase === "verify"
          ? runner?.verify_digest?.split("@")[1]
          : phase === "screenshots"
            ? runner?.screenshots_digest?.split("@")[1]
            : undefined);
      lines.push(
        `- ${phase} app: ${cell(metadata?.app ? `${metadata.app.ref} (commit ${metadata.app.commit ?? "unavailable"})` : "unavailable")}`,
        `- ${phase} runtimes: ${cell(metadata?.runtimes?.length ? metadata.runtimes.map((runtime) => `${runtime.ref} (commit ${runtime.commit ?? "unavailable"})`).join(", ") : "unavailable")}`,
        `- ${phase} runner image: ${cell(imageVersion ?? "unavailable")} (${cell(image ?? "unavailable")}; digest ${cell(imageDigest ?? "unavailable")})`,
        `- ${phase} recipe content hash: ${cell(metadata?.recipe?.content_hash ?? "unavailable")}`,
        `- ${phase} recipe input digest: ${cell(metadata?.recipe?.input_digest ?? "unknown")}`,
        `- ${phase} failure category: ${cell(row.phases[phase].category ?? "unclassified")}`,
        `- ${phase} wrapper execution: ${cell(row.phases[phase].execution ? JSON.stringify(row.phases[phase].execution) : "unavailable")}`,
      );
      if (row.phases[phase].message)
        lines.push(`- ${phase}: ${cell(row.phases[phase].message)}`);
    }
    if ("error" in row) lines.push(cell(row.error));
  }
  return lines.join("\n") + "\n";
}

interface Snapshot {
  schema_version: number;
  run_id: string;
  run_attempt: string;
  rows: ReportRow[];
  missing?: boolean;
  unsupported?: boolean;
}

export function snapshots(directory: string): Snapshot[] {
  const collect = (path: string): string[] => {
    try {
      return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? collect(join(path, entry.name))
          : entry.isFile() && entry.name.endsWith(".json")
            ? [join(path, entry.name)]
            : [],
      );
    } catch {
      return [];
    }
  };
  const names = collect(directory);
  return names
    .flatMap((name) => {
      try {
        const value = readJson(name);
        if (typeof value !== "object" || value === null) return [];
        const snapshot = value as Snapshot;
        if (
          typeof snapshot.run_id !== "string" ||
          typeof snapshot.run_attempt !== "string" ||
          (snapshot.schema_version === 1 &&
            !Array.isArray(snapshot.rows) &&
            snapshot.missing !== true)
        )
          return [];
        if (snapshot.schema_version !== 1) {
          return [{ ...snapshot, rows: [], unsupported: true }];
        }
        return [snapshot];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Number(b.run_id) - Number(a.run_id));
}

export function compare(current: ReportRow[], previous: Snapshot[]): string[] {
  const changes: string[] = [];
  const latest = previous[0];
  if (latest?.missing) {
    changes.push(
      `- Previous workflow run ${latest.run_id} has no retained result record.`,
    );
  }
  if (latest?.unsupported) {
    changes.push(
      `- Previous workflow run ${latest.run_id} uses unsupported history schema ${latest.schema_version}.`,
    );
  }
  for (const row of current) {
    const before = latest?.rows.find(
      (candidate) => candidate.app.app_id === row.app.app_id,
    );
    const app = row.app.app_id;
    for (const [phase, label] of [
      ["verify", "startup"],
      ["screenshots", "recipe"],
    ] as const) {
      const now = row.phases[phase].status;
      const was = before?.phases[phase].status;
      const appFailure = phase === "verify" ? "app_failed" : "recipe_failed";
      if (
        latest?.missing ||
        latest?.unsupported ||
        !before ||
        !was ||
        (was !== "passed" && was !== appFailure) ||
        (now !== "passed" && now !== appFailure)
      ) {
        changes.push(
          `- ${app} ${label}: comparison unavailable (missing run or phase)`,
        );
      } else if (was === "passed" && now === appFailure) {
        changes.push(`- ${app} ${label}: newly failing (${was} → ${now})`);
      } else if (was === appFailure && now === "passed") {
        changes.push(`- ${app} ${label}: recovered (${was} → passed)`);
      }
    }
    if (before && "tested_at" in row && "tested_at" in before) {
      const startupVersions = (health: Health) =>
        JSON.stringify({
          appVersion: health.resolved.version,
          appCommit: health.phases.verify.metadata?.app?.commit,
          runtimes: health.phases.verify.metadata?.runtimes,
          runner: health.phases.verify.metadata?.runner_image,
          runnerRevision: health.runner.revision,
        });
      const recipeVersions = (health: Health) =>
        JSON.stringify({
          contentHash: health.phases.screenshots.metadata?.recipe?.content_hash,
          appCommit: health.phases.screenshots.metadata?.app?.commit,
          runtimes: health.phases.screenshots.metadata?.runtimes,
          runner: health.phases.screenshots.metadata?.runner_image,
          runnerRevision: health.runner.revision,
        });
      if (startupVersions(before) !== startupVersions(row))
        changes.push(`- ${app} startup environment/version changed`);
      if (recipeVersions(before) !== recipeVersions(row))
        changes.push(`- ${app} recipe environment/version changed`);
      if (row.app.recipe) {
        const oldDigest =
          before.phases.screenshots.metadata?.recipe?.input_digest;
        const newDigest = row.phases.screenshots.metadata?.recipe?.input_digest;
        if (
          !oldDigest ||
          !newDigest ||
          oldDigest.split(":")[0] !== newDigest.split(":")[0]
        )
          changes.push(
            `- ${app} recipe input comparison unavailable (missing or incompatible fixture-inclusive digest)`,
          );
        else if (oldDigest !== newDigest)
          changes.push(
            `- ${app} recipe inputs changed (YAML or seeded fixtures)`,
          );
      }
    }
  }
  return changes;
}

main(import.meta, () => {
  const args = argumentsFor(["input", "output", "history"]);
  const rows = aggregate(load(), args.input ?? join(ROOT, "artifacts"));
  const output = args.output ?? join(ROOT, "artifacts/report");
  mkdirSync(output, { recursive: true });
  writeJson(join(output, "report.json"), rows);
  const history = snapshots(args.history ?? join(ROOT, "history"));
  const summary = render(rows);
  const changes = compare(rows, history);
  const comparison = [
    "## Since the previous retained run",
    "",
    ...(history.length
      ? changes
      : ["- No previous retained run is available."]),
    "",
  ].join("\n");
  writeFileSync(join(output, "summary.md"), `${summary}\n${comparison}`);
  writeJson(join(output, "history.json"), {
    schema_version: 1,
    run_id: process.env.GITHUB_RUN_ID ?? "local",
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    rows,
  });
  process.exitCode = successful(rows) ? 0 : 1;
});
