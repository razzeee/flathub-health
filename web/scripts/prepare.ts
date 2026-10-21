/** Read the existing report contract and stage a bounded set of image assets. */
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { appSchema, healthSchema } from "../../scripts/model.ts";
import type { ReportRow } from "../../scripts/model.ts";
import type { PageData } from "../src/data.ts";

export function decodeRows(value: unknown): ReportRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate: unknown): ReportRow[] => {
    const health = healthSchema.safeParse(candidate);
    if (health.success) return [health.data];
    const app = appSchema.safeParse(
      candidate && typeof candidate === "object" && "app" in candidate
        ? candidate.app
        : undefined,
    );
    if (!app.success) return [];
    return [
      {
        app: app.data,
        phases: {
          prepare: { status: "incomplete" },
          verify: { status: "incomplete" },
          screenshots: { status: "incomplete" },
        },
        error: "Missing or invalid result record",
      },
    ];
  });
}

// Do not follow symlinked files or directories in downloaded evidence.
function* imageFiles(root: string, directory = root): Generator<string> {
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* imageFiles(root, path);
    else if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
      yield path;
  }
}

export function prepare(
  reportPath: string,
  artifactsPath: string,
  output: string,
): PageData {
  mkdirSync(output, { recursive: true });
  rmSync(join(output, "screenshots"), { recursive: true, force: true });
  let rows: ReportRow[] = [];
  try {
    rows = decodeRows(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch {
    /* Missing evidence never establishes a pass. */
  }
  const images: Record<string, string[]> = {};
  let bytes = 0;
  for (const row of rows) {
    const appId = row.app.app_id;
    const captures: string[] = [];
    images[appId] = captures;
    for (const source of imageFiles(join(artifactsPath, `health-${appId}`))) {
      const size = lstatSync(source).size;
      if (size > 2 * 1024 * 1024) continue;
      if (captures.length >= 3 || bytes + size > 30 * 1024 * 1024) break;
      const filename = `capture-${captures.length + 1}${source.match(/\.(png|jpe?g|webp)$/i)![0]}`;
      const destination = join(output, "screenshots", appId, filename);
      mkdirSync(join(output, "screenshots", appId), { recursive: true });
      cpSync(source, destination);
      bytes += size;
      captures.push(
        relative(output, destination)
          .split(sep)
          .map(encodeURIComponent)
          .join("/"),
      );
    }
  }
  const runId = process.env.GITHUB_RUN_ID;
  return {
    rows,
    images,
    runUrl: /^\d+$/.test(runId ?? "")
      ? `https://github.com/razzeee/flathub-health/actions/runs/${runId}`
      : "https://github.com/razzeee/flathub-health/actions",
  };
}
