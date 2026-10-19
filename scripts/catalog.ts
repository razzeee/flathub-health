import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { argumentsFor, beneath, main, readJson, ROOT } from "./io.ts";
import { catalogSchema } from "./model.ts";
import type { App } from "./model.ts";

export function load(path = join(ROOT, "apps.json")): App[] {
  const data = catalogSchema.parse(readJson(path));
  const seen = new Set<string>();
  return data.apps.map((app) => {
    if (seen.has(app.app_id)) throw new Error("duplicate app ID");
    seen.add(app.app_id);
    if (app.recipe !== undefined) {
      const recipe = realpathSync(resolve(dirname(path), app.recipe));
      if (
        isAbsolute(app.recipe) ||
        !beneath(realpathSync(join(dirname(path), "recipes")), recipe) ||
        !statSync(recipe).isFile()
      ) {
        throw new Error("recipe must be an existing file beneath recipes/");
      }
    }
    return app;
  });
}

export function matrix(apps: App[]): { include: { app_id: string }[] } {
  return { include: apps.map(({ app_id }) => ({ app_id })) };
}

main(import.meta, () => {
  const args = argumentsFor(["catalog"]);
  console.log(JSON.stringify(matrix(load(args.catalog))));
});
