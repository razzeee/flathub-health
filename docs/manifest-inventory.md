# Security inventory pilot

The opt-in pilot inventories published manifests and app/runtime contents for
Calculator, KCalc and VSCodium, then scans the saved evidence with Grype. Results
are independent of smoke-test verdicts. It does not execute application code or
extra-data installation scripts.

## Run it

In **Flathub health → Run workflow**, enable **Generate content inventories and
vulnerability scans for the three pilot apps**. Scheduled runs leave this pilot
off. A subsequent run replaces the page, without carrying forward older findings.

For a local run, install Node 24, pnpm, Rust/rustup, Git, OSTree, Python,
then prepare the pinned tools and schema validator:

```sh
pnpm install --frozen-lockfile
git clone https://github.com/razzeee/flatpak-sbom.git .sbom
git -C .sbom fetch origin "$(node scripts/security-config.ts --field revision)"
git -C .sbom checkout --detach "$(node scripts/security-config.ts --field revision)"
rustup toolchain install "$(node scripts/security-config.ts --field rust)" --profile minimal
cargo +"$(node scripts/security-config.ts --field rust)" build --locked --release --manifest-path .sbom/Cargo.toml
node scripts/security-tools.ts
python3 -m venv .sbom/target/validation-venv
.sbom/target/validation-venv/bin/pip install jsonschema==4.26.0 referencing==0.37.0
export PATH="$PWD/.sbom/target/validation-venv/bin:$PWD/.sbom/target/tools:$PATH"
grype db update
export GRYPE_DB_AUTO_UPDATE=false
node scripts/security.ts --app org.gnome.Calculator
node scripts/security.ts --app org.kde.kcalc
node scripts/security.ts --app com.vscodium.codium
```

The tool installer supports Linux x86_64 and verifies SHA-256 archive pins in
`security.json`. Observations verify generator revision, clean checkout and tool
versions, recording generator and scanner binary digests. This does not establish
reproducible compilation. Each observation refuses an existing output directory;
use `--output artifacts/another-run` rather than overwriting evidence.

## Evidence chain

1. `flatpak-sbom generate` resolves immutable app/runtime snapshots and inspects
   their contents using Syft, native detectors and the pinned CPE mapping. Remote
   extra-data archive acquisition verifies declared checksums and size, without
   executing scripts. Unselected extensions remain outside the inventory.
2. The original CycloneDX 1.7 inventory is validated against official schemas at
   an immutable CycloneDX revision, as well as the consumed provenance contract.
3. A CycloneDX 1.6 projection of that exact saved inventory is schema-validated
   for Grype. As in the pinned generator, quarantined identities and references
   to them are excluded. Both original and projected bytes are retained. The
   integration does not invoke `scan REF`, which would generate a second SBOM.
4. Grype scans that projection. Its version, binary digest, database build time
   and database archive checksum are retained with normalized severity and scope
   counts. Package/advisory matches are not unique vulnerability totals.
5. Publication revalidates all hashes, byte sizes, projection identity and
   extracted summaries. Tampered, missing, oversized and symlinked evidence is
   not published. Inventory generation and scanning failures remain distinct.

The page shows app/runtime manifest-source counts, content package records and
coverage gaps, severity and attribution counts, package versions, supplied fixes,
match types, independent inventory/database freshness and smoke comparisons.
It renders at most 200 matches per app; the complete Grype report is downloadable.
It also offers the original inventory, exact scanner input and coverage evidence.
Logs and binaries remain in Actions artifacts, never in the generated page.

## Bounds and verification

- Inventory generation has a 30-minute process deadline, scanning ten minutes,
  and each hosted job a 60-minute ceiling. At most two pilot jobs run concurrently.
- Each job prepares a current database before scanning; automatic updates are
  disabled afterwards to keep qualification and observation on a stable database.
  Grype's database age validation remains enabled.
- Records are limited to 64 KiB, inventories to 16 MiB, and each scan evidence file
  to 32 MiB. Publication permits 32 MiB of inventories and 128 MiB total evidence.
- Actions retains records, evidence, reports and the verified security-only site
  for 14 days. There is no persistent inventory history or shared runtime cache.
- `verify-security` builds a security-only site on every requested run, including
  non-default branches, and requires successful validated evidence for every pilot
  app. Default-branch publication additionally fetches the deployed page and all
  downloads, checking current run identity and evidence hashes.

Run the regular checks, and opt into real tools for the integration gate:

```sh
pnpm format:check
pnpm check
pnpm test
FLATPAK_SBOM_CHECKOUT="$PWD/.sbom" SECURITY_SCANNERS=1 pnpm exec tsx --test tests/security.test.ts tests/security-scan.test.ts
```

The gate uses real local OSTree refs and known-vulnerable npm and Python packages
in separate app/runtime trees. It exercises generation, both schema versions,
Grype matching, attribution, aggregation and static rendering. It does not build
a Flatpak with `flatpak-builder`. Fixture success is not live Flathub proof.

To verify an existing deployment against downloaded records from its run, set
`GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT` to that run and execute:

```sh
node scripts/verify-security-site.ts --url https://razzeee.github.io/flathub-health/
```

## Interpretation and remaining scope

Coverage remains incomplete even when acquisition and scanning succeed. Static,
stripped and vendored dependencies can remain unidentified. Archive inspection
does not establish equivalence to installed extra-data. Native library identities
do not establish whether downstream security patches were applied. Manifest
sources may have been removed during cleanup. Unknown scope stays unknown.

The runtime is the current remote snapshot, not a historical build runtime or a
particular installed machine's runtime. App/runtime snapshots are acquired
independently from smoke installation; extensions are excluded from match claims.
OSTree publisher authenticity still relies on HTTPS, not GPG verification.

Zero findings is not proof of safety. Findings need triage. This integration does
not yet query OSV, select extensions, inspect host-installed deployments, deduplicate
shared runtime findings across apps, or provide triage/notification policy.

The earlier manifest-only live attempts, including a hosted run on 2026-11-08,
failed with Flathub HTTP 403. A successful content-generation run and verified
publication must be established with the new pinned generator, not inferred from
those historical failures or fixture tests.
