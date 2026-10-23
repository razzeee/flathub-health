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
Hosted run [39875487593](https://github.com/razzeee/flathub-health/actions/runs/39875487593)
at `cdd4a00edd0bbf06b2eefb5c163e91f859ea175a` passed all seven app jobs and
the aggregate report with dependency reuse enabled, without diagnostic workflow
patches. Both GIMP and VSCodium emit `dependency-inputs.json` again. Their app and
every selected runtime/extension commit match the failing v0.5.0 reuse run and
the mitigated baseline exactly in both verify and screenshots phases.

Visually reviewed the declared GIMP editor capture: tool icons and brush previews
render normally. VSCodium's README editor and settings panel render correctly.
VLC's declared capture also shows the actual test-pattern video. No splash,
blank desktop or idle player is accepted as editor/media readiness. Firefox
remains startup-only; this release makes no page-readiness claim.

This application-level evidence meets the exception-removal gate independently
of upstream fixture regression coverage. The follow-up commit only records this
evidence and updates README wording; executable code and runner pins are unchanged.

Baselines: failing reuse run [39851320733](https://github.com/razzeee/flathub-health/actions/runs/39851320733),
controlled no-reuse run [39853806251](https://github.com/razzeee/flathub-health/actions/runs/39853806251),
and merged mitigation candidate [39855463739](https://github.com/razzeee/flathub-health/actions/runs/39855463739).
