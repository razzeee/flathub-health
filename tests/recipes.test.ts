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

test("GIMP captures only after selecting the editor and observing its menus", () => {
  const app = load().find(({ app_id }) => app_id === "org.gimp.GIMP");
  assert.ok(app?.recipe, "startup visibility alone can accept GIMP's splash");
  const parsed = parseDocument(readFileSync(join(ROOT, app.recipe), "utf8"), {
    uniqueKeys: true,
  });
  assert.deepEqual(parsed.errors, []);
  const recipe = parsed.toJS();
  assert.equal(recipe.window.title, "GNU Image Manipulation Program");
  const firstCapture = recipe.steps.findIndex(
    (step: { capture?: unknown }) => step.capture,
  );
  assert.ok(firstCapture > 0, "capture must follow editor readiness checks");
  const readiness = recipe.steps.slice(0, firstCapture);
  for (const label of ["Tools", "Filters"]) {
    assert.ok(
      readiness.some(
        (step: { wait_text?: string }) => step.wait_text === label,
      ),
      `require editor menu ${label}, absent from the startup splash`,
    );
  }
  assert.deepEqual(recipe.setup.files, [
    {
      source: "fixtures/org.gimp.GIMP/gimprc",
      destination: "config/gimp-editor/gimprc",
    },
  ]);
  assert.equal(
    readFileSync(
      join(ROOT, "recipes", recipe.setup.files[0].source),
      "utf8",
    ).trim(),
    '(show-welcome-dialog no)\n(config-version "3.2.6")',
    "only dismiss the welcome dialog; keep normal plug-in startup and splash",
  );
  assert.deepEqual(recipe.launch.args, [
    "--gimprc=${APP_CONFIG}/gimp-editor/gimprc",
  ]);
});

test("VLC recipe seeds and opens its redistributable media fixture", () => {
  const recipe = parseDocument(
    readFileSync(join(ROOT, "recipes/org.videolan.VLC.yml"), "utf8"),
    { uniqueKeys: true },
  );
  assert.deepEqual(recipe.errors, []);
  const value = recipe.toJS() as {
    window: { title: string };
    setup: { files: { source: string; destination: string }[] };
    launch: { args: string[] };
    steps: { wait_text?: string; capture?: { name: string } }[];
  };
  assert.equal(value.window.title, "VLC media player");
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
    "--no-qt-privacy-ask",
    "--no-metadata-network-access",
    "--repeat",
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
      window: z.object({ title: z.string() }),
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

  assert.equal(recipe.window.title, "sample.odt — LibreOffice Writer");
  assert.deepEqual(recipe.setup.files, [
    {
      source: "fixtures/org.libreoffice.LibreOffice/sample.odt",
      destination: "data/documents/sample.odt",
    },
    {
      source: "fixtures/org.libreoffice.LibreOffice/registrymodifications.xcu",
      destination: "config/libreoffice/4/user/registrymodifications.xcu",
    },
  ]);
  const profile = readFileSync(
    join(ROOT, "recipes", recipe.setup.files[1]!.source),
    "utf8",
  );
  assert.match(
    profile,
    /oor:path="\/org\.openoffice\.Setup\/Product"[\s\S]*oor:name="WhatsNew"[^>]*>\s*<value>false<\/value>/,
  );
  assert.match(
    profile,
    /oor:path="\/org\.openoffice\.Office\.Common\/Misc"[\s\S]*oor:name="ShowTipOfTheDay"[^>]*>\s*<value>false<\/value>/,
  );
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
