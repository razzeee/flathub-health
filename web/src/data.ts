import type { Mode, ReportRow } from "../../scripts/model.ts";

export interface Capture {
  url: string;
  phase: Mode;
  name: string;
  description?: string;
}

export function captureLabel(capture: Capture): string {
  return `${capture.phase === "verify" ? "Startup" : "Recipe"} · ${capture.name}`;
}

/** Ephemeral page props, derived from #8's report; not a history format. */
export interface PageData {
  rows: ReportRow[];
  images: Record<string, Capture[]>;
  runUrl: string;
}

export const FRESHNESS_MS = 36 * 60 * 60 * 1000;
export function freshness(testedAt: string, now: number) {
  const age = now - Date.parse(testedAt);
  return Number.isFinite(age) && age >= 0 && age < FRESHNESS_MS;
}
export function dateLabel(value: string): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  );
}
