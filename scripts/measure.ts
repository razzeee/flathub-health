/** Hosted app-check measurements, separate from functional health results. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main, ROOT, writeJson, readJson } from "./io.ts";
import { load } from "./catalog.ts";
import { z } from "zod";

const snapshotSchema = z.object({
  at_ms: z.number().int().nonnegative(),
  interface: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
  received_bytes: z.number().int().nonnegative(),
});
type Snapshot = z.infer<typeof snapshotSchema>;

export function defaultInterface(routes: string): string {
  for (const line of routes.trim().split("\n").slice(1)) {
    const [name, destination, , flags] = line.trim().split(/\s+/);
    if (destination === "00000000" && (parseInt(flags ?? "0", 16) & 3) === 3) {
      return snapshotSchema.shape.interface.parse(name);
    }
  }
  throw new Error("no active default IPv4 route for traffic measurement");
}

export function delta(start: Snapshot, end: Snapshot) {
  snapshotSchema.parse(start);
  snapshotSchema.parse(end);
  if (
    start.interface !== end.interface ||
    end.at_ms < start.at_ms ||
    end.received_bytes < start.received_bytes
  ) {
    throw new Error("measurement clock, interface, or counter changed");
  }
  return {
    elapsed_seconds: (end.at_ms - start.at_ms) / 1000,
    interface: start.interface,
    host_received_bytes: end.received_bytes - start.received_bytes,
    scope:
      "app-check step only; default-interface receive traffic includes background traffic, not exact Flatpak payload or total job downloads",
  };
}

function snapshot(): Snapshot {
  const name = defaultInterface(readFileSync("/proc/net/route", "utf8"));
  return snapshotSchema.parse({
    at_ms: Date.now(),
    interface: name,
    received_bytes: Number(
      readFileSync(`/sys/class/net/${name}/statistics/rx_bytes`, "utf8").trim(),
    ),
  });
}

main(import.meta, () => {
  const [mode, appId] = process.argv.slice(2);
  if (
    !["start", "finish"].includes(mode ?? "") ||
    !load().some(({ app_id }) => app_id === appId)
  ) {
    throw new Error(
      "usage: node scripts/measure.ts start|finish <catalog app ID>",
    );
  }
  const state = join(ROOT, `.measurement-${appId}.json`);
  if (mode === "start") writeJson(state, snapshot());
  else
    writeJson(
      join(ROOT, "artifacts", appId!, "resources.json"),
      delta(snapshotSchema.parse(readJson(state)), snapshot()),
    );
});
