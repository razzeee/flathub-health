# Roadmap

## Current state

The project checks released Flathub apps with startup tests and selected
screenshot recipes. The catalog, daily workflow, failure-isolation checks,
bounded run history, and read-only results page are in place. See
[validation.md](validation.md) for the latest hosted-run evidence and known
limitations. A passing startup check or screenshot does not prove full app
functionality.

The initial delivery milestones are complete: [runner pinning](https://github.com/razzeee/flathub-health/issues/2),
[hosted validation](https://github.com/razzeee/flathub-health/issues/3),
[failure isolation](https://github.com/razzeee/flathub-health/issues/4),
[safe CI checks](https://github.com/razzeee/flathub-health/issues/5),
[runtime metadata](https://github.com/razzeee/flathub-health/issues/6),
[daily runs](https://github.com/razzeee/flathub-health/issues/7),
[run history](https://github.com/razzeee/flathub-health/issues/8), and the
[results page](https://github.com/razzeee/flathub-health/issues/9). Coverage
additions for [VLC](https://github.com/razzeee/flathub-health/issues/10),
[LibreOffice](https://github.com/razzeee/flathub-health/issues/11), and further
[app selection](https://github.com/razzeee/flathub-health/issues/12) are also
complete. Their remaining limitations are documented in the catalog and
validation notes.

## Next

### [Reduce transient noise before adding notifications #13](https://github.com/razzeee/flathub-health/issues/13)

Use evidence from repeated runs to identify transient failure types. Retry only
those, at most once, and retain both attempts and their version metadata. Do not
hide app or recipe failures behind retries.

Done when reports distinguish a retry recovery from a first-attempt pass and
tests enforce the retry limit. Open a separate notification issue only after
choosing who receives alerts, which changes qualify, and how to avoid duplicates.

## Deferred

App-release triggers, additional architectures, automatic upstream issue filing,
and pixel-diff failure checks can wait. Revisit them after repeated runs provide
useful history. Do not infer full app functionality from startup checks or
screenshots.
