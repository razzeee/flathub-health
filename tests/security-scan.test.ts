import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadSecurity } from "../scripts/security-config.ts";
import { command } from "../scripts/process.ts";
import type { Executor } from "../scripts/process.ts";
import {
  inspectScan,
  scannerInput,
  scanInventory,
  validateScan,
} from "../scripts/security-scan.ts";
import { sha256 } from "../scripts/security.ts";
import { verifySecuritySite } from "../scripts/verify-security-site.ts";

const config = loadSecurity();
test("publication proof cannot succeed with missing page data or missing target records", async () => {
  await assert.rejects(
    verifySecuritySite(async () => Buffer.from("<html></html>")),
    /page data is missing/,
  );
  await assert.rejects(
    verifySecuritySite(async () =>
      Buffer.from(
        '<script id="page-data" type="application/json">{"security":{}}</script>',
      ),
    ),
  );
});
const properties = (scope: string) => [
  { name: "flatpak:scope", value: scope },
  { name: "flatpak:ref", value: `${scope}/org.example.Demo/x86_64/stable` },
  { name: "flatpak:commit", value: "a".repeat(64) },
];
function inventory() {
  return Buffer.from(
    JSON.stringify({
      $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      version: 1,
      metadata: {
        component: { type: "application", name: "fixture", "bom-ref": "root" },
      },
      components: [
        {
          type: "library",
          name: "lodash",
          version: "4.17.20",
          purl: "pkg:npm/lodash@4.17.20",
          "bom-ref": "app",
          properties: properties("app"),
        },
        {
          type: "library",
          name: "urllib3",
          version: "1.26.4",
          purl: "pkg:pypi/urllib3@1.26.4",
          "bom-ref": "runtime",
          properties: properties("runtime"),
        },
        {
          type: "library",
          name: "rejected",
          "bom-ref": "quarantined",
          properties: [
            { name: "flatpak:identity-status", value: "quarantined" },
          ],
        },
      ],
      dependencies: [
        { ref: "root", dependsOn: ["app", "runtime", "quarantined"] },
        { ref: "quarantined" },
      ],
      compositions: [
        {
          aggregate: "incomplete",
          assemblies: ["app", "runtime", "quarantined"],
        },
      ],
    }),
  );
}
const coverage = {
  inventory_complete: false,
  acquisition_complete: true,
  completeness_limitations: ["static dependencies"],
  scopes: {
    app: { content_scan: "completed", content_packages: 1, gaps: [] },
    runtime: { content_scan: "completed", content_packages: 1, gaps: [] },
  },
};
function report() {
  return {
    descriptor: {
      version: config.analysis!.grype.version,
      db: {
        status: {
          built: "2026-11-08T00:00:00Z",
          from: `https://example.org/db.tar.zst?checksum=sha256:${"a".repeat(64)}`,
          schemaVersion: "v6.1.10",
          valid: true,
        },
      },
    },
    matches: [
      {
        artifact: { id: "app", name: "lodash", version: "4.17.20" },
        vulnerability: {
          id: "GHSA-fixture",
          severity: "High",
          fix: { versions: ["4.17.21"] },
        },
        matchDetails: [{ type: "exact-direct-match" }],
      },
      {
        artifact: { id: "unattributed", name: "unknown" },
        vulnerability: { id: "CVE-fixture", severity: "future-severity" },
      },
    ],
  };
}
function temporary(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "security-scan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("scanner projection preserves identities and excludes quarantined graph references", () => {
  const bytes = inventory();
  const input = JSON.parse(scannerInput(bytes).toString());
  assert.equal(input.specVersion, "1.6");
  assert.equal(
    input.$schema,
    "https://cyclonedx.org/schema/bom-1.6.schema.json",
  );
  assert.deepEqual(
    input.components.map((c: { "bom-ref": string }) => c["bom-ref"]),
    ["app", "runtime"],
  );
  assert.deepEqual(input.dependencies, [
    { ref: "root", dependsOn: ["app", "runtime"] },
  ]);
  assert.deepEqual(input.compositions[0].assemblies, ["app", "runtime"]);
  assert.equal(JSON.parse(bytes.toString()).components.length, 3);
});

test("scan validates provenance, severity, fixes and unknown attribution rather than guessing", () => {
  const { findings, summary } = inspectScan(
    Buffer.from(JSON.stringify(report())),
    inventory(),
  );
  assert.equal(summary.matches, 2);
  assert.equal(summary.severities.High, 1);
  assert.equal(summary.severities.Unknown, 1);
  assert.deepEqual(summary.scopes, { app: 1, runtime: 0, unknown: 1 });
  assert.deepEqual(findings[0]!.fixes, ["4.17.21"]);
  for (const value of [
    {},
    { matches: [] },
    { ...report(), matches: [{}] },
    { ...report(), descriptor: {} },
  ])
    assert.throws(() =>
      inspectScan(Buffer.from(JSON.stringify(value)), inventory()),
    );
});

test("scan failures remain failures and publication rejects altered evidence and summaries", async (t) => {
  const root = temporary(t);
  const execute: Executor = async (args) => {
    if (args[0] === "python3") return { code: 0, stdout: "" };
    if (args[1] === "version")
      return {
        code: 0,
        stdout: JSON.stringify({ version: config.analysis!.grype.version }),
      };
    if (args[0] === "which") return { code: 0, stdout: join(root, "binary") };
    if (args[1] === "coverage")
      return { code: 0, stdout: JSON.stringify(coverage) };
    writeFileSync(args[args.indexOf("--file") + 1]!, JSON.stringify(report()));
    return { code: 0, stdout: "" };
  };
  writeFileSync(join(root, "binary"), "fixture binary");
  const bytes = inventory();
  const result = await scanInventory(
    bytes,
    root,
    "generator",
    config.analysis!,
    execute,
  );
  assert.notEqual(result, "not_requested");
  if (result === "not_requested" || result.status !== "completed") return;
  const input = readFileSync(join(root, "scanner-input.cdx.json"));
  const raw = readFileSync(join(root, "grype.json"));
  const coverageBytes = readFileSync(join(root, "coverage.json"));
  assert.equal(result.inventory_sha256, sha256(bytes));
  assert.equal(
    validateScan(result, bytes, input, raw, coverageBytes).findings.length,
    2,
  );
  assert.throws(() =>
    validateScan(result, bytes, input, Buffer.from("{}"), coverageBytes),
  );
  assert.throws(() =>
    validateScan({ ...result, matches: 0 }, bytes, input, raw, coverageBytes),
  );
  assert.throws(() =>
    validateScan(result, Buffer.from("{}"), input, raw, coverageBytes),
  );
  const failed = await scanInventory(
    bytes,
    root,
    "generator",
    config.analysis!,
    async () => {
      throw new Error("scanner unavailable");
    },
  );
  assert.deepEqual(failed, {
    status: "failed",
    message: "scanner unavailable",
  });
});

test(
  "real pinned Grype detects vulnerable app and runtime packages from the saved projection",
  { skip: !process.env.SECURITY_SCANNERS },
  async (t) => {
    const root = temporary(t);
    const bytes = inventory();
    const input = scannerInput(bytes);
    writeFileSync(join(root, "input.json"), input);
    await command(
      [
        "grype",
        `sbom:${join(root, "input.json")}`,
        "-o",
        "json",
        "--file",
        join(root, "grype.json"),
      ],
      join(root, "scan.log"),
      { timeoutMs: 600_000 },
    );
    const { findings, summary } = inspectScan(
      readFileSync(join(root, "grype.json")),
      input,
    );
    assert.equal(summary.scanner_version, config.analysis!.grype.version);
    assert.ok(
      findings.some((f) => f.package === "lodash" && f.scope === "app"),
    );
    assert.ok(
      findings.some((f) => f.package === "urllib3" && f.scope === "runtime"),
    );
  },
);
