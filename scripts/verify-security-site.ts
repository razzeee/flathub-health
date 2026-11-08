import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { argumentsFor, main } from "./io.ts";
import { load } from "./catalog.ts";
import { loadSecurity } from "./security-config.ts";
import { decodeSecurity } from "./security-report.ts";
import { evidenceBytes, inspectInventory } from "./security.ts";
import { INVENTORY_LIMIT, SCAN_LIMIT } from "./security-model.ts";
import type { SecurityConfig } from "./security-model.ts";
import type { App } from "./model.ts";
import { validateScan } from "./security-scan.ts";
import { validateCoverage } from "./security-coverage.ts";
import { responseBytes } from "./http.ts";

const pageSchema = z.object({
  security: z.record(
    z.string(),
    z.object({
      row: z.unknown(),
      scan: z.unknown().optional(),
      coverage: z.unknown().optional(),
      inventoryUrl: z.string().optional(),
    }),
  ),
});

export async function verifySecuritySite(
  get: (parts: string[], limit: number) => Promise<Buffer>,
  options: {
    config?: SecurityConfig;
    apps?: App[];
    runId?: string;
    attempt?: string;
  } = {},
) {
  const html = (await get(["index.html"], 16 * 1024 * 1024)).toString("utf8");
  const serialized = html.match(
    /<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!serialized) throw new Error("page data is missing");
  const page = pageSchema.parse(JSON.parse(serialized));
  const config = options.config ?? loadSecurity();
  const proofs = [];
  for (const app of (options.apps ?? load()).filter((app) =>
    config.apps.includes(app.app_id),
  )) {
    const view = page.security[app.app_id];
    const record = decodeSecurity(
      view?.row,
      app,
      config,
      options.runId ?? process.env.GITHUB_RUN_ID ?? "local",
      options.attempt ?? process.env.GITHUB_RUN_ATTEMPT ?? "1",
    );
    if (
      record.status !== "completed" ||
      record.scan === "not_requested" ||
      record.scan.status !== "completed" ||
      !view?.scan ||
      record.coverage?.status !== "completed" ||
      !view.coverage
    )
      throw new Error(
        `${app.app_id}: a validated content inventory and scan are required`,
      );
    const parts = ["inventories", app.app_id];
    const inventory = await get(
      [...parts, "inventory.cdx.json"],
      INVENTORY_LIMIT,
    );
    const inspected = inspectInventory(
      inventory,
      app,
      config.repository,
      config.generator.version,
      config.analysis?.syft.version,
    );
    const base = `inventories/${encodeURIComponent(app.app_id)}`;
    if (
      !isDeepStrictEqual(inspected, record.inventory) ||
      view.inventoryUrl !== `${base}/inventory.cdx.json`
    )
      throw new Error("published inventory mismatch");
    const [input, findings, coverage] = await Promise.all(
      ["scanner-input.cdx.json", "grype.json", "coverage.json"].map((path) =>
        get([...parts, path], SCAN_LIMIT),
      ),
    );
    const validated = validateScan(record.scan, {
      inventory,
      input: input!,
      findings: findings!,
    });
    const summary = validateCoverage(record.coverage, {
      inventory,
      coverage: coverage!,
    });
    if (
      !isDeepStrictEqual(view.scan, {
        findings: validated.slice(0, 200),
        findingsUrl: `${base}/grype.json`,
        inputUrl: `${base}/scanner-input.cdx.json`,
      })
    )
      throw new Error("published scan view mismatch");
    if (
      !isDeepStrictEqual(view.coverage, {
        summary,
        url: `${base}/coverage.json`,
      })
    )
      throw new Error("published coverage view mismatch");
    proofs.push({
      app_id: app.app_id,
      inventory_sha256: inspected.evidence.sha256,
      scanner_input_sha256: record.scan.evidence.input.sha256,
      findings_sha256: record.scan.evidence.findings.sha256,
      coverage_sha256: record.coverage.evidence.sha256,
      matches: record.scan.matches,
    });
  }
  if (proofs.length !== config.apps.length)
    throw new Error("missing expected targets");
  return proofs;
}

main(import.meta, async () => {
  const args = argumentsFor(["directory", "url"]);
  const root = args.directory ?? "site";
  const get = async (parts: string[], limit: number) => {
    if (!args.url) return evidenceBytes(root, parts, limit);
    const base = new URL(args.url.endsWith("/") ? args.url : `${args.url}/`);
    const response = await fetch(
      new URL(parts.map(encodeURIComponent).join("/"), base),
      { cache: "no-store", signal: AbortSignal.timeout(60_000) },
    );
    return responseBytes(response, limit);
  };
  const proofs = await verifySecuritySite(get);
  console.log(
    JSON.stringify(
      { source: args.url ?? join(root, "index.html"), proofs },
      null,
      2,
    ),
  );
});
