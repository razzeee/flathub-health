# Validation

## Current runner pin

`runner.json` pins flatpak-smoke `v0.4.0` at
`a84805caeaa4ae5c3deb80d76128c22139f77bf2`. On 2026-10-20, both public
Linux amd64 image manifests and their configuration labels were checked against
the release tag. Both images report that version and revision:

- Verifier: `sha256:ffaee733b888837e4d8c1569270bdc65bf875993f9a5c5f7f010e5710041648b`
- Screenshots: `sha256:7b29b3d7516046720b56be7a96059f30abdf05bfe0e094689ad51bf2ce20753f`

Hosted app validation of v0.4.0 is pending. The workflow remains manual-only
pending failure-isolation validation.

The previous pin, v0.2.0 at `65fc5d65e02bbf18812d3b9e56ddaa172242e415`, had a
successful hosted run on all five apps:
[39441598891](https://github.com/razzeee/flathub-health/actions/runs/39441598891).

Last checked on 2026-10-20. v0.4.0 image provenance was verified; its hosted app
validation has not yet run.

## Passing checks

These commands pass locally:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm check
pnpm test
node scripts/catalog.ts
```

All 37 tests pass with Node 24.22.0 and pnpm 12.6.0. They cover catalog validation, failure classification,
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

## Hosted validation history

The first [manual run on 2026-10-20](https://github.com/razzeee/flathub-health/actions/runs/39388899704)
tested `v0.1.2` at revision `7b4e5db4c134098f41fd7b21b0eaa606a970580f`.
All five preparations passed. Calculator, KCalc, VSCodium, and LibreOffice passed
startup checks, and their captures show the app windows. VLC returned
`early_exit` without opening a GUI.

All three recipe runs failed before capture with the same parser error:

```text
caption must be a single line without a trailing full stop
```

The captions were corrected in PR #19. Tests load every catalog recipe and
check that captions follow this rule, including nonempty single-line text.
The tests do not replace upstream validation of other recipe actions.

VLC's logs show `no suitable interface module`, a failed `skins2` interface,
and a fallback to the command-line interface before shutdown. They also show a
refused PulseAudio connection. These messages do not establish which condition
prevented its GUI from starting. Local Docker access is still denied, so this
environment cannot reproduce that launch independently. Keep this result as
an observed compatibility failure, not proof that the app is generally broken.

All five app artifacts and the combined report uploaded. The report job returned
exit code 1 because it contained failed phases, not because aggregation crashed.
No app artifacts were missing. The run recorded app refs, versions, commits,
runtime metadata, and image digests.

The later [caption-fix run](https://github.com/razzeee/flathub-health/actions/runs/39395698702)
passed Calculator and KCalc recipes and startup checks for LibreOffice. VSCodium
timed out during bundle export, before testing; VLC repeated its GUI startup
failure. Those observations motivated the flatpak-smoke `v0.2.0` update.

The [v0.2.0 hosted run](https://github.com/razzeee/flathub-health/actions/runs/39441598891)
on 2026-10-20 passed all five apps before VLC's media recipe was added:

- Calculator, KCalc, and VSCodium passed startup and screenshot recipes.
- VLC and LibreOffice passed startup checks; screenshots were not requested.
- All five app artifacts and the aggregate report completed successfully.
- Each artifact records runner `v0.2.0`, revision
  `65fc5d65e02bbf18812d3b9e56ddaa172242e415`, and the executed image digests.

This confirms the new runner resolves the observed VSCodium OCR and VLC startup
failures in this hosted run. It does not prove all app functionality or establish
that those failures cannot recur.

The VLC media recipe adds fixture seeding and a capture after waiting for the
fixture filename. It runs in the screenshot phase's clean profile and opens
the file rather than only capturing the player shell. The fixture is a
five-second silent synthetic test pattern dedicated under CC0 1.0. No account,
audio-device, or hardware-acceleration assertions are made. A successful image
only demonstrates that this VLC build opened and displayed this fixture; it is
not a test of audio, general codec support, or hardware acceleration. This
recipe still needs repeated hosted runs before that stability claim is made.

The first hosted attempt for PR #24 ([run 39445551464](https://github.com/razzeee/flathub-health/actions/runs/39445551464)) passed VLC startup but failed screenshot setup before opening the fixture: flatpak-smoke rejects setup source paths containing `..`. The startup screenshot was only the VLC player shell, not a media capture. The follow-up moves the fixture beneath the recipe directory and adds a regression test requiring a contained, existing source path. Repeated hosted media captures remain required before issue #10 is complete.

## Before enabling daily runs

1. Break one recipe and confirm that other jobs still upload their artifacts
   and the report identifies the failure.

Keep the workflow manual-only until failure isolation passes. Unit tests do not
prove that a failed app job leaves other hosted jobs and artifact aggregation
unaffected.
