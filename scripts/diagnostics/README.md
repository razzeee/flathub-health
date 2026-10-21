# Temporary LibreOffice focus investigation

This branch is diagnostic-only. Do not merge its single-app matrix or probe into
the normal health workflow. No runner release/pins, recipe, timeouts, scheduling,
or failure classifications are changed. The helper still checks focus after its
existing 100 ms delay and returns the original error if focus is wrong.

`install-focus-probe.py` adds a container mount and PATH entry to the pinned
action checkout. `gnome-shell` passes version queries through unchanged and adds
`[DEBUG-lo-focus]` observations to the disposable capture extension before GNOME
starts. The uploaded `screenshots/logs/desktop.stderr.log` records selected and
focused window IDs/titles, mapped/showing state, modal count, and other windows.
This is an instrumented image execution, not an unmodified release run.

## Evidence as of 2026-10-21

- Production run 39572843834 on merged PR #30 failed with
  `Could not focus selected window` before initial readiness completed; no
  screenshot was saved.
- Diagnostic run 39578962416 stopped at a bug in this probe's version-query
  handling, before app launch. That probe bug was corrected and tested locally.
- Corrected diagnostic run 39579957406 passed LibreOffice. Writer already owned
  focus before initial resize and retained focus after each 100 ms check; no
  other windows or modal dialogs were present. The aggregate report fails
  because this diagnostic branch intentionally runs only LibreOffice.
- Thirteen sequential local replays with the exact app/runtime/image commits
  and fresh app profiles also passed. They shared an installation cache to avoid
  repeated dependency downloads; they are not thirteen fresh installs. Eight
  omitted the Python protocol wrapper to reduce instrumentation timing effects.
  All thirteen recorded Writer already focused before initial resize.
- An earlier local attempt hit a dependency-install timeout, and another hit
  desktop startup timeout while the host load average was about 89. Neither
  reproduced the production focus failure.

The remaining race is **not fixed or diagnosed conclusively**. There is no
failing focus-state snapshot yet, so there is no basis to identify a competing
dialog, GNOME startup UI, or delayed focus as the actual cause. In particular,
do not increase timeouts or claim repeated hosted capture reliability from
these successful diagnostic samples.

The next useful evidence is a failing run with this probe enabled, specifically
the `before-activate` and `after-100ms` records for the failing action. Dispatch
`check-apps.yml` manually on this diagnostic branch to collect that evidence;
do not count the diagnostic matrix/report as a full-catalog health run.

Issue #11 remains open and unchanged. No fix PR was opened for this unresolved
focus race.
