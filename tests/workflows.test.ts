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
  env?: Record<string, unknown>;
  if?: string;
  "continue-on-error"?: boolean;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency?: Record<string, unknown>;
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
  // Feature branches are checked through pull_request, not a second push run.
  assert.deepEqual(ci.on, {
    pull_request: null,
    push: { branches: ["main"] },
  });
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

test("app jobs run daily or manually and depend on successful catalog validation", () => {
  const apps = workflow("check-apps.yml");
  assert.deepEqual(apps.on, {
    schedule: [{ cron: "17 5 * * *" }],
    workflow_dispatch: null,
  });
  assert.deepEqual(apps.permissions, { actions: "read", contents: "read" });
  assert.deepEqual(apps.concurrency, {
    group: "flathub-health",
    "cancel-in-progress": false,
  });
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
    apps.jobs.catalog!.steps.flatMap((step) => (step.run ? [step.run] : [])),
    [
      "pnpm install --frozen-lockfile",
      "pnpm format:check",
      "pnpm check",
      "pnpm test",
      'echo "matrix=$(node scripts/catalog.ts)" >> "$GITHUB_OUTPUT"',
      'revision=$(node scripts/runner.ts)\necho "revision=$revision" >> "$GITHUB_OUTPUT"\n',
    ],
  );
  const catalog = apps.jobs.catalog!.steps.at(-2)!;
  assert.equal(catalog.id, "catalog");
  assert.match(catalog.run!, /node scripts\/catalog\.ts/);
  const uploads = apps.jobs.check!.steps.filter((step) =>
    step.uses?.includes("upload-artifact"),
  );
  assert.equal(uploads.length, 2);
  assert.match(String(uploads[0]!.with?.path), /!.*health\.json/);
  assert.equal(uploads[0]!.with?.["retention-days"], 14);
  assert.equal(uploads[1]!.with?.["retention-days"], 14);
  assert.ok(
    apps.jobs.report!.steps.some((step) =>
      step.run?.includes("gh run download"),
    ),
  );
  const reportUploads = apps.jobs.report!.steps.filter((step) =>
    step.uses?.includes("upload-artifact"),
  );
  assert.equal(reportUploads.length, 2);
  assert.equal(reportUploads[1]!.with?.["retention-days"], 14);
  assert.match(String(reportUploads[1]!.with?.name), /history-/);
});

test("resource measurements cannot suppress app checks or diagnostic upload", () => {
  const steps = workflow("check-apps.yml").jobs.check!.steps;
  const start = steps.findIndex(({ id }) => id === "measurement");
  const run = steps.findIndex(
    ({ run }) => run === 'node scripts/run.ts --app "$APP_ID"',
  );
  const finish = steps.findIndex(
    ({ run }) => run === 'node scripts/measure.ts finish "$APP_ID"',
  );
  const upload = steps.findIndex(
    ({ name }) => name === "Upload logs and images",
  );
  assert.ok(start >= 0 && run > start && finish > run && upload > finish);
  assert.equal(steps[start]!["continue-on-error"], true);
  assert.equal(steps[run]!["continue-on-error"], undefined);
  assert.equal(steps[finish]!["continue-on-error"], true);
  assert.equal(
    steps[finish]!.if,
    "always() && steps.measurement.outcome == 'success'",
  );
  assert.equal(steps[upload]!.if, "always()");
});

test("Pages publishing is isolated to a least-privilege results job", () => {
  const apps = workflow("check-apps.yml");
  const publish = apps.jobs["publish-results"]!;
  assert.equal(
    publish.if,
    "always() && needs.catalog.result == 'success' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
  );
  assert.deepEqual(publish.needs, ["catalog", "check", "report"]);
  assert.deepEqual(publish.permissions, {
    actions: "read",
    contents: "read",
    pages: "write",
    "id-token": "write",
  });
  assert.equal((publish.environment as { name: string }).name, "github-pages");
  assert.ok(publish.steps.some((step) => step.run?.includes("pnpm site")));
  assert.ok(
    publish.steps.some((step) =>
      step.uses?.startsWith("actions/deploy-pages@"),
    ),
  );
  assert.equal(apps.jobs.check!.permissions, undefined);
});

test("hosted failure fixtures require explicit confirmation and stay outside the app catalog", () => {
  const fixture = workflow("test-failure-isolation.yml");
  assert.deepEqual(Object.keys(fixture.on), ["workflow_dispatch"]);
  const input = (
    fixture.on.workflow_dispatch as {
      inputs: Record<string, { required: boolean }>;
    }
  ).inputs;
  assert.equal(input.confirm!.required, true);
  assert.deepEqual(Object.keys(fixture.jobs), [
    "hosted-fixtures",
    "verify-fixtures",
  ]);
  assert.equal(
    fixture.jobs["hosted-fixtures"]!.if,
    "${{ inputs.confirm == 'RUN HOSTED FAILURE TEST' }}",
  );
  assert.equal(
    fixture.jobs["hosted-fixtures"]!.strategy &&
      (fixture.jobs["hosted-fixtures"]!.strategy as { "fail-fast": boolean })[
        "fail-fast"
      ],
    false,
  );
  assert.deepEqual(
    (
      fixture.jobs["hosted-fixtures"]!.strategy as {
        matrix: { case: string[] };
      }
    ).matrix.case,
    [
      "recipe-failure",
      "unaffected-matrix",
      "missing-artifact",
      "installation-failure",
      "cancellation-cleanup",
    ],
  );
  const steps = fixture.jobs["hosted-fixtures"]!.steps;
  assert.ok(steps.some((step) => step.name?.includes("fixture evidence")));
  assert.ok(steps.every((step) => !step.run?.includes("scripts/run.ts")));
  const executableFixture = steps.find(
    (step) => step.run === "node scripts/hosted-fixture.ts",
  );
  assert.equal(
    executableFixture?.if,
    "matrix.case == 'installation-failure' || matrix.case == 'cancellation-cleanup'",
  );
  assert.equal(executableFixture?.env?.CASE, "${{ matrix.case }}");
  const fixtureSource = readFileSync(
    join(ROOT, "scripts/hosted-fixture.ts"),
    "utf8",
  );
  assert.match(fixtureSource, /infrastructure_failed/);
  assert.match(fixtureSource, /status !== "incomplete"/);
  assert.match(fixtureSource, /docker.*rm.*--force/s);
  assert.match(fixtureSource, /fixture_container_removed=true/);
  const verification = fixture.jobs["verify-fixtures"]!.steps.find((step) =>
    step.name?.includes("Confirm unaffected"),
  );
  assert.match(verification!.run!, /unaffected-matrix\.txt/);
  assert.match(
    verification!.run!,
    /test ! -e fixture-downloads\/hosted-fixture-missing-artifact/,
  );
  assert.match(verification!.run!, /hosted-fixture-installation-failure/);
  assert.match(verification!.run!, /hosted-fixture-cancellation-cleanup/);
  assert.equal(
    fixture.jobs["verify-fixtures"]!.if,
    "${{ always() && inputs.confirm == 'RUN HOSTED FAILURE TEST' }}",
  );
  assertActionPins([fixture]);
});

function assertActionPins(workflows: Workflow[]): void {
  const allowed = new Set([
    "actions/checkout",
    "pnpm/action-setup",
    "actions/setup-node",
    "actions/upload-artifact",
    "actions/download-artifact",
    "actions/configure-pages",
    "actions/upload-pages-artifact",
    "actions/deploy-pages",
  ]);
  // Review release commits in the dependency PR. A second SHA list here would
  // reject every Dependabot update instead of checking the pinning policy.
  const pins = new Map<string, string>();
  for (const current of workflows) {
    for (const job of Object.values(current.jobs)) {
      for (const step of job.steps) {
        if (!step.uses) continue;
        assert.match(step.uses, /^[^@]+@[a-f0-9]{40}$/);
        const [action, sha] = step.uses.split("@");
        assert.ok(allowed.has(action!), `unexpected action: ${action}`);
        const previous = pins.get(action!);
        if (previous !== undefined) {
          assert.equal(
            sha,
            previous,
            `${action} pins differ between workflows`,
          );
        }
        pins.set(action!, sha!);
      }
    }
  }
}

function actionWorkflow(...uses: string[]): Workflow {
  return {
    on: {},
    permissions: {},
    jobs: { fixture: { steps: uses.map((uses) => ({ uses })) } },
  };
}

test("all third-party workflow actions use immutable, consistent pins from allowed repositories", () => {
  assertActionPins([
    workflow("ci.yml"),
    workflow("check-apps.yml"),
    workflow("test-failure-isolation.yml"),
  ]);
});

test("action release updates can change immutable pins without updating a second version list", () => {
  const updated = `actions/checkout@${"a".repeat(40)}`;
  assert.doesNotThrow(() =>
    assertActionPins([actionWorkflow(updated), actionWorkflow(updated)]),
  );
});

test("action pin policy rejects mutable refs, unknown repositories, and version drift", () => {
  for (const uses of [
    "actions/checkout@v7.0.1",
    "actions/checkout@main",
    "actions/checkout@abc1234",
    `actions/checkout@v7.0.1@${"a".repeat(40)}`,
    `unexpected/checkout@${"a".repeat(40)}`,
  ]) {
    assert.throws(() => assertActionPins([actionWorkflow(uses)]));
  }
  assert.throws(
    () =>
      assertActionPins([
        actionWorkflow(`actions/checkout@${"a".repeat(40)}`),
        actionWorkflow(`actions/checkout@${"b".repeat(40)}`),
      ]),
    /pins differ/,
  );
});
