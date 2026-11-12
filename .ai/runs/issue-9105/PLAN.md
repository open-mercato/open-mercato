# Issue 9105

1. Confirm issue and regression gap, claim issue. Done.
2. Add self-contained browser spec for create/edit preview and persisted statement map; ordinary/missing names and replacement.
3. Run browser coverage and configured validation using local runner (no compose app running); record concrete environment blockers.
4. Commit, open PR when validated, review, publish evidence, release claims.

## om-root-cause brief
Summary: Literal popup name handling lacks real-consumer browser regression coverage.

Root cause: PlotMapPreviewImpl binds createPlotMapPopupContent(name), which uses textContent. Existing integration specs exercise API geometry but never open Leaflet popups. The gap is inferred from code search, not a reproduced production vulnerability.

Files to change:
- packages/core/src/modules/eudr/__integration__/TC-EUDR-020.spec.ts — self-contained browser regressions and API fixtures/cleanup.

Approach: Persist HTML-looking GeoJSON properties.name through API fixtures, reload edit and statement detail pages, click rendered map features, and assert literal text without supplied elements. Drive create/edit geometry replacement through the textarea, verifying ordinary and missing names and removal of old popups/layers. Keep production code unchanged.

Risks: Browser execution requires an EUDR-enabled app, authenticated fixture account and Chromium. Leaflet paths need DOM selectors because the renderer supplies no accessible name. Assert cleanup responses; never rely on seeded business records.
