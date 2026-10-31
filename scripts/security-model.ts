import { z } from "zod";
import { appSchema } from "./model.ts";

export const INVENTORY_LIMIT = 16 * 1024 * 1024;
export const RECORD_LIMIT = 64 * 1024;
export const SECURITY_LIMITATIONS =
  "Manifest-derived inventory is incomplete: vendored dependencies, source archive contents, binary extra-data payloads and extensions are not fully inventoried. Manifest declarations do not prove what remains after build cleanup. The runtime is the current remote runtime, not a particular installed system's runtime. No vulnerability scan was performed; this is not proof of safety.";

const text = z.string().min(1).max(2000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const securityConfigSchema = z.strictObject({
  schema_version: z.literal(1),
  // file: supports reproducible local OSTree fixtures; hosted runs use HTTPS.
  repository: z.url({ protocol: /^(https|file)$/ }),
  generator: z.strictObject({
    repository: z.literal("razzeee/flatpak-sbom"),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    rust: z.string().regex(/^\d+\.\d+\.\d+$/),
  }),
  apps: z.array(appSchema.shape.app_id).min(1).max(20),
});
export type SecurityConfig = z.infer<typeof securityConfigSchema>;

const counts = z
  .strictObject({
    sources: z.number().int().nonnegative(),
    identified: z.number().int().nonnegative(),
    versioned: z.number().int().nonnegative(),
  })
  .refine((v) => v.versioned <= v.identified && v.identified <= v.sources);
const snapshot = z.strictObject({
  ref: text,
  commit: digest,
  manifest: z.enum(["files/manifest.json", "usr/manifest.json"]),
});
export const inventorySchema = z.strictObject({
  generated_at: z.iso.datetime({ offset: true }),
  app: snapshot,
  runtime: snapshot,
  completeness: z.literal("incomplete"),
  unresolved_extension_groups: z.number().int().nonnegative(),
  sources: z.strictObject({ app: counts, runtime: counts }),
  evidence: z.strictObject({
    path: z.literal("inventory.cdx.json"),
    sha256: digest,
    bytes: z.number().int().positive().max(INVENTORY_LIMIT),
  }),
});
export type Inventory = z.infer<typeof inventorySchema>;

const base = {
  schema_version: z.literal(1),
  app: appSchema,
  repository: securityConfigSchema.shape.repository,
  run_id: z.string().regex(/^(local|\d+)$/),
  run_attempt: z.string().regex(/^\d+$/),
  started_at: z.iso.datetime({ offset: true }),
  generator: securityConfigSchema.shape.generator,
  scan: z.literal("not_requested"),
};
export const securityRecordSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...base, status: z.literal("incomplete") }),
  z.strictObject({
    ...base,
    status: z.literal("failed"),
    finished_at: z.iso.datetime({ offset: true }),
    stage: z.enum(["tool", "generate", "validate"]),
    message: text,
  }),
  z.strictObject({
    ...base,
    status: z.literal("completed"),
    finished_at: z.iso.datetime({ offset: true }),
    binary_sha256: digest,
    inventory: inventorySchema,
  }),
]);
export type SecurityRecord = z.infer<typeof securityRecordSchema>;
export const securityRowSchema = z.discriminatedUnion("status", [
  ...securityRecordSchema.options,
  z.strictObject({ app: appSchema, status: z.literal("not_requested") }),
  z.strictObject({
    app: appSchema,
    status: z.literal("unavailable"),
    message: text,
  }),
]);
export type SecurityRow = z.infer<typeof securityRowSchema>;
export const securityReportSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: base.run_id,
  run_attempt: base.run_attempt,
  requested: z.boolean(),
  rows: z.array(securityRowSchema).max(1000),
});
