# GIMP editor profile

`gimprc` is a minimal test configuration authored for this repository. It disables
the welcome dialog so the empty editor is available without interacting with
first-run onboarding. The documented `--gimprc` option selects this file explicitly,
independently of GIMP's versioned default configuration directory.
`config-version` matches the tested GIMP 3.2.6 release: GIMP shows onboarding after
an upgrade regardless of `show-welcome-dialog`. A newer release may need this
profile reviewed and updated; an obstructed editor must fail the recipe.
The recipe does not suppress the splash, skip plug-in discovery, or sleep for a
fixed interval.

The exact English empty-editor title is `GNU Image Manipulation Program`.
The recipe selects that app-owned window, then waits for the `Tools` and `Filters`
menus before capturing it. Neither the welcome dialog nor plug-in discovery is
evidence of editor readiness. Selection and OCR are bounded by the pinned
runner's deadlines; a title/label change fails the recipe rather than accepting
the splash.

Source references:

- [GIMP 3.2 empty-image title assignment](https://github.com/GNOME/gimp/blob/GIMP_3_2_0/app/display/gimpdisplayshell-title.c)
  uses `GIMP_NAME`, defined in [about.h](https://github.com/GNOME/gimp/blob/GIMP_3_2_0/app/about.h).
- [GIMP 3.2 GUI configuration](https://github.com/GNOME/gimp/blob/GIMP_3_2_0/app/config/gimpguiconfig.c)
  defines `show-welcome-dialog` (default true).
- [GIMP 3.2.6 update handling](https://github.com/GNOME/gimp/blob/GIMP_3_2_6/app/gimp-update.c)
  also shows the welcome dialog when `config-version` is missing or older.
- [flatpak-smoke v0.4.1 recipe contract](https://github.com/razzeee/flatpak-smoke/blob/fb9c87a451ac97438532aa205dec60fdc6bc5384/docs/reference.md#writing-a-recipe)
  supports exact `window.title` selection and polling `wait_text` actions.

The separate startup verification phase can still pass on the splash. Only a
successful recipe establishes the empty editor checks above. It does not establish
image loading, editing, saving, exporting, plug-in functionality, color management,
or format compatibility. There is no image fixture.

## Hosted validation (2026-10-22)

[Run 39752711587](https://github.com/razzeee/flathub-health/actions/runs/39752711587)
at health revision `121dbd197b1fbacd193f6ec6eb1edb2c4cb07370` passed GIMP
preparation, startup, and the editor recipe using flatpak-smoke v0.4.1. The
reviewed `screenshots/screenshots/000-editor.png` shows the empty editor, menus,
toolbox, and docks. Initial editor readiness took 14.811 seconds; this is an
observation, not a configured sleep. The run failed overall in VLC and reporting.

Tested app: GIMP 3.2.6, `app/org.gimp.GIMP/x86_64/stable`, commit
`a1a84591666ddf43858346427b59241ce2ee286774345d55fd37b80ca1f2c72f`.
Screenshot image digest:
`sha256:c971baec925c1f8a20c63df0adb462a98fa2b4b08df61cfd9a06d8562597e41c`.

The preceding [run 39750676614](https://github.com/razzeee/flathub-health/actions/runs/39750676614)
timed out waiting for initial editor readiness and emitted no recipe capture.
It seeded `show-welcome-dialog` alone. Adding the matching `config-version`
removed the forced first-run onboarding and allowed the same editor selector and
menu checks to pass. A local rootless Podman attempt could not start GNOME because
`org.freedesktop.login1` activation failed; it supplied no GIMP readiness evidence.

This is one successful hosted editor capture, not a repeatability guarantee.
