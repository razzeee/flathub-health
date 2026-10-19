import { join } from "node:path";
import { main, readJson, ROOT } from "./io.ts";
import { runnerSchema } from "./model.ts";
import type { Runner } from "./model.ts";

export function loadRunner(root: string): Runner {
  return runnerSchema.parse(readJson(join(root, "runner.json")));
}

// The workflow consumes this validated revision before checking out upstream.
main(import.meta, () => console.log(loadRunner(ROOT).revision));
