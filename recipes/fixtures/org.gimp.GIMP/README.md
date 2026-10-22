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
