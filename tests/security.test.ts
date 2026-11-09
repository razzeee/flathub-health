import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { loadSecurity } from "../scripts/security-config.ts";
import { load } from "../scripts/catalog.ts";
import { aggregateSecurity } from "../scripts/security-report.ts";
import {
  INVENTORY_LIMIT,
  securityRecordSchema,
  INVENTORY_PUBLICATION_LIMIT,
  SECURITY_PUBLICATION_LIMIT,
} from "../scripts/security-model.ts";
import type { SecurityConfig } from "../scripts/security-model.ts";
import {
  describeEvidence,
  evidenceBytes,
  inspectInventory,
  observeSecurity,
  sha256,
} from "../scripts/security.ts";
import { verifySecuritySite } from "../scripts/verify-security-site.ts";
import type { Executor } from "../scripts/process.ts";
import type { App, ReportRow } from "../scripts/model.ts";
import { prepareSecurity } from "../web/scripts/security.ts";
import { build, prerender } from "../web/scripts/build.ts";
import { inventoryRelation } from "../web/src/components/SecurityObservation.tsx";
import { inspectScan, scannerInput } from "../scripts/security-scan.ts";

const app: App = {
  app_id: "org.example.Demo",
  name: "Demo",
  branch: "stable",
  arch: "x86_64",
  limitations: "Fixture",
};
const appRef = `app/${app.app_id}/x86_64/stable`;
const runtimeRef = "runtime/org.example.Platform/x86_64/1";
const appCommit = "a".repeat(64);
const runtimeCommit = "b".repeat(64);
const health: ReportRow = {
  app,
  phases: {
    prepare: { status: "incomplete" },
    verify: { status: "incomplete" },
    screenshots: { status: "not_requested" },
  },
  error: "Fixture",
};
const defaultConfig = { ...loadSecurity(), analysis: undefined };

function temporary(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "health-security-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function setup(
  root: string,
  config: SecurityConfig = { ...defaultConfig, apps: [app.app_id] },
) {
  writeFileSync(
    join(root, "apps.json"),
    JSON.stringify({ schema_version: 1, apps: [app] }),
  );
  writeFileSync(join(root, "security.json"), JSON.stringify(config));
  mkdirSync(join(root, ".sbom/target/release"), { recursive: true });
  writeFileSync(
    join(root, ".sbom/target/release/flatpak-sbom"),
    "fixture binary",
  );
  return config;
}

function bom() {
  const properties = (scope: string) => [
    { name: "flatpak:scope", value: scope },
    { name: "flatpak:repo-url", value: defaultConfig.repository },
    { name: "flatpak:inventory-kind", value: "manifest-derived" },
    { name: "flatpak:ref", value: scope === "app" ? appRef : runtimeRef },
    {
      name: "flatpak:commit",
      value: scope === "app" ? appCommit : runtimeCommit,
    },
    { name: "flatpak:manifest-path", value: "files/manifest.json" },
  ];
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    metadata: {
      timestamp: "2026-10-31T00:00:00Z",
      component: { "bom-ref": "root", properties: properties("app") },
      tools: { components: [{ name: "flatpak-sbom", version: "0.1.0" }] },
    },
    components: [
      { "bom-ref": "app", properties: properties("app") },
      { "bom-ref": "runtime", properties: properties("runtime") },
      {
        "bom-ref": "source/0",
        purl: "pkg:cargo/demo@1.0",
        properties: [
          ...properties("app"),
          { name: "flatpak:source-type", value: "archive" },
        ],
      },
      {
        "bom-ref": "source/1",
        properties: [
          ...properties("app"),
          { name: "flatpak:source-type", value: "archive" },
        ],
      },
    ],
    dependencies: [{ ref: "root", dependsOn: ["app", "runtime"] }],
    compositions: [{ aggregate: "incomplete" }],
  };
}

function executor(document: unknown = bom(), fail?: string): Executor {
  return async (args) => {
    if (args.includes("rev-parse"))
      return { code: 0, stdout: defaultConfig.generator.revision };
    if (args.includes("status")) return { code: 0, stdout: "" };
    if (args.includes("--version"))
      return { code: 0, stdout: "flatpak-sbom 0.1.0" };
    assert.equal(args[1], "generate");
    assert.equal(args[2], appRef);
    if (fail) throw new Error(fail);
    writeFileSync(
      args[args.indexOf("--output") + 1]!,
      JSON.stringify(document),
    );
    return { code: 0, stdout: "" };
  };
}

function publish(root: string, record: unknown, config: SecurityConfig) {
  const records = join(root, "downloads", `security-record-${app.app_id}`);
  mkdirSync(records, { recursive: true });
  writeFileSync(join(records, "security.json"), JSON.stringify(record));
  const report = aggregateSecurity(
    [app],
    join(root, "downloads"),
    config,
    true,
    process.env.GITHUB_RUN_ID ?? "local",
    process.env.GITHUB_RUN_ATTEMPT ?? "1",
  );
  const reportDir = join(root, "downloads/security-report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, "security-report.json"),
    JSON.stringify(report),
  );
  const evidence = join(root, "downloads", `security-evidence-${app.app_id}`);
  mkdirSync(evidence, { recursive: true });
  cpSync(
    join(root, "observations", app.app_id, "inventory.cdx.json"),
    join(evidence, "inventory.cdx.json"),
  );
  return report;
}

test("observation to publication preserves incomplete coverage, hashes and independent provenance", async (t) => {
  const root = temporary(t);
  const config = setup(root);
  const record = await observeSecurity(app, join(root, "observations"), {
    root,
    execute: executor(),
  });
  assert.equal(record.status, "completed");
  if (record.status !== "completed") return;
  assert.equal(record.scan, "not_requested");
  assert.deepEqual(record.inventory.sources.app, {
    sources: 2,
    identified: 1,
    versioned: 1,
  });
  assert.equal(record.inventory.completeness, "incomplete");
  assert.equal(publish(root, record, config).rows[0]!.status, "completed");
  const view = prepareSecurity(
    [health],
    join(root, "downloads"),
    join(root, "site"),
    { config, apps: [app] },
  );
  assert.ok(view.security[app.app_id]!.inventoryUrl);
  const html = prerender("<!--app-->", {
    rows: [health],
    images: {},
    runUrl: "",
    security: view.security,
  });
  assert.match(html, /Generated · incomplete coverage/);
  assert.match(html, /FRESHNESS UNVERIFIED/);
  assert.match(html, /Vulnerability scan: not performed/);
  assert.match(html, /not proof of safety/);
  assert.match(html, /Download CycloneDX 1.7/);
  assert.match(html, /not the percentage of installed dependencies covered/);
  const metadata = {
    app: { ref: appRef, commit: appCommit },
    runtimes: [{ ref: runtimeRef, commit: runtimeCommit }],
    recipe: null,
    runner_image: { version: "v1", image: "test", digest: null },
  };
  assert.equal(
    inventoryRelation(record.inventory, { status: "incomplete" }),
    "Unavailable",
  );
  assert.equal(
    inventoryRelation(record.inventory, { status: "passed", metadata }),
    "App and base runtime match",
  );
  assert.equal(
    inventoryRelation(record.inventory, {
      status: "passed",
      metadata: {
        ...metadata,
        runtimes: [{ ref: runtimeRef, commit: "c".repeat(64) }],
      },
    }),
    "Different runtime snapshot",
  );
  assert.equal(
    inventoryRelation(record.inventory, {
      status: "passed",
      metadata: { ...metadata, app: { ref: appRef, commit: "c".repeat(64) } },
    }),
    "Different app snapshot",
  );
  await assert.rejects(
    observeSecurity(app, join(root, "observations"), {
      root,
      execute: executor(),
    }),
    /EEXIST/,
  );
});

test("published coverage survives a failed vulnerability scan", async (t) => {
  const root = temporary(t);
  const config = setup(root);
  const record = await observeSecurity(app, join(root, "observations"), {
    root,
    execute: executor(),
  });
  assert.equal(record.status, "completed");
  if (record.status !== "completed") return;
  const coverage = Buffer.from(
    JSON.stringify({
      inventory_complete: false,
      acquisition_complete: true,
      completeness_limitations: ["static dependencies"],
      scopes: {
        app: { content_scan: "completed", content_packages: 3, gaps: [{}] },
        runtime: { content_scan: "completed", content_packages: 2, gaps: [] },
      },
    }),
  );
  const failed = {
    ...record,
    scan: { status: "failed", message: "Grype timed out" },
    coverage: {
      status: "completed",
      inventory_sha256: record.inventory.evidence.sha256,
      evidence: {
        path: "coverage.json",
        sha256: sha256(coverage),
        bytes: coverage.length,
      },
    },
  };
  publish(root, failed, config);
  writeFileSync(
    join(root, "downloads", `security-evidence-${app.app_id}`, "coverage.json"),
    coverage,
  );
  const prepared = prepareSecurity(
    [health],
    join(root, "downloads"),
    join(root, "site"),
    { config, apps: [app] },
  );
  const view = prepared.security[app.app_id]!;
  assert.equal(view.row.status, "completed");
  assert.equal(view.coverage?.summary.scopes.app.content_packages, 3);
  assert.ok(view.coverage?.url);
  const html = prerender("<!--app-->", {
    ...prepared,
    images: {},
    runUrl: "",
  }).replaceAll("<!-- -->", "");
  assert.match(html, /Vulnerability scan: failed/);
  assert.match(html, /3 package records; 1 recorded gaps/);
  assert.match(html, /Download coverage evidence/);
  assert.doesNotMatch(html, /scanner matches requiring triage/);
});

test("findings are published and rendered separately by fix ownership, with per-group limits", async (t) => {
  const root = temporary(t);
  setup(root);
  const document = bom();
  document.metadata.component.properties.find(
    (property) => property.name === "flatpak:inventory-kind",
  )!.value = "manifest-and-content";
  for (const scope of ["app", "runtime"])
    document.metadata.component.properties.push(
      {
        name: `flatpak:content-scanner-version:${scope}`,
        value: loadSecurity().analysis!.syft.version,
      },
      {
        name: `flatpak:content-scan:${scope}`,
        value: "syft-asar-and-native-metadata",
      },
    );
  const record = await observeSecurity(app, join(root, "observations"), {
    root,
    execute: executor(document),
  });
  assert.equal(record.status, "completed");
  if (record.status !== "completed") return;
  const config = {
    ...defaultConfig,
    apps: [app.app_id],
    analysis: loadSecurity().analysis,
  };
  record.content_scanner = {
    version: config.analysis!.syft.version,
    binary_sha256: "a".repeat(64),
  };
  const input = scannerInput(Buffer.from(JSON.stringify(document)));
  const match = (scope: string, index: number) => ({
    artifact: { id: scope, name: `${scope}-package-${index}`, version: "1.0" },
    vulnerability: {
      id: `CVE-${scope}-${index}`,
      severity: "High",
      fix: { versions: ["2.0"] },
    },
    matchDetails: [{ type: "exact-direct-match" }],
  });
  const findings = Buffer.from(
    JSON.stringify({
      descriptor: {
        version: config.analysis!.grype.version,
        db: {
          status: {
            built: "2026-11-08T00:00:00Z",
            from: `https://example.org/db?checksum=sha256:${"a".repeat(64)}`,
            schemaVersion: "v6.1.10",
            valid: true,
          },
        },
      },
      matches: [
        ...Array.from({ length: 205 }, (_, i) => match("runtime", i)),
        match("app", 0),
        match("unknown", 0),
      ],
    }),
  );
  const { summary } = inspectScan(findings, input);
  record.scan = {
    status: "completed",
    finished_at: "2026-11-08T01:00:00Z",
    inventory_sha256: record.inventory.evidence.sha256,
    scanner_sha256: "a".repeat(64),
    ...summary,
    evidence: {
      input: describeEvidence("scanner-input.cdx.json", input),
      findings: describeEvidence("grype.json", findings),
    },
  };
  const coverage = Buffer.from(
    JSON.stringify({
      inventory_complete: false,
      acquisition_complete: true,
      completeness_limitations: [],
      scopes: {
        app: { content_scan: "completed", content_packages: 1, gaps: [] },
        runtime: { content_scan: "completed", content_packages: 1, gaps: [] },
      },
    }),
  );
  record.coverage = {
    status: "completed",
    inventory_sha256: record.inventory.evidence.sha256,
    evidence: describeEvidence("coverage.json", coverage),
  };
  publish(root, record, config);
  const evidence = join(root, "downloads", `security-evidence-${app.app_id}`);
  writeFileSync(join(evidence, "scanner-input.cdx.json"), input);
  writeFileSync(join(evidence, "grype.json"), findings);
  writeFileSync(join(evidence, "coverage.json"), coverage);
  const prepared = prepareSecurity(
    [health],
    join(root, "downloads"),
    join(root, "site"),
    { config, apps: [app] },
  );
  const view = prepared.security[app.app_id]!;
  assert.equal(view.scan?.findings.length, 202, JSON.stringify(view));
  const render = () =>
    prerender("<!--app-->", {
      rows: [health],
      images: {},
      runUrl: "",
      security: prepared.security,
    });
  const html = render().replaceAll("<!-- -->", "");
  const group = (title: string) =>
    html.split(`<section aria-label="${title}">`)[1]!.split("</section>")[0]!;
  assert.match(group("App dependencies"), /App maintainers: update/);
  assert.match(group("App dependencies"), /app-package-0/);
  assert.doesNotMatch(group("App dependencies"), /runtime-package/);
  assert.match(group("Runtime dependencies"), /Runtime maintainers: update/);
  assert.match(group("Runtime dependencies"), /Showing 200 of 205 matches/);
  assert.doesNotMatch(group("Runtime dependencies"), /app-package/);
  assert.match(group("Unknown attribution"), /Triage the package origin/);
  assert.match(group("Unknown attribution"), /unknown-package-0/);
  assert.match(html, /Fix versions: 2.0/);
  assert.match(html, /exact-direct-match/);
  assert.match(html, /Download Grype findings/);
  const pagePath = join(root, "site/index.html");
  const template =
    '<!--app--><script id="page-data" type="application/json"></script>';
  const writePage = () =>
    writeFileSync(
      pagePath,
      prerender(template, {
        rows: [health],
        images: {},
        runUrl: "",
        security: prepared.security,
      }),
    );
  writePage();
  const get = async (parts: string[], limit: number) =>
    evidenceBytes(join(root, "site"), parts, limit);
  assert.equal(
    (await verifySecuritySite(get, { config, apps: [app] })).length,
    1,
  );
  const published = view.scan!.findings;
  view.scan!.findings = inspectScan(findings, input).findings.slice(0, 200);
  writePage();
  await assert.rejects(
    verifySecuritySite(get, { config, apps: [app] }),
    /published scan view mismatch/,
  );
  view.scan!.findings = published;
  if (
    view.row.status !== "completed" ||
    view.row.scan === "not_requested" ||
    view.row.scan.status !== "completed"
  )
    return;
  view.row.scan.scopes.app = 0;
  view.scan!.findings = view.scan!.findings.filter(
    (finding) => finding.scope !== "app",
  );
  assert.match(render(), /No scanner matches attributed to this group/);
});

test("later app inventories cannot exceed the total evidence budget", async (t) => {
  const root = temporary(t);
  const configured = setup(root);
  const prototype = await observeSecurity(app, join(root, "observations"), {
    root,
    execute: executor(),
  });
  assert.equal(prototype.status, "completed");
  if (prototype.status !== "completed") return;
  const apps = Array.from({ length: 5 }, (_, index) => ({
    ...app,
    app_id: `org.example.Budget${index}`,
  }));
  const config = { ...configured, apps: apps.map((app) => app.app_id) };
  const downloads = join(root, "downloads");
  const mib = 1024 * 1024;
  for (const [index, target] of apps.entries()) {
    const targetRef = `app/${target.app_id}/${target.arch}/${target.branch}`;
    const inventory = Buffer.from(
      JSON.stringify({ ...bom(), padding: "x".repeat(6 * mib) }).replaceAll(
        appRef,
        targetRef,
      ),
    );
    const inspected = inspectInventory(
      inventory,
      target,
      config.repository,
      config.generator.version,
    );
    const coverage = Buffer.from(
      JSON.stringify({
        inventory_complete: false,
        acquisition_complete: true,
        completeness_limitations: [],
        scopes: {
          app: { content_scan: "completed", content_packages: 1, gaps: [] },
          runtime: { content_scan: "completed", content_packages: 1, gaps: [] },
        },
      }).padEnd([32, 32, 32, 6, 1][index]! * mib, " "),
    );
    const record = {
      ...prototype,
      app: target,
      inventory: inspected,
      scan: { status: "failed", message: "scanner unavailable" },
      coverage: {
        status: "completed",
        inventory_sha256: inspected.evidence.sha256,
        evidence: {
          path: "coverage.json",
          bytes: coverage.length,
          sha256: sha256(coverage),
        },
      },
    };
    const records = join(downloads, `security-record-${target.app_id}`);
    const evidence = join(downloads, `security-evidence-${target.app_id}`);
    mkdirSync(records, { recursive: true });
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(records, "security.json"), JSON.stringify(record));
    writeFileSync(join(evidence, "inventory.cdx.json"), inventory);
    writeFileSync(join(evidence, "coverage.json"), coverage);
  }
  mkdirSync(join(downloads, "security-report"));
  writeFileSync(
    join(downloads, "security-report/security-report.json"),
    JSON.stringify(
      aggregateSecurity(
        apps,
        downloads,
        config,
        true,
        prototype.run_id,
        prototype.run_attempt,
      ),
    ),
  );
  const output = join(root, "site");
  const prepared = prepareSecurity([], downloads, output, { config, apps });
  for (const target of apps.slice(0, 4))
    assert.ok(prepared.security[target.app_id]!.coverage);
  const last = prepared.security[apps[4]!.app_id]!;
  assert.equal(last.inventoryUrl, undefined);
  assert.equal(last.row.status, "completed");
  assert.equal(last.evidenceUnavailable, true);
  const files = readdirSync(join(output, "inventories")).flatMap((id) =>
    readdirSync(join(output, "inventories", id)).map((name) => ({
      path: join(output, "inventories", id, name),
      name,
    })),
  );
  assert.ok(
    files.reduce((total, file) => total + statSync(file.path).size, 0) <=
      SECURITY_PUBLICATION_LIMIT,
  );
  assert.ok(
    files
      .filter((file) => file.name === "inventory.cdx.json")
      .reduce((total, file) => total + statSync(file.path).size, 0) <=
      INVENTORY_PUBLICATION_LIMIT,
  );
});

test("generation and validation failures retain failure records, never zero findings", async (t) => {
  for (const [name, document, failure, stage] of [
    ["transport", bom(), "HTTP 403", "generate"],
    ["malformed", {}, undefined, "validate"],
  ] as const) {
    const root = temporary(t);
    setup(root);
    const record = await observeSecurity(app, join(root, name), {
      root,
      execute: executor(document, failure),
    });
    assert.equal(record.status, "failed");
    if (record.status === "failed") assert.equal(record.stage, stage);
    assert.equal(
      JSON.parse(
        readFileSync(join(root, name, app.app_id, "security.json"), "utf8"),
      ).status,
      "failed",
    );
    assert.equal("inventory" in record, false);
    assert.equal("findings" in record, false);
  }
});

test("content inventory permits repeated evidence paths but requires matching pinned content provenance", () => {
  const document = bom();
  document.metadata.component.properties.find(
    (p) => p.name === "flatpak:inventory-kind",
  )!.value = "manifest-and-content";
  for (const scope of ["app", "runtime"])
    document.metadata.component.properties.push(
      { name: `flatpak:content-scanner-version:${scope}`, value: "1.55.0" },
      {
        name: `flatpak:content-scan:${scope}`,
        value: "syft-asar-and-native-metadata",
      },
    );
  const content = {
    "bom-ref": "content",
    properties: [
      { name: "flatpak:inventory-kind", value: "content-detected" },
      { name: "flatpak:scope", value: "app" },
      { name: "flatpak:ref", value: appRef },
      { name: "flatpak:commit", value: appCommit },
      { name: "flatpak:content-path", value: "/first" },
      { name: "flatpak:content-path", value: "/second" },
    ],
  };
  document.components.push(content);
  const inspect = () =>
    inspectInventory(
      Buffer.from(JSON.stringify(document)),
      app,
      defaultConfig.repository,
      defaultConfig.generator.version,
      "1.55.0",
    );
  assert.equal(inspect().app.commit, appCommit);
  content.properties.find((p) => p.name === "flatpak:commit")!.value =
    runtimeCommit;
  assert.throws(inspect, /snapshot mismatch/);
  content.properties.find((p) => p.name === "flatpak:commit")!.value =
    appCommit;
  content.properties.push({ name: "flatpak:scope", value: "runtime" });
  assert.throws(inspect, /ambiguous/);
});

test("inventory contract rejects absent scope, collisions, wrong targets and inconsistent commits", () => {
  const mutations = [
    (v: ReturnType<typeof bom>) => {
      v.components[0]!.properties = [];
    },
    (v: ReturnType<typeof bom>) => {
      v.components[1]!["bom-ref"] = "app";
    },
    (v: ReturnType<typeof bom>) => {
      v.dependencies[0]!.dependsOn.push("missing");
    },
    (v: ReturnType<typeof bom>) => {
      v.metadata.component.properties.find(
        (p) => p.name === "flatpak:ref",
      )!.value = "app/org.other.App/x86_64/stable";
    },
    (v: ReturnType<typeof bom>) => {
      v.components[2]!.properties.find(
        (p) => p.name === "flatpak:commit",
      )!.value = "c".repeat(64);
    },
    (v: ReturnType<typeof bom>) => {
      v.compositions[0]!.aggregate = "complete";
    },
  ];
  for (const mutate of mutations) {
    const value = bom();
    mutate(value);
    assert.throws(() =>
      inspectInventory(
        Buffer.from(JSON.stringify(value)),
        app,
        defaultConfig.repository,
        "0.1.0",
      ),
    );
  }
  assert.throws(() =>
    inspectInventory(
      Buffer.alloc(INVENTORY_LIMIT + 1),
      app,
      defaultConfig.repository,
      "0.1.0",
    ),
  );
});

test("expected jobs distinguish not requested from lost, invalid, wrong-run and unsupported records", async (t) => {
  const root = temporary(t);
  const config = setup(root);
  const record = await observeSecurity(app, join(root, "observations"), {
    root,
    execute: executor(),
  });
  const missing = join(root, "missing");
  assert.equal(
    aggregateSecurity([app], missing, config, false).rows[0]!.status,
    "not_requested",
  );
  assert.equal(
    aggregateSecurity([app], missing, config, true).rows[0]!.status,
    "unavailable",
  );
  const records = join(root, `security-record-${app.app_id}`);
  mkdirSync(records);
  for (const invalid of [
    {},
    { ...record, schema_version: 2 },
    { ...record, run_id: "99" },
    { ...record, app: { ...app, branch: "beta" } },
  ]) {
    writeFileSync(join(records, "security.json"), JSON.stringify(invalid));
    assert.equal(
      aggregateSecurity([app], root, config, true).rows[0]!.status,
      "unavailable",
    );
  }
  assert.equal(
    securityRecordSchema.safeParse({
      ...record,
      status: "completed",
      inventory: undefined,
    }).success,
    false,
  );
});

test("publication rejects tampering and symlinks, removes stale downloads and keeps records", async (t) => {
  const root = temporary(t);
  const config = setup(root);
  const record = await observeSecurity(app, join(root, "observations"), {
    root,
    execute: executor(),
  });
  publish(root, record, config);
  const output = join(root, "site");
  const downloads = join(root, "downloads");
  assert.ok(
    prepareSecurity([health], downloads, output, { config, apps: [app] })
      .security[app.app_id]!.inventoryUrl,
  );
  const file = join(
    downloads,
    `security-evidence-${app.app_id}`,
    "inventory.cdx.json",
  );
  writeFileSync(file, JSON.stringify(bom()).replace("source/1", "changed"));
  let view = prepareSecurity([health], downloads, output, {
    config,
    apps: [app],
  }).security[app.app_id]!;
  assert.equal(view.row.status, "completed");
  assert.equal(view.evidenceUnavailable, true);
  assert.equal(view.inventoryUrl, undefined);
  assert.throws(
    () =>
      readFileSync(
        join(output, "inventories", app.app_id, "inventory.cdx.json"),
      ),
    /ENOENT/,
  );
  rmSync(file);
  symlinkSync(
    join(root, "observations", app.app_id, "inventory.cdx.json"),
    file,
  );
  view = prepareSecurity([health], downloads, output, { config, apps: [app] })
    .security[app.app_id]!;
  assert.equal(view.inventoryUrl, undefined);
  const reportPath = join(downloads, "security-report/security-report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  report.rows.push(report.rows[0]);
  writeFileSync(reportPath, JSON.stringify(report));
  assert.equal(
    prepareSecurity([health], downloads, output, { config, apps: [app] })
      .security[app.app_id]!.row.status,
    "unavailable",
  );
});

test(
  "real generator and local OSTree refs flow through observation, aggregation and publication",
  { skip: !process.env.FLATPAK_SBOM_CHECKOUT },
  async (t) => {
    const root = temporary(t);
    const repo = join(root, "repo");
    const tree = join(root, "tree");
    mkdirSync(join(tree, "files"), { recursive: true });
    const ostree = (...args: string[]) =>
      execFileSync("ostree", [`--repo=${repo}`, ...args], {
        encoding: "utf8",
      }).trim();
    ostree("init", "--mode=archive");
    writeFileSync(
      join(tree, "metadata"),
      "[Application]\nruntime=org.example.Platform/x86_64/1\n",
    );
    writeFileSync(
      join(tree, "files/manifest.json"),
      JSON.stringify({
        id: app.app_id,
        modules: [
          {
            name: "demo",
            sources: [
              {
                type: "archive",
                url: "https://static.crates.io/crates/demo/demo-1.0.0.crate",
              },
            ],
          },
        ],
      }),
    );
    if (process.env.SECURITY_SCANNERS) {
      const pkg = join(tree, "files/lib/node_modules/lodash");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({ name: "lodash", version: "4.17.20" }),
      );
    }
    const appCommit = ostree(
      "commit",
      "--branch",
      appRef,
      "--subject",
      "fixture",
      `--tree=dir=${tree}`,
    );
    writeFileSync(
      join(tree, "metadata"),
      "[Runtime]\nname=org.example.Platform\n",
    );
    rmSync(join(tree, "files/manifest.json"));
    if (process.env.SECURITY_SCANNERS) {
      rmSync(join(tree, "files/lib"), { recursive: true });
      const pkg = join(
        tree,
        "files/lib/python3.12/site-packages/urllib3-1.26.4.dist-info",
      );
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, "METADATA"),
        "Metadata-Version: 2.1\nName: urllib3\nVersion: 1.26.4\n",
      );
      writeFileSync(
        join(pkg, "RECORD"),
        "urllib3-1.26.4.dist-info/METADATA,,\n",
      );
    }
    mkdirSync(join(tree, "usr"));
    writeFileSync(
      join(tree, "usr/manifest.json"),
      JSON.stringify({ modules: [] }),
    );
    const runtimeCommit = ostree(
      "commit",
      "--branch",
      runtimeRef,
      "--subject",
      "fixture runtime",
      `--tree=dir=${tree}`,
    );
    const config = setup(root, {
      ...defaultConfig,
      analysis: process.env.SECURITY_SCANNERS
        ? loadSecurity().analysis
        : undefined,
      repository: pathToFileURL(repo).href,
      apps: [app.app_id],
    });
    const record = await observeSecurity(app, join(root, "observations"), {
      root,
      generator: process.env.FLATPAK_SBOM_CHECKOUT,
    });
    assert.equal(record.status, "completed", JSON.stringify(record));
    if (record.status !== "completed") return;
    assert.equal(record.inventory.app.commit, appCommit);
    assert.equal(record.inventory.runtime.commit, runtimeCommit);
    assert.equal(record.inventory.runtime.manifest, "usr/manifest.json");
    assert.equal(record.inventory.sources.app.versioned, 1);
    if (process.env.SECURITY_SCANNERS) {
      assert.notEqual(record.scan, "not_requested");
      assert.equal(
        typeof record.scan === "object" && record.scan.status,
        "completed",
        JSON.stringify(record.scan),
      );
      for (const name of [
        "scanner-input.cdx.json",
        "grype.json",
        "coverage.json",
      ]) {
        const dir = join(root, "downloads", `security-evidence-${app.app_id}`);
        mkdirSync(dir, { recursive: true });
        cpSync(join(root, "observations", app.app_id, name), join(dir, name));
      }
    }
    publish(root, record, config);
    const views = prepareSecurity(
      [health],
      join(root, "downloads"),
      join(root, "site"),
      { config, apps: [app] },
    );
    assert.ok(views.security[app.app_id]!.inventoryUrl);
    if (process.env.SECURITY_SCANNERS) {
      const scan = views.security[app.app_id]!.scan;
      assert.ok(scan, "validated scan evidence is published");
      assert.ok(
        scan.findings.some(
          (finding) => finding.package === "lodash" && finding.scope === "app",
        ),
      );
      assert.ok(
        scan.findings.some(
          (finding) =>
            finding.package === "urllib3" && finding.scope === "runtime",
        ),
      );
      const html = prerender("<!--app-->", {
        rows: [health],
        images: {},
        runUrl: "",
        security: views.security,
      });
      assert.match(html, /scanner matches requiring triage/);
      assert.match(html, /Download Grype findings/);
      assert.match(html, /Download exact scanner input/);
      assert.match(html, /lodash/);
      assert.doesNotMatch(html, /Vulnerability scan: not performed/);
      const template =
        '<!--app--><script id="page-data" type="application/json"></script>';
      const pageData = {
        rows: [health],
        images: {},
        runUrl: "",
        security: views.security,
      };
      const pagePath = join(root, "site/index.html");
      const pageHtml = prerender(template, pageData);
      writeFileSync(pagePath, pageHtml);
      const get = async (parts: string[], limit: number) =>
        evidenceBytes(join(root, "site"), parts, limit);
      assert.equal(
        (await verifySecuritySite(get, { config, apps: [app] })).length,
        1,
      );
      await assert.rejects(
        verifySecuritySite(get, {
          config,
          apps: [app],
          runId: "99999999999999",
        }),
        /identity mismatch/,
      );
      const forged = structuredClone(pageData);
      forged.security[app.app_id]!.scan!.findings = [];
      writeFileSync(pagePath, prerender(template, forged));
      await assert.rejects(
        verifySecuritySite(get, { config, apps: [app] }),
        /published scan view mismatch/,
      );
      writeFileSync(pagePath, pageHtml);
      const path = join(
        root,
        "downloads",
        `security-evidence-${app.app_id}`,
        "grype.json",
      );
      const raw = readFileSync(path);
      writeFileSync(path, "{}");
      const altered = prepareSecurity(
        [health],
        join(root, "downloads"),
        join(root, "site"),
        { config, apps: [app] },
      );
      assert.equal(altered.security[app.app_id]!.scan, undefined);
      assert.equal(altered.security[app.app_id]!.row.status, "completed");
      assert.match(
        prerender("<!--app-->", {
          rows: [health],
          images: {},
          runUrl: "",
          security: altered.security,
        }),
        /Vulnerability evidence unavailable/,
      );
      writeFileSync(path, raw);
    }
    assert.match(
      prerender("<!--app-->", {
        rows: [health],
        images: {},
        runUrl: "",
        security: views.security,
      }),
      /Download CycloneDX 1.7/,
    );
  },
);

test("missing smoke report and one malformed inventory row cannot suppress valid inventories", async (t) => {
  const root = temporary(t);
  const config = setup(root);
  const record = await observeSecurity(app, join(root, "observations"), {
    root,
    execute: executor(),
  });
  publish(root, record, config);
  const other = { ...app, app_id: "org.example.Other", name: "Other" };
  const reportPath = join(
    root,
    "downloads/security-report/security-report.json",
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  report.rows.push({ app: other, status: "completed" }); // Required evidence is absent.
  writeFileSync(reportPath, JSON.stringify(report));
  const options = {
    config: { ...config, apps: [app.app_id, other.app_id] },
    apps: [app, other],
  };
  const prepared = prepareSecurity(
    [],
    join(root, "downloads"),
    join(root, "site"),
    options,
  );
  assert.equal(prepared.security[app.app_id]!.row.status, "completed");
  assert.ok(prepared.security[app.app_id]!.inventoryUrl);
  assert.equal(prepared.security[other.app_id]!.row.status, "unavailable");
  assert.equal(prepared.rows.length, 2);
  assert.equal(prepared.rows[0]!.phases.verify.status, "incomplete");
  const html = prerender("<!--app-->", { ...prepared, images: {}, runUrl: "" });
  assert.match(html, /Download CycloneDX 1.7/);
  assert.match(html, /Missing smoke result/);
  assert.equal(
    prepareSecurity([], join(root, "absent"), join(root, "site"), options).rows
      .length,
    0,
  );
  report.requested = false;
  writeFileSync(reportPath, JSON.stringify(report));
  assert.equal(
    prepareSecurity([], join(root, "downloads"), join(root, "site"), options)
      .rows.length,
    0,
  );
});

test("production site retains requested inventory failures when the smoke report is lost", async (t) => {
  const root = temporary(t);
  const selected = load().find((app) => app.app_id === defaultConfig.apps[0])!;
  const reportDir = join(root, "downloads/security-report");
  mkdirSync(reportDir, { recursive: true });
  const run = {
    run_id: process.env.GITHUB_RUN_ID ?? "local",
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  };
  writeFileSync(
    join(reportDir, "security-report.json"),
    JSON.stringify({
      schema_version: 1,
      ...run,
      requested: true,
      rows: [
        {
          schema_version: 1,
          app: selected,
          repository: defaultConfig.repository,
          generator: defaultConfig.generator,
          ...run,
          status: "failed",
          scan: "not_requested",
          started_at: "2026-10-31T00:00:00Z",
          finished_at: "2026-10-31T00:00:01Z",
          stage: "generate",
          message: "HTTP 403",
        },
      ],
    }),
  );
  await build(
    join(root, "missing-smoke-report.json"),
    join(root, "downloads"),
    join(root, "site"),
  );
  const html = readFileSync(join(root, "site/index.html"), "utf8");
  assert.match(html, /Generation failed/);
  assert.ok(html.includes(selected.app_id));
  assert.match(html, /Missing smoke result/);
  assert.doesNotMatch(html, /Generated · incomplete coverage/);
});
