/** Build a bounded, static, read-only view from the per-run report artifact. */
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { argumentsFor, main } from "./io.ts";
import { appSchema, healthSchema } from "./model.ts";
import type { ReportRow } from "./model.ts";

// Consume the existing report contract; invalid evidence never establishes a pass.
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
          prepare: { status: "incomplete" as const },
          verify: { status: "incomplete" as const },
          screenshots: { status: "incomplete" as const },
        },
        error: "Missing or invalid result record",
      },
    ];
  });
}

const esc = (value: unknown) =>
  String(value ?? "unavailable")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export async function build(
  reportPath: string,
  artifactsPath: string,
  output: string,
): Promise<void> {
  mkdirSync(output, { recursive: true });
  rmSync(join(output, "screenshots"), { recursive: true, force: true });
  let rows: ReportRow[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
    rows = decodeRows(parsed);
  } catch {
    // An unavailable report is rendered explicitly rather than as a passing run.
  }
  const screenshots = join(output, "screenshots");
  mkdirSync(screenshots, { recursive: true });
  let screenshotBytes = 0;
  const cards = rows.map((row) => {
    const appId = String(row?.app?.app_id ?? "");
    const safeId =
      /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){2,}$/.test(appId)
        ? appId
        : "";
    let images: string[] = [];
    const from = safeId ? join(artifactsPath, `health-${safeId}`) : "";
    if (from && statSync(from, { throwIfNoEntry: false })?.isDirectory()) {
      const dest = join(screenshots, safeId);
      for (const name of readdirSync(from, { recursive: true })) {
        if (typeof name !== "string" || !/\.(png|jpe?g|webp)$/i.test(name))
          continue;
        const source = join(from, name);
        const sourceStat = lstatSync(source, { throwIfNoEntry: false });
        if (!sourceStat?.isFile() || sourceStat.size > 2 * 1024 * 1024)
          continue;
        if (screenshotBytes + sourceStat.size > 30 * 1024 * 1024) break;
        if (images.length >= 3) break;
        const file = `capture-${images.length + 1}${name.match(/\.(png|jpe?g|webp)$/i)?.[0] ?? ".png"}`;
        mkdirSync(dest, { recursive: true });
        cpSync(source, join(dest, file));
        screenshotBytes += sourceStat.size;
        images.push(
          `screenshots/${encodeURIComponent(safeId)}/${encodeURIComponent(file)}`,
        );
      }
    }
    const phase = (name: "prepare" | "verify" | "screenshots") =>
      esc(row?.phases?.[name]?.status ?? "incomplete");
    const tested = "tested_at" in row ? row.tested_at : undefined;
    const testedTime = Date.parse(tested ?? "");
    const testedLabel = Number.isFinite(testedTime)
      ? new Date(testedTime)
          .toISOString()
          .replace("T", " ")
          .replace(".000Z", " UTC")
      : "time unavailable";
    const links = images.length
      ? `<div class="captures">${images.map((url, i) => `<a href="${url}"><img loading="lazy" src="${url}" alt="Smoke-test capture ${i + 1} for ${esc(row?.app?.name)}"></a>`).join("")}</div>`
      : `<p class="muted">No screenshots available for this run.</p>`;
    const details =
      "tested_at" in row
        ? { resolved: row.resolved, runner: row.runner, phases: row.phases }
        : { error: row.error, phases: row.phases };
    return `<article><div class="apphead"><div><h2>${esc(row.app.name)}</h2><code>${esc(appId)}</code></div><span>Tested ${esc(testedLabel)}</span></div><dl><div><dt>Startup</dt><dd>${phase("verify")}</dd></div><div><dt>Recipe</dt><dd>${phase("screenshots")}</dd></div><div><dt>Preparation</dt><dd>${phase("prepare")}</dd></div></dl>${links}<details><summary>Versions and diagnostics</summary><pre>${esc(JSON.stringify(details, null, 2))}</pre><a href="https://github.com/razzeee/flathub-health/actions/runs/${encodeURIComponent(process.env.GITHUB_RUN_ID ?? "")}">Open this workflow run and its 14-day diagnostics</a></details></article>`;
  });
  const latest = rows
    .map((r) => Date.parse("tested_at" in r ? r.tested_at : ""))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const stale = !latest || Date.now() - latest > 36 * 60 * 60 * 1000;
  const latestIso = latest ? new Date(latest).toISOString() : "";
  const banner = rows.length
    ? `<div id="freshness" data-tested-at="${latestIso}" class="stale" role="status">${stale ? "STALE / UNAVAILABLE" : "FRESHNESS UNVERIFIED"} · Latest test: ${latestIso || "unavailable"}. Results expire after 36 hours. Enable JavaScript for a live freshness check.</div>`
    : `<div class="stale" role="status">NO RESULTS · No valid report is available. No apps are assumed to have passed.</div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Flathub health results</title><link rel="stylesheet" href="style.css"><script src="freshness.js" defer></script></head><body><a class="skip" href="#results">Skip to results</a><header><p class="eyebrow">RELEASED APP SMOKE TESTS</p><h1>Flathub <i>health</i></h1><p>Can selected released apps install and open? Are their smoke-test recipes still working?</p>${banner}</header><main id="results" tabindex="-1"><p class="note">A startup pass checks only that an app opens; it does not verify every feature. Recipe failures may mean test steps no longer match the app. Screenshots are smoke-test evidence, not app-store images.</p>${cards.length ? cards.join("") : "<p>No app results are available.</p>"}</main><footer>Read-only results · At most three screenshots per app (2 MiB each, 30 MiB total) from the latest run. Workflow diagnostics expire after 14 days.</footer></body></html>`;
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(join(output, "index.html"), html),
  );
  cpSync(
    new URL("./site-client.js", import.meta.url),
    join(output, "freshness.js"),
  );
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      join(output, "style.css"),
      css +
        "\n[role=status]{padding:.85rem 1rem;margin-top:2rem;border-left:5px solid;font-weight:750}code{overflow-wrap:anywhere}.apphead>div{min-width:0}summary{padding:.6rem 0}",
    ),
  );
}

const css = `:root{color-scheme:light;--ink:#18221f;--muted:#52605b;--paper:#f4f3ed;--card:#fffefa;--green:#146e50;--line:#d5d8cf;--red:#852c24}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.55 system-ui,sans-serif}header,main,footer{width:min(68rem,calc(100% - 2rem));margin-inline:auto}header{padding:4rem 0 2rem}h1{font:clamp(3rem,9vw,6.6rem)/.95 Georgia,serif;letter-spacing:-.06em;margin:.3rem 0 1rem}h1 i{color:var(--green);font-weight:400}.eyebrow{font:700 .75rem/1.2 monospace;letter-spacing:.16em;color:var(--green)}aside{padding:.85rem 1rem;margin-top:2rem;border-left:5px solid;font-weight:750}.fresh{background:#e2eee7;border-color:var(--green)}.stale{background:#f5e5df;border-color:var(--red)}.note{max-width:68ch;color:var(--muted);margin:0 0 1.5rem}article{background:var(--card);border:1px solid var(--line);padding:clamp(1rem,3vw,2rem);margin:1rem 0 1.4rem;box-shadow:0 8px 24px #18221f0b}.apphead{display:flex;justify-content:space-between;gap:1rem;align-items:start}h2{font:2rem/1.1 Georgia,serif;margin:0 0 .3rem}code,time,.muted{color:var(--muted);font-size:.85rem}dl{display:flex;gap:1rem 2rem;flex-wrap:wrap;margin:1.4rem 0}dl div{min-width:8rem}dt{color:var(--muted);font-size:.82rem}dd{margin:0;font-weight:750}.captures{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem;margin:1rem 0}.captures a{display:block;aspect-ratio:16/10;background:#e8e8e1;overflow:hidden}.captures img{width:100%;height:100%;object-fit:contain}summary,a{color:var(--green);cursor:pointer}a:focus-visible,summary:focus-visible,.skip:focus{outline:3px solid #c26028;outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;background:#f0f0e9;padding:1rem}footer{padding:2rem 0 4rem;color:var(--muted);font-size:.85rem}.skip{position:absolute;left:-999px}.skip:focus{left:1rem;top:1rem;background:white;padding:.5rem;z-index:2}@media(max-width:38rem){header{padding-top:2.5rem}.apphead{display:block}.apphead time{display:block;margin-top:.8rem}.captures{grid-template-columns:1fr 1fr}article{padding:1rem}dl{gap:1rem}dl div{min-width:6.5rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

main(import.meta, () => {
  const args = argumentsFor(["report", "artifacts", "output"]);
  return build(
    args.report ?? "downloads/report/report.json",
    args.artifacts ?? "downloads",
    args.output ?? "site",
  );
});
