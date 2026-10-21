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

test("production build prerenders validated results and no-JS links at a relative Pages base", async (t) => {
  const root = temporary(t);
  const report = join(root, "report.json");
  writeFileSync(report, JSON.stringify([record()]));
  const captures = join(root, "health-org.example.Demo");
  mkdirSync(captures);
  for (let i = 0; i < 4; i++)
    writeFileSync(join(captures, `${i}.png`), "image");
  const output = join(root, "site");
  await build(report, root, output);
  const html = readFileSync(join(output, "index.html"), "utf8");
  assert.match(html, /FRESHNESS UNVERIFIED/);
  assert.match(html, /&lt;Demo&gt;/);
  assert.match(html, /<details>/);
  assert.match(html, /href="screenshots\/org.example.Demo\/capture-1.png"/);
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
  const captures = join(root, "health-org.example.Demo");
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
