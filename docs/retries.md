# Retry policy and evidence

For [Issue #13](https://github.com/razzeee/flathub-health/issues/13), the production
retry allowlist remains empty. An infrastructure classification alone is not
evidence that repeating a check is safe or useful.

## Evidence reviewed on 2026-11-08

- The issue's earlier triage found configuration, preparation, runner and recipe
  defects, not a demonstrated retry-safe transient signature.
- The later failure in [run 40312529205](https://github.com/razzeee/flathub-health/actions/runs/40312529205)
  was VLC's `screenshot_failed`: `native image and window buffer dimensions differ`.
  [PR #57](https://github.com/razzeee/flathub-health/pull/57) reproduced the capture
  race and disabled video autoresizing. Retry is not the remedy for this defect.
- Subsequent hosted workflow conclusions through
  [run 42477858442](https://github.com/razzeee/flathub-health/actions/runs/42477858442)
  were successful. That run's retained report was inspected: all nine apps passed
  preparation and startup; all six requested recipes passed. These are historical
  hosted results, not validation of the attempt-tracking changes.

## Attempt contract

Startup and recipe outcomes retain an `attempts` array, including each attempt's
failure, execution/cleanup evidence and available version metadata. Older records
without this field remain readable; their attempt count is unknown.

The retry controller allows at most two attempts. The production policy currently
rejects every failure. Any future allowlist entry must identify a narrow signature
backed by controlled same-input failure/recovery evidence. Before consulting that
policy, the controller requires an explicit infrastructure category and reason,
consistent nonzero exits, completed wrapper execution, no signal, and successful
cleanup. App failures, recipe failures, cancellation, timeouts, missing results
and unclassified failures are not retry candidates. Preparation is not retried.

The first outcome is saved before a retry. The existing phase directory and logs
retain the first attempt; a second attempt uses `retry/verify` or
`retry/screenshots`, with separate logs and action output. Both use the same
prepared app repository, dependency snapshot and pinned runner image. Reports
distinguish a first-attempt pass, recovery after one retry, and continued failure.
The results page stages captures from the final attempt only, never falling back
to a prior attempt when final evidence is missing.

Tests use a synthetic eligible signature to exercise recovery and the retry limit;
it is not a production allowlist entry or evidence of a real transient failure.
Enabling a real signature remains blocked on evidence. Notifications are not
implemented: recipients, qualifying changes and deduplication need a separate
decision before a notification issue is opened.
