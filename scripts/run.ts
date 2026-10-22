/** Prepare a released app and run the pinned upstream action. */
import { copyFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { platform, release } from "node:os";
import { load } from "./catalog.ts";
import {
  argumentsFor,
  beneath,
  canonical,
  main,
  readJson,
  ROOT,
  writeJson,
} from "./io.ts";
import {
  executionSchema,
  message,
  successful,
  upstreamResultSchema,
} from "./model.ts";
import type { App, Health, Mode, Outcome } from "./model.ts";
import { loadRunner } from "./runner.ts";
import { command, CommandError } from "./process.ts";
import type { Executor } from "./process.ts";

const appReasons = new Set([
  "launch_failed",
  "window_timeout",
  "early_exit",
  "app_error_window",
]);

export function classify(
  code: number | null,
  result: unknown,
  mode: Mode,
): Outcome {
  const infrastructure = (message: string): Outcome => ({
    status: "infrastructure_failed",
    message,
    exit_code: code,
  });
  if (code === null) return infrastructure("runner terminated by a signal");
  const parsed = upstreamResultSchema.safeParse(result);
  if (!parsed.success)
    return infrastructure("missing or invalid runner result");
  if (code === 0 && parsed.data.status === "passed")
    return { status: "passed", exit_code: code };
  const failure = parsed.data.failure;
  const reason = failure?.reason;
  const knownFailure =
    reason !== undefined &&
    (appReasons.has(reason) ||
      (mode === "screenshots" &&
        reason === "screenshot_failed" &&
        failure?.category === "expectation"));
  return {
    status:
      code !== 0 &&
      parsed.data.status === "failed" &&
      knownFailure &&
      (failure?.category == null || failure.category === "expectation")
        ? mode === "verify"
          ? "app_failed"
          : "recipe_failed"
        : "infrastructure_failed",
    exit_code: code,
    reason,
    category: failure?.category,
    message: failure?.message ?? "inconsistent runner exit/result",
  };
}

interface Invocation {
  app: App;
  mode: Mode;
  image: string;
  runnerVersion?: string;
  runnerImageName?: string;
  repo: string;
  dependencyRepo?: string;
  output: string;
  runner: string;
  env: NodeJS.ProcessEnv;
  root: string;
  execute: Executor;
}
type Invoker = (options: Invocation) => Promise<Outcome>;

export const invoke: Invoker = async ({
  app,
  mode,
  image,
  runnerVersion,
  runnerImageName,
  repo,
  dependencyRepo,
  output,
  runner,
  env,
  root,
  execute,
}) => {
  const destination = join(output, mode);
  const inputs = {
    mode,
    repo: relative(root, repo),
    "app-ref": `app/${app.app_id}/${app.arch}/${app.branch}`,
    output: relative(root, destination),
    image,
    user: "nobody",
    "allow-network-remotes": "true",
    ...(dependencyRepo
      ? { "dependency-repo": relative(root, dependencyRepo) }
      : {}),
    "execution-timeout": "420",
    "cleanup-timeout": "30",
    args: "--overall-timeout 5m",
    ...(mode === "screenshots" ? { recipe: app.recipe } : {}),
  };
  const result = await execute(
    ["python3", join(runner, "action/run.py")],
    join(output, `${mode}.log`),
    {
      timeoutMs: 480_000,
      graceMs: 40_000,
      allowFailure: true,
      env: {
        ...env,
        FLATPAK_SMOKE_INPUTS: JSON.stringify(inputs),
        GITHUB_WORKSPACE: root,
        GITHUB_OUTPUT: join(output, "action-output.txt"),
      },
    },
  );
  let raw: unknown;
  try {
    raw = readJson(join(destination, "result.json"));
  } catch {
    raw = null;
  }
  const parsed = upstreamResultSchema.safeParse(raw);
  const phaseMetadata = parsed.success ? parsed.data.phase_metadata : undefined;
  const metadata = {
    app: phaseMetadata?.app ?? null,
    runtimes: phaseMetadata?.runtimes ?? null,
    recipe: phaseMetadata?.recipe ?? null,
    runner_image: {
      version: runnerVersion ?? loadRunner(ROOT).version,
      image: runnerImageName ?? image.split("@")[0]!,
      digest: image.split("@")[1] ?? null,
    },
  };
  const outcome: Outcome = { ...classify(result.code, raw, mode), metadata };
  if (parsed.success && parsed.data.status === "passed") {
    const ref = `app/${app.app_id}/${app.arch}/${app.branch}`;
    // App identity is a catalog concern; capture validity belongs to upstream.
    if (parsed.data.app_ref !== ref) {
      Object.assign(outcome, {
        status: "infrastructure_failed",
        exit_code: result.code,
        message: "runner passed without expected app ref",
        metadata,
      });
    }
  }
  try {
    outcome.execution = executionSchema.parse(
      readJson(`${destination}.execution.json`),
    );
    const execution = outcome.execution;
    if (
      outcome.status === "passed" &&
      (execution.status !== "completed" ||
        execution.exit_code !== 0 ||
        !execution.cleanup?.remove ||
        Object.values(execution.cleanup).some(
          (item) => !["ok", "absent"].includes(item.status),
        ))
    ) {
      outcome.status = "infrastructure_failed";
      outcome.message = "runner passed but wrapper execution or cleanup failed";
    }
  } catch {
    if (outcome.status === "passed") {
      outcome.status = "infrastructure_failed";
      outcome.message = "missing or invalid wrapper execution record";
    }
  }
  return outcome;
};

interface RunOptions {
  root?: string;
  execute?: Executor;
  invoke?: Invoker;
}

export async function runApp(
  app: App,
  runner: string,
  outputRoot: string,
  options: RunOptions = {},
): Promise<Health> {
  const root = canonical(options.root ?? ROOT);
  outputRoot = canonical(outputRoot);
  if (!beneath(root, outputRoot))
    throw new Error("output must be beneath the workspace");
  const execute = options.execute ?? command;
  const invokeRunner = options.invoke ?? invoke;
  const output = join(outputRoot, app.app_id);
  if (!beneath(outputRoot, canonical(output)))
    throw new Error("app output escapes output directory");
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(output); // Refuse existing diagnostics rather than overwrite them.
  const config = loadRunner(root);
  const record: Health = {
    schema_version: 1,
    app,
    runner: config,
    tested_at: new Date().toISOString(),
    environment: {
      platform: `${platform()} ${release()}`,
      node: process.version,
      image_os: process.env.ImageOS,
      image_version: process.env.ImageVersion,
    },
    resolved: {},
    phases: {
      prepare: { status: "incomplete" },
      verify: { status: "incomplete" },
      screenshots: { status: app.recipe ? "incomplete" : "not_requested" },
    },
  };
  const save = () => writeJson(join(output, "health.json"), record);
  save();
  const log = join(output, "prepare.log");
  const work = join(root, ".health-work", app.app_id);
  try {
    if (!beneath(root, canonical(work)))
      throw new Error("work directory escapes workspace");
    mkdirSync(join(root, ".health-work"), { recursive: true });
    mkdirSync(work);
    const env = {
      ...process.env,
      FLATPAK_USER_DIR: join(work, "installation"),
    };
    const cmd = async (args: string[], timeoutMs = 120_000) =>
      (await execute(args, log, { timeoutMs, env })).stdout;
    const revision = await cmd(["git", "-C", runner, "rev-parse", "HEAD"]);
    if (revision !== config.revision)
      throw new Error("runner checkout does not match runner.json revision");
    const ref = `app/${app.app_id}/${app.arch}/${app.branch}`;
    await cmd([
      "flatpak",
      "remote-add",
      "--user",
      "--if-not-exists",
      "flathub",
      "https://flathub.org/repo/flathub.flatpakrepo",
    ]);
    // Complete Locale deployments can be exported by the upstream snapshot tool.
    await cmd(["flatpak", "config", "--user", "--set", "languages", "*"]);
    await cmd(
      ["flatpak", "install", "--user", "--noninteractive", "flathub", ref],
      900_000,
    );
    record.resolved.ref = ref;
    record.resolved.commit = await cmd([
      "flatpak",
      "info",
      "--user",
      "--show-commit",
      ref,
    ]);
    record.resolved.runtime = await cmd([
      "flatpak",
      "info",
      "--user",
      "--show-runtime",
      ref,
    ]);
    record.resolved.runtime_commit = await cmd([
      "flatpak",
      "info",
      "--user",
      "--show-commit",
      record.resolved.runtime,
    ]);
    const versions = await cmd([
      "flatpak",
      "list",
      "--user",
      "--app",
      "--columns=application,version",
    ]);
    record.resolved.version =
      versions
        .split("\n")
        .map((line) => line.split("\t"))
        .find(([id]) => id === app.app_id)?.[1] || "unknown";
    record.environment.flatpak = await cmd(["flatpak", "--version"]);
    // Publish the exact installed commit; no further host installation mutations.
    const repo = join(work, "installation/repo");
    await cmd(
      [
        "ostree",
        `--repo=${repo}`,
        "refs",
        `--create=${ref}`,
        record.resolved.commit,
      ],
      300_000,
    );
    await cmd(["flatpak", "build-update-repo", repo], 300_000);
    const dependencyRepo = join(work, "dependencies");
    await cmd(
      [
        "python3",
        join(runner, "action/prepare-dependencies.py"),
        "--installation",
        join(work, "installation"),
        "--output",
        dependencyRepo,
      ],
      300_000,
    );
    copyFileSync(
      join(dependencyRepo, "inputs.json"),
      join(output, "dependency-inputs.json"),
    );
    record.phases.prepare = { status: "passed" };
    save();
    for (const mode of ["verify", "screenshots"] as const) {
      if (mode === "screenshots" && !app.recipe) continue;
      try {
        record.phases[mode] = await invokeRunner({
          app,
          mode,
          image: config[`${mode}_digest`]!,
          runnerVersion: config.version,
          runnerImageName: config[`${mode}_image`],
          repo,
          dependencyRepo,
          output,
          runner,
          env,
          root,
          execute,
        });
      } catch (error) {
        record.phases[mode] = {
          status: "infrastructure_failed",
          message: message(error),
        };
        if (error instanceof CommandError && error.cancelled) {
          save();
          throw error;
        }
      }
      save();
    }
  } catch (error) {
    if (record.phases.prepare.status !== "passed") {
      record.phases.prepare = {
        status: "infrastructure_failed",
        message: message(error),
      };
    }
  } finally {
    save();
  }
  return record;
}

main(import.meta, async () => {
  const args = argumentsFor(["app", "runner", "output"]);
  const app = load().find((app) => app.app_id === args.app);
  if (!app) throw new Error("--app must name an app in apps.json");
  const record = await runApp(
    app,
    canonical(args.runner ?? join(ROOT, ".runner")),
    args.output ?? join(ROOT, "artifacts"),
  );
  console.log(
    JSON.stringify({ app_id: app.app_id, phases: record.phases }, null, 2),
  );
  process.exitCode = successful([record]) ? 0 : 1;
});
