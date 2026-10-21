import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build, decodeRows } from "../scripts/site.ts";
import { runInNewContext } from "node:vm";
import { loadRunner } from "../scripts/runner.ts";
import { ROOT } from "../scripts/io.ts";

const app = {
  app_id: "org.example.Demo",
  name: "<Demo>",
  arch: "x86_64",
  branch: "stable",
  limitations: "Startup only",
};

test("site shows missing data clearly and reports old results as stale on each visit", async () => {
  const root = mkdtempSync(join(tmpdir(), "health-site-"));
  const output = join(root, "site");
  await build(join(root, "absent.json"), root, output);
  const html = readFileSync(join(output, "index.html"), "utf8");
  assert.match(html, /NO RESULTS/);
  assert.match(html, /No apps are assumed to have passed/);

  writeFileSync(
    join(root, "report.json"),
    JSON.stringify([
      {
        schema_version: 1,
        app,
        environment: {},
        tested_at: "2020-01-01T00:00:00Z",
        resolved: {},
        runner: loadRunner(ROOT),
        phases: {
          prepare: { status: "passed" },
          verify: { status: "incomplete" },
          screenshots: { status: "incomplete" },
        },
      },
    ]),
  );
  const captures = join(root, "health-org.example.Demo", "captures");
  mkdirSync(captures, { recursive: true });
  for (let i = 0; i < 4; i++)
    writeFileSync(join(captures, `${i}.png`), "image");
  await build(join(root, "report.json"), root, output);
  const rendered = readFileSync(join(output, "index.html"), "utf8");
  assert.match(rendered, /data-tested-at="2020-01-01T00:00:00.000Z"/);
  assert.match(rendered, /STALE \/ UNAVAILABLE/);
  assert.match(rendered, /&lt;Demo&gt;/);
  assert.doesNotMatch(rendered, /<Demo>/);
  assert.equal((rendered.match(/<img /g) ?? []).length, 3);
  const freshRows = JSON.parse(readFileSync(join(root, "report.json"), "utf8"));
  freshRows[0].tested_at = new Date().toISOString();
  writeFileSync(join(root, "report.json"), JSON.stringify(freshRows));
  await build(join(root, "report.json"), root, output);
  const fallback = readFileSync(join(output, "index.html"), "utf8");
  assert.match(fallback, /FRESHNESS UNVERIFIED/);
  assert.doesNotMatch(fallback, /class="fresh"/);
  assert.match(fallback, /src="freshness.js" defer/);
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

test("live freshness expires in an open tab and refreshes after visibility changes", () => {
  const tested = Date.parse("2026-01-01T00:00:00Z");
  let now = tested;
  let callback: () => void = () => {};
  const events: Record<string, () => void> = {};
  const banner = {
    dataset: { testedAt: new Date(tested).toISOString() },
    className: "",
    textContent: "",
  };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  runInNewContext(
    readFileSync(new URL("../scripts/site-client.js", import.meta.url), "utf8"),
    {
      Date: Clock,
      document: {
        querySelector: () => banner,
        addEventListener: (name: string, fn: () => void) => {
          events[name] = fn;
        },
      },
      window: {
        addEventListener: (name: string, fn: () => void) => {
          events[name] = fn;
        },
      },
      clearTimeout() {},
      setTimeout(fn: () => void) {
        callback = fn;
      },
    },
  );
  assert.equal(banner.className, "fresh");
  now += 36 * 3600000;
  callback();
  assert.equal(banner.className, "stale");
  now = tested - 1000;
  events.visibilitychange!();
  assert.equal(banner.className, "stale");
  now = tested;
  events.pageshow!();
  assert.equal(banner.className, "fresh");
});
