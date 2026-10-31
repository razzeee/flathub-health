import { useEffect, useState } from "react";
import { dateLabel, freshness, FRESHNESS_MS } from "../data.ts";

export function Freshness({
  testedAt,
  hasRows,
  id = "freshness",
  observation = "Latest test",
}: {
  testedAt: string;
  hasRows: boolean;
  id?: string;
  observation?: string;
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
    <div
      id={id}
      className="freshness"
      role="status"
      data-tested-at={testedAt}
      data-fresh={isFresh}
    >
      <span className="freshness-label">{label}</span>
      <span className="freshness-detail">
        {hasRows ? (
          <>
            {observation}: {known ? dateLabel(testedAt) : "time unavailable"}.
            Results are stale after 36 hours.
            {now === null ? " Enable JavaScript to check freshness." : null}
          </>
        ) : (
          "No valid report. No apps are assumed to have passed."
        )}
      </span>
    </div>
  );
}
