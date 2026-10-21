import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { dateLabel, freshness, FRESHNESS_MS } from "../data.ts";

export function Freshness({
  testedAt,
  hasRows,
}: {
  testedAt: string;
  hasRows: boolean;
}) {
  // SSR and the first client render agree. Only a live browser clock claims fresh.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const clock = Date.now();
      setNow(clock);
      const remaining = Date.parse(testedAt) + FRESHNESS_MS - clock;
      timer = setTimeout(
        refresh,
        remaining > 0 ? Math.min(remaining, 60000) : 60000,
      );
    }
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [testedAt]);
  const isFresh = now !== null && freshness(testedAt, now);
  const known = Number.isFinite(Date.parse(testedAt));
  const label = !hasRows
    ? "NO RESULTS"
    : now === null
      ? "FRESHNESS UNVERIFIED"
      : isFresh
        ? "FRESH"
        : "STALE / UNAVAILABLE";
  return (
    <Alert
      id="freshness"
      role="status"
      data-tested-at={testedAt}
      variant={isFresh ? "success" : "warning"}
    >
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>
        {hasRows ? (
          <>
            Latest test: {known ? dateLabel(testedAt) : "time unavailable"}.
            Results expire after 36 hours.
            {now === null
              ? " Enable JavaScript for a live freshness check."
              : null}
          </>
        ) : (
          "No valid report is available. No apps are assumed to have passed."
        )}
      </AlertDescription>
    </Alert>
  );
}
