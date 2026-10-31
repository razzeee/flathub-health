import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { loadSecurity } from "../scripts/security-config.ts";
import { load } from "../scripts/catalog.ts";
import { aggregateSecurity } from "../scripts/security-report.ts";
import {
  INVENTORY_LIMIT,
  securityRecordSchema,
} from "../scripts/security-model.ts";
import type { SecurityConfig } from "../scripts/security-model.ts";
import { inspectInventory, observeSecurity } from "../scripts/security.ts";
import type { Executor } from "../scripts/process.ts";
import type { App, ReportRow } from "../scripts/model.ts";
import { prepareSecurity } from "../web/scripts/security.ts";
import { build, prerender } from "../web/scripts/build.ts";
import { inventoryRelation } from "../web/src/components/SecurityObservation.tsx";

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
const defaultConfig = loadSecurity();

function temporary(t: { after(fn: () => void): void }) {
  const root = mkdtempSync("/tmp/opencode/health-security-");
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
    publish(root, record, config);
    const views = prepareSecurity(
      [health],
      join(root, "downloads"),
      join(root, "site"),
      { config, apps: [app] },
    );
    assert.ok(views.security[app.app_id]!.inventoryUrl);
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
