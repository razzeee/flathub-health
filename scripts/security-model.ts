import { z } from "zod";
import { appSchema } from "./model.ts";

export const INVENTORY_LIMIT = 16 * 1024 * 1024;
export const RECORD_LIMIT = 64 * 1024;
export const SCAN_LIMIT = 32 * 1024 * 1024;
export const INVENTORY_PUBLICATION_LIMIT = 32 * 1024 * 1024;
export const SECURITY_PUBLICATION_LIMIT = 128 * 1024 * 1024;
export const SECURITY_LIMITATIONS =
  "Inventory coverage is incomplete. Content inspection cannot identify every static or vendored dependency. Extensions are not scanned unless explicitly selected. Manifest declarations do not prove what remains after build cleanup. The runtime is the current remote runtime, not a particular installed system's runtime. Scanner matches need triage; this is not proof of safety.";

const text = z.string().min(1).max(2000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const tool = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  archive_sha256: digest,
});
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
  analysis: z.strictObject({ syft: tool, grype: tool }).optional(),
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

export const evidenceSchema = z.strictObject({
  path: z.enum(["scanner-input.cdx.json", "grype.json", "coverage.json"]),
  sha256: digest,
  bytes: z.number().int().positive().max(SCAN_LIMIT),
});
export const severities = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Negligible",
  "Unknown",
] as const;
export const findingSchema = z.strictObject({
  vulnerability: text,
  package: text,
  version: text,
  severity: z.enum(severities),
  cvss: z
    .strictObject({
      score: z.number().min(0).max(10),
      version: text,
      source: text.optional(),
    })
    .optional(),
  fixes: z.array(text).max(100),
  match_types: z.array(text).max(100),
  scope: z.enum(["app", "runtime", "unknown"]),
  bom_ref: text,
});
export type Finding = z.infer<typeof findingSchema>;
export const coverageObservationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("incomplete") }),
  z.strictObject({ status: z.literal("failed"), message: text }),
  z.strictObject({
    status: z.literal("completed"),
    inventory_sha256: digest,
    evidence: evidenceSchema.extend({ path: z.literal("coverage.json") }),
  }),
]);
export type CoverageObservation = z.infer<typeof coverageObservationSchema>;
export const scanSchema = z.union([
  z.literal("not_requested"),
  z.strictObject({ status: z.literal("incomplete") }),
  z.strictObject({ status: z.literal("failed"), message: text }),
  z.strictObject({
    status: z.literal("completed"),
    finished_at: z.iso.datetime({ offset: true }),
    inventory_sha256: digest,
    scanner_version: text,
    scanner_sha256: digest,
    database_built: z.iso.datetime({ offset: true }),
    database_schema: text,
    database_checksum: text,
    matches: z.number().int().nonnegative(),
    severities: z.record(z.enum(severities), z.number().int().nonnegative()),
    scopes: z.strictObject({
      app: z.number().int().nonnegative(),
      runtime: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    }),
    evidence: z.strictObject({
      input: evidenceSchema.extend({
        path: z.literal("scanner-input.cdx.json"),
      }),
      findings: evidenceSchema.extend({ path: z.literal("grype.json") }),
    }),
  }),
]);
export type Scan = z.infer<typeof scanSchema>;

const base = {
  schema_version: z.literal(1),
  app: appSchema,
  repository: securityConfigSchema.shape.repository,
  run_id: z.string().regex(/^(local|\d+)$/),
  run_attempt: z.string().regex(/^\d+$/),
  started_at: z.iso.datetime({ offset: true }),
  generator: securityConfigSchema.shape.generator,
  scan: scanSchema,
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
    content_scanner: z
      .strictObject({ version: text, binary_sha256: digest })
      .optional(),
    inventory: inventorySchema,
    coverage: coverageObservationSchema.optional(),
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
