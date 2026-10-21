# Catalog selection research

Research checked 2026-10-21 against the official Flathub Popular collection
and AppStream API. Following the research, the user requested direct
implementation: Firefox and GIMP are now startup-only entries in `apps.json`.
This explicitly bypasses the original pre-inclusion gate; it is **not evidence
of hosted validation or budget approval**. No screenshot recipes were added.
Issue [#7](https://github.com/razzeee/flathub-health/issues/7) remains open:
there is no agreed recurring budget or measured current-catalog baseline to
compare against. Consequently no honest incremental or monthly cost estimate
can be calculated. Approval of recurring costs and completion of issue #12's
measured-budget requirement remain blocked on issue #7.

## Current catalog and cost evidence

The original five refs are `org.gnome.Calculator`, `org.kde.kcalc`,
`com.vscodium.codium`, `org.videolan.VLC`, and
`org.libreoffice.LibreOffice`, all `x86_64/stable`. The workflow currently
allows up to two app jobs concurrently and caps each at 45 minutes, or up to
225 app VM-minutes per complete run before catalog/report jobs. A daily schedule
would therefore have a theoretical cap of 6,750 app VM-minutes in a 30-day
month. With the two additions, these ceilings become 315 app VM-minutes per
run and 9,450 per 30-day month. These are timeout ceilings, not observed
runtime or cost estimates; no schedule has been enabled.

The latest successful hosted all-five run documented in
[validation.md](validation.md) is historical evidence for flatpak-smoke v0.2.0
(run 39441598891). The configured v0.4.0 pin has not had hosted app validation;
the workflow is manual-only. No measured download volume, artifact size, or
repeated-run duration is recorded, and issue #7 has no comments. Thus neither
actual current cost nor the incremental cost of another app is known. Measure
these on hosted runs and agree a monthly limit before making any cost-fit claim.

## Selected additions (startup-only; hosted validation pending)

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

## Cost estimate and decision gate

| Candidate | Runtime cost                                                       | Download/artifact cost                                               | Estimate status                                             |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Firefox   | Unknown; no hosted run measured with the configured v0.4.0 runner. | Unknown; no per-app transfer or artifact size measurement available. | Not estimable from metadata or the five-app historical run. |
| GIMP      | Unknown; no hosted run measured with the configured v0.4.0 runner. | Unknown; no per-app transfer or artifact size measurement available. | Not estimable from metadata or the five-app historical run. |

The only available planning bound is the workflow's 45-minute per-app job
timeout: if both candidates were run once, their combined app-job ceiling would
be 90 VM-minutes, assuming the same workflow limits. This is a timeout-derived
upper bound, **not an expected or measured cost**; downloads and storage are
unbounded by that figure. With a daily schedule, two additional maximum-length
jobs would imply up to 2,700 extra app VM-minutes per 30-day month. Do not treat
this deliberately conservative ceiling as evidence that the additions fit a
budget.

The recurring-budget decision is blocked until issue #7 records an agreed limit and hosted
measurements establish the current baseline. Then measure each candidate's
actual job time, download volume, and artifact size over representative repeated
runs (including startup and intended recipe phases); compare the observed
increment and uncertainty to that limit. The current v0.4.0 hosted validation
and failure-isolation checks must also pass before enabling routine scheduled runs.

## Limitations and follow-up

- The direct implementation request expands the catalog to seven apps, but does
  not establish either addition's hosted compatibility or cost fit. Manual
  runs now include both startup-only entries.
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
- Issue #12 originally required a separate implementation issue per approved app
  and a hosted startup result plus measured cost before catalog inclusion. The
  user's direct implementation request bypasses that ordering, not the need for
  evidence. No follow-up GitHub issues were created. Hosted startup results,
  repeated cost measurements, and budget agreement remain outstanding; do not
  mark issue #12 complete from these local changes.

## Sources

- Flathub Popular collection, checked 2026-10-21:
  <https://flathub.org/api/v2/collection/popular>
- Firefox AppStream record, checked 2026-10-21:
  <https://flathub.org/api/v2/appstream/org.mozilla.firefox>
- GIMP AppStream record, checked 2026-10-21:
  <https://flathub.org/api/v2/appstream/org.gimp.GIMP>
- Current budget dependency: <https://github.com/razzeee/flathub-health/issues/7>
- Workflow limits and validation history: [validation.md](validation.md) and
  [README.md](../README.md#limits)
