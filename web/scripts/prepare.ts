/** Read the existing report contract and stage a bounded set of image assets. */
import { cpSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { z } from "zod";
import {
  appSchema,
  healthSchema,
  upstreamResultSchema,
} from "../../scripts/model.ts";
import type { ReportRow } from "../../scripts/model.ts";
import type { Capture, PageData } from "../src/data.ts";

const captureMetadataSchema = z.object({
  schema_version: z.literal(1),
  app_ref: z.string(),
  captures: z.array(
    z.object({
      path: z.string(),
      name: z.string().min(1).max(200),
      caption: z.string().max(2000).nullish(),
    }),
  ),
});

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

// All components below the artifact directory must be real directories/files.
// A result manifest is not permission to follow symlinks or publish logs.
function evidenceFile(root: string, parts: string[]): string | undefined {
  if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return;
  let path = root;
  for (const [index, part] of parts.entries()) {
    if (!part || part === "." || part === ".." || /[/\\\0]/.test(part)) return;
    path = join(path, part);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (index === parts.length - 1 ? !stat?.isFile() : !stat?.isDirectory())
      return;
  }
  return path;
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
  const images: Record<string, Capture[]> = {};
  let bytes = 0;
  for (const row of rows) {
    const appId = row.app.app_id;
    const captures: Capture[] = [];
    images[appId] = captures;
    for (const phase of ["verify", "screenshots"] as const) {
      if (row.phases[phase].status === "not_requested") continue;
      const manifest = evidenceFile(artifactsPath, [
        `health-${appId}`,
        phase,
        "result.json",
      ]);
      if (!manifest) continue;
      let result;
      try {
        result = upstreamResultSchema.safeParse(
          JSON.parse(readFileSync(manifest, "utf8")),
        );
      } catch {
        continue;
      }
      if (
        !result.success ||
        result.data.app_ref !== `app/${appId}/${row.app.arch}/${row.app.branch}`
      )
        continue;
      const metadata = new Map<
        string,
        { name: string; caption?: string | null }
      >();
      const sidecar = evidenceFile(artifactsPath, [
        `health-${appId}`,
        phase,
        "screenshots.json",
      ]);
      if (sidecar) {
        try {
          const parsed = captureMetadataSchema.safeParse(
            JSON.parse(readFileSync(sidecar, "utf8")),
          );
          if (parsed.success && parsed.data.app_ref === result.data.app_ref) {
            for (const capture of parsed.data.captures)
              metadata.set(capture.path, capture);
          }
        } catch {
          // Optional captions never replace the authoritative result manifest.
        }
      }
      for (const capture of new Set(result.data.screenshots ?? [])) {
        if (!/^screenshots\/[^/\\\0]+\.(png|jpe?g|webp)$/i.test(capture))
          continue;
        const source = evidenceFile(artifactsPath, [
          `health-${appId}`,
          phase,
          ...capture.split("/"),
        ]);
        if (!source) continue;
        const size = lstatSync(source).size;
        if (size > 2 * 1024 * 1024) continue;
        if (captures.length >= 3 || bytes + size > 30 * 1024 * 1024) break;
        const filename = basename(capture);
        const destination = join(output, "screenshots", appId, phase, filename);
        mkdirSync(join(output, "screenshots", appId, phase), {
          recursive: true,
        });
        cpSync(source, destination);
        bytes += size;
        const details = metadata.get(capture);
        const name = (
          details?.name ??
          filename.replace(/\.(png|jpe?g|webp)$/i, "").replace(/^\d+-/, "")
        ).replace(/[-_]+/g, " ");
        captures.push({
          url: relative(output, destination)
            .split(sep)
            .map(encodeURIComponent)
            .join("/"),
          phase,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          description:
            details?.caption ||
            (phase === "verify"
              ? "First visible window during startup; not proof of application readiness."
              : undefined),
        });
      }
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
