import { join } from "node:path";
import { load } from "./catalog.ts";
import { argumentsFor, main, readJson, ROOT } from "./io.ts";
import { securityConfigSchema } from "./security-model.ts";

export function loadSecurity(root = ROOT) {
  const config = securityConfigSchema.parse(
    readJson(join(root, "security.json")),
  );
  const apps = load(join(root, "apps.json"));
  if (
    new Set(config.apps).size !== config.apps.length ||
    config.apps.some((id) => !apps.some((app) => app.app_id === id))
  ) {
    throw new Error("security pilot must contain unique catalog app IDs");
  }
  return config;
}

main(import.meta, () => {
  const { field } = argumentsFor(["field"]);
  const config = loadSecurity();
  switch (field) {
    case "revision":
      console.log(config.generator.revision);
      break;
    case "rust":
      console.log(config.generator.rust);
      break;
    case "matrix":
      console.log(
        JSON.stringify({ include: config.apps.map((app_id) => ({ app_id })) }),
      );
      break;
    default:
      throw new Error("--field must be revision, rust or matrix");
  }
});
