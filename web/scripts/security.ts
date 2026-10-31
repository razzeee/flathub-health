import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { load } from "../../scripts/catalog.ts";
import type { App, ReportRow } from "../../scripts/model.ts";
import { loadSecurity } from "../../scripts/security-config.ts";
import { decodeSecurity } from "../../scripts/security-report.ts";
import { evidenceBytes, inspectInventory } from "../../scripts/security.ts";
import {
  INVENTORY_LIMIT,
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
            );
            if (
              !isDeepStrictEqual(inventory, row.inventory) ||
              totalBytes + bytes.length > 32 * 1024 * 1024
            )
              throw new Error(
                "inventory evidence mismatch or publication limit exceeded",
              );
            const dir = join(output, "inventories", app.app_id);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, "inventory.cdx.json"), bytes);
            totalBytes += bytes.length;
            view.inventoryUrl = `inventories/${encodeURIComponent(app.app_id)}/inventory.cdx.json`;
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
