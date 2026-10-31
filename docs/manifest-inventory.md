# Manifest inventory pilot

The opt-in pilot observes the published manifests for Calculator, KCalc and
VSCodium. It generates CycloneDX 1.7 inventories with `flatpak-sbom`, retains
provenance and evidence, and presents them alongside smoke results. It does not
run Grype or report vulnerability counts.

## Run it

In **Flathub health → Run workflow**, enable **Generate experimental manifest
inventories for the three pilot apps**. The existing smoke checks also run.
Scheduled runs leave inventory generation off. A subsequent run replaces the
published page; it does not silently carry forward an older inventory.

For a local run, install Node 24, pnpm, Rust/rustup, Git and OSTree, then prepare
the generator in `.sbom/`:

```sh
pnpm install --frozen-lockfile
git clone https://github.com/razzeee/flatpak-sbom.git .sbom
git -C .sbom checkout --detach "$(node scripts/security-config.ts --field revision)"
rustup toolchain install "$(node scripts/security-config.ts --field rust)" --profile minimal
cargo +"$(node scripts/security-config.ts --field rust)" build --locked --release --manifest-path .sbom/Cargo.toml
node scripts/security.ts --app org.gnome.Calculator
node scripts/security.ts --app org.kde.kcalc
node scripts/security.ts --app com.vscodium.codium
```

Run each observation even if another fails. `--generator` accepts a clean checkout
at the configured revision with a freshly built `target/release/flatpak-sbom`.
The integration verifies source revision, clean working tree and CLI version,
and records the binary digest; this does not establish reproducible compilation.
The generator's source repository, revision, version and Rust toolchain are pinned
in `security.json`. Its configured pilot IDs must be unique catalog entries.

Each observation refuses an existing output directory. Use `--output
artifacts/another-run` for another local run rather than overwriting evidence.
Local files do not expire automatically.

To reproduce the hosted artifact layout locally:

```sh
mkdir -p artifacts/inventory-downloads
for app in org.gnome.Calculator org.kde.kcalc com.vscodium.codium; do
  mkdir -p "artifacts/inventory-downloads/security-record-$app"
  cp "artifacts/security/$app/security.json" "artifacts/inventory-downloads/security-record-$app/"
  mkdir -p "artifacts/inventory-downloads/security-evidence-$app"
  if test -f "artifacts/security/$app/inventory.cdx.json"; then
    cp "artifacts/security/$app/inventory.cdx.json" "artifacts/inventory-downloads/security-evidence-$app/"
  fi
done
node scripts/security-report.ts --requested true --input artifacts/inventory-downloads --output artifacts/inventory-downloads/security-report
pnpm site --report artifacts/report/report.json --artifacts artifacts/inventory-downloads --output site
```

The site command expects a smoke report from `scripts/report.ts`. To include
screenshots too, put the corresponding `health-<app-id>/` directories in the same
downloads directory. If the smoke report is missing, a valid requested inventory
report still produces pilot app rows with unavailable smoke results. Invalid
inventory rows are isolated per app rather than discarding the other observations.

## Execution and storage

- `scripts/security.ts` owns one observation: initial incomplete record,
  subprocess execution, validation, provenance, hashes and atomic final record.
- Generation has a ten-minute process deadline, with the existing TERM/KILL
  process-group cleanup. Each hosted job has a twenty-minute ceiling including
  installation/build, and at most two inventory jobs run concurrently.
- `.github/workflows/check-apps.yml` runs inventory jobs independently from smoke
  preparation. Missing/build-failed/cancelled jobs become unavailable in the
  expected-target aggregate. Uploads and aggregation run after failures.
- `scripts/security-report.ts` writes a separate versioned report and summary.
  Smoke verdicts and smoke history retain their existing meanings.
- Each record includes run/attempt, timestamps, generator provenance, actual app
  and runtime snapshots, source identity counts and evidence hash/size. Completed
  generation is distinct from incomplete inventory coverage.
- Actions retains `security-record-*`, `security-evidence-*` and `security-report`
  for 14 days. Pages publishes the current report and validated inventories only.
  Logs and binary files are never published by the site builder.
- Records are bounded to 64 KiB; inventories to 16 MiB each and 32 MiB across the
  page. Publication checks hash, size and extracted metadata and rejects symlinks.
  Missing or rejected downloads are explicitly unavailable without erasing a
  retained generation record.

There is no persistent inventory cache, shared runtime cache or vulnerability
database yet. Each generator invocation uses its own temporary OSTree repository.
The pilot intentionally measures this straightforward execution path before
adding persistent caching. Run timestamps and inventory sizes support initial
cost assessment; network traffic and peak-memory measurements remain future work.

## Interpreting results

Inventories are **manifest-derived and incomplete**. Vendored dependencies,
source-archive contents, binary extra-data payloads and extensions are not fully
inventoried. Source identity counts are not a percentage of installed dependency
coverage. Manifest declarations may describe inputs removed during build cleanup.

The app and runtime refs are resolved independently from smoke installation.
Each ref is read at its pinned commit, but the runtime is the current remote
runtime, not a specific installed system's runtime. The page compares both
snapshots with per-phase smoke metadata; unknown metadata stays unknown and
extensions are excluded from the match claim. Inventory freshness uses its own
generation timestamp and expires after 36 hours; without JavaScript it is
unverified. A matching snapshot is not proof of safety.

The pinned generator uses HTTPS with OSTree GPG verification disabled. Recorded
commit identities are provenance, not a claim of authenticated publisher identity.

## Validation and next increment

Run the normal checks:

```sh
pnpm format:check
pnpm check
pnpm test
```

The focused integration test can additionally exercise a real generator and real
local OSTree app/runtime refs, including the runtime manifest fallback path:

```sh
FLATPAK_SBOM_CHECKOUT="$PWD/.sbom" pnpm exec tsx --test tests/security.test.ts
```

This creates disposable local refs; it does not build a Flatpak with
`flatpak-builder`. The file-URL configuration exists for these reproducible local
fixtures; hosted configuration uses Flathub HTTPS.

On 2026-10-31, local live attempts for all three pilot apps failed fetching Flathub
OSTree commit objects with HTTP 403. Failure records and diagnostics were retained;
successful live Flathub generation and hosted workflow execution remain unverified.
The consumed JSON contract is validated, not the complete CycloneDX schema.

Before vulnerability reporting, add a generator interface to scan the exact saved
inventory, qualify CycloneDX 1.7 and converted 1.6 against their schemas, and test a
real pinned Grype round trip including package matching and scope/BOM attribution.
Record database identity and age, then normalize severity, fixes and unknown
attribution. A successful scan with no matches must not become a safety verdict.
The generator's current `scan REF` generates a new inventory, so it cannot be
paired with an earlier `generate REF` output as if they were the same evidence.

Fleet-scale follow-up needs separate inventory and scan cache keys, immutable
shared-runtime snapshot caching, database-driven rescans, longer-lived history,
deduplicated runtime findings and an explicit triage/notification policy.
