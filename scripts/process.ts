import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { basename } from "node:path";

export interface CommandOptions {
  timeoutMs?: number;
  graceMs?: number;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}
export interface CommandResult {
  code: number | null;
  stdout: string;
}
export type Executor = (
  args: string[],
  log: string,
  options?: CommandOptions,
) => Promise<CommandResult>;

export class CommandError extends Error {
  cancelled: boolean;
  constructor(message: string, cancelled = false) {
    super(message);
    this.name = "CommandError";
    this.cancelled = cancelled;
  }
}

export const command: Executor = async (args, log, options = {}) => {
  const executable = args[0];
  if (!executable) throw new Error("empty command");
  const fd = openSync(log, "a");
  try {
    writeSync(fd, JSON.stringify(args) + "\n");
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(executable, args.slice(1), {
        env: options.env,
        detached: true,
        stdio: ["ignore", "pipe", fd],
      });
      let stdout = "";
      let failure: Error | undefined;
      let escalation: NodeJS.Timeout | undefined;
      const killGroup = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== "ESRCH"
          ) {
            failure ??=
              error instanceof Error ? error : new Error(String(error));
          }
        }
      };
      const stop = (error: Error) => {
        if (failure) return;
        failure = error;
        writeSync(fd, `\n${error.message}\n`);
        // Rejecting a promise does not stop the process. Signal its Linux process
        // group and give the upstream TERM handler time to remove its container.
        killGroup("SIGTERM");
        escalation = setTimeout(
          () => killGroup("SIGKILL"),
          options.graceMs ?? 30_000,
        );
      };
      const interrupt = () =>
        stop(new CommandError("command interrupted", true));
      const timer = setTimeout(
        () =>
          stop(
            new CommandError(
              `command timed out after ${options.timeoutMs ?? 120_000}ms`,
            ),
          ),
        options.timeoutMs ?? 120_000,
      );
      process.once("SIGTERM", interrupt);
      process.once("SIGINT", interrupt);
      child.stdout!.setEncoding("utf8"); // spawn pipes stdout above.
      child.stdout!.on("data", (chunk: string) => {
        writeSync(fd, chunk);
        if (stdout.length + chunk.length > 8 * 1024 * 1024) {
          stop(
            new CommandError(
              "command stdout exceeds 8 MiB capture limit; see full log",
            ),
          );
        } else {
          stdout += chunk;
        }
      });
      child.once("error", (error) => {
        failure ??= error;
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        clearTimeout(escalation);
        process.removeListener("SIGTERM", interrupt);
        process.removeListener("SIGINT", interrupt);
        // Do not leave grandchildren behind if the parent exits on TERM first.
        if (failure) killGroup("SIGKILL");
        if (failure) reject(failure);
        else if (code !== 0 && !options.allowFailure) {
          reject(
            new CommandError(
              `command exited ${code}: ${executable} (see ${basename(log)})`,
            ),
          );
        } else resolve({ code, stdout: stdout.trim() });
      });
    });
  } finally {
    closeSync(fd);
  }
};
