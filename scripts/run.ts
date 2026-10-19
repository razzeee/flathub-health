/** Resolve one released app and invoke the pinned upstream action. */
import { mkdirSync, statSync } from "node:fs";
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
  digestSchema,
  message,
  runnerSchema,
  successful,
  upstreamResultSchema,
} from "./model.ts";
import type { App, Health, Mode, Outcome, Runner } from "./model.ts";
import { command, CommandError } from "./process.ts";
import type { Executor } from "./process.ts";

const appReasons = new Set([
  "launch_failed",
  "window_timeout",
  "early_exit",
  "app_error_window",
]);

export function loadRunner(root: string): Runner {
  return runnerSchema.parse(readJson(join(root, "runner.json")));
}

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
      (mode === "screenshots" && reason === "screenshot_failed"));
  return {
    status:
      code !== 0 && parsed.data.status === "failed" && knownFailure
        ? mode === "verify"
          ? "app_failed"
          : "recipe_failed"
        : "infrastructure_failed",
    exit_code: code,
    reason,
    message: failure?.message ?? "inconsistent runner exit/result",
  };
}

interface Invocation {
  app: App;
  mode: Mode;
  image: string;
  bundle: string;
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
  bundle,
  output,
  runner,
  env,
  root,
  execute,
}) => {
  const destination = join(output, mode);
  if (![bundle, destination].every((path) => beneath(root, canonical(path)))) {
    throw new Error("bundle and output must stay beneath the workspace");
  }
  const inputs = {
    mode,
    bundle: relative(root, bundle),
    output: relative(root, destination),
    image,
    user: "nobody",
    "allow-network-remotes": "true",
    args: "--overall-timeout 5m",
    ...(mode === "screenshots" ? { recipe: app.recipe } : {}),
  };
  const result = await execute(
    [
      "timeout",
      "--signal=TERM",
      "--kill-after=30s",
      "420s",
      "python3",
      join(runner, "action/run.py"),
    ],
    join(output, `${mode}.log`),
    {
      timeoutMs: 480_000,
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
  if (parsed.success && parsed.data.status === "passed") {
    const ref = `app/${app.app_id}/${app.arch}/${app.branch}`;
    const captures = parsed.data.screenshots;
    const validCaptures =
      Array.isArray(captures) &&
      captures.length > 0 &&
      captures.every((path: unknown) => {
        if (typeof path !== "string") return false;
        try {
          const file = canonical(join(destination, path));
          return (
            beneath(canonical(destination), file) && statSync(file).isFile()
          );
        } catch {
          return false;
        }
      });
    if (parsed.data.app_ref !== ref || !validCaptures) {
      return {
        status: "infrastructure_failed",
        exit_code: result.code,
        message: "runner passed without expected app ref or screenshot files",
      };
    }
  }
  return classify(result.code, raw, mode);
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
    await cmd(["docker", "info"], 30_000);
    const resolveImage = async (mode: Mode) => {
      const image = config[`${mode}_image`];
      await cmd(["docker", "pull", image], 300_000);
      const digests: unknown = JSON.parse(
        await cmd([
          "docker",
          "image",
          "inspect",
          image,
          "--format",
          "{{json .RepoDigests}}",
        ]),
      );
      const digest = digestSchema.safeParse(
        Array.isArray(digests) ? digests[0] : undefined,
      );
      if (!digest.success) {
        throw new Error("image has no immutable repository digest");
      }
      config[`${mode}_digest`] = digest.data;
      return digest.data;
    };
    await resolveImage("verify");
    const ref = `app/${app.app_id}/${app.arch}/${app.branch}`;
    await cmd([
      "flatpak",
      "remote-add",
      "--user",
      "--if-not-exists",
      "flathub",
      "https://flathub.org/repo/flathub.flatpakrepo",
    ]);
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
    const bundle = join(work, "app.flatpak");
    await cmd(
      [
        "flatpak",
        "build-bundle",
        `--arch=${app.arch}`,
        join(work, "installation/repo"),
        bundle,
        app.app_id,
        app.branch,
      ],
      300_000,
    );
    record.phases.prepare = { status: "passed" };
    save();
    for (const mode of ["verify", "screenshots"] as const) {
      if (mode === "screenshots" && !app.recipe) continue;
      try {
        // Optional capture infrastructure must not suppress startup results.
        const image = config[`${mode}_digest`] ?? (await resolveImage(mode));
        record.phases[mode] = await invokeRunner({
          app,
          mode,
          image,
          bundle,
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
