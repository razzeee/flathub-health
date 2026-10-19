# Bootstrap validation — 2026-10-19

## Runner investigation

Inspected the upstream CLI documentation, action inputs and `action/run.py`,
and `tests/compatibility/prepare.py` in
`/home/razze/dev/from-framework/flatpak-smoke`. Also fetched the published
v0.1.1 `action/run.py` to verify the supported bundle path. No app-ID action
input is assumed. Upstream provides all generic testing, capture, cleanup, and
fresh-profile functionality.

Verified with GitHub API:

- `gh api repos/razzeee/flatpak-smoke/releases/latest`: v0.1.1, published
  2026-09-18, no release assets.
- `gh api repos/razzeee/flatpak-smoke/git/ref/tags/v0.1.1`:
  `718df5b31ff138dec6b8361ae1eef535667db1cb`.
- `docker manifest inspect ghcr.io/razzeee/flatpak-smoke:v0.1.1`:
  `manifest unknown`, exit 1.
- `docker manifest inspect ghcr.io/razzeee/flatpak-smoke-screenshots:v0.1.1`:
  `manifest unknown`, exit 1.

Image publication is an upstream deployment blocker, not an app compatibility
failure. Publication/update needs a separate upstream action; no generic runner
functionality was duplicated here to work around it.

## Local manual attempts

Before the TypeScript migration, cloned the exact v0.1.1 runner into ignored
`.runner/`. Invoked the original Python wrapper
`python3 scripts/run.py --app <app-id>` separately for all three bootstrap apps.
Each returned exit 1 and saved its own `health.json` and preparation log:

| App                  | Preparation           | Startup    | Recipe     |
| -------------------- | --------------------- | ---------- | ---------- |
| org.gnome.Calculator | infrastructure_failed | incomplete | incomplete |
| org.kde.kcalc        | infrastructure_failed | incomplete | incomplete |
| com.vscodium.codium  | infrastructure_failed | incomplete | incomplete |

All three hit `docker info`: permission denied connecting to
`unix:///var/run/docker.sock`. Preparation deliberately stops before downloading
apps when the container backend is unavailable. Thus no resolved app versions,
screenshots, or app compatibility conclusions are available. Ignored diagnostic
outputs are local under `artifacts/`; this document preserves the findings.

## TypeScript migration validation

The repository's orchestration and tests now run on Node.js 24. The only Python
entry point still used is the pinned upstream `.runner/action/run.py`.
Effect was evaluated and deferred; see `typescript-dependencies.md`.

Repeated preparation through the TypeScript `runApp` entry point for all three
bootstrap apps, using an isolated workspace at `artifacts/typescript-validation/`
to preserve the original Python diagnostics. All three produced the same
`infrastructure_failed` Docker permission result and saved separate logs and
`health.json` files. The TypeScript reporter also consumed the existing Python
artifacts successfully, preserving the artifact format and expected nonzero
report exit status.

## Verified locally

- Catalog validation and generation of the three-entry matrix.
- `pnpm install --frozen-lockfile`: installs the pinned dependency graph.
- `pnpm format:check`: maintained files match Prettier formatting.
- `pnpm check`: strict TypeScript checking passes.
- `pnpm test`: 17 Node tests pass, covering validation, runner exits/timeouts, failure classification,
  preparation diagnostics, recipe execution after startup failure, and aggregation
  of failed, corrupt, missing, and provenance-incomplete job artifacts. New tests
  check TERM-resistant processes, grandchild process-group cleanup, external
  cancellation, partial logs, argv preservation, symlink escapes, and actual
  screenshot-file/ref evidence validation.
- Zod schema tests reject malformed runner configuration, upstream results,
  artifact metadata, phase outcomes, and provenance while accepting additional
  upstream metadata fields for forward compatibility.
- A simulated unavailable screenshot image leaves completed startup results
  intact and is reported only as screenshot infrastructure failure.
- Workflow and recipe YAML parse successfully.

## Still required

1. Publish compatible upstream release images and give the test runner Docker
   access (or run on disposable GitHub-hosted VMs).
2. Repeat bootstrap end-to-end, retaining real results and screenshots; deliberately
   break one recipe and confirm all other matrix artifacts survive.
3. Record a dated Flathub popularity source before selecting 5–10 broader apps.
4. Push to `https://github.com/razzeee/flathub-health`, run the manual workflow,
   and only enable a daily schedule after the end-to-end acceptance checks pass.

The full end-to-end acceptance check is **blocked**, not passed. Synthetic tests
prove orchestration behavior, not desktop compatibility or hosted CI behavior.
