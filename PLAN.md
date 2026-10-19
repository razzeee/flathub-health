# Flathub health monitor

## Purpose

Run flatpak-smoke against selected Flathub apps. Report installation and startup
problems, and capture reproducible screenshots. Keep app selection and recipes
here. Keep test execution and screenshot capture in flatpak-smoke.

The local runner source is `/home/razze/dev/from-framework/flatpak-smoke`.
Its upstream repository is `razzeee/flatpak-smoke`.

## First milestone

- Review a small catalog with stable app IDs and explicit branches and architectures.
- Support manual and daily GitHub Actions runs. Give each app a separate job,
  limit concurrency and execution time, and disable matrix fail-fast.
- Test released Flathub apps without rebuilding their manifests.
- Test startup and run optional app-specific screenshot recipes.
- Upload results, screenshots, and logs after failures as well as passes.
- Report app failures, recipe failures, and infrastructure or download failures
  separately. A startup pass does not test every app function.

## Files

```text
apps.json                       # app catalog
recipes/<app-id>.yml             # screenshot steps
fixtures/<app-id>/               # redistributable sample documents
scripts/catalog.ts              # validation and CI matrix generation
scripts/run.ts                  # app preparation and pinned runner invocation
scripts/report.ts               # combined results and summary
tests/                          # catalog, execution, and reporting tests
.github/workflows/check-apps.yml # manual dispatch and app matrix
```

Each catalog entry has an app ID, display name, branch, architecture, optional
recipe, and compatibility limitations. Do not put shell commands in the catalog.
Pass commands as argument arrays.

## Initial apps

Start with Calculator, KCalc, and VSCodium. Reuse flatpak-smoke's
`tests/compatibility/` recipes. These apps cover different toolkits, not a
popularity ranking.

The catalog now also includes VLC and LibreOffice for media and document
coverage. They have startup checks only until we can verify screenshot recipes.
[docs/catalog-selection.md](docs/catalog-selection.md) records the selection
sources. The expanded catalog has five apps. Avoid accounts, paid content, and
hardware-dependent checks. Keep dated Flathub popularity evidence for future
additions instead of assuming the catalog is a ranking.

## Execution

1. Validate the catalog and generate the job matrix.
2. Resolve each current Flathub release. Record its OSTree commit, version,
   runtime, branch, architecture, runner version and image digest, and test time.
3. Create an isolated installation and clean profile, then test startup.
4. Run the screenshot recipe with a separate fresh profile and any sample files.
   Record its outcome separately. A recipe that no longer matches the app does
   not prove the app is broken.
5. Upload diagnostics after failures. Treat missing job artifacts as incomplete,
   never as passes.

Before choosing an installation path, check the runner CLI, action inputs, and
`tests/compatibility/prepare.py`. The action accepts bundles. Do not assume it
has an app-ID input. Reuse a supported remote installation or local repository,
or prepare bundles as the compatibility tests do. Document missing runner
capabilities instead of implementing them here.

Pin a published runner release and image. The upstream README references
v0.1.2 but says its images need publication. Check availability before using it.
Set separate installation and execution timeouts. Run privileged containers
without secrets or untrusted PR code. Give the report job read-only permissions.

## Reports and later work

Start with GitHub job summaries and downloadable artifacts. A later screenshot
gallery and history need storage and retention limits. Record app versions and
environment metadata before comparing runs. Review screenshots as evidence,
not pixel-diff pass criteria. Do not publish listing screenshots or file upstream
issues automatically.

Later, retry suspected transient failures once and detect newly failing apps.
Consider app-release triggers and opt-in notifications after measuring noise.

## Acceptance checks

- Tests cover catalog validation, matrix generation, runner exit codes, and
  combined results with failed or missing jobs.
- A manual end-to-end run produces results and screenshots for the initial
  apps, or records specific compatibility failures.
- A deliberately failing app or recipe does not prevent other jobs from
  uploading their artifacts.
- Every report identifies the exact app and runner versions tested.
- The documentation explains setup, concurrency, cost limits, retention,
  and how to add an app.

## Current state

The catalog, recipes, TypeScript scripts, Node tests, and manual workflow exist.
The daily trigger will wait until hosted end-to-end validation passes.
[docs/typescript-dependencies.md](docs/typescript-dependencies.md) explains why
we did not add Effect.

[docs/validation.md](docs/validation.md) records the current limits. Runner images
are missing, local Docker access fails, and no desktop end-to-end run has passed.
The two added apps still need hosted startup validation. All screenshot recipes
still need an end-to-end run.

The repository is [razzeee/flathub-health](https://github.com/razzeee/flathub-health).
No hosted test run, daily schedule, recurring task, or gallery is active.
