# flathub-health

Check whether released Flathub apps install and open a window, then capture
screenshots with app-specific recipes.
[flatpak-smoke](https://github.com/razzeee/flatpak-smoke) runs the tests and
desktop automation. This repository selects apps, prepares bundles, and reports
the results. It does not rebuild app manifests.

## Status

The catalog has five apps. Calculator, KCalc, and VSCodium cover GTK, Qt, and
Electron. Their recipes come from flatpak-smoke's `tests/compatibility/` at the
revision in `runner.json`. VLC opens a short, silent CC0 test video and
LibreOffice opens a bundled CC0 Writer document from a clean profile. See
[the selection notes](docs/catalog-selection.md) for sources and test limits.

The latest successful hosted run
([39441598891](https://github.com/razzeee/flathub-health/actions/runs/39441598891))
is historical evidence for flatpak-smoke `v0.2.0`: the three recipes passed
startup and capture, and VLC and LibreOffice passed startup checks. See
[docs/validation.md](docs/validation.md) for the run history and remaining check.

The workflow is manual-only. No daily schedule is active. A startup pass does
not prove that all app functions work. Failure isolation still needs hosted
validation before scheduling is considered.

## Setup

Use Linux x86_64 with these tools:

- Node.js 24.2 or newer. Use the current Node 24 LTS release.
- pnpm 12.6.0, pinned in `package.json`.
- Python 3.10 or newer for the upstream action wrapper.
- Git, Flatpak, GNU `timeout`, and Docker with privileged-container access.

Node runs the TypeScript files without a build step. Zod validates JSON at
runtime and supplies the TypeScript types. TypeScript, Node type definitions,
and Prettier are development dependencies.

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
node scripts/report.ts
```

Run each app command even if the previous one fails. The scripts return a
nonzero exit code for failures or incomplete results.

## Results and repeat runs

Each app writes `artifacts/<app-id>/health.json` and preparation logs. When the
runner starts, its `verify/` and `screenshots/` directories contain results,
screenshots, and logs. The reporter writes
`artifacts/report/{report.json,summary.md}`.

The scripts refuse to overwrite an existing run. Archive its output, then remove
only that app's generated `artifacts/<app-id>` and `.health-work/<app-id>`
directories before repeating it. Local outputs do not expire automatically.

The script installs the selected Flathub ref in a separate `FLATPAK_USER_DIR`
under `.health-work/` and exports a bundle with `flatpak build-bundle`. The
upstream action installs that bundle in a fresh container for each phase.
Startup tests and screenshot recipes run as `nobody` with separate clean
profiles. Each container downloads its runtime.

`runner.json` pins the runner source revision and image release tags. The script
pulls each image once per job, records its immutable digest, and runs that digest.
The workflow reads its upstream checkout revision from the same validated config.
Each digest is saved before invoking the upstream action.
Reports include the app version, ref, OSTree commit, runtime ref and commit,
runner revision and image digests, runner environment, and UTC test time.
Unresolved versions appear as unavailable or unknown.

The recorded runtime commit comes from the preparation installation. Runtime
downloads can change between phases, so it does not prove that both containers
used that commit.

## GitHub Actions

Open [Actions](https://github.com/razzeee/flathub-health/actions), select
"Flathub health", and choose "Run workflow". The configured v0.4.0 images have
public manifests. Hosted app validation is pending.
For future upgrades, update the source revision and both image
tags together in `runner.json` to a verified release with available images.

Keep the workflow manual-only until a hosted end-to-end run succeeds. Also test
a failing recipe and confirm that the other apps still upload their artifacts.
After those checks, add a daily schedule if wanted. `17 5 * * *` requests a run
at 05:17 UTC. GitHub can delay scheduled jobs.

For an explicitly labeled, isolated hosted workflow-fixture run, select
"Hosted failure-isolation test (opt-in)" and type `RUN HOSTED FAILURE TEST`.
It is workflow-dispatch-only, uses no app-catalog entries or privileged
containers, and writes fixture artifacts under separate names; one matrix case
intentionally omits its artifact. The normal health workflow has no schedule or
input that can enable one. The test suite separately exercises install failure,
missing/incomplete report evidence, distinct app/recipe/infrastructure
classifications, and TERM cancellation/process-group cleanup. A GitHub-hosted
fixture run validates matrix continuation and artifact handling, not real
Docker-container cleanup; that remains covered by the safe process tests.

### Limits

- Each app gets a fresh Ubuntu 24.04 VM. At most two app jobs run at once.
- Matrix fail-fast is off. A startup failure does not prevent the recipe attempt.
  Each phase prepares its own image after shared bundle preparation. A missing
  image in either phase cannot suppress the other phase's results.
- Installation has a 15-minute timeout. Each image pull and bundle export has
  a 5-minute timeout. Other preparation commands have their own timeouts.
- Each runner phase has a 5-minute internal timeout and a 7-minute outer timeout,
  followed by a cleanup period. Each app job has a 45-minute limit.
- Five app jobs can use at most 225 VM-minutes per run, plus the catalog and
  report jobs. A daily run would use at most about 6,750 app VM-minutes in a
  30-day month. Downloads and screenshot storage add to that cost.
- GitHub keeps result artifacts and the combined report for 14 days.

### Failures and permissions

Upload and report steps run after test failures. The reporter marks missing or
invalid job artifacts as `incomplete`. Cancellation or VM loss can still prevent
an upload.

The process adapter writes logs as commands run. On timeout or cancellation, it
sends TERM to the child process group, then KILL if needed. The TERM handler in
the upstream wrapper gets time to remove its Docker container.

Workflow permissions are read-only, and checkout does not retain credentials.
The workflow has no secrets or PR triggers. Run privileged containers only on
disposable VMs with reviewed code. Do not use shared machines that hold secrets.
The separate report job reads downloaded JSON without executing artifact files.

Reports distinguish startup failures, `recipe_failed`, `infrastructure_failed`,
and `incomplete`. Preparation and download errors count as infrastructure
failures. A changed OCR label can break a recipe without breaking the app.
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
