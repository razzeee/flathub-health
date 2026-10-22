# flathub-health

Check whether released Flathub apps install and open a window, then capture
screenshots with app-specific recipes.
[flatpak-smoke](https://github.com/razzeee/flatpak-smoke) runs the tests and
desktop automation. This repository selects apps, prepares bundles, and reports
the results. It does not rebuild app manifests.

## Status

The catalog has seven apps. Calculator, KCalc, and VSCodium cover GTK, Qt, and
Electron. Their recipes come from flatpak-smoke's `tests/compatibility/` at the
revision in `runner.json`. VLC opens a short, silent CC0 test video and
LibreOffice opens a bundled CC0 Writer document from a clean profile. Firefox
remains startup-only; its hosted capture shows the welcome dialog. GIMP's separate
recipe selects the empty editor by title and waits for editor menus before capture.
Its startup check alone can still pass on the splash screen. See the
[GIMP recipe notes](recipes/fixtures/org.gimp.GIMP/README.md) for selectors and
limits. Their inclusion was requested
directly; budget is not a gate for these additions. See
[the selection notes](docs/catalog-selection.md) for sources and test limits.

The historical successful hosted run
([39441598891](https://github.com/razzeee/flathub-health/actions/runs/39441598891))
is historical evidence for flatpak-smoke `v0.2.0`: the three recipes passed
startup and capture, and VLC and LibreOffice passed startup checks. See
[docs/validation.md](docs/validation.md) for the run history and remaining check.

The newer v0.4.0 main run passed startup for the original five apps, but VLC's
screenshot phase failed in the desktop infrastructure. See the dated
[cost baseline](docs/catalog-selection.md#measured-five-app-baseline) for
observed job times and compressed artifact sizes; these are not an agreed budget.

The workflow runs daily at 05:17 UTC and can also be started manually. A startup
pass does not prove that all app functions work. Hosted scheduled runs must
produce complete reports repeatedly before the daily workflow is considered
validated.

The `publish-results` job deploys the read-only results page to GitHub Pages
after each workflow run. Configure the repository's Pages source to **GitHub
Actions** before the first deployment. The page marks results stale after 36
hours, updating at expiry and when a browser tab resumes. Without JavaScript,
freshness is explicitly unverified. Only runs on the default branch publish.
It shows at most three smoke-test captures per app (2 MiB per
image, 30 MiB total) from the latest run, in startup-then-recipe order. Only
output images declared by each phase's `result.json` are published; debug
baselines, OCR images, and diagnostic copies are excluded. Captures are labeled
with their phase and name. Optional recipe `capture.caption` descriptions come
from the runner's `screenshots.json` and appear below the image and in its viewer.
For example:

```yaml
- capture:
    name: settings
    caption: Change VSCodium settings
```

Captions describe the intended capture, not an additional test assertion. Startup
images show a first visible window, which may be a welcome dialog or splash screen.
Missing caption metadata falls back to the capture filename; missing/invalid
result manifests never fall back to scanning diagnostic images. The deployment
replaces the prior published set. Diagnostic artifacts remain in Actions for 14 days. Missing or
invalid reports are shown as unavailable/incomplete, never as passing.

## Setup

Use Linux x86_64 with these tools:

- Node.js 24.2 or newer. Use the current Node 24 LTS release.
- pnpm 12.6.0, pinned in `package.json`.
- Python 3.10 or newer for the upstream action wrapper.
- Git, Flatpak, OSTree, and Docker with privileged-container access.

Node runs the runner and reporter TypeScript files without a build step. Zod
validates JSON at runtime and supplies the TypeScript types. The results frontend
uses React, Vite, Tailwind CSS, and shadcn/Radix; its dependencies are development
dependencies used by the static-site build. App and report jobs install only Zod.

Allow several GB of disk space and downloads per app. The screenshot image
includes a desktop environment.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm check
pnpm test
node scripts/catalog.ts
git clone https://github.com/razzeee/flatpak-smoke.git .runner
git -C .runner checkout --detach "$(node scripts/runner.ts)"
node scripts/run.ts --app org.gnome.Calculator
node scripts/run.ts --app org.kde.kcalc
node scripts/run.ts --app com.vscodium.codium
node scripts/run.ts --app org.videolan.VLC
node scripts/run.ts --app org.libreoffice.LibreOffice
node scripts/run.ts --app org.mozilla.firefox
node scripts/run.ts --app org.gimp.GIMP
node scripts/report.ts
```

Run each app command even if the previous one fails. The scripts return a
nonzero exit code for failures or incomplete results.

## Results and repeat runs

Each app writes a compact `health.json` result record separately from
preparation logs and the runner's `verify/` and `screenshots/` results, images,
and logs. GitHub stores these as separate record and diagnostics artifacts. The
reporter writes `artifacts/report/{report.json,summary.md}` and a separate
`history.json` record artifact.

The report compares startup and recipe results independently against the most
recent retained workflow run, identifies new failures and recoveries, and flags
environment/version changes. Missing phases or records are unavailable, never
passes. History records use schema version 1; unsupported schemas are reported,
and unsupported or malformed records are never interpreted as results. At most 30 prior
workflow runs are queried, and records and diagnostics use GitHub's existing
14-day artifact retention. No logs or screenshots are retained in the history
record artifact.

The scripts refuse to overwrite an existing run. Archive its output, then remove
only that app's generated `artifacts/<app-id>` and `.health-work/<app-id>`
directories before repeating it. Local outputs do not expire automatically.

The script installs the selected Flathub ref in a separate `FLATPAK_USER_DIR`
under `.health-work/` and exports a bundle with `flatpak build-bundle`. The
upstream action installs that bundle in a fresh container for each phase.
Startup tests and screenshot recipes run as `nobody` with separate clean
profiles. A frozen dependency repository exported from the host installation
supplies both phases; missing backend-specific extensions may still be downloaded.
The available dependency set is recorded in `dependency-inputs.json`, while
per-phase metadata records the dependencies actually selected.

`runner.json` pins the runner source revision, image release tags and published
image digests. The script pulls each image by digest and checks its identity.
The workflow reads its upstream checkout revision from the same validated config.
Each digest is saved before invoking the upstream action.
Reports include app and runtime refs and commits reported by each test phase,
the runner image version, reference and immutable digest used by that phase,
the YAML-only recipe hash, fixture-inclusive input digest, wrapper execution and
cleanup diagnostics, failure category, runner environment, and UTC test time. Missing phase
metadata is represented as unavailable rather than inferred from preparation.
The preparation installation's commits remain in `resolved` for comparison;
they are not substituted for commits reported by the test containers.

## GitHub Actions

Open [Actions](https://github.com/razzeee/flathub-health/actions), select
"Flathub health", and choose "Run workflow" to start a manual run. The workflow
also runs daily at 05:17 UTC; GitHub can delay scheduled jobs. The configured
v0.5.0 images have verified public linux/amd64 manifests and include blank-capture
publication guards. See [upgrade validation](docs/flatpak-smoke-v0.5.0.md) for current evidence. GIMP passed hosted startup and editor-recipe
checks with v0.4.1 in [run 39752711587](https://github.com/razzeee/flathub-health/actions/runs/39752711587);
the earlier Firefox and GIMP startup-only evidence used v0.4.0. Limitations
and measured run costs are documented in the selection notes.
For future upgrades, update the source revision and both image
tags and digests together in `runner.json` to a verified release with available images.

To pause daily runs, disable "Flathub health" from its Actions page (this also
disables manual runs). To keep manual runs available but stop the schedule,
remove the `schedule` trigger from `.github/workflows/check-apps.yml` and merge
that change. Re-enable the workflow or restore the trigger to resume daily runs.

For an explicitly labeled, isolated hosted workflow-fixture run, select
"Hosted failure-isolation test (opt-in)" and type `RUN HOSTED FAILURE TEST`.
It is workflow-dispatch-only, uses no app-catalog entries or privileged
containers, and writes fixture artifacts under separate names; one matrix case
intentionally omits its artifact. The test suite separately exercises install failure,
missing/incomplete report evidence, distinct app/recipe/infrastructure
classifications, and TERM cancellation/process-group cleanup. A GitHub-hosted
fixture run validates matrix continuation and artifact handling, not real
Docker-container cleanup; that remains covered by the safe process tests.

### Limits

- Each app gets a fresh Ubuntu 24.04 VM. At most five app jobs run at once.
- Matrix fail-fast is off. A startup failure does not prevent the recipe attempt.
  Each phase prepares its own image after shared bundle preparation. A missing
  image in either phase cannot suppress the other phase's results.
- Installation has a 15-minute timeout. Each image pull and bundle export has
  a 5-minute timeout. Other preparation commands have their own timeouts.
- Each runner phase has a 5-minute CLI timeout, a 420-second wrapper execution
  budget and a separate 30-second cleanup budget, within a 480-second process
  deadline. Each app job has a 45-minute limit.
- Seven app jobs can use at most 315 VM-minutes per run, plus the catalog and
  report jobs. A daily run would use at most about 9,450 app VM-minutes in a
  30-day month. These are timeout ceilings, not measured costs or an agreed
  budget. Downloads and screenshot storage add to that cost.
- GitHub keeps result artifacts and the combined report for 14 days.

### Failures and permissions

Upload and report steps run after test failures. The reporter marks missing or
invalid job artifacts as `incomplete`. Cancellation or VM loss can still prevent
an upload.

The process adapter writes logs as commands run. On timeout or cancellation, it
sends TERM to the child process group, then KILL if needed. The TERM handler in
the upstream wrapper gets time to remove its Docker container.

Test and report workflow permissions are read-only, and checkout does not retain
credentials. The separate Pages publishing job alone gets `pages: write` and
`id-token: write` (plus read access to Actions artifacts); it downloads data and
publishes static files without executing artifact files. The workflow has no
secrets or PR triggers. Run privileged containers only on disposable VMs with
reviewed code. Do not use shared machines that hold secrets.

Reports distinguish startup failures, `recipe_failed`, `infrastructure_failed`,
and `incomplete`. Preparation and download errors count as infrastructure
failures. A changed OCR label can break a recipe without breaking the app.
Capture categories distinguish known infrastructure from unmet expectations.
Unclassified `screenshot_failed` results remain conservatively infrastructure/unassessed;
they are not proof of a recipe or app regression. Wrapper diagnostics are separate
from CLI failures, and unsuccessful cleanup prevents a passing health verdict.
A startup pass does not test every app function. Review screenshots as evidence;
the tests do not compare pixels against a reference image.

## Development

Zod validates catalog entries, runner configuration, upstream results, and health
artifacts. The scripts also check path containment, duplicate app IDs, and
screenshot files.

Run `pnpm format` to format maintained files. Prettier skips generated outputs,
the upstream checkout, dependencies, and the lockfile. CI checks formatting and
installs runtime dependencies in app and report jobs.

Actions handles app concurrency, and the local commands run in sequence. Node's
built-in process handling and test runner cover the current needs without Effect.

### Results frontend

`web/src/` contains the React page and shadcn components. `web/scripts/prepare.ts`
validates the existing report records and copies bounded screenshot evidence;
`web/scripts/build.ts` builds Vite assets and prerenders the page with escaped
embedded props. Fonts are bundled locally. Results, native disclosures, and image
links work without JavaScript. Hydration adds live freshness, Radix disclosures,
and a keyboard-accessible image viewer.
The light and dark palettes follow the system preference, including without
JavaScript. The Appearance selector can save an explicit light/dark override.

```sh
# Hot-reloading frontend (starts with the empty report state)
pnpm dev

# Build downloaded Actions artifacts into site/, then preview that build
pnpm site --report downloads/report/report.json --artifacts downloads --output site
pnpm preview
```

The artifacts directory should contain `health-<app-id>/` diagnostics folders.
Set `GITHUB_RUN_ID` when building to link diagnostics to a specific workflow run.
Assets use relative URLs for GitHub Pages project paths. `pnpm test` includes a
production build, prerendering and escaping checks, freshness boundaries, and
evidence limits. The frontend consumes the existing report contract; page props
are build output, not a history storage format.

## Adding an app

1. Add its stable app ID, name, explicit branch, `x86_64` architecture, and test
   limitations to `apps.json`. Do not add shell commands or arbitrary fields.
2. Add `recipes/<app-id>.yml` if it needs a screenshot recipe. Use the upstream
   recipe format. Avoid accounts, paid content, and hardware-dependent checks.
   Captions must be nonempty single lines without trailing periods. `pnpm test`
   checks every catalog recipe against these caption rules.
3. If the recipe needs sample data, keep redistributable files beneath its
   recipe directory and document their source and license. flatpak-smoke rejects
   `setup.files` paths that traverse above the recipe directory. The VLC test
   video is synthetic, silent, and CC0; its playback screenshot does not
   establish audio output, general codec compatibility, or hardware acceleration.
   LibreOffice's bundled Writer document is also CC0 1.0; its recipe seeds it
   into the clean profile and opens it directly rather than relying on the start
   center.
4. Run validation and tests, test both phases manually, and review the captures.

For further additions, record a dated official Flathub source and explain the
selection in [the catalog notes](docs/catalog-selection.md). Keep the catalog
small until hosted tests establish its runtime and download costs.

The workflow does not publish listing screenshots or file upstream issues.

## Runner integration

See [v0.5.0 feature coverage and validation](docs/flatpak-smoke-v0.5.0.md) for dependency snapshots, execution diagnostics, failure attribution, and recipe-input provenance.
