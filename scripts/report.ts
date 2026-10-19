/** Absent, corrupt, or mismatched job artifacts are never successes. */
import { isDeepStrictEqual } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
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
    "Startup checks are not full functionality tests. Recipe failures do not label an app broken.",
    "",
    "| App | Preparation / downloads | Startup | Recipe |",
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
      `App provenance: ${cell(JSON.stringify("resolved" in row ? row.resolved : {}))}`,
      `Runner: ${cell(JSON.stringify("runner" in row ? row.runner : {}))}`,
    );
    for (const phase of phases) {
      if (row.phases[phase].message)
        lines.push(`- ${phase}: ${cell(row.phases[phase].message)}`);
    }
    if ("error" in row) lines.push(cell(row.error));
  }
  return lines.join("\n") + "\n";
}

main(import.meta, () => {
  const args = argumentsFor(["input", "output"]);
  const rows = aggregate(load(), args.input ?? join(ROOT, "artifacts"));
  const output = args.output ?? join(ROOT, "artifacts/report");
  mkdirSync(output, { recursive: true });
  writeJson(join(output, "report.json"), rows);
  writeFileSync(join(output, "summary.md"), render(rows));
  process.exitCode = successful(rows) ? 0 : 1;
});
