import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "./catalog.ts";
import { ROOT, readJson } from "./io.ts";
import type { Health } from "./model.ts";
import { command, CommandError } from "./process.ts";
import { runApp } from "./run.ts";
import { loadRunner } from "./runner.ts";

const root = mkdtempSync(join(tmpdir(), "flathub-health-hosted-fixture-"));
const evidence = process.env.FIXTURE_EVIDENCE;
if (!evidence) throw new Error("FIXTURE_EVIDENCE is required");
mkdirSync(evidence, { recursive: true });

try {
  if (process.env.CASE === "installation-failure") {
    cpSync(join(ROOT, "runner.json"), join(root, "runner.json"));
    let installAttempted = false;
    const selected = load()[0]!;
    const result = await runApp(selected, root, join(root, "artifacts"), {
      root,
      execute: async (args) => {
        if (args.at(-1) === "HEAD")
          return {
            code: 0,
            stdout: loadRunner(root).revision,
          };
        if (args[0] === "docker" && args[1] === "info")
          return { code: 0, stdout: "Docker is available" };
        if (args[0] === "flatpak" && args[1] === "install") {
          installAttempted = true;
          throw new CommandError("fixture: Flatpak installation failed");
        }
        return { code: 0, stdout: "" };
      },
    });
    const saved = readJson(
      join(root, "artifacts", selected.app_id, "health.json"),
    ) as Health;
    if (
      !installAttempted ||
      result.phases.prepare.status !== "infrastructure_failed" ||
      result.phases.verify.status !== "incomplete" ||
      saved.phases.verify.status !== "incomplete"
    ) {
      throw new Error(
        "installation failure did not preserve incomplete downstream evidence",
      );
    }
    process.stdout.write(
      "classification=infrastructure_failed\nverify=incomplete\n",
    );
  } else if (process.env.CASE === "cancellation-cleanup") {
    const name = `flathub-health-cancel-${process.pid}`;
    await command(
      ["docker", "run", "-d", "--name", name, "alpine:3.22", "sleep", "600"],
      join(root, "docker.log"),
    );
    try {
      const pending = command(
        ["docker", "logs", "--follow", name],
        join(root, "cancel.log"),
        { graceMs: 250 },
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      process.emit("SIGTERM");
      await pending.then(
        () => {
          throw new Error("cancellation did not interrupt Docker client");
        },
        (error: unknown) => {
          if (!(error instanceof CommandError) || !error.cancelled) throw error;
        },
      );
    } finally {
      await command(
        ["docker", "rm", "--force", name],
        join(root, "cleanup.log"),
      );
    }
    const remaining = await command(
      ["docker", "ps", "-aq", "--filter", `name=^${name}$`],
      join(root, "verify-cleanup.log"),
    );
    if (
      existsSync(join(root, "cancel.log")) === false ||
      remaining.stdout !== ""
    )
      throw new Error(
        "cancellation evidence missing or fixture container remains",
      );
    process.stdout.write("cancelled=true\nfixture_container_removed=true\n");
  } else {
    throw new Error(`unsupported fixture case: ${process.env.CASE}`);
  }
  const text = `case=${process.env.CASE}\nresult=passed\n`;
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(join(evidence, `${process.env.CASE}.txt`), text),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
