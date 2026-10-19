import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { load, matrix } from "../scripts/catalog.ts";
import { ROOT, readJson, writeJson } from "../scripts/io.ts";
import type { App, Health } from "../scripts/model.ts";
import { command, CommandError } from "../scripts/process.ts";
import type { Executor } from "../scripts/process.ts";
import { aggregate, render } from "../scripts/report.ts";
import { classify, invoke, loadRunner, runApp } from "../scripts/run.ts";

function temporary(t: { after: (fn: () => void) => void }): string {
  mkdirSync("/tmp/opencode", { recursive: true });
  const root = mkdtempSync("/tmp/opencode/flathub-health-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function app(): App {
  return load()[0]!;
}

function record(selected = app()): Health {
  return {
    schema_version: 1,
    app: selected,
    tested_at: new Date().toISOString(),
    environment: {},
    runner: {
      ...loadRunner(ROOT),
      verify_digest: `ghcr.io/example/image@sha256:${"a".repeat(64)}`,
      screenshots_digest: `ghcr.io/example/image@sha256:${"b".repeat(64)}`,
    },
    resolved: {
      version: "1.0",
      commit: "abc",
      ref: `app/${selected.app_id}/x86_64/stable`,
      runtime: "runtime/ref",
      runtime_commit: "def",
    },
    phases: {
      prepare: { status: "passed" },
      verify: { status: "passed" },
      screenshots: { status: "passed" },
    },
  };
}

test("bootstrap catalog and matrix", () => {
  const apps = load();
  assert.equal(apps.length, 3);
  assert.deepEqual(matrix(apps), {
    include: apps.map(({ app_id }) => ({ app_id })),
  });
});

test("catalog rejects invalid fields, IDs, branches, architectures and recipes", (t) => {
  const root = temporary(t);
  cpSync(join(ROOT, "recipes"), join(root, "recipes"), { recursive: true });
  const mutations: ((apps: Record<string, unknown>[]) => void)[] = [
    (apps) => {
      apps.push(structuredClone(apps[0]!));
    },
    (apps) => {
      apps[0]!.arch = "aarch64";
    },
    (apps) => {
      apps[0]!.branch = "stable;echo x";
    },
    (apps) => {
      apps[0]!.app_id = "../../bad";
    },
    (apps) => {
      apps[0]!.command = "sh";
    },
    (apps) => {
      apps[0]!.recipe = "../outside.yml";
    },
    (apps) => {
      apps[0]!.name = "bad\nname";
    },
    (apps) => {
      delete apps[0]!.name;
    },
    (apps) => {
      apps[0]!.recipe = 1;
    },
  ];
  const path = join(root, "apps.json");
  for (const mutate of mutations) {
    const apps = structuredClone(load()) as unknown as Record<
      string,
      unknown
    >[];
    mutate(apps);
    writeJson(path, { schema_version: 1, apps });
    assert.throws(() => load(path));
  }
  for (const value of [
    null,
    [],
    { schema_version: 1, apps: [] },
    { schema_version: 1, apps: [null] },
  ]) {
    writeJson(path, value);
    assert.throws(() => load(path));
  }
});

test("catalog rejects recipe symlink escapes", (t) => {
  const root = temporary(t);
  mkdirSync(join(root, "recipes"));
  writeFileSync(join(root, "outside.yml"), "version: 1\n");
  symlinkSync(join(root, "outside.yml"), join(root, "recipes/escape.yml"));
  writeJson(join(root, "apps.json"), {
    schema_version: 1,
    apps: [{ ...app(), recipe: "recipes/escape.yml" }],
  });
  assert.throws(() => load(join(root, "apps.json")));
});

test("runner exits and failure classifications remain separate", () => {
  const passed = { schema_version: 1, status: "passed" };
  assert.equal(classify(0, passed, "verify").status, "passed");
  for (const [code, raw] of [
    [1, passed],
    [0, null],
    [124, null],
    [0, { status: "passed" }],
    [1, { schema_version: 1, failure: "bad" }],
  ] as const) {
    assert.equal(classify(code, raw, "verify").status, "infrastructure_failed");
  }
  for (const mode of ["verify", "screenshots"] as const) {
    const failed = {
      schema_version: 1,
      status: "failed",
      failure: { reason: "window_timeout" },
    };
    assert.equal(
      classify(1, failed, mode).status,
      mode === "verify" ? "app_failed" : "recipe_failed",
    );
    assert.equal(classify(0, failed, mode).status, "infrastructure_failed");
    assert.equal(classify(null, failed, mode).status, "infrastructure_failed");
  }
  for (const reason of [
    "install_failed",
    "dependency_failed",
    "display_start_failed",
    "unknown_future_reason",
  ]) {
    assert.equal(
      classify(
        1,
        { schema_version: 1, status: "failed", failure: { reason } },
        "verify",
      ).status,
      "infrastructure_failed",
    );
  }
});

test("runner configuration schema rejects malformed and unknown fields", (t) => {
  const root = temporary(t);
  const config = loadRunner(ROOT);
  for (const value of [
    null,
    {},
    { ...config, revision: "main" },
    { ...config, verify_image: 42 },
    { ...config, screenshots_image: "image\nargument" },
    { ...config, command: "sh" },
    { ...config, verify_digest: "not-a-digest" },
  ]) {
    writeJson(join(root, "runner.json"), value);
    assert.throws(() => loadRunner(root));
  }
  writeJson(join(root, "runner.json"), config);
  assert.deepEqual(loadRunner(root), config);
});

test("upstream schema validates consumed fields but allows future metadata", () => {
  const passed = {
    schema_version: 1,
    status: "passed",
    future_metadata: { value: 1 },
  };
  assert.equal(classify(0, passed, "verify").status, "passed");
  for (const raw of [
    { ...passed, screenshots: [1] },
    { ...passed, app_ref: 1 },
    { ...passed, failure: { reason: "window_timeout" } },
    {
      schema_version: 1,
      status: "failed",
      failure: { reason: "early_exit", message: 42 },
    },
  ]) {
    assert.equal(classify(0, raw, "verify").status, "infrastructure_failed");
  }
});

test("process adapter preserves argv, streams logs, and handles failed exits/spawn", async (t) => {
  const root = temporary(t);
  const log = join(root, "command.log");
  const result = await command(
    [
      process.execPath,
      "-e",
      "console.log(process.argv[1]); console.error('diagnostic')",
      "$(echo unsafe); space",
    ],
    log,
  );
  assert.equal(result.stdout, "$(echo unsafe); space");
  assert.match(readFileSync(log, "utf8"), /diagnostic/);
  await assert.rejects(
    command([process.execPath, "-e", "process.exit(7)"], log),
    /exited 7/,
  );
  assert.equal(
    (
      await command([process.execPath, "-e", "process.exit(7)"], log, {
        allowFailure: true,
      })
    ).code,
    7,
  );
  await assert.rejects(command([join(root, "nonexistent")], log), /ENOENT/);
});

test("timeout escalates for TERM-resistant process and retains partial logs", async (t) => {
  const root = temporary(t);
  const log = join(root, "timeout.log");
  const started = Date.now();
  await assert.rejects(
    command(
      [
        process.execPath,
        "-e",
        "process.on('SIGTERM', () => {}); console.log('partial'); setInterval(() => {}, 1000)",
      ],
      log,
      { timeoutMs: 500, graceMs: 50 },
    ),
    /timed out/,
  );
  assert.ok(Date.now() - started < 5_000);
  assert.match(readFileSync(log, "utf8"), /partial/);
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // An orphan zombie is no longer running; its reaping belongs to the host init.
  try {
    return (
      readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z"
    );
  } catch {
    return false;
  }
}

test("timeout terminates grandchildren in the process group", async (t) => {
  const root = temporary(t);
  const pidFile = join(root, "grandchild.pid");
  const script = `const {spawn} = require('node:child_process');
    const {writeFileSync} = require('node:fs');
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {stdio:'ignore'});
    writeFileSync(process.argv[1], String(child.pid)); setInterval(() => {}, 1000);`;
  await assert.rejects(
    command([process.execPath, "-e", script, pidFile], join(root, "tree.log"), {
      timeoutMs: 500,
      graceMs: 50,
    }),
    /timed out/,
  );
  const pid = Number(readFileSync(pidFile, "utf8"));
  for (let i = 0; i < 20 && alive(pid); i++) await delay(25);
  assert.equal(alive(pid), false);
});

test("external TERM cancels the active subprocess and cleans up", async (t) => {
  const root = temporary(t);
  const ready = join(root, "ready");
  const running = command(
    [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], 'ready'); setInterval(() => {}, 1000)",
      ready,
    ],
    join(root, "cancel.log"),
    { graceMs: 50 },
  );
  for (let i = 0; i < 100 && !existsSync(ready); i++) await delay(10);
  assert.ok(existsSync(ready));
  process.emit("SIGTERM");
  await assert.rejects(
    running,
    (error: unknown) => error instanceof CommandError && error.cancelled,
  );
});

test("preparation failures are saved and existing artifacts are never overwritten", async (t) => {
  const root = temporary(t);
  cpSync(join(ROOT, "runner.json"), join(root, "runner.json"));
  const row = await runApp(app(), root, join(root, "artifacts"), {
    root,
    execute: async () => {
      throw new Error("Docker unavailable");
    },
  });
  assert.equal(row.phases.prepare.status, "infrastructure_failed");
  assert.ok(existsSync(join(root, "artifacts", app().app_id, "health.json")));
  await assert.rejects(
    runApp(app(), root, join(root, "artifacts"), { root }),
    /EEXIST/,
  );
});

test("failed startup still runs the recipe, with immutable images", async (t) => {
  const root = temporary(t);
  cpSync(join(ROOT, "runner.json"), join(root, "runner.json"));
  const calls: string[] = [];
  const execute: Executor = async (args) => ({
    code: 0,
    stdout:
      args.at(-1) === "HEAD"
        ? loadRunner(root).revision
        : args.includes("inspect")
          ? JSON.stringify([`ghcr.io/example/image@sha256:${"a".repeat(64)}`])
          : args.includes("--columns=application,version")
            ? `${app().app_id}\t1.0`
            : "example",
  });
  const row = await runApp(app(), root, join(root, "artifacts"), {
    root,
    execute,
    invoke: async (options) => {
      calls.push(options.mode);
      assert.match(options.image, /@sha256:/);
      return { status: options.mode === "verify" ? "app_failed" : "passed" };
    },
  });
  assert.deepEqual(calls, ["verify", "screenshots"]);
  assert.equal(row.phases.screenshots.status, "passed");
  assert.equal(row.resolved.version, "1.0");
});

test("unavailable screenshot image preserves completed startup results", async (t) => {
  const root = temporary(t);
  cpSync(join(ROOT, "runner.json"), join(root, "runner.json"));
  const config = loadRunner(root);
  const calls: string[] = [];
  const execute: Executor = async (args) => {
    if (args[1] === "pull" && args[2] === config.screenshots_image) {
      calls.push("screenshots-image");
      throw new Error("screenshot image unavailable");
    }
    return {
      code: 0,
      stdout:
        args.at(-1) === "HEAD"
          ? config.revision
          : args.includes("inspect")
            ? JSON.stringify([`ghcr.io/example/image@sha256:${"a".repeat(64)}`])
            : args.includes("--columns=application,version")
              ? `${app().app_id}\t1.0`
              : "example",
    };
  };
  const row = await runApp(app(), root, join(root, "artifacts"), {
    root,
    execute,
    invoke: async ({ mode }) => {
      calls.push(mode);
      return { status: "passed" };
    },
  });
  assert.deepEqual(calls, ["verify", "screenshots-image"]);
  assert.equal(row.phases.prepare.status, "passed");
  assert.equal(row.phases.verify.status, "passed");
  assert.equal(row.phases.screenshots.status, "infrastructure_failed");
  const reported = aggregate([app()], join(root, "artifacts"));
  assert.equal(reported[0]!.phases.verify.status, "passed");
  assert.equal(reported[0]!.phases.screenshots.status, "infrastructure_failed");
});

test("upstream action invocation validates ref and real screenshot files", async (t) => {
  const root = temporary(t);
  const output = join(root, "artifacts", app().app_id);
  const destination = join(output, "verify");
  mkdirSync(destination, { recursive: true });
  const result = join(destination, "result.json");
  const raw = {
    schema_version: 1,
    status: "passed",
    app_ref: `app/${app().app_id}/x86_64/stable`,
    screenshots: ["capture.png"],
  };
  writeJson(result, raw);
  const options = {
    app: app(),
    mode: "verify" as const,
    image: "image",
    bundle: join(root, "app.flatpak"),
    output,
    runner: join(root, ".runner"),
    env: {},
    root,
    execute: (async (args, _log, opts) => {
      assert.equal(args[4], "python3");
      assert.equal(opts?.allowFailure, true);
      assert.equal(JSON.parse(opts!.env!.FLATPAK_SMOKE_INPUTS!).user, "nobody");
      return { code: 0, stdout: "" };
    }) satisfies Executor,
  };
  assert.equal((await invoke(options)).status, "infrastructure_failed");
  writeFileSync(join(destination, "capture.png"), "screenshot");
  assert.equal((await invoke(options)).status, "passed");
  writeJson(result, { ...raw, app_ref: "wrong" });
  assert.equal((await invoke(options)).status, "infrastructure_failed");
  writeJson(result, { ...raw, screenshots: ["../../outside.png"] });
  assert.equal((await invoke(options)).status, "infrastructure_failed");
});

test("aggregation keeps failed jobs, identifies missing/corrupt jobs and renders provenance", (t) => {
  const root = temporary(t);
  const apps = load();
  const path = join(root, app().app_id);
  mkdirSync(path);
  const row = record();
  row.phases.verify = { status: "app_failed", message: "<error>|message" };
  row.phases.screenshots = { status: "recipe_failed" };
  writeJson(join(path, "health.json"), row);
  const rows = aggregate(apps, root);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.phases.verify.status, "app_failed");
  assert.equal(rows[1]!.phases.verify.status, "incomplete");
  assert.match(render(rows), /&lt;error&gt;&#124;message/);
  assert.match(render(rows), /718df5b31ff138dec6b8361ae1eef535667db1cb/);
  writeFileSync(join(path, "health.json"), "not JSON");
  assert.ok("error" in aggregate(apps, root)[0]!);
  writeJson(join(path, "health.json"), null);
  assert.ok("error" in aggregate(apps, root)[0]!);
});

test("passing artifacts require app and runner provenance; JSON field order is irrelevant", (t) => {
  const root = temporary(t);
  const path = join(root, app().app_id);
  mkdirSync(path);
  const file = join(path, "health.json");
  const row = record();
  row.app = Object.fromEntries(
    Object.entries(row.app).reverse(),
  ) as unknown as App;
  row.environment.image_os = null;
  writeJson(file, row);
  assert.equal(aggregate([app()], root)[0]!.phases.verify.status, "passed");
  delete row.resolved.commit;
  writeJson(file, row);
  assert.ok("error" in aggregate([app()], root)[0]!);
  assert.ok(readJson(file));
});

test("artifact schemas reject malformed metadata, phase outcomes and provenance", (t) => {
  const root = temporary(t);
  const path = join(root, app().app_id);
  mkdirSync(path);
  const valid = record();
  for (const raw of [
    { ...valid, schema_version: 2 },
    { ...valid, environment: { platform: 42 } },
    { ...valid, resolved: { ...valid.resolved, version: 42 } },
    { ...valid, runner: { ...valid.runner, revision: "main" } },
    { ...valid, runner: { ...valid.runner, verify_digest: "not-a-digest" } },
    { ...valid, runner: { ...valid.runner, screenshots_digest: undefined } },
    {
      ...valid,
      phases: { ...valid.phases, prepare: { status: "app_failed" } },
    },
    {
      ...valid,
      phases: { ...valid.phases, screenshots: { status: "not_requested" } },
    },
    {
      ...valid,
      phases: { ...valid.phases, verify: { status: "passed", exit_code: "0" } },
    },
    { ...valid, tested_at: "not-a-date" },
    { ...valid, app: { ...valid.app, branch: "beta" } },
  ]) {
    writeJson(join(path, "health.json"), raw);
    assert.ok("error" in aggregate([app()], root)[0]!);
  }
});
