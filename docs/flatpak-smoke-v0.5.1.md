# flatpak-smoke v0.5.1 validation

The [release](https://github.com/razzeee/flatpak-smoke/releases/tag/v0.5.1) fixes
dependency reuse on Flatpak 1.16 by initializing the private system repository
before launch. Portal-spawned children can resolve installations without relaxing
sandboxing or installation isolation (upstream #43/#44). Screenshot bounds-check
timeouts now report `screenshot_failed` instead of `internal_error`; consumer
classification remains unchanged and conservative.

`runner.json` pins the dereferenced release tag revision
`c16708f020b7108eabbc6ce649097ceb417eefc9` and both published image digests.
The candidate removes the GIMP/VSCodium exceptions and uses the same upstream
snapshot exporter and per-phase isolated installations for all seven apps.
No retries, timeouts, recipes, readiness assertions or sandbox settings change.

## Validation gate

Local validation passes all 58 tests (including the production site build), type
checking, formatting and diff checks. Anonymous registry inspection confirms both
linux/amd64 manifest digests and the matching release revision/version labels.
Hosted candidate validation is pending. Do not merge exception
removal based only on the upstream fixture regression. Require all seven hosted
checks and the report to pass; compare GIMP/VSCodium app/runtime/extension commits
against the v0.5.0 failure and mitigated baseline. Inspect the declared editor
captures for GIMP icons/brush previews and the VSCodium README/settings views.
Record any input drift explicitly rather than calling it a matched comparison.

Baselines: failing reuse run [39851320733](https://github.com/razzeee/flathub-health/actions/runs/39851320733),
controlled no-reuse run [39853806251](https://github.com/razzeee/flathub-health/actions/runs/39853806251),
and merged mitigation candidate [39855463739](https://github.com/razzeee/flathub-health/actions/runs/39855463739).
