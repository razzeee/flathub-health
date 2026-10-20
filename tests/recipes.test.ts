import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
