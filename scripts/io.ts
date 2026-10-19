import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function beneath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

// Resolve parent symlinks before checking whether the output stays in the workspace.
export function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    const parent = dirname(resolve(path));
    if (parent === resolve(path)) throw error;
    return resolve(canonical(parent), relative(parent, resolve(path)));
  }
}

export function argumentsFor(
  names: string[],
): Record<string, string | undefined> {
  const options = Object.fromEntries(
    names.map((name) => [name, { type: "string" as const }]),
  );
  return parseArgs({ options }).values as Record<string, string | undefined>;
}

export function main(
  module: ImportMeta,
  action: () => void | Promise<void>,
): void {
  if (module.main) {
    Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
