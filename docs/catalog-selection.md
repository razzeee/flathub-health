# Catalog selection

Checked official Flathub sources on 2026-10-19. The catalog is not a top-five
popularity list. Calculator, KCalc, and VSCodium cover GTK, Qt, and Electron.
VLC and LibreOffice add media and document apps.

## Sources

In the [Popular collection API](https://flathub.org/api/v2/collection/popular)
response on the check date:

- VLC appeared at position 9 with `installs_last_month` of 107,904.
- LibreOffice appeared at position 26 with `installs_last_month` of 57,236.

The [Flathub implementation](https://github.com/flathub-infra/website/blob/bdd8c6a443d0ed7fbaab5adedb6f8761399b8f1d/backend/app/routes/collection.py)
defines Popular by installations over the previous 30 days. These figures are
not download counts or unique users. The API did not return exact window
timestamps. Positions can change as the window moves.

The AppStream APIs confirmed the app IDs and refs:

- [VLC](https://flathub.org/api/v2/appstream/org.videolan.VLC) returned
  `app/org.videolan.VLC/x86_64/stable`.
- [LibreOffice](https://flathub.org/api/v2/appstream/org.libreoffice.LibreOffice)
  returned `app/org.libreoffice.LibreOffice/x86_64/stable`.

## Test limits

VLC and LibreOffice have startup checks only, with no screenshot recipes yet.
Those checks do not test playback, document editing, or file compatibility.
Neither app has a successful startup result here. See
[validation.md](validation.md) for the current run blockers.
