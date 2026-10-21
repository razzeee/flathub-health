// Refresh on the exact expiry boundary, after backgrounding, and on BFCache restore.
const banner = document.querySelector("#freshness");
if (banner) {
  const tested = Date.parse(banner.dataset.testedAt || "");
  const lifetime = 36 * 60 * 60 * 1000;
  let timer;
  function refresh() {
    clearTimeout(timer);
    const age = Date.now() - tested;
    const known = Number.isFinite(age) && age >= 0;
    const fresh = known && age < lifetime;
    banner.className = fresh ? "fresh" : "stale";
    banner.textContent = `${fresh ? "FRESH" : "STALE / UNAVAILABLE"} · Latest test: ${known ? new Date(tested).toISOString() : "time unavailable"}. Results expire after 36 hours.`;
    timer = setTimeout(
      refresh,
      fresh ? Math.min(60000, lifetime - age) : 60000,
    );
  }
  refresh();
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pageshow", refresh);
}
