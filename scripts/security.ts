/** One observation owns execution, validation, provenance and evidence lifetime. */
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { load } from "./catalog.ts";
import { argumentsFor, beneath, canonical, main, ROOT } from "./io.ts";
import { appSchema, message } from "./model.ts";
import type { App } from "./model.ts";
import { command } from "./process.ts";
import type { Executor } from "./process.ts";
import { loadSecurity } from "./security-config.ts";
import {
  INVENTORY_LIMIT,
  inventorySchema,
  securityRecordSchema,
} from "./security-model.ts";
import type { Inventory, SecurityRecord } from "./security-model.ts";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Only real files beneath real directories are eligible evidence. Callers supply
// fixed path segments, never paths from an artifact's contents.
export function evidenceBytes(
  root: string,
  parts: string[],
  limit: number,
): Buffer {
  if (!lstatSync(root).isDirectory())
    throw new Error("invalid evidence directory");
  let path = root;
  for (const [index, part] of parts.entries()) {
    if (!part || part === "." || part === ".." || /[/\\\0]/.test(part))
      throw new Error("invalid evidence path");
    path = join(path, part);
    const stat = lstatSync(path);
    if (index < parts.length - 1) {
      if (!stat.isDirectory()) throw new Error("invalid evidence directory");
    } else if (!stat.isFile() || stat.size > limit) {
      throw new Error("invalid or oversized evidence file");
    }
  }
  return readFileSync(path);
}

const propertySchema = z.object({ name: z.string(), value: z.string() });
const componentSchema = z.object({
  "bom-ref": z.string().min(1),
  properties: z.array(propertySchema),
  purl: z
    .string()
    .regex(/^pkg:[a-z][a-z0-9.+-]*\/.+/)
    .optional(),
});
// Validate the consumed contract, not the complete CycloneDX specification.
const bomSchema = z.object({
  bomFormat: z.literal("CycloneDX"),
  specVersion: z.literal("1.7"),
  metadata: z.object({
    timestamp: z.iso.datetime({ offset: true }),
    component: componentSchema,
    tools: z.object({
      components: z.array(z.object({ name: z.string(), version: z.string() })),
    }),
  }),
  components: z.array(componentSchema).min(2),
  dependencies: z.array(
    z.object({ ref: z.string(), dependsOn: z.array(z.string()).default([]) }),
  ),
  compositions: z
    .array(z.object({ aggregate: z.literal("incomplete") }))
    .min(1),
});

export function inspectInventory(
  bytes: Buffer,
  app: App,
  repository: string,
  version: string,
): Inventory {
  if (bytes.length > INVENTORY_LIMIT)
    throw new Error("inventory exceeds size limit");
  const bom = bomSchema.parse(JSON.parse(bytes.toString("utf8")));
  const properties = (component: z.infer<typeof componentSchema>) => {
    const entries = component.properties.filter((p) =>
      p.name.startsWith("flatpak:"),
    );
    if (new Set(entries.map((p) => p.name)).size !== entries.length)
      throw new Error("ambiguous inventory provenance");
    return Object.fromEntries(entries.map((p) => [p.name, p.value]));
  };
  const ref = `app/${app.app_id}/${app.arch}/${app.branch}`;
  const root = properties(bom.metadata.component);
  if (
    root["flatpak:ref"] !== ref ||
    root["flatpak:repo-url"] !== repository ||
    root["flatpak:inventory-kind"] !== "manifest-derived" ||
    !bom.metadata.tools.components.some(
      (tool) => tool.name === "flatpak-sbom" && tool.version === version,
    )
  ) {
    throw new Error("inventory target or generator mismatch");
  }
  const all = [bom.metadata.component, ...bom.components];
  const refs = new Set(all.map((c) => c["bom-ref"]));
  if (
    refs.size !== all.length ||
    bom.dependencies.some(
      (d) => !refs.has(d.ref) || d.dependsOn.some((r) => !refs.has(r)),
    )
  ) {
    throw new Error("invalid inventory references");
  }
  const snapshots: Partial<Record<"app" | "runtime", Inventory["app"]>> = {};
  const sources = {
    app: { sources: 0, identified: 0, versioned: 0 },
    runtime: { sources: 0, identified: 0, versioned: 0 },
  };
  for (const component of bom.components) {
    const p = properties(component);
    const scope = p["flatpak:scope"];
    if (
      (scope !== "app" && scope !== "runtime") ||
      p["flatpak:repo-url"] !== repository ||
      p["flatpak:inventory-kind"] !== "manifest-derived"
    ) {
      throw new Error("missing inventory provenance");
    }
    const observed = {
      ref: p["flatpak:ref"]!,
      commit: p["flatpak:commit"]!,
      manifest: p["flatpak:manifest-path"]! as Inventory["app"]["manifest"],
    };
    if (
      snapshots[scope] &&
      JSON.stringify(snapshots[scope]) !== JSON.stringify(observed)
    )
      throw new Error("inconsistent inventory snapshots");
    snapshots[scope] = observed;
    if (p["flatpak:source-type"] !== undefined) {
      sources[scope].sources++;
      if (component.purl) {
        sources[scope].identified++;
        if (/^[^?#]*@[^?#]+/.test(component.purl)) sources[scope].versioned++;
      }
    }
  }
  if (
    snapshots.app?.ref !== ref ||
    snapshots.app.commit !== root["flatpak:commit"] ||
    !new RegExp(`^runtime/[A-Za-z0-9_.-]+/${app.arch}/[A-Za-z0-9_.-]+$`).test(
      snapshots.runtime?.ref ?? "",
    )
  ) {
    throw new Error("inventory snapshot mismatch");
  }
  const extensionCount = root["flatpak:unresolved-extension-groups"] ?? "0";
  if (!/^\d+$/.test(extensionCount)) throw new Error("invalid extension count");
  return inventorySchema.parse({
    generated_at: bom.metadata.timestamp,
    app: snapshots.app,
    runtime: snapshots.runtime,
    completeness: "incomplete",
    unresolved_extension_groups: Number(extensionCount),
    sources,
    evidence: {
      path: "inventory.cdx.json",
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
  });
}

export async function observeSecurity(
  app: App,
  outputRoot: string,
  options: {
    root?: string;
    generator?: string;
    execute?: Executor;
  } = {},
): Promise<SecurityRecord> {
  app = appSchema.parse(app);
  const root = canonical(options.root ?? ROOT);
  const config = loadSecurity(root);
  if (
    !config.apps.includes(app.app_id) ||
    !load(join(root, "apps.json")).some((candidate) =>
      isDeepStrictEqual(candidate, app),
    )
  )
    throw new Error("app is not a configured security target");
  outputRoot = canonical(outputRoot);
  if (!beneath(root, outputRoot))
    throw new Error("output must be beneath workspace");
  mkdirSync(outputRoot, { recursive: true });
  const output = join(outputRoot, app.app_id);
  mkdirSync(output); // Never overwrite a previous observation.
  const execute = options.execute ?? command;
  const generator = canonical(options.generator ?? join(root, ".sbom"));
  const binary = join(generator, "target/release/flatpak-sbom");
  const base = {
    schema_version: 1 as const,
    app,
    repository: config.repository,
    generator: config.generator,
    scan: "not_requested" as const,
    started_at: new Date().toISOString(),
    run_id: process.env.GITHUB_RUN_ID ?? "local",
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  };
  let record: SecurityRecord = securityRecordSchema.parse({
    ...base,
    status: "incomplete",
  });
  const save = () => {
    writeFileSync(
      join(output, "security.json.tmp"),
      JSON.stringify(securityRecordSchema.parse(record), null, 2) + "\n",
    );
    renameSync(
      join(output, "security.json.tmp"),
      join(output, "security.json"),
    );
  };
  save();
  let stage: "tool" | "generate" | "validate" = "tool";
  try {
    const log = join(output, "generation.log");
    const revision = await execute(
      ["git", "-C", generator, "rev-parse", "HEAD"],
      log,
    );
    const status = await execute(
      ["git", "-C", generator, "status", "--porcelain"],
      log,
    );
    if (revision.stdout !== config.generator.revision || status.stdout)
      throw new Error(
        "generator checkout must be clean and match security.json",
      );
    const version = await execute([binary, "--version"], log);
    if (version.stdout !== `flatpak-sbom ${config.generator.version}`)
      throw new Error("generator version mismatch");
    const binaryHash = sha256(readFileSync(binary));
    stage = "generate";
    await execute(
      [
        binary,
        "generate",
        `app/${app.app_id}/${app.arch}/${app.branch}`,
        "--repo",
        config.repository,
        "--output",
        join(output, "inventory.cdx.json.tmp"),
      ],
      log,
      { timeoutMs: 600_000 },
    );
    stage = "validate";
    const bytes = evidenceBytes(
      output,
      ["inventory.cdx.json.tmp"],
      INVENTORY_LIMIT,
    );
    const inventory = inspectInventory(
      bytes,
      app,
      config.repository,
      config.generator.version,
    );
    renameSync(
      join(output, "inventory.cdx.json.tmp"),
      join(output, "inventory.cdx.json"),
    );
    record = {
      ...base,
      status: "completed",
      finished_at: new Date().toISOString(),
      binary_sha256: binaryHash,
      inventory,
    };
  } catch (error) {
    record = {
      ...base,
      status: "failed",
      finished_at: new Date().toISOString(),
      stage,
      message: message(error).slice(0, 2000),
    };
  } finally {
    save();
  }
  return record;
}

main(import.meta, async () => {
  const args = argumentsFor(["app", "generator", "output"]);
  const app = load().find((app) => app.app_id === args.app);
  if (!app) throw new Error("--app must name a catalog app");
  const record = await observeSecurity(
    app,
    args.output ?? join(ROOT, "artifacts/security"),
    { generator: args.generator },
  );
  console.log(JSON.stringify({ app_id: app.app_id, status: record.status }));
  process.exitCode = record.status === "completed" ? 0 : 1;
});
