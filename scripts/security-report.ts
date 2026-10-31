/** Independent security records never change smoke-test verdicts or history. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { load } from "./catalog.ts";
import { argumentsFor, main, ROOT, writeJson } from "./io.ts";
import type { App } from "./model.ts";
import { loadSecurity } from "./security-config.ts";
import { evidenceBytes } from "./security.ts";
import {
  RECORD_LIMIT,
  SECURITY_LIMITATIONS,
  securityRecordSchema,
  securityReportSchema,
} from "./security-model.ts";
import type {
  SecurityConfig,
  SecurityRecord,
  SecurityRow,
} from "./security-model.ts";

export function decodeSecurity(
  value: unknown,
  app: App,
  config: SecurityConfig,
  runId: string,
  attempt: string,
): SecurityRecord {
  const record = securityRecordSchema.parse(value);
  if (
    !isDeepStrictEqual(record.app, app) ||
    record.repository !== config.repository ||
    !isDeepStrictEqual(record.generator, config.generator) ||
    record.run_id !== runId ||
    record.run_attempt !== attempt ||
    (record.status === "completed" &&
      record.inventory.app.ref !==
        `app/${app.app_id}/${app.arch}/${app.branch}`)
  ) {
    throw new Error("security record identity mismatch");
  }
  return record;
}

export function aggregateSecurity(
  apps: App[],
  directory: string,
  config: SecurityConfig,
  requested: boolean,
  runId = "local",
  attempt = "1",
) {
  const rows: SecurityRow[] = apps.map((app) => {
    if (!requested || !config.apps.includes(app.app_id))
      return { app, status: "not_requested" };
    try {
      return decodeSecurity(
        JSON.parse(
          evidenceBytes(
            directory,
            [`security-record-${app.app_id}`, "security.json"],
            RECORD_LIMIT,
          ).toString("utf8"),
        ),
        app,
        config,
        runId,
        attempt,
      );
    } catch {
      return {
        app,
        status: "unavailable",
        message: "Missing, invalid or mismatched inventory record",
      };
    }
  });
  return securityReportSchema.parse({
    schema_version: 1,
    run_id: runId,
    run_attempt: attempt,
    requested,
    rows,
  });
}

export function renderSecurity(rows: SecurityRow[]): string {
  const lines = ["## Manifest inventory pilot", "", SECURITY_LIMITATIONS, ""];
  for (const row of rows) {
    lines.push(`- ${row.app.app_id}: ${row.status}`);
    if (row.status === "completed") {
      lines.push(
        `  - Generated: ${row.inventory.generated_at}; app commit: ${row.inventory.app.commit}; runtime commit: ${row.inventory.runtime.commit}`,
      );
      for (const scope of ["app", "runtime"] as const) {
        const counts = row.inventory.sources[scope];
        lines.push(
          `  - ${scope}: ${counts.identified}/${counts.sources} manifest sources have inferred package identities (${counts.versioned} versioned). Inventory incomplete.`,
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}

main(import.meta, () => {
  const args = argumentsFor(["input", "output", "requested"]);
  if (args.requested !== "true" && args.requested !== "false")
    throw new Error("--requested must be true or false");
  const report = aggregateSecurity(
    load(),
    args.input ?? join(ROOT, "downloads"),
    loadSecurity(),
    args.requested === "true",
    process.env.GITHUB_RUN_ID ?? "local",
    process.env.GITHUB_RUN_ATTEMPT ?? "1",
  );
  const output = args.output ?? join(ROOT, "artifacts/security-report");
  mkdirSync(output, { recursive: true });
  writeJson(join(output, "security-report.json"), report);
  writeFileSync(join(output, "summary.md"), renderSecurity(report.rows));
  process.exitCode = report.rows.every(
    (row) => row.status === "completed" || row.status === "not_requested",
  )
    ? 0
    : 1;
});
