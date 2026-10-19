# Catalog selection

Checked official Flathub sources on 2026-10-19.

## Selection basis

The original Calculator, KCalc, and VSCodium entries cover GTK, Qt, and Electron.
We did not choose them by popularity. The expansion from three to five apps adds
VLC for media and LibreOffice for documents. The catalog is not a top-five
popularity list.

Flathub's [Popular collection](https://flathub.org/apps/collection/popular) has a
public [collection API](https://flathub.org/api/v2/collection/popular). The API
was accessible. Its unfiltered response reported page 1, 250 hits per page,
3,328 total hits, and 14 pages. VLC appeared at position 9 and LibreOffice at
position 26 in that returned page. Their `installs_last_month` values were
107,904 and 57,236 respectively. These are the API's installation figures,
not download counts or unique users. These observations support selecting
these two workflow examples; they are not permanent rankings.

The official [API implementation](https://github.com/flathub-infra/website/blob/bdd8c6a443d0ed7fbaab5adedb6f8761399b8f1d/backend/app/routes/collection.py)
defines Popular as installations in the previous 30 days, distinct from
Trending's growth-based collection. The response did not include exact start
and end timestamps for that window. This note therefore records the collection,
its documented rolling window, and the check date, not an invented calendar
range.

## App identity and scope

The [VLC page](https://flathub.org/apps/org.videolan.VLC) and
[AppStream API](https://flathub.org/api/v2/appstream/org.videolan.VLC) identify
`org.videolan.VLC` as a multimedia player. The API returned bundle
`app/org.videolan.VLC/x86_64/stable`.

The [LibreOffice page](https://flathub.org/apps/org.libreoffice.LibreOffice) and
[AppStream API](https://flathub.org/api/v2/appstream/org.libreoffice.LibreOffice)
identify `org.libreoffice.LibreOffice` as an office suite including Writer,
Calc, and Impress. The API returned bundle
`app/org.libreoffice.LibreOffice/x86_64/stable`.

Both additions target stable x86_64 and are intended for startup checks only.
We will verify new interaction recipes once end-to-end runs can execute.
Startup checks do not establish media playback, document editing, or file
format compatibility. End-to-end validation remains blocked by the runner
image and Docker access issues recorded in [validation.md](validation.md).
Neither app has a successful startup result from this selection research.
