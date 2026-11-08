import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSecurity } from "./security-config.ts";
import { main, ROOT } from "./io.ts";
import { command } from "./process.ts";
import { sha256 } from "./security.ts";

main(import.meta, async () => {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("security tool pins require Linux x86_64");
  const analysis = loadSecurity().analysis;
  if (!analysis) throw new Error("security analysis is not configured");
  const output = join(ROOT, ".sbom/target/tools");
  mkdirSync(output, { recursive: true });
  for (const name of ["syft", "grype"] as const) {
    const pin = analysis[name];
    const archive = `${name}_${pin.version}_linux_amd64.tar.gz`;
    const response = await fetch(
      `https://github.com/anchore/${name}/releases/download/v${pin.version}/${archive}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok)
      throw new Error(`${name} download failed: ${response.status}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body!) {
      size += chunk.length;
      if (size > 100 * 1024 * 1024)
        throw new Error("security tool archive exceeds size limit");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== pin.archive_sha256)
      throw new Error(`${name} archive checksum mismatch`);
    const path = join(output, archive);
    writeFileSync(path, bytes);
    await command(
      ["tar", "-xzf", path, "-C", output, name],
      join(output, "install.log"),
    );
  }
});
