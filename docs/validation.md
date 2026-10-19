# Validation results, 2026-10-19

## Runner checks

We checked the runner CLI, action inputs, `action/run.py`, and
`tests/compatibility/prepare.py` in
`/home/razze/dev/from-framework/flatpak-smoke`. We also fetched the published
v0.1.1 `action/run.py` to confirm that it accepts bundles. Our scripts do not
assume an app-ID action input. The upstream runner handles app testing,
screenshots, cleanup, and fresh profiles.

These commands identified the release and image availability:

- `gh api repos/razzeee/flatpak-smoke/releases/latest` returned v0.1.1, published
  on 2026-09-18, with no release assets.
- `gh api repos/razzeee/flatpak-smoke/git/ref/tags/v0.1.1` returned commit
  `718df5b31ff138dec6b8361ae1eef535667db1cb`.
- `docker manifest inspect ghcr.io/razzeee/flatpak-smoke:v0.1.1` returned
  `manifest unknown` and exit code 1.
- `docker manifest inspect ghcr.io/razzeee/flatpak-smoke-screenshots:v0.1.1`
  returned `manifest unknown` and exit code 1.

The runner images need publication before these releases can run. Their absence
does not indicate an app compatibility problem. We did not replace upstream
runner code to work around it.

## Local runs

Before the TypeScript migration, we cloned v0.1.1 into `.runner/` and ran the
original Python wrapper for each app:

```sh
python3 scripts/run.py --app <app-id>
```

That wrapper no longer exists in this repository. Each attempt returned exit
code 1 and saved a separate `health.json` and preparation log.

| App                  | Preparation           | Startup    | Recipe     |
| -------------------- | --------------------- | ---------- | ---------- |
| org.gnome.Calculator | infrastructure_failed | incomplete | incomplete |
| org.kde.kcalc        | infrastructure_failed | incomplete | incomplete |
| com.vscodium.codium  | infrastructure_failed | incomplete | incomplete |

All attempts stopped at `docker info`. Docker denied access to
`unix:///var/run/docker.sock`. Preparation stops before downloading apps if
the container backend is unavailable. We have no resolved app versions,
screenshots, or app compatibility results from these attempts. The local
diagnostics remain under the ignored `artifacts/` directory.

## After the TypeScript migration

Our scripts and tests now run on Node.js 24. The pinned upstream
`.runner/action/run.py` still needs Python. The
[dependency assessment](typescript-dependencies.md) explains why we did not
add Effect.

We repeated preparation through `runApp` for each app. A separate workspace at
`artifacts/typescript-validation/` preserved the earlier diagnostics. All three
attempts recorded the same Docker permission error and saved their logs and
`health.json` files.

The TypeScript reporter also read the Python-era artifacts. It preserved their
failure results and returned a nonzero exit code.

## Checks that pass

- The expanded catalog validates and produces a matrix with five apps. VLC and
  LibreOffice have startup checks only. The local attempts above covered only
  the original three apps.
- `pnpm install --frozen-lockfile` installs the locked dependencies.
- `pnpm format:check` finds no formatting errors.
- `pnpm check` finds no TypeScript errors.
- All 18 tests pass. They cover validation, runner exit codes, timeouts, failure
  classification, preparation logs, and recipes after startup failures. They
  also cover missing or corrupt artifacts, required version metadata, process
  cleanup, cancellation, partial logs, argument arrays, and path checks.
- Zod rejects malformed configuration, upstream results, artifact metadata,
  phase outcomes, and version metadata. It accepts extra upstream metadata
  fields for compatibility with future releases.
- A simulated missing screenshot image leaves startup results intact. The
  report records the image error under screenshot infrastructure failure.
- An app without a recipe skips the screenshot image and phase. Its report marks
  that phase as `not_requested`.
- The workflow and recipe files parse as YAML.

## Checks still needed

1. Publish compatible runner images and provide Docker access. Disposable
   GitHub-hosted VMs are an option.
2. Run all five apps end-to-end and retain their results. Retain screenshots
   for the three apps with recipes. Verify recipes for the two new apps before
   adding them.
   Break one recipe and confirm that the other matrix jobs still upload
   artifacts.
3. Keep the dated selection sources in `catalog-selection.md` up to date when
   adding more apps.
4. Run the manual workflow in
   [razzeee/flathub-health](https://github.com/razzeee/flathub-health).
   Add a daily schedule only after the end-to-end checks pass.

The end-to-end acceptance check has not passed. The tests verify script behavior,
not desktop compatibility or hosted CI behavior.
