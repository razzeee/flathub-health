# LibreOffice Writer sample document

`sample.odt` is a small document authored for flathub-health. It includes the
text “A small garden” so the screenshot recipe can verify that Writer opened the
document rather than only displaying its start center.

The recipe selects the observed document title `sample.odt — LibreOffice Writer`
(with an em dash) rather than the short-lived startup splash. It also seeds
`registrymodifications.xcu` into the otherwise fresh profile to disable the
welcome/what's-new screen and daily tips, which can take focus during capture.
These settings do not disable document-content checks or change failure handling.

The settings are defined in LibreOffice's
[`Setup.xcs`](https://github.com/LibreOffice/core/blob/master/officecfg/registry/schema/org/openoffice/Setup.xcs)
and
[`Common.xcs`](https://github.com/LibreOffice/core/blob/master/officecfg/registry/schema/org/openoffice/Office/Common.xcs).
The welcome-screen check is in
[`viewfrm.cxx`](https://github.com/LibreOffice/core/blob/master/sfx2/source/view/viewfrm.cxx).

The document and profile settings are dedicated to the public domain under the
CC0 1.0 Universal waiver. The attribution and full legal notice are in `LICENSE.txt`; see
https://creativecommons.org/publicdomain/zero/1.0/.
