# Catalog selection research

Research checked 2026-10-21 against the official Flathub Popular collection
and AppStream API. Following the research, the user requested direct
implementation: Firefox and GIMP are now startup-only entries in `apps.json`.
The user clarified that budget is not a concern: issue #7's budget agreement
and measurements are not gates for issue #12 or these recommendations. Costs
below are informational, with unknowns explicit; the single-run baseline does
not establish recurring usage. Hosted startup validation is still required to
establish compatibility. No unverified screenshot recipes were added.

## Current catalog and cost evidence

The original five refs are `org.gnome.Calculator`, `org.kde.kcalc`,
`com.vscodium.codium`, `org.videolan.VLC`, and
`org.libreoffice.LibreOffice`, all `x86_64/stable`. The workflow currently
allows up to two app jobs concurrently and caps each at 45 minutes, or up to
225 app VM-minutes per complete run before catalog/report jobs. A daily schedule
would therefore have a theoretical cap of 6,750 app VM-minutes in a 30-day
month. With the two additions, these ceilings become 315 app VM-minutes per
run and 9,450 per 30-day month. These are timeout ceilings, not observed
runtime or cost estimates. The rebase preserves main's daily 05:17 UTC schedule,
run-history support, and newer v0.4.1 runner pin; this PR does not change them.

### Measured five-app baseline

Checked [main run 39583067820](https://github.com/razzeee/flathub-health/actions/runs/39583067820)
on 2026-10-21 at main revision `01238d6c7a3fd4764a6ad48b3db238ec2fa09f72`,
using the configured v0.4.0 runner. GitHub's jobs and artifacts APIs report:

| App         | Job elapsed time (seconds) | Compressed artifact (bytes) | Result                                           |
| ----------- | -------------------------: | --------------------------: | ------------------------------------------------ |
| Calculator  |                        157 |                     130,156 | Startup and recipe passed                        |
| KCalc       |                        157 |                     115,547 | Startup and recipe passed                        |
| VSCodium    |                        501 |                   1,267,544 | Startup and recipe passed                        |
| VLC         |                        210 |                     105,877 | Startup passed; screenshot infrastructure failed |
| LibreOffice |                        484 |                     895,744 | Startup and recipe passed                        |

Total app-job elapsed time was 1,509 seconds (25.15 VM-minutes); catalog and
report jobs added 39 seconds. App artifacts totalled 2,514,868 compressed bytes,
plus 5,533 bytes for the report. Elapsed time uses job `started_at`/`completed_at`,
not billing-rounded minutes or workflow wall time. Sizes are GitHub artifact
`size_in_bytes`, not raw files, downloads, or retained monthly storage usage.
The run failed overall because VLC's screenshot desktop exited with status 133;
the complete report preserved all five results. This is one run, not evidence of
repeatability, a healthy all-green baseline, or agreed monthly usage. Download
traffic was not instrumented in that run. Issue #7 is still open with no comments.

Sources: [jobs API](https://api.github.com/repos/razzeee/flathub-health/actions/runs/39583067820/jobs),
[artifacts API](https://api.github.com/repos/razzeee/flathub-health/actions/runs/39583067820/artifacts),
and the run's `health-report` artifact.

### Measurement scope for the additions

The branch records `resources.json` beside each app's diagnostics. It measures
elapsed seconds and received bytes on the VM's default IPv4 interface around
the app-check step, including bundle preparation, app/runtime installation,
container-image pulls, and requested test phases. It excludes checkout, tooling
and dependency setup, artifact uploads, and reporting. Background traffic is
included; these are host-interface traffic measurements, not exact Flatpak
payload sizes. Internal Docker bridge traffic is not summed a second time.
Missing or reset counters fail measurement rather than inventing zero usage.
Full job times and compressed artifact sizes must still come from GitHub's API.

The authorized manual validation run is
[39585913867](https://github.com/razzeee/flathub-health/actions/runs/39585913867),
at branch revision `54e040c`. Both additions passed preparation and startup;
their recipe phases were `not_requested`. Firefox's capture shows the first-run
welcome dialog. GIMP's capture shows its splash screen during plug-in discovery,
not the editor: its startup pass does not establish editor readiness. All seven
app artifacts and the aggregate report uploaded. The overall run failed only
because VLC repeated main's `display_exited` screenshot infrastructure failure
(GNOME exit status 133); the report correctly returned nonzero for that failure.
This run used v0.4.0 and predates main's daily schedule and v0.4.1 pin; it is
not hosted validation of the newer runner.

## Selected additions (hosted startup-only validation)

The original catalog intentionally covers GTK (Calculator), Qt (KCalc),
Electron (VSCodium), media playback (VLC), and documents (LibreOffice), rather
than being a top-five popularity list. The additions fill workload gaps, not
new toolkit claims. Browsers beyond Firefox, vector graphics, games, communication,
hardware-dependent apps, and non-x86_64 architectures remain uncovered.

| Candidate | Explicit ref (`x86_64/stable`)          | Gap filled                                                                             | Intended initial scope                                                                                                                                                   |
| --------- | --------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Firefox   | `app/org.mozilla.firefox/x86_64/stable` | Web browser; the original five apps have no browser workload.                          | Startup-only in a clean profile. No screenshot recipe, page-rendering, account, network, extension, or general web compatibility assertion.                              |
| GIMP      | `app/org.gimp.GIMP/x86_64/stable`       | Raster image editor; original document/media coverage does not exercise image editing. | Startup-only in a clean profile. No screenshot recipe or image fixture; no image-loading, editing, export, plug-in, color-management, or format-compatibility assertion. |

These two apps add distinct user-facing workload categories while keeping the
shortlist small. Their AppStream API responses on 2026-10-21 confirmed the exact
app IDs and refs above. The response also identifies Firefox as Mozilla's
browser and GIMP as an image manipulation application. AppStream metadata and
presence in a popularity collection do not establish that an app is suitable
for this runner, reliable in a hosted test, or affordable.

### Dated official Flathub source

The [Flathub Popular collection API](https://flathub.org/api/v2/collection/popular)
was checked 2026-10-21. Firefox appeared first with `installs_last_month` of
199,909. These are Flathub's rolling previous-month installation figures as
reported by the API; they are not download sizes, unique users, or test costs.
The API does not provide exact window timestamps in this response, so rank and
count are a dated snapshot, not a stable measure. GIMP's exact ref was confirmed
through the [Flathub AppStream API](https://flathub.org/api/v2/appstream/org.gimp.GIMP);
it is not put forward here on a popularity claim. Firefox's ref was confirmed
through the [Firefox AppStream API](https://flathub.org/api/v2/appstream/org.mozilla.firefox).

The [Flathub collection implementation](https://github.com/flathub-infra/website/blob/bdd8c6a443d0ed7fbaab5adedb6f8761399b8f1d/backend/app/routes/collection.py)
defines Popular using installations over the previous 30 days. A popularity
position is not a measure of how well the existing five apps cover workflows.

## Informational costs (not an approval gate)

| Candidate | Runtime cost                                                    | Download/artifact cost                                                          | Estimate status                                                             |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Firefox   | Job: 299 seconds; measured app-check interval: 275.633 seconds. | Host received traffic: 1,631,297,575 bytes; compressed artifact: 245,523 bytes. | Single hosted observation; recurring cost and exact payload volume unknown. |
| GIMP      | Job: 207 seconds; measured app-check interval: 175.360 seconds. | Host received traffic: 1,874,930,901 bytes; compressed artifact: 390,212 bytes. | Single hosted observation; recurring cost and exact payload volume unknown. |

The additions total 506 job seconds (8.43 VM-minutes), 3,506,228,476 received
bytes during their app-check intervals, and 635,735 compressed artifact bytes in
this run. These observed costs are not estimates of future usage or billing.
See the measurement scope above for the distinction between host traffic and
actual download payloads. Sources: the run's `resources.json` and `health.json`
artifacts, [jobs API](https://api.github.com/repos/razzeee/flathub-health/actions/runs/39585913867/jobs),
and [artifacts API](https://api.github.com/repos/razzeee/flathub-health/actions/runs/39585913867/artifacts).

Verified phase app commits were Firefox
`7985364b35b83cfe5aa17a00932df1c2d1dae69e5c592aa637a53ff1d53fdabc`
(158.0.1) and GIMP
`a1a84591666ddf43858346427b59241ce2ee286774345d55fd37b80ca1f2c72f`
(3.2.6). Both used verifier digest
`sha256:ffaee733b888837e4d8c1569270bdc65bf875993f9a5c5f7f010e5710041648b`.

The workflow's conservative planning bound is its 45-minute per-app job
timeout: if both candidates were run once, their combined app-job ceiling would
be 90 VM-minutes, assuming the same workflow limits. This is a timeout-derived
upper bound, **not an expected or measured cost**; downloads and storage are
unbounded by that figure. With a daily schedule, two additional maximum-length
jobs would imply up to 2,700 extra app VM-minutes per 30-day month. Do not treat
this deliberately conservative ceiling as evidence that the additions fit a
budget.

No budget agreement or additional cost measurement is required to recommend
these additions under the user's clarified scope. Observations will be recorded
from the authorized hosted run without extrapolating a single run into a
reliability or recurring-cost guarantee. Scheduling is unchanged by this work.

## Limitations and follow-up

- The catalog now has seven apps. Hosted results establish only visible startup
  windows, not broader functional compatibility or future cost. Manual runs
  include both startup-only entries.
- Popularity data supports interest, not test quality or cost. It is a rolling
  aggregate and can change between checks.
- Exact refs establish identity, not that the refs install successfully or that
  these apps work in the hosted environment.
- The proposed tests are deliberately startup-level. Browser network behavior
  and real-world sites, and image editing or broad format handling, remain
  untested. A fixture must have a documented source and redistribution license.
- Recipe feasibility and reliable selectors have not been verified. Do not add
  screenshot recipes until they are checked against the pinned upstream runner;
  capture-only validation is not a functional test.
- Issue #12 originally requested separate implementation issues. The user asked
  to implement these apps directly instead; no follow-up GitHub issues were
  created. Hosted startup evidence is recorded above. Budget agreement and repeated
  cost measurement are explicitly not completion gates under the clarified scope.

## Sources

### Existing catalog provenance and limits

The earlier official Popular API check on 2026-10-19 placed VLC at position 9
with 107,904 `installs_last_month` and LibreOffice at position 26 with 57,236.
These historical observations are not current counts. Their AppStream records
confirmed `app/org.videolan.VLC/x86_64/stable` and
`app/org.libreoffice.LibreOffice/x86_64/stable`:
[VLC](https://flathub.org/api/v2/appstream/org.videolan.VLC),
[LibreOffice](https://flathub.org/api/v2/appstream/org.libreoffice.LibreOffice).

VLC's recipe opens a five-second synthetic silent CC0 video; it does not prove
audio output, general codec compatibility, or hardware acceleration. Its fixture
source and generation command are in
`recipes/fixtures/org.videolan.VLC/README.md`. LibreOffice opens a bundled CC0
Writer document, not an editing or format-compatibility test; attribution is in
`recipes/fixtures/org.libreoffice.LibreOffice/README.md`. Current hosted limitations
are recorded in [validation.md](validation.md).

### New selection sources

- Flathub Popular collection, checked 2026-10-21:
  <https://flathub.org/api/v2/collection/popular>
- Firefox AppStream record, checked 2026-10-21:
  <https://flathub.org/api/v2/appstream/org.mozilla.firefox>
- GIMP AppStream record, checked 2026-10-21:
  <https://flathub.org/api/v2/appstream/org.gimp.GIMP>
- Original roadmap budget issue (not a gate under the clarified scope):
  <https://github.com/razzeee/flathub-health/issues/7>
- Workflow limits and validation history: [validation.md](validation.md) and
  [README.md](../README.md#limits)
