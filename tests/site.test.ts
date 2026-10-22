import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build, prerender } from "../web/scripts/build.ts";
import { prepare, decodeRows } from "../web/scripts/prepare.ts";
import { freshness, FRESHNESS_MS } from "../web/src/data.ts";
import { loadRunner } from "../scripts/runner.ts";
import { ROOT } from "../scripts/io.ts";

const app = {
  app_id: "org.example.Demo",
  name: "<Demo>",
  arch: "x86_64",
  branch: "stable",
  limitations: "Startup only",
};
const record = () => ({
  schema_version: 1,
  app,
  environment: {},
  tested_at: new Date().toISOString(),
  resolved: {},
  runner: loadRunner(ROOT),
  phases: {
    prepare: { status: "passed" },
    verify: { status: "incomplete" },
    screenshots: { status: "not_requested" },
  },
});
function temporary(t: { after(fn: () => void): void }) {
  const root = mkdtempSync("/tmp/opencode/health-site-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function result(
  root: string,
  phase: "verify" | "screenshots",
  screenshots: string[],
  overrides = {},
) {
  const dir = join(root, "health-org.example.Demo", phase);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify({
      schema_version: 1,
      status: "passed",
      app_ref: "app/org.example.Demo/x86_64/stable",
      screenshots,
      ...overrides,
    }),
  );
  return dir;
}

test("gallery publishes only declared captures, never diagnostic baselines or OCR images", (t) => {
  const root = temporary(t);
  const report = join(root, "report.json");
  writeFileSync(report, JSON.stringify([record()]));
  const phase = join(root, "health-org.example.Demo", "verify");
  mkdirSync(join(phase, "logs"), { recursive: true });
  mkdirSync(join(phase, "screenshots"));
  for (const name of ["last-candidate", "wayland-baseline", "ocr-contrast"])
    writeFileSync(join(phase, "logs", `${name}.png`), "diagnostic");
  writeFileSync(
    join(phase, "screenshots", "000-window-visible.png"),
    "app window",
  );
  writeFileSync(join(phase, "screenshots", "001-unlisted.png"), "unlisted");
  writeFileSync(
    join(phase, "result.json"),
    JSON.stringify({
      schema_version: 1,
      status: "passed",
      app_ref: "app/org.example.Demo/x86_64/stable",
      screenshots: ["screenshots/000-window-visible.png"],
    }),
  );
  const images = prepare(report, root, join(root, "site")).images[app.app_id]!;
  assert.equal(images.length, 1);
  assert.equal(
    readFileSync(join(root, "site", images[0]!.url), "utf8"),
    "app window",
  );
  assert.equal(images[0]!.phase, "verify");
  assert.equal(images[0]!.name, "Window visible");
});

test("production build prerenders validated results and no-JS links at a relative Pages base", async (t) => {
  const root = temporary(t);
  const report = join(root, "report.json");
  writeFileSync(report, JSON.stringify([record()]));
  const captures = join(
    result(root, "verify", [
      "screenshots/0.png",
      "screenshots/1.png",
      "screenshots/2.png",
      "screenshots/3.png",
    ]),
    "screenshots",
  );
  mkdirSync(captures);
  for (let i = 0; i < 4; i++)
    writeFileSync(join(captures, `${i}.png`), "image");
  const output = join(root, "site");
  await build(report, root, output);
  const html = readFileSync(join(output, "index.html"), "utf8");
  assert.match(html, /FRESHNESS UNVERIFIED/);
  assert.match(html, /&lt;Demo&gt;/);
  assert.match(html, /<details>/);
  assert.match(html, /href="screenshots\/org.example.Demo\/verify\/0.png"/);
  assert.match(html, /Startup · 0/);
  assert.match(html, /not proof of application readiness/);
  assert.match(html, /src="\.\/assets\//);
  assert.equal((html.match(/<img /g) ?? []).length, 3);
  assert.doesNotMatch(html, /<!--app-->/);
  const json = html.match(
    /<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/,
  )![1]!;
  assert.equal(JSON.parse(json).rows[0].app.name, "<Demo>");
});

test("prerendered data cannot break out of its script or corrupt replacement text", () => {
  const dangerous = record();
  dangerous.app = { ...app, name: "</script><script>alert(1)</script>$&" };
  const template = readFileSync(join(ROOT, "web/index.html"), "utf8");
  const html = prerender(template, {
    rows: decodeRows([dangerous]),
    images: {},
    runUrl: "https://github.com/razzeee/flathub-health/actions",
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /\\u003c\/script>/);
  assert.match(html, /\$&/);
  const missing = prerender(template, {
    rows: [],
    images: {},
    runUrl: "https://github.com/razzeee/flathub-health/actions",
  });
  assert.match(missing, /NO RESULTS/);
  assert.match(missing, /No apps are assumed to have passed/);
});

test("invalid records cannot assert passing results or freshness", () => {
  for (const candidate of [
    {
      app,
      phases: { verify: { status: "passed" } },
      tested_at: new Date().toISOString(),
    },
    { app, schema_version: 999, phases: { verify: { status: "passed" } } },
    { app, tested_at: "nonsense" },
  ]) {
    const rows = decodeRows([candidate]);
    assert.equal(rows[0]?.phases.verify.status, "incomplete");
    assert.equal("tested_at" in rows[0]!, false);
  }
  assert.deepEqual(
    decodeRows([null, 42, {}, { app: { app_id: "../escape" } }]),
    [],
  );
});

test("freshness rejects future/invalid times and expires exactly at 36 hours", () => {
  const tested = "2026-01-01T00:00:00Z";
  const epoch = Date.parse(tested);
  assert.equal(freshness(tested, epoch), true);
  assert.equal(freshness(tested, epoch + FRESHNESS_MS - 1), true);
  assert.equal(freshness(tested, epoch + FRESHNESS_MS), false);
  assert.equal(freshness(tested, epoch - 1), false);
  assert.equal(freshness("", epoch), false);
});

test("evidence preparation excludes oversized and symlinked images and replaces old assets", (t) => {
  const root = temporary(t);
  const report = join(root, "report.json");
  writeFileSync(report, JSON.stringify([record()]));
  const phase = result(root, "verify", [
    "screenshots/a.png",
    "screenshots/b.png",
    "screenshots/c.png",
  ]);
  const captures = join(phase, "screenshots");
  mkdirSync(captures);
  writeFileSync(join(root, "secret.png"), "not evidence");
  symlinkSync(join(root, "secret.png"), join(captures, "a.png"));
  writeFileSync(join(captures, "b.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
  writeFileSync(join(captures, "c.png"), "capture");
  const output = join(root, "site");
  assert.equal(prepare(report, root, output).images[app.app_id]?.length, 1);
  const empty = prepare(join(root, "missing.json"), root, output);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.images, {});
});

test("recipe captions and ordered phase labels survive staging; sidecars cannot add captures", (t) => {
  const root = temporary(t);
  const report = join(root, "report.json");
  const row = record();
  row.phases.screenshots.status = "incomplete";
  writeFileSync(report, JSON.stringify([row]));
  const phase = result(
    root,
    "screenshots",
    ["screenshots/000-overview.png", "screenshots/001-settings.png"],
    {
      status: "failed",
      failure: { reason: "screenshot_failed", message: "later capture failed" },
    },
  );
  mkdirSync(join(phase, "screenshots"));
  for (const file of ["000-overview", "001-settings", "002-unlisted"])
    writeFileSync(join(phase, "screenshots", `${file}.png`), file);
  writeFileSync(
    join(phase, "screenshots.json"),
    JSON.stringify({
      schema_version: 1,
      app_ref: "app/org.example.Demo/x86_64/stable",
      captures: [
        {
          path: "screenshots/000-overview.png",
          name: "overview",
          caption: "Read <notes> & settings",
        },
        {
          path: "screenshots/001-settings.png",
          name: "preferences",
          caption: null,
        },
        {
          path: "screenshots/002-unlisted.png",
          name: "unlisted",
          caption: "Do not publish",
        },
      ],
    }),
  );
  const data = prepare(report, root, join(root, "site"));
  const images = data.images[app.app_id]!;
  assert.deepEqual(
    images.map(({ phase, name, description }) => ({
      phase,
      name,
      description,
    })),
    [
      {
        phase: "screenshots",
        name: "Overview",
        description: "Read <notes> & settings",
      },
      { phase: "screenshots", name: "Preferences", description: undefined },
    ],
  );
  const html = prerender(
    readFileSync(join(ROOT, "web/index.html"), "utf8"),
    data,
  );
  assert.match(html, /Recipe · Overview/);
  assert.match(html, /Read &lt;notes&gt; &amp; settings/);
  assert.doesNotMatch(html, /Do not publish/);
});

test("missing, malformed, mismatched manifests never fall back to scanning files", (t) => {
  const root = temporary(t);
  const report = join(root, "report.json");
  writeFileSync(report, JSON.stringify([record()]));
  const phase = result(root, "verify", ["screenshots/000-window-visible.png"]);
  mkdirSync(join(phase, "screenshots"));
  writeFileSync(join(phase, "screenshots/000-window-visible.png"), "window");
  const manifest = join(phase, "result.json");
  for (const invalid of [
    "{",
    "null",
    JSON.stringify({
      schema_version: 1,
      status: "passed",
      app_ref: "app/org.other.App/x86_64/stable",
      screenshots: ["screenshots/000-window-visible.png"],
    }),
  ]) {
    writeFileSync(manifest, invalid);
    assert.deepEqual(
      prepare(report, root, join(root, "site")).images[app.app_id],
      [],
    );
  }
  rmSync(manifest);
  assert.deepEqual(
    prepare(report, root, join(root, "site")).images[app.app_id],
    [],
  );
});

test("declared paths cannot escape or publish logs, and directory/manifest symlinks are rejected", (t) => {
  const root = temporary(t);
  const report = join(root, "report.json");
  writeFileSync(report, JSON.stringify([record()]));
  const phase = result(root, "verify", [
    "../secret.png",
    "/secret.png",
    "screenshots/../../secret.png",
    "logs/ocr.png",
    "screenshots/link.png",
  ]);
  mkdirSync(join(phase, "logs"));
  mkdirSync(join(phase, "screenshots"));
  writeFileSync(join(phase, "logs/ocr.png"), "diagnostic");
  writeFileSync(join(root, "secret.png"), "secret");
  symlinkSync(join(root, "secret.png"), join(phase, "screenshots/link.png"));
  const output = join(root, "site");
  assert.deepEqual(prepare(report, root, output).images[app.app_id], []);
  rmSync(join(phase, "screenshots"), { recursive: true });
  symlinkSync(root, join(phase, "screenshots"));
  result(root, "verify", ["screenshots/secret.png"]);
  assert.deepEqual(prepare(report, root, output).images[app.app_id], []);
  rmSync(join(phase, "result.json"));
  writeFileSync(
    join(root, "result.json"),
    JSON.stringify({
      schema_version: 1,
      status: "passed",
      app_ref: "app/org.example.Demo/x86_64/stable",
      screenshots: ["screenshots/secret.png"],
    }),
  );
  symlinkSync(join(root, "result.json"), join(phase, "result.json"));
  assert.deepEqual(prepare(report, root, output).images[app.app_id], []);
});
