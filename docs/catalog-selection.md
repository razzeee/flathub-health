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

VLC has a screenshot recipe that seeds a five-second synthetic CC0 video into
the clean profile and opens the file directly. Its capture checks that VLC
opens this media and presents video. It is not evidence for audio output,
hardware acceleration, broad codec support, or general playback compatibility.
It uses no account, audio-device, or hardware-acceleration assertions. The
fixture source, generation command, and license are documented in
`recipes/fixtures/org.videolan.VLC/README.md`. LibreOffice opens a bundled CC0
Writer document from its recipe directory; its fixture attribution is in
`recipes/fixtures/org.libreoffice.LibreOffice/README.md`. Its
check does not test document editing or file compatibility. See
[validation.md](validation.md) for the current run blockers.
