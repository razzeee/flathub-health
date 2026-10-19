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

All 27 tests pass with Node 24.22.0 and pnpm 12.6.0. They cover catalog validation, failure classification,
timeouts, process-group cleanup, cancellation, logs, path containment, and
reporting with failed or missing artifacts. They also verify that a missing
screenshot image preserves startup results and that apps without recipes skip
screenshot preparation. The matrix contains five apps.
Configuration tests check release/image tag consistency, parse the workflow's
revision output and checkout wiring, and execute the revision-output step locally.
Phase tests check unavailable images in either direction, invalid repository
digests, checkout mismatches, and recording the exact execution digest before
invoking upstream. These are nonprivileged tests with mocked runner execution.

## Safe CI checks

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. Feature
branch pushes do not trigger a duplicate run alongside the PR check. It installs locked
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

## Verified upstream release

Checks on 2026-10-19 found that the GitHub API's latest published release is still
[`v0.1.1`](https://github.com/razzeee/flatpak-smoke/releases/tag/v0.1.1),
published on 2026-09-18 at 16:33:30 UTC. However, the newer `v0.1.2` source tag
exists at `7b4e5db4c134098f41fd7b21b0eaa606a970580f`, and its
[release CI run](https://github.com/razzeee/flatpak-smoke/actions/runs/39265347845)
passed Cargo checks, fixture smoke tests, native screenshot tests, and both
image publishing jobs. A GitHub release entry is distinct from a published
source tag and container images.

```sh
gh api repos/razzeee/flatpak-smoke/releases/latest
gh api repos/razzeee/flatpak-smoke/releases
gh api repos/razzeee/flatpak-smoke/git/ref/tags/v0.1.2
gh api repos/razzeee/flatpak-smoke/git/tags/bdcfcdb5ffd4b2e463f5e61b9a03c8610097784f
gh run view 39265347845 --repo razzeee/flatpak-smoke --json jobs
```

Both v0.1.2 manifests are available for Linux amd64. Registry checks using
anonymous GHCR pull tokens also fetched the image indexes, manifests, and image
configurations. Manifest and configuration content hashes matched their
descriptors. Both configurations have OCI version `v0.1.2`, revision
`7b4e5db4c134098f41fd7b21b0eaa606a970580f`, and source
`https://github.com/razzeee/flatpak-smoke`.

```sh
docker manifest inspect --verbose ghcr.io/razzeee/flatpak-smoke:v0.1.2
docker manifest inspect --verbose ghcr.io/razzeee/flatpak-smoke-screenshots:v0.1.2
```

Verified image index digests:

```text
ghcr.io/razzeee/flatpak-smoke@sha256:c695e599c3fdbddb75f1ccaaedf5a0bad3c4fa7cd2edf37a46682dac68199941
ghcr.io/razzeee/flatpak-smoke-screenshots@sha256:a6a83f37a499288b0df1aeac231509bd96b098a8fb105ffbcbe56ba5d2a24a74
```

Their Linux amd64 manifest digests are respectively
`sha256:0a21c4c158e676171373b5d3e3b2358c4013563f3ceb686d6901e3872a59f227`
and `sha256:0d74a4eb63bafa12ab69cd017f29c50f777fbca821d6c405aa038bcf25406c43`.
The source revision and both image tags in `runner.json` were updated together.
The upstream wrapper at that revision still accepts the inputs used here,
including explicit immutable image references. The configured workflow will
pull each image and record the repository digest actually used before execution.
The digests above are registry verification evidence, not evidence of an app run.

The old v0.1.1 images still return `manifest unknown`. That historical publication
blocker is avoided by using the verified v0.1.2 tag and images. No images were
built or published and no upstream files were changed in this worktree.

## Remaining end-to-end validation

Previously recorded local runs for Calculator, KCalc, and VSCodium stopped at `docker info` because
Docker denied access to `unix:///var/run/docker.sock`. Each saved preparation
logs and an `infrastructure_failed` result under `artifacts/`. Startup and
recipe phases remained `incomplete`. VLC and LibreOffice have not run yet.

Those earlier attempts produced no app versions, screenshots, or compatibility
results. No privileged app runs or hosted workflows were started for issue #2.
Its end-to-end completion check still requires a user-requested manual workflow
run that pulls both images and produces health artifacts with execution digests.

## Before enabling daily runs

1. Provide Docker access on a disposable runner. Upstream v0.1.2 publication and
   both public image manifests have been verified, but local pulls and app runs
   have not been performed as part of this change.
2. Run the manual GitHub workflow for all five apps. Review startup results and
   screenshots for the three apps with recipes.
3. Break one recipe and confirm that other jobs still upload their artifacts
   and the report identifies the failure.

Keep the workflow manual-only until these checks pass. Unit tests do not prove
desktop compatibility or hosted CI behavior.
