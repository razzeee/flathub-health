import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { load } from "../../scripts/catalog.ts";
import type { App, ReportRow } from "../../scripts/model.ts";
import { loadSecurity } from "../../scripts/security-config.ts";
import { decodeSecurity } from "../../scripts/security-report.ts";
import { evidenceBytes, inspectInventory } from "../../scripts/security.ts";
import { validateScan } from "../../scripts/security-scan.ts";
import { validateCoverage } from "../../scripts/security-coverage.ts";
import {
  INVENTORY_LIMIT,
  INVENTORY_PUBLICATION_LIMIT,
  SECURITY_PUBLICATION_LIMIT,
  SCAN_LIMIT,
  securityReportSchema,
  securityRowSchema,
} from "../../scripts/security-model.ts";
import type { SecurityConfig } from "../../scripts/security-model.ts";
import type { SecurityView } from "../src/data.ts";

// Validate the envelope separately: one corrupt row must not erase other apps.
const envelopeSchema = securityReportSchema.extend({
  rows: z.array(z.unknown()).max(1000),
});
const identitySchema = z.object({ app: z.object({ app_id: z.string() }) });

export function prepareSecurity(
  rows: ReportRow[],
  artifacts: string,
  output: string,
  options: { config?: SecurityConfig; apps?: App[] } = {},
): { rows: ReportRow[]; security: Record<string, SecurityView> } {
  const config = options.config ?? loadSecurity();
  const targets = new Map(rows.map(({ app }) => [app.app_id, app]));
  for (const app of options.apps ?? load()) {
    if (config.apps.includes(app.app_id)) targets.set(app.app_id, app);
  }
  rmSync(join(output, "inventories"), { recursive: true, force: true });
  let report;
  try {
    report = envelopeSchema.parse(
      JSON.parse(
        evidenceBytes(
          artifacts,
          ["security-report", "security-report.json"],
          1024 * 1024,
        ).toString("utf8"),
      ),
    );
    if (
      (process.env.GITHUB_RUN_ID &&
        report.run_id !== process.env.GITHUB_RUN_ID) ||
      (process.env.GITHUB_RUN_ATTEMPT &&
        report.run_attempt !== process.env.GITHUB_RUN_ATTEMPT)
    )
      throw new Error("wrong security run");
  } catch {
    report = undefined;
  }
  let totalBytes = 0;
  let inventoryBytes = 0;
  const security: Record<string, SecurityView> = Object.fromEntries(
    [...targets.values()].map((app) => {
      const unavailable: SecurityView = {
        row: {
          app,
          status: "unavailable",
          message: "Inventory observation unavailable for this run",
        },
      };
      if (!report) return [app.app_id, unavailable];
      const candidates = report.rows.filter(
        (row) => identitySchema.safeParse(row).data?.app.app_id === app.app_id,
      );
      const candidate = securityRowSchema.safeParse(candidates[0]).data;
      if (
        candidates.length !== 1 ||
        !candidate ||
        !isDeepStrictEqual(candidate.app, app)
      )
        return [app.app_id, unavailable];
      const requested = report.requested && config.apps.includes(app.app_id);
      if (!requested)
        return [app.app_id, { row: { app, status: "not_requested" } }];
      if (candidate.status === "not_requested")
        return [app.app_id, unavailable];
      if (candidate.status === "unavailable")
        return [app.app_id, { row: candidate }];
      try {
        const row = decodeSecurity(
          candidate,
          app,
          config,
          report.run_id,
          report.run_attempt,
        );
        const view: SecurityView = { row };
        if (row.status === "completed") {
          try {
            const bytes = evidenceBytes(
              artifacts,
              [`security-evidence-${app.app_id}`, "inventory.cdx.json"],
              INVENTORY_LIMIT,
            );
            const inventory = inspectInventory(
              bytes,
              app,
              config.repository,
              config.generator.version,
              config.analysis?.syft.version,
            );
            if (!isDeepStrictEqual(inventory, row.inventory))
              throw new Error("inventory evidence mismatch");
            const dir = join(output, "inventories", app.app_id);
            const publish = (
              files: { name: string; bytes: Buffer }[],
              inventory = false,
            ) => {
              const size = files.reduce(
                (sum, file) => sum + file.bytes.length,
                0,
              );
              if (
                totalBytes + size > SECURITY_PUBLICATION_LIMIT ||
                (inventory &&
                  inventoryBytes + size > INVENTORY_PUBLICATION_LIMIT)
              )
                throw new Error("evidence publication limit exceeded");
              mkdirSync(dir, { recursive: true });
              for (const file of files) {
                writeFileSync(join(dir, file.name), file.bytes);
                totalBytes += file.bytes.length;
                if (inventory) inventoryBytes += file.bytes.length;
              }
            };
            publish([{ name: "inventory.cdx.json", bytes }], true);
            const base = `inventories/${encodeURIComponent(app.app_id)}`;
            view.inventoryUrl = `${base}/inventory.cdx.json`;
            if (row.coverage?.status === "completed") {
              try {
                const coverage = evidenceBytes(
                  artifacts,
                  [`security-evidence-${app.app_id}`, "coverage.json"],
                  SCAN_LIMIT,
                );
                const summary = validateCoverage(row.coverage, {
                  inventory: bytes,
                  coverage,
                });
                publish([{ name: "coverage.json", bytes: coverage }]);
                view.coverage = { summary, url: `${base}/coverage.json` };
              } catch {
                view.evidenceUnavailable = true;
              }
            }
            if (
              row.scan !== "not_requested" &&
              row.scan.status === "completed"
            ) {
              try {
                const scan = row.scan;
                const input = evidenceBytes(
                  artifacts,
                  [`security-evidence-${app.app_id}`, "scanner-input.cdx.json"],
                  SCAN_LIMIT,
                );
                const findings = evidenceBytes(
                  artifacts,
                  [`security-evidence-${app.app_id}`, "grype.json"],
                  SCAN_LIMIT,
                );
                const inspected = validateScan(scan, {
                  inventory: bytes,
                  input,
                  findings,
                });
                if (scan.scanner_version !== config.analysis?.grype.version)
                  throw new Error("unexpected scanner version");
                publish([
                  { name: "scanner-input.cdx.json", bytes: input },
                  { name: "grype.json", bytes: findings },
                ]);
                view.scan = {
                  findings: inspected.slice(0, 200),
                  findingsUrl: `${base}/grype.json`,
                  inputUrl: `${base}/scanner-input.cdx.json`,
                };
              } catch {
                view.evidenceUnavailable = true;
              }
            }
          } catch {
            view.evidenceUnavailable = true;
          }
        }
        return [app.app_id, view];
      } catch {
        return [app.app_id, unavailable];
      }
    }),
  );
  const joined = [...rows];
  if (report?.requested) {
    const present = new Set(rows.map(({ app }) => app.app_id));
    for (const { row } of Object.values(security)) {
      if (
        !present.has(row.app.app_id) &&
        config.apps.includes(row.app.app_id)
      ) {
        joined.push({
          app: row.app,
          phases: {
            prepare: { status: "incomplete" },
            verify: { status: "incomplete" },
            screenshots: {
              status: row.app.recipe ? "incomplete" : "not_requested",
            },
          },
          error: "Missing smoke result; inventory observation is independent",
        });
      }
    }
  }
  return { rows: joined, security };
}
