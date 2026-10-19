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

All 18 tests pass. They cover catalog validation, failure classification,
timeouts, process-group cleanup, cancellation, logs, path containment, and
reporting with failed or missing artifacts. They also verify that a missing
screenshot image preserves startup results and that apps without recipes skip
screenshot preparation. The matrix contains five apps.

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
