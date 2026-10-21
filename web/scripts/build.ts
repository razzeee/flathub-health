import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build as viteBuild } from "vite";
import { argumentsFor, main, ROOT } from "../../scripts/io.ts";
import { App } from "../src/App.tsx";
import { prepare } from "./prepare.ts";
import type { PageData } from "../src/data.ts";

export function prerender(template: string, data: PageData): string {
  const serialized = JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  if (!template.includes("<!--app-->"))
    throw new Error("Missing prerender placeholder");
  return template
    .replace("<!--app-->", () => renderToString(createElement(App, { data })))
    .replace(
      /(<script id="page-data" type="application\/json">)[\s\S]*?(<\/script>)/,
      (_, start: string, end: string) => start + serialized + end,
    );
}

export async function build(
  reportPath: string,
  artifactsPath: string,
  output: string,
) {
  output = resolve(output);
  mkdirSync(output, { recursive: true });
  // Replace only generated assets, never the caller's entire output directory.
  rmSync(join(output, "assets"), { recursive: true, force: true });
  const data = prepare(reportPath, artifactsPath, output);
  await viteBuild({
    configFile: join(ROOT, "web/vite.config.ts"),
    build: { outDir: output, emptyOutDir: false },
  });
  const index = join(output, "index.html");
  writeFileSync(index, prerender(readFileSync(index, "utf8"), data));
}

main(import.meta, () => {
  const args = argumentsFor(["report", "artifacts", "output"]);
  return build(
    args.report ?? "downloads/report/report.json",
    args.artifacts ?? "downloads",
    args.output ?? "site",
  );
});
