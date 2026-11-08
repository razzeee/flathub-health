import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { message } from "./model.ts";
import type { Executor } from "./process.ts";
import { describeEvidence, sha256 } from "./security.ts";
import { SCAN_LIMIT } from "./security-model.ts";
import type { CoverageObservation } from "./security-model.ts";

const scopeCoverage = z.object({
  content_scan: z.string().max(2000),
  content_packages: z.number().int().nonnegative(),
  gaps: z
    .array(z.unknown())
    .max(100_000)
    .transform((gaps) => gaps.length),
});
const coverageSchema = z.object({
  inventory_complete: z.literal(false),
  acquisition_complete: z.boolean(),
  completeness_limitations: z.array(z.string().max(2000)).max(100),
  scopes: z.object({ app: scopeCoverage, runtime: scopeCoverage }),
});
export type Coverage = z.infer<typeof coverageSchema>;

function inspectCoverage(bytes: Buffer): Coverage {
  if (bytes.length > SCAN_LIMIT) throw new Error("coverage exceeds size limit");
  return coverageSchema.parse(JSON.parse(bytes.toString("utf8")));
}

export async function observeCoverage(
  inventory: Buffer,
  output: string,
  generator: string,
  execute: Executor,
): Promise<CoverageObservation> {
  try {
    const bytes = Buffer.from(
      (
        await execute(
          [generator, "coverage", join(output, "inventory.cdx.json")],
          join(output, "generation.log"),
        )
      ).stdout,
    );
    inspectCoverage(bytes);
    writeFileSync(join(output, "coverage.json"), bytes);
    return {
      status: "completed",
      inventory_sha256: sha256(inventory),
      evidence: describeEvidence("coverage.json", bytes),
    };
  } catch (error) {
    return { status: "failed", message: message(error).slice(0, 2000) };
  }
}

export interface CoverageEvidence {
  inventory: Buffer;
  coverage: Buffer;
}

export function validateCoverage(
  observation: Extract<CoverageObservation, { status: "completed" }>,
  evidence: CoverageEvidence,
): Coverage {
  if (
    observation.inventory_sha256 !== sha256(evidence.inventory) ||
    !isDeepStrictEqual(
      observation.evidence,
      describeEvidence("coverage.json", evidence.coverage),
    )
  )
    throw new Error("coverage evidence mismatch");
  return inspectCoverage(evidence.coverage);
}
