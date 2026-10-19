import { z } from "zod";

const line = z
  .string()
  .refine((value) => Boolean(value.trim()) && !/[\r\n\0]/.test(value), {
    message: "expected a nonempty single-line string",
  });

export const appSchema = z.strictObject({
  app_id: line.regex(
    /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){2,}$/,
  ),
  name: line,
  branch: line.regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
  arch: z.literal("x86_64"),
  limitations: line,
  recipe: line.optional(),
});
export type App = z.infer<typeof appSchema>;

export const catalogSchema = z.strictObject({
  schema_version: z.literal(1),
  apps: z.array(appSchema).min(1),
});

export const phases = ["prepare", "verify", "screenshots"] as const;
export type Phase = (typeof phases)[number];
export type Mode = Exclude<Phase, "prepare">;
const statusSchema = z.enum([
  "passed",
  "incomplete",
  "infrastructure_failed",
  "app_failed",
  "recipe_failed",
  "not_requested",
]);
export type Status = z.infer<typeof statusSchema>;
export const outcomeSchema = z.strictObject({
  status: statusSchema,
  message: z.string().optional(),
  exit_code: z.number().int().nullable().optional(),
  reason: z.string().optional(),
});
export type Outcome = z.infer<typeof outcomeSchema>;

export const digestSchema = line.regex(
  /^[A-Za-z0-9][A-Za-z0-9._/:@-]*@sha256:[a-f0-9]{64}$/,
);
export const runnerSchema = z.strictObject({
  version: line,
  revision: line.regex(
    /^[a-f0-9]{40}$/,
    "runner revision must be a full commit SHA",
  ),
  verify_image: line.regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/),
  screenshots_image: line.regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/),
  verify_digest: digestSchema.optional(),
  screenshots_digest: digestSchema.optional(),
});
export type Runner = z.infer<typeof runnerSchema>;

export const healthSchema = z
  .strictObject({
    schema_version: z.literal(1),
    app: appSchema,
    runner: runnerSchema,
    tested_at: z.iso.datetime({ offset: true }),
    // Python-era artifacts use null for absent GitHub runner metadata.
    environment: z.record(z.string(), z.string().nullish()),
    resolved: z.record(z.string(), z.string()),
    phases: z.strictObject({
      prepare: outcomeSchema,
      verify: outcomeSchema,
      screenshots: outcomeSchema,
    }),
  })
  .superRefine((record, context) => {
    for (const phase of phases) {
      const allowed: Status[] = [
        "passed",
        "incomplete",
        "infrastructure_failed",
      ];
      if (phase === "verify") allowed.push("app_failed");
      if (phase === "screenshots")
        allowed.push(record.app.recipe ? "recipe_failed" : "not_requested");
      if (!allowed.includes(record.phases[phase].status)) {
        context.addIssue({
          code: "custom",
          path: ["phases", phase, "status"],
          message: "invalid status for phase",
        });
      }
    }
    if (record.phases.verify.status === "passed") {
      if (
        !["version", "commit", "ref", "runtime", "runtime_commit"].every(
          (key) => record.resolved[key],
        ) ||
        !record.runner.verify_digest
      ) {
        context.addIssue({
          code: "custom",
          message: "missing app or startup runner version details",
        });
      }
    }
    if (
      record.app.recipe &&
      record.phases.screenshots.status === "passed" &&
      !record.runner.screenshots_digest
    ) {
      context.addIssue({
        code: "custom",
        message: "missing screenshot runner image digest",
      });
    }
  });
export type Health = z.infer<typeof healthSchema>;

// Accept extra upstream fields. A run that fails before launch can omit the
// screenshots and app ref, so check those separately before accepting a pass.
const upstreamFields = {
  schema_version: z.literal(1),
  app_ref: z.string().nullable().optional(),
  screenshots: z.array(z.string()).optional(),
};
export const upstreamResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...upstreamFields,
    status: z.literal("passed"),
    failure: z.null().optional(),
  }),
  z.object({
    ...upstreamFields,
    status: z.literal("failed"),
    failure: z.object({ reason: line, message: z.string().optional() }),
  }),
]);
export interface MissingHealth {
  app: App;
  phases: Record<Phase, Outcome>;
  error: string;
}
export type ReportRow = Health | MissingHealth;

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function successful(
  rows: { phases: Record<Phase, Outcome> }[],
): boolean {
  return rows.every((row) =>
    phases.every((phase) =>
      ["passed", "not_requested"].includes(row.phases[phase].status),
    ),
  );
}
