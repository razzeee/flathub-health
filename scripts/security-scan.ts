import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { message } from "./model.ts";
import type { Executor } from "./process.ts";
import { ROOT } from "./io.ts";
import { describeEvidence, evidenceBytes, sha256 } from "./security.ts";
import {
  findingSchema,
  SCAN_LIMIT,
  scanSchema,
  severities,
} from "./security-model.ts";
import type { Finding, Scan, SecurityConfig } from "./security-model.ts";

const properties = z.array(z.object({ name: z.string(), value: z.string() }));
const component = z.looseObject({ "bom-ref": z.string(), properties });
const documentSchema = z.looseObject({
  components: z.array(component),
  dependencies: z
    .array(
      z.looseObject({
        ref: z.string(),
        dependsOn: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  compositions: z
    .array(z.looseObject({ assemblies: z.array(z.string()).optional() }))
    .optional(),
});

// Match the pinned generator's Grype projection, including quarantined identities.
// The original inventory remains unchanged and both digests are retained.
export function scannerInput(bytes: Buffer): Buffer {
  const document = documentSchema.parse(JSON.parse(bytes.toString("utf8")));
  const rejected = new Set(
    document.components
      .filter((c) =>
        c.properties.some(
          (p) =>
            p.name === "flatpak:identity-status" && p.value === "quarantined",
        ),
      )
      .map((c) => c["bom-ref"]),
  );
  document.$schema = "https://cyclonedx.org/schema/bom-1.6.schema.json";
  document.specVersion = "1.6";
  document.components = document.components.filter(
    (c) => !rejected.has(c["bom-ref"]),
  );
  document.dependencies = document.dependencies
    ?.filter((d) => !rejected.has(d.ref))
    .map((d) => ({
      ...d,
      dependsOn: d.dependsOn?.filter((ref) => !rejected.has(ref)),
    }));
  document.compositions = document.compositions?.map((c) => ({
    ...c,
    assemblies: c.assemblies?.filter((ref) => !rejected.has(ref)),
  }));
  return Buffer.from(JSON.stringify(document));
}

const cvssSchema = z.object({
  version: z.string().min(1).max(2000),
  source: z.string().min(1).max(2000).optional(),
  metrics: z.object({ baseScore: z.number().min(0).max(10) }),
});
const reportSchema = z.object({
  descriptor: z.object({
    version: z.string(),
    db: z.object({
      status: z.object({
        built: z.iso.datetime({ offset: true }),
        from: z.url(),
        schemaVersion: z.string().min(1),
        valid: z.literal(true),
      }),
    }),
  }),
  matches: z
    .array(
      z.object({
        vulnerability: z.object({
          id: z.string().min(1),
          severity: z.string(),
          fix: z.object({ versions: z.array(z.string()) }).optional(),
          cvss: z.array(z.unknown()).nullish(),
        }),
        relatedVulnerabilities: z
          .array(z.object({ cvss: z.array(z.unknown()).nullish() }))
          .nullish(),
        artifact: z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          version: z.string().optional(),
        }),
        matchDetails: z.array(z.object({ type: z.string() })).optional(),
      }),
    )
    .max(100_000),
});

export function inspectScan(bytes: Buffer, inventory: Buffer) {
  if (bytes.length > SCAN_LIMIT) throw new Error("scan exceeds size limit");
  const report = reportSchema.parse(JSON.parse(bytes.toString("utf8")));
  const databaseAge =
    Date.now() - Date.parse(report.descriptor.db.status.built);
  if (databaseAge < -5 * 60_000)
    throw new Error("database build timestamp is in the future");
  const components = new Map(
    documentSchema
      .parse(JSON.parse(inventory.toString("utf8")))
      .components.map((c) => [c["bom-ref"], c]),
  );
  const counts = Object.fromEntries(severities.map((s) => [s, 0])) as Record<
    (typeof severities)[number],
    number
  >;
  const scopes = { app: 0, runtime: 0, unknown: 0 };
  const findings: Finding[] = report.matches.map((match) => {
    const c = components.get(match.artifact.id);
    const rawScope = c?.properties.find(
      (p) => p.name === "flatpak:scope",
    )?.value;
    const scope =
      rawScope === "app" || rawScope === "runtime" ? rawScope : "unknown";
    const severity =
      severities.find((s) => s === match.vulnerability.severity) ?? "Unknown";
    counts[severity]++;
    scopes[scope]++;
    const scores = [
      ...(match.vulnerability.cvss ?? []),
      ...(match.relatedVulnerabilities ?? []).flatMap((v) => v.cvss ?? []),
    ].flatMap((value) => {
      const parsed = cvssSchema.safeParse(value);
      return parsed.success
        ? [
            {
              score: parsed.data.metrics.baseScore,
              version: parsed.data.version,
              source: parsed.data.source,
            },
          ]
        : [];
    });
    const cvss = scores.toSorted((a, b) => b.score - a.score)[0];
    return findingSchema.parse({
      vulnerability: match.vulnerability.id,
      package: match.artifact.name,
      version: match.artifact.version || "Unknown",
      severity,
      ...(cvss ? { cvss } : {}),
      fixes: match.vulnerability.fix?.versions ?? [],
      match_types: [...new Set(match.matchDetails?.map((m) => m.type) ?? [])],
      scope,
      bom_ref: match.artifact.id,
    });
  });
  return {
    findings,
    summary: {
      scanner_version: report.descriptor.version,
      database_built: report.descriptor.db.status.built,
      database_schema: report.descriptor.db.status.schemaVersion,
      database_checksum: z
        .string()
        .regex(/^sha256:[a-f0-9]{64}$/)
        .parse(
          new URL(report.descriptor.db.status.from).searchParams.get(
            "checksum",
          ),
        ),
      matches: findings.length,
      severities: counts,
      scopes,
    },
  };
}

export function publishedFindings(findings: Finding[]): Finding[] {
  const ordered = findings.toSorted(
    (a, b) =>
      (b.cvss?.score ?? -1) - (a.cvss?.score ?? -1) ||
      severities.indexOf(a.severity) - severities.indexOf(b.severity) ||
      a.vulnerability.localeCompare(b.vulnerability, "en") ||
      a.package.localeCompare(b.package, "en") ||
      a.version.localeCompare(b.version, "en") ||
      a.bom_ref.localeCompare(b.bom_ref, "en"),
  );
  return (["app", "runtime", "unknown"] as const).flatMap((scope) =>
    ordered.filter((finding) => finding.scope === scope).slice(0, 200),
  );
}

export async function scanInventory(
  inventory: Buffer,
  output: string,
  config: NonNullable<SecurityConfig["analysis"]>,
  execute: Executor,
): Promise<Scan> {
  const log = join(output, "scan.log");
  try {
    const version = JSON.parse(
      (await execute(["grype", "version", "-o", "json"], log)).stdout,
    );
    if (version.version !== config.grype.version)
      throw new Error("scanner version mismatch");
    const binary = (await execute(["which", "grype"], log)).stdout;
    const scannerHash = sha256(readFileSync(binary));
    const input = scannerInput(inventory);
    writeFileSync(join(output, "scanner-input.cdx.json"), input);
    await execute(
      [
        "python3",
        join(ROOT, "scripts/validate-inventory.py"),
        join(output, "scanner-input.cdx.json"),
      ],
      log,
      { timeoutMs: 180_000 },
    );
    await execute(
      [
        "grype",
        `sbom:${join(output, "scanner-input.cdx.json")}`,
        "-o",
        "json",
        "--file",
        join(output, "grype.json"),
      ],
      log,
      { timeoutMs: 600_000 },
    );
    const raw = evidenceBytes(output, ["grype.json"], SCAN_LIMIT);
    const { summary } = inspectScan(raw, input);
    if (summary.scanner_version !== config.grype.version)
      throw new Error("scan provenance mismatch");
    return scanSchema.parse({
      status: "completed",
      finished_at: new Date().toISOString(),
      inventory_sha256: sha256(inventory),
      scanner_sha256: scannerHash,
      ...summary,
      evidence: {
        input: describeEvidence("scanner-input.cdx.json", input),
        findings: describeEvidence("grype.json", raw),
      },
    });
  } catch (error) {
    return { status: "failed", message: message(error).slice(0, 2000) };
  }
}

export interface ScanEvidence {
  inventory: Buffer;
  input: Buffer;
  findings: Buffer;
}

export function validateScan(
  scan: Extract<Scan, { status: "completed" }>,
  evidence: ScanEvidence,
) {
  if (
    scan.inventory_sha256 !== sha256(evidence.inventory) ||
    !evidence.input.equals(scannerInput(evidence.inventory))
  )
    throw new Error("scan input mismatch");
  for (const [key, bytes] of [
    ["input", evidence.input],
    ["findings", evidence.findings],
  ] as const) {
    if (
      !isDeepStrictEqual(
        describeEvidence(scan.evidence[key].path, bytes),
        scan.evidence[key],
      )
    )
      throw new Error("scan evidence mismatch");
  }
  const inspected = inspectScan(evidence.findings, evidence.input);
  for (const [key, value] of Object.entries(inspected.summary)) {
    if (!isDeepStrictEqual(scan[key as keyof typeof inspected.summary], value))
      throw new Error("scan summary mismatch");
  }
  return inspected.findings;
}
