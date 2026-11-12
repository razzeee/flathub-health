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
  publishedFindings,
  scannerInput,
  scanInventory,
  validateScan,
} from "../scripts/security-scan.ts";
import { sha256 } from "../scripts/security.ts";
import { verifySecuritySite } from "../scripts/verify-security-site.ts";
import {
  observeCoverage,
  validateCoverage,
} from "../scripts/security-coverage.ts";
import { responseBytes } from "../scripts/http.ts";

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

test("scan retains the highest valid primary or related CVSS score and its provenance", () => {
  const score = (baseScore: unknown, version = "3.1", source = "nvd") => ({
    version,
    source,
    metrics: { baseScore },
  });
  const inspect = (cvss: unknown[], related: unknown[] = []) => {
    const data = report();
    const match = data.matches[0]!;
    return inspectScan(
      Buffer.from(
        JSON.stringify({
          ...data,
          matches: [
            {
              ...match,
              vulnerability: { ...match.vulnerability, cvss },
              relatedVulnerabilities: [{ cvss: related }],
            },
          ],
        }),
      ),
      inventory(),
    ).findings[0]!;
  };
  assert.deepEqual(inspect([score(7.5), score(9.8)]).cvss, {
    score: 9.8,
    version: "3.1",
    source: "nvd",
  });
  assert.deepEqual(inspect([score(7.5)], [score(9.9, "4.0", "vendor")]).cvss, {
    score: 9.9,
    version: "4.0",
    source: "vendor",
  });
  assert.equal(inspect([score(0)]).cvss?.score, 0);
  assert.equal(inspect([]).cvss, undefined);
  assert.equal(
    inspect([null, {}, score(-1), score(11), score("9.8")]).cvss,
    undefined,
  );
});

test("publication sorts CVSS before limiting each scope and falls back to severity with stable ties", () => {
  const base = inspectScan(Buffer.from(JSON.stringify(report())), inventory())
    .findings[0]!;
  const findings = [
    ...Array.from({ length: 205 }, (_, i) => ({
      ...base,
      vulnerability: `CVE-low-${i}`,
      severity: "Low" as const,
    })),
    { ...base, vulnerability: "CVE-high", severity: "Critical" as const },
    {
      ...base,
      vulnerability: "CVE-score-b",
      cvss: { score: 9.8, version: "3.1" },
    },
    {
      ...base,
      vulnerability: "CVE-score-a",
      cvss: { score: 9.8, version: "3.1" },
    },
    { ...base, vulnerability: "CVE-zero", cvss: { score: 0, version: "3.1" } },
    { ...base, scope: "runtime" as const },
    { ...base, scope: "unknown" as const },
  ];
  const original = [...findings];
  const result = publishedFindings(findings);
  assert.deepEqual(
    result.slice(0, 4).map((f) => f.vulnerability),
    ["CVE-score-a", "CVE-score-b", "CVE-zero", "CVE-high"],
  );
  assert.equal(result.length, 202);
  assert.equal(result[200]!.scope, "runtime");
  assert.equal(result[201]!.scope, "unknown");
  assert.deepEqual(findings, original);
  assert.deepEqual(publishedFindings([...findings].reverse()), result);
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
    writeFileSync(args[args.indexOf("--file") + 1]!, JSON.stringify(report()));
    return { code: 0, stdout: "" };
  };
  writeFileSync(join(root, "binary"), "fixture binary");
  const bytes = inventory();
  const result = await scanInventory(bytes, root, config.analysis!, execute);
  assert.notEqual(result, "not_requested");
  if (result === "not_requested" || result.status !== "completed") return;
  const input = readFileSync(join(root, "scanner-input.cdx.json"));
  const raw = readFileSync(join(root, "grype.json"));
  const evidence = { inventory: bytes, input, findings: raw };
  assert.equal(result.inventory_sha256, sha256(bytes));
  assert.equal(validateScan(result, evidence).length, 2);
  assert.throws(() =>
    validateScan(result, { ...evidence, findings: Buffer.from("{}") }),
  );
  assert.throws(() => validateScan({ ...result, matches: 0 }, evidence));
  assert.throws(() =>
    validateScan(result, { ...evidence, inventory: Buffer.from("{}") }),
  );
  const failed = await scanInventory(
    bytes,
    root,
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

test("coverage evidence is independent of scanner availability and rejects tampering", async (t) => {
  const root = temporary(t);
  const bytes = inventory();
  const observed = await observeCoverage(
    bytes,
    root,
    "generator",
    async () => ({ code: 0, stdout: JSON.stringify(coverage) }),
  );
  assert.equal(observed.status, "completed");
  if (observed.status !== "completed") return;
  const evidence = {
    inventory: bytes,
    coverage: readFileSync(join(root, "coverage.json")),
  };
  assert.equal(
    validateCoverage(observed, evidence).scopes.app.content_packages,
    1,
  );
  const failed = await scanInventory(
    bytes,
    root,
    config.analysis!,
    async () => {
      throw new Error("scanner unavailable");
    },
  );
  assert.deepEqual(failed, {
    status: "failed",
    message: "scanner unavailable",
  });
  assert.deepEqual(
    readFileSync(join(root, "coverage.json")),
    evidence.coverage,
  );
  assert.throws(
    () =>
      validateCoverage(observed, { ...evidence, coverage: Buffer.from("{}") }),
    /mismatch/,
  );
  assert.throws(
    () =>
      validateCoverage(observed, { ...evidence, inventory: Buffer.from("{}") }),
    /mismatch/,
  );
  assert.equal(
    (
      await observeCoverage(bytes, root, "generator", async () => {
        throw new Error("coverage failed");
      })
    ).status,
    "failed",
  );
});

test("bounded HTTP responses reject errors, enforce byte limits and cancel oversized streams", async () => {
  assert.deepEqual(
    await responseBytes(new Response("1234"), 4),
    Buffer.from("1234"),
  );
  assert.equal(
    (await responseBytes(new Response(null, { status: 204 }), 0)).length,
    0,
  );
  await assert.rejects(
    responseBytes(new Response("failure", { status: 503 }), 20),
    /503/,
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(3));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(responseBytes(new Response(body), 5), /size limit/);
  assert.equal(cancelled, true);
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
