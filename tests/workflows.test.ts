import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseDocument } from "yaml";
import { ROOT } from "../scripts/io.ts";

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      needs?: string | string[];
      steps: Step[];
      [key: string]: unknown;
    }
  >;
}

function workflow(name: string): Workflow {
  const document = parseDocument(
    readFileSync(join(ROOT, ".github/workflows", name), "utf8"),
    { uniqueKeys: true },
  );
  assert.deepEqual(document.errors, []);
  return document.toJS() as Workflow;
}

test("PR and push checks only install dependencies and run safe checks", () => {
  const ci = workflow("ci.yml");
  assert.deepEqual(Object.keys(ci).sort(), [
    "jobs",
    "name",
    "on",
    "permissions",
  ]);
  assert.deepEqual(ci.on, { pull_request: null, push: null });
  assert.deepEqual(ci.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(ci.jobs), ["checks"]);
  const checks = ci.jobs.checks!;
  assert.deepEqual(Object.keys(checks).sort(), [
    "name",
    "runs-on",
    "steps",
    "timeout-minutes",
  ]);
  assert.equal(checks["runs-on"], "ubuntu-24.04");
  assert.equal(checks["timeout-minutes"], 5);
  // An allowlist prevents app commands, local actions, secrets, conditions,
  // containers, or extra steps from crossing into the untrusted workflow.
  assert.deepEqual(
    checks.steps.map(({ name: _name, uses, ...step }) => ({
      ...step,
      ...(uses ? { uses: uses.split("@")[0] } : {}),
    })),
    [
      { uses: "actions/checkout", with: { "persist-credentials": false } },
      { uses: "pnpm/action-setup" },
      {
        uses: "actions/setup-node",
        with: { "node-version-file": ".node-version", cache: "pnpm" },
      },
      { run: "pnpm install --frozen-lockfile" },
      { run: "pnpm format:check" },
      { run: "pnpm check" },
      { run: "pnpm catalog" },
      { run: "pnpm test" },
    ],
  );
  const compiler = JSON.parse(
    readFileSync(join(ROOT, "tsconfig.json"), "utf8"),
  );
  assert.equal(compiler.compilerOptions.strict, true);
  assert.deepEqual(compiler.compilerOptions.types, ["node"]);
  assert.equal(readFileSync(join(ROOT, ".node-version"), "utf8").trim(), "24");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.packageManager, "pnpm@12.6.0");
});

test("app jobs remain manual and depend on successful catalog validation", () => {
  const apps = workflow("check-apps.yml");
  assert.deepEqual(apps.on, { workflow_dispatch: null });
  assert.deepEqual(apps.permissions, { contents: "read" });
  assert.equal(apps.jobs.check!.needs, "catalog");
  assert.equal(apps.jobs.check!.if, undefined);
  assert.equal(apps.jobs.catalog!.if, undefined);
  assert.equal(apps.jobs.catalog!["continue-on-error"], undefined);
  for (const step of apps.jobs.catalog!.steps) {
    assert.equal("continue-on-error" in step, false);
    assert.equal("if" in step, false);
  }
  // These checks load the real catalog and fail the prerequisite job before
  // its matrix output step if the catalog is invalid.
  assert.deepEqual(
    apps.jobs
      .catalog!.steps.flatMap((step) => (step.run ? [step.run] : []))
      .slice(0, -1),
    [
      "pnpm install --frozen-lockfile",
      "pnpm format:check",
      "pnpm check",
      "pnpm test",
    ],
  );
  const catalog = apps.jobs.catalog!.steps.at(-1)!;
  assert.equal(catalog.id, "catalog");
  assert.match(catalog.run!, /node scripts\/catalog\.ts/);
});

test("all third-party workflow actions use the reviewed upstream release commits", () => {
  const pins: Record<string, string> = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "pnpm/action-setup": "fc06bc1257f339d1d5d8b3a19a8cae5388b55320",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
    "actions/download-artifact": "d3f86a106a0bac45b974a628896c90dbdf5c8093",
  };
  for (const file of ["ci.yml", "check-apps.yml"]) {
    for (const job of Object.values(workflow(file).jobs)) {
      for (const step of job.steps) {
        if (!step.uses) continue;
        const [action, sha] = step.uses.split("@");
        assert.match(sha!, /^[a-f0-9]{40}$/);
        assert.ok(action! in pins);
        assert.equal(sha, pins[action!]);
      }
    }
  }
});
