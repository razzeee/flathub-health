# Validation

Last checked on 2026-10-19. No end-to-end run has reached app testing.

## Passing checks

These commands pass locally:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm check
pnpm test
node scripts/catalog.ts
```

All 22 tests pass. They cover catalog validation, failure classification,
timeouts, process-group cleanup, cancellation, logs, path containment, and
reporting with failed or missing artifacts. They also verify that a missing
screenshot image preserves startup results and that apps without recipes skip
screenshot preparation. The matrix contains five apps.

## Safe CI checks

`.github/workflows/ci.yml` runs on pull requests and pushes. It installs locked
dependencies, checks formatting and strict TypeScript, validates the catalog,
and runs tests. It uses Node 24 from `.node-version` and pnpm 12.6.0 from
`package.json`. pnpm setup runs before Node setup so the existing pnpm store
cache behavior is preserved.

The workflow requests only `contents: read` and does not retain checkout
credentials. It references no secrets and runs no Docker, Flatpak, app jobs,
privileged containers, or publishing steps. The app workflow remains manual-only
with its existing catalog prerequisite. No schedule is enabled.

Workflow regression tests parse both YAML files to check triggers, permissions,
the safe command allowlist, setup and caching, action pins, and the manual app
job dependency. CLI tests confirm that invalid IDs, duplicate entries, escaped
recipe paths, and unknown catalog fields return exit code 1 with no matrix on
stdout. A valid fixture must still produce a matrix. The tests use temporary
catalogs and mocked app execution, not privileged app runs.

On 2026-10-19, action pins were checked against release tags and commit objects
in their upstream GitHub repositories. The commits were GitHub-verified, and
their action definitions were reviewed for the inputs and runtimes used here:

- `actions/checkout` v4.4.0
- `pnpm/action-setup` v4.4.0
- `actions/setup-node` v4.4.0
- `actions/upload-artifact` v4.6.2
- `actions/download-artifact` v4.3.0

Both workflows use full commit SHAs with release comments. The pnpm v4 major
tag resolved to a different commit, so its v4.4.0 release commit was used rather
than assuming the major tag was the release commit.

Local validation uses Node 24.22.0 and pnpm 12.6.0. The commands above and
actionlint 1.7.12 validate the safe checks without starting a hosted workflow.
PR check delivery still needs confirmation after these changes are published;
no privileged app run was performed for this change.

## End-to-end blockers

The latest published flatpak-smoke release at the check date was `v0.1.1`,
commit `718df5b31ff138dec6b8361ae1eef535667db1cb`. Both image checks returned
`manifest unknown` with exit code 1:

```sh
docker manifest inspect ghcr.io/razzeee/flatpak-smoke:v0.1.1
docker manifest inspect ghcr.io/razzeee/flatpak-smoke-screenshots:v0.1.1
```

Local runs for Calculator, KCalc, and VSCodium stopped at `docker info` because
Docker denied access to `unix:///var/run/docker.sock`. Each saved preparation
logs and an `infrastructure_failed` result under `artifacts/`. Startup and
recipe phases remained `incomplete`. VLC and LibreOffice have not run yet.

These attempts produced no app versions, screenshots, or compatibility results.

## Before enabling daily runs

1. Publish compatible runner images or update the pinned release. Provide
   Docker access on a disposable runner.
2. Run the manual GitHub workflow for all five apps. Review startup results and
   screenshots for the three apps with recipes.
3. Break one recipe and confirm that other jobs still upload their artifacts
   and the report identifies the failure.

Keep the workflow manual-only until these checks pass. Unit tests do not prove
desktop compatibility or hosted CI behavior.
