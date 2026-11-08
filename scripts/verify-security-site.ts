import { join } from "node:path";
import { z } from "zod";
import { argumentsFor, main } from "./io.ts";
import { load } from "./catalog.ts";
import { loadSecurity } from "./security-config.ts";
import { decodeSecurity } from "./security-report.ts";
import { evidenceBytes, inspectInventory } from "./security.ts";
import { INVENTORY_LIMIT, SCAN_LIMIT } from "./security-model.ts";
import { validateScan } from "./security-scan.ts";

const pageSchema = z.object({
  security: z.record(
    z.string(),
    z.object({ row: z.unknown(), scan: z.unknown().optional() }),
  ),
});

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
    if (!response.ok)
      throw new Error(`published evidence returned ${response.status}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body!) {
      size += chunk.length;
      if (size > limit)
        throw new Error("published evidence exceeds size limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const html = (await get(["index.html"], 16 * 1024 * 1024)).toString("utf8");
  const serialized = html.match(
    /<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!serialized) throw new Error("page data is missing");
  const page = pageSchema.parse(JSON.parse(serialized));
  const config = loadSecurity();
  const proofs = [];
  for (const app of load().filter((app) => config.apps.includes(app.app_id))) {
    const view = page.security[app.app_id];
    const record = decodeSecurity(
      view?.row,
      app,
      config,
      process.env.GITHUB_RUN_ID ?? "local",
      process.env.GITHUB_RUN_ATTEMPT ?? "1",
    );
    if (
      record.status !== "completed" ||
      record.scan === "not_requested" ||
      record.scan.status !== "completed" ||
      !view?.scan
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
    if (inspected.evidence.sha256 !== record.inventory.evidence.sha256)
      throw new Error("published inventory mismatch");
    const [input, raw, coverage] = await Promise.all(
      ["scanner-input.cdx.json", "grype.json", "coverage.json"].map((path) =>
        get([...parts, path], SCAN_LIMIT),
      ),
    );
    validateScan(record.scan, inventory, input!, raw!, coverage!);
    proofs.push({
      app_id: app.app_id,
      inventory_sha256: inspected.evidence.sha256,
      scanner_input_sha256: record.scan.evidence.input.sha256,
      findings_sha256: record.scan.evidence.findings.sha256,
      matches: record.scan.matches,
    });
  }
  if (proofs.length !== config.apps.length)
    throw new Error("missing expected targets");
  console.log(
    JSON.stringify(
      { source: args.url ?? join(root, "index.html"), proofs },
      null,
      2,
    ),
  );
});
