<img src="assets/icon.svg" width="64" height="64" alt="">

# flathub-health

Startup checks and reproducible screenshot recipes for released Flathub
apps. This repository orchestrates [flatpak-smoke](https://github.com/razzeee/flatpak-smoke);
it does not build app manifests or implement its own desktop automation.

## Status

Bootstrap catalog: Calculator (GTK), KCalc (Qt), and VSCodium (Electron).
These are toolkit examples, **not a popularity ranking**. Recipes originate from
flatpak-smoke's `tests/compatibility/` at the revision in `runner.json`.

**End-to-end screenshots are currently blocked.** On 2026-10-19 the latest
published runner release was `v0.1.1` (revision
`718df5b31ff138dec6b8361ae1eef535667db1cb`), but both corresponding GHCR
image manifests returned `manifest unknown`. The upstream README's `v0.1.2`
examples explicitly require publication. We pin the published source release;
we do not silently build a different runner or substitute `latest`.
Local bootstrap attempts also found Docker daemon permission denied. See
[validation evidence](docs/validation.md). No app has been declared broken.

## Setup and local use

Requirements: Linux x86_64, Node.js 24.2+ (use the current Node 24 LTS), Python
3.10+ (only for the upstream
action wrapper), Git, Flatpak, GNU `timeout`, and Docker with permission to run
privileged containers. Our scripts run TypeScript directly using Node's native
type stripping; no build step is required. Zod is the runtime dependency for
JSON validation and inferred TypeScript types. TypeScript, Node type definitions,
and Prettier are development dependencies only.
Use pnpm 12.6.0, pinned in `package.json`; CI installs that version automatically.
Allow several GB of disk/downloads per app; screenshot images include a desktop.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm check
pnpm test
node scripts/catalog.ts
git clone --branch v0.1.1 --depth 1 https://github.com/razzeee/flatpak-smoke.git .runner
node scripts/run.ts --app org.gnome.Calculator
node scripts/run.ts --app org.kde.kcalc
node scripts/run.ts --app com.vscodium.codium
node scripts/report.ts
```

Each run writes `artifacts/<app-id>/health.json`, preparation/action logs, and
upstream `verify/` and `screenshots/` results when those phases can run. The
aggregator writes `artifacts/report/{report.json,summary.md}`. Nonzero exit codes
are expected for failures or incomplete evidence. Run apps separately even if a
previous command fails. Outputs are refused if already present: archive them and
remove **only** the corresponding generated `artifacts/<app-id>` and
`.health-work/<app-id>` directories before repeating a run. Local outputs have
no automatic retention policy.

Effect was assessed and deferred: Actions handles app concurrency, while this
small sequential CLI benefits more from a tested process adapter than a new
effect runtime. See [the dependency assessment](docs/typescript-dependencies.md)
for tradeoffs and criteria for revisiting it. JSON is validated at runtime;
TypeScript types alone are not trusted for catalogs or downloaded artifacts:
Zod validates catalog entries, runner configuration, upstream results, and health
artifacts. Filesystem containment, catalog uniqueness, and screenshot evidence
are still checked explicitly. Use `pnpm format` to format the maintained files;
generated outputs, the upstream checkout, dependencies, and the lockfile are
excluded. CI checks formatting and installs runtime dependencies in app/report jobs.

The app is installed from the explicit Flathub ref into a separate
`FLATPAK_USER_DIR` under `.health-work/`, then exported with `flatpak build-bundle`.
The upstream action installs that bundle in a fresh privileged container for
each phase and downloads its runtime. Startup and recipes use separate clean
profiles, running as `nobody`. Recipe `setup.files` can seed sample data; sources
are relative to the recipe. Put redistributable fixtures under `fixtures/<app-id>/`
and document their license. There are no fixtures required by the bootstrap apps.

`runner.json` pins the source revision and image release tags. Each image is
pulled once per job, its immutable repository digest is recorded, and that digest
is used for execution. Reports include app version, branch/architecture/ref,
OSTree commit, runtime ref/commit, runner revision/digests, runner environment,
and UTC test time. Unresolved versions are explicitly unavailable, not invented.
Runtime downloads can change between phases; the recorded runtime commit is the
preparation installation, not a promise that both containers used that commit.

## GitHub Actions

Repository: [razzeee/flathub-health](https://github.com/razzeee/flathub-health).
After pushing, use **Actions → Flathub health → Run workflow**.
The workflow is **manual-only** until a hosted end-to-end run and failure-isolation
check succeed. No hosted run has been started or daily schedule enabled.
After validation, a daily schedule such as `17 5 * * *` can be added (GitHub may
delay scheduled jobs).
First publish the missing upstream images, or update `runner.json` and the
workflow checkout SHA together to a verified published release.

- One fresh Ubuntu 24.04 VM per app; at most two app jobs in parallel.
- Matrix fail-fast is disabled; each app attempts its recipe even if startup fails.
- Screenshot image preparation happens separately, after startup testing, so an
  unavailable optional image cannot suppress startup results.
- Preparation: individual commands bounded, installation 15 min, image pulls
  5 min each, bundle export 5 min. Each runner phase has a 5 min internal limit
  and a 7 min outer limit plus cleanup; each app job is capped at 45 min.
  The Linux process adapter streams logs and signals the child process group
  with TERM then KILL on timeout/cancellation, allowing upstream container cleanup.
- At three apps, app jobs consume at most 135 VM-minutes per run (plus small
  catalog/report jobs). Daily upper bound is about 4,050 app VM-minutes/month;
  actual usage should be lower. Downloads and screenshot storage can be large.
- Result/log/screenshot artifacts and the combined report expire after 14 days.
- Upload and reporting steps run even after failure. Missing or invalid job
  artifacts are `incomplete`, never successful. Hard cancellation or a VM loss
  can still prevent upload; aggregation detects the absent artifact.
- Workflow permissions are read-only. Checkout credentials are not persisted;
  there are no secrets, PR triggers, remote issue creation, or gallery publishing.
  Privileged containers must only run trusted reviewed code on disposable VMs,
  not on shared/self-hosted machines containing secrets. The report job is separate
  and does not execute downloaded artifacts.

Startup failures are separated from `recipe_failed`, `infrastructure_failed`
(including preparation/download failures), and `incomplete`. A stale OCR label
is not evidence the app is broken. Passing startup does not prove full app
functionality; screenshots are review evidence, not pixel-diff assertions.

## Adding an app

1. Add a unique stable ID, name, explicit branch and `x86_64` architecture, and
   documented limitations to `apps.json`. No shell commands or arbitrary fields.
2. Optionally add `recipes/<app-id>.yml` using the upstream recipe format.
   Avoid accounts, paid content, and hardware-dependent assertions.
3. Run catalog validation/tests, then manually test both phases and review captures.
4. For expansion beyond bootstrap, first record a **dated official Flathub
   popularity source** and selection rationale. Target 5–10 apps covering GTK,
   Qt, Electron, and media/document workflows; do not call these three popular
   without evidence.

History, a gallery, retry/noise handling, release triggers, and notifications are
future work described in [PLAN.md](PLAN.md). No listing screenshots or upstream
issues are automatically published.
