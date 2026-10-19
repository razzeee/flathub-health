# Flathub health monitor

## Purpose

Run flatpak-smoke against a curated selection of popular Flathub applications,
report installation/startup problems, and capture reproducible screenshots.
Keep orchestration and app-specific recipes here; generic testing and capture
functionality belongs in flatpak-smoke.

Runner source: `/home/razze/dev/from-framework/flatpak-smoke`
(upstream: `razzeee/flatpak-smoke`).

## First milestone

- Small, reviewed catalog with stable app IDs and explicit branch/architecture.
- Daily and manually dispatched GitHub Actions runs, one isolated job per app,
  bounded concurrency/timeouts, and matrix fail-fast disabled.
- Test released Flathub apps rather than rebuilding application manifests.
- Smoke-test startup and run optional app-specific screenshot recipes.
- Always upload results, screenshots, and diagnostic logs, including on failure.
- Summarize app, recipe, and infrastructure/download failures separately.
  Passing startup checks does not prove that all app functionality works.

## Suggested layout

```text
apps.json                       # curated catalog
recipes/<app-id>.yml             # screenshot interactions
fixtures/<app-id>/               # redistributable sample documents
scripts/catalog.ts              # validation and CI matrix generation
scripts/run.ts                  # prepare app and invoke pinned flatpak-smoke
scripts/report.ts               # aggregate results and render summary
tests/                          # catalog, execution, reporting tests
.github/workflows/check-apps.yml # schedule + workflow_dispatch + matrix
```

Catalog fields: app ID, display name, branch, architecture, optional recipe,
and documented compatibility limitations. Do not embed shell commands in the
catalog; execute commands using argument arrays.

## Initial coverage

Bootstrap with Calculator, KCalc, and VSCodium using flatpak-smoke's existing
`tests/compatibility/` recipes. These cover toolkits, not necessarily popularity.
Then choose roughly 5–10 popular apps using a documented, dated Flathub
popularity source. Cover GTK, Qt, Electron, and media/document workflows.
Avoid accounts, paid content, and hardware-dependent assertions initially.

## Execution

1. Validate the catalog and generate the matrix.
2. Resolve each current Flathub release; record its OSTree commit, version,
   runtime, branch, architecture, runner version/image digest, and test time.
3. Prepare an isolated installation and clean profile; run the smoke check.
4. Run an optional screenshot recipe with a fresh seeded profile. Record its
   outcome separately so a stale recipe does not label an app broken.
5. Upload diagnostics even on failure. Treat missing job artifacts as incomplete,
   never as success.

Before implementation, inspect the runner CLI, action inputs, and
`tests/compatibility/prepare.py`. The documented action accepts bundles: do not
assume an app-ID input exists. Reuse a supported remote-install/local-repository
path or prepare bundles following the compatibility approach. Document any
missing runner capability instead of duplicating it here.

Pin a published runner release/image. Its README currently references v0.1.2
with a publication caveat; verify availability before selecting it. Bound
installation and execution separately. Keep privileged execution isolated from
secrets and untrusted PR code; reporting gets minimal permissions.

## Reporting and follow-ups

Start with GitHub job summaries and downloadable artifacts. Later add a static
screenshot gallery and history with explicit retention/storage limits. Record
app and environment metadata before comparing runs. Screenshots are review
evidence, not automatic pixel-diff failure criteria. Do not automatically publish
listing screenshots or file upstream issues.

Later: retry suspected transient failures once, detect newly failing apps,
run on app releases, and add opt-in notifications after measuring noise.

## Acceptance checks

- Tests cover catalog validation, matrix generation, runner exit handling, and
  aggregation with failed/missing jobs.
- A manual end-to-end run produces results and screenshots for the bootstrap
  apps, or records concrete compatibility failures.
- A deliberately failing app/recipe does not suppress other app artifacts.
- Every report identifies the exact app and runner versions tested.
- Document setup, concurrency/cost limits, retention, and adding an app.

## Current state

Bootstrap catalog, recipes, TypeScript orchestration scripts, Node tests, and a
manual workflow are implemented. The daily trigger is deferred until hosted
end-to-end validation succeeds. Effect was assessed and deferred; see
`docs/typescript-dependencies.md`. See `docs/validation.md` for verified behavior and
concrete blockers: missing published runner images and local Docker access.
No successful desktop end-to-end run is claimed. Popularity-based expansion
remains after bootstrap validation. The GitHub repository is
`https://github.com/razzeee/flathub-health`. No hosted test run, daily schedule,
scheduled task, or published gallery has been started.
