import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirname, resolve, sep } from "node:path";
import { test } from "node:test";
import { parseDocument } from "yaml";
import { z } from "zod";
import { load } from "../scripts/catalog.ts";
import { ROOT } from "../scripts/io.ts";

// Check our captions against flatpak-smoke's recipe contract. Leave validation
// of other recipe actions to the upstream runner.
const captions = z.object({
  steps: z.array(
    z.object({
      capture: z
        .object({
          caption: z
            .string()
            .refine(
              (caption) =>
                caption.trim().length > 0 &&
                !/[\r\n\0]/.test(caption) &&
                !caption.trimEnd().endsWith("."),
              "caption must be a single line without a trailing full stop",
            ),
        })
        .optional(),
    }),
  ),
});

for (const app of load()) {
  const recipe = app.recipe;
  if (!recipe) continue;
  test(`${app.app_id} recipe captions follow the runner contract`, () => {
    const document = parseDocument(readFileSync(join(ROOT, recipe), "utf8"), {
      uniqueKeys: true,
    });
    assert.deepEqual(document.errors, []);
    const checked = captions.parse(document.toJS());
    assert.ok(
      checked.steps.some((step) => step.capture),
      "expected a screenshot capture",
    );
  });
}

test("VLC recipe seeds and opens its redistributable media fixture", () => {
  const recipe = parseDocument(
    readFileSync(join(ROOT, "recipes/org.videolan.VLC.yml"), "utf8"),
    { uniqueKeys: true },
  );
  assert.deepEqual(recipe.errors, []);
  const value = recipe.toJS() as {
    setup: { files: { source: string; destination: string }[] };
    launch: { args: string[] };
    steps: { wait_text?: string; capture?: { name: string } }[];
  };
  const recipePath = join(ROOT, "recipes/org.videolan.VLC.yml");
  const source = value.setup.files[0]!.source;
  assert.ok(
    !source.split(/[\\/]/).includes(".."),
    "source cannot traverse above the recipe directory",
  );
  assert.ok(
    resolve(dirname(recipePath), source).startsWith(
      `${join(ROOT, "recipes")}${sep}`,
    ),
    "source must remain within the recipes tree",
  );
  readFileSync(resolve(dirname(recipePath), source));
  assert.deepEqual(value.setup.files, [
    {
      source: "fixtures/org.videolan.VLC/smoke-test.mp4",
      destination: "data/VLC-smoke-test.mp4",
    },
  ]);
  assert.deepEqual(value.launch.args, [
    "--no-one-instance",
    "--play-and-exit",
    "${APP_DATA}/VLC-smoke-test.mp4",
  ]);
  assert.ok(
    value.steps.some((step) => step.wait_text === "VLC-smoke-test.mp4"),
    "wait for the actual media filename rather than the player shell",
  );
  assert.ok(value.steps.some((step) => step.capture?.name === "sample-video"));
  assert.equal(
    readFileSync(
      join(ROOT, "recipes/fixtures/org.videolan.VLC/README.md"),
      "utf8",
    ).includes("CC0 1.0"),
    true,
    "fixture source and license must be documented",
  );
});

test("LibreOffice recipe seeds and opens the licensed sample document", () => {
  const app = load().find(
    ({ app_id }) => app_id === "org.libreoffice.LibreOffice",
  );
  assert.ok(app?.recipe);
  const parsed = parseDocument(readFileSync(join(ROOT, app.recipe), "utf8"), {
    uniqueKeys: true,
  });
  assert.deepEqual(parsed.errors, []);
  const recipe = z
    .object({
      setup: z.object({
        files: z.array(
          z.object({ source: z.string(), destination: z.string() }),
        ),
      }),
      launch: z.object({ args: z.array(z.string()) }),
      steps: z.array(
        z.object({
          wait_text: z.string().optional(),
          capture: z
            .object({ name: z.string(), caption: z.string() })
            .optional(),
        }),
      ),
    })
    .parse(parsed.toJS());

  assert.deepEqual(recipe.setup.files, [
    {
      source: "fixtures/org.libreoffice.LibreOffice/sample.odt",
      destination: "data/documents/sample.odt",
    },
  ]);
  assert.deepEqual(recipe.launch.args, [
    "--writer",
    "${APP_DATA}/documents/sample.odt",
  ]);
  assert.ok(recipe.steps.some((step) => step.wait_text === "A small garden"));
  assert.ok(
    recipe.steps.some((step) => step.capture?.name === "sample-document"),
  );

  const fixture = join(
    ROOT,
    "recipes/fixtures/org.libreoffice.LibreOffice/sample.odt",
  );
  assert.ok(statSync(fixture).size > 0);
  const odt = readFileSync(fixture);
  assert.equal(odt.subarray(0, 2).toString(), "PK");
  assert.ok(
    odt.includes(Buffer.from("application/vnd.oasis.opendocument.text")),
  );
  assert.match(
    readFileSync(
      join(ROOT, "recipes/fixtures/org.libreoffice.LibreOffice/LICENSE.txt"),
      "utf8",
    ),
    /CC0 1\.0/,
  );
});
