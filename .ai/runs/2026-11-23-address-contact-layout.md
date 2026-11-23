# Address contact layout on PR #9643

Adopted from the [QA report](https://github.com/open-mercato/open-mercato/pull/9643#issuecomment-7091306909) on 2026-11-23. The existing person and company address flows accept a recipient name of up to 200 characters and a phone of up to 50. Users need to be able to read both values within an address tile on desktop and mobile.

## Progress

### Phase 1. Save and display address contact values

- [x] 1.1 Verify the person and company create forms persist both address contact fields — 4c336e681b

### Phase 2. Contain long contact values

- [x] 2.1 Correct the shared address tile layout and exercise both reported viewport widths in the CRM browser regression — 72a753f4a7

On the local runner, Chromium reproduced overflow with a 200-character recipient name and a 50-character phone. After the repair the rendered address component fit in both the 390 px and 1440 px viewports. All ten focused component tests passed. The full application browser regression runs in hosted CI.

### Phase 3. Repair the delete/undo unit fixture

- [x] 3.1 Reproduce all four address snapshot failures on GitHub's merge commit, let the real scoped readers load the customer and profile from the test fixture, and validate the prepare and undo handlers with both current and legacy snapshots.

Four related suites passed on the PR branch (23 tests) and on the hosted merge commit with the fixture repair applied (31 tests).

Independent review and human QA cover the broader address-book feature. The previous QA run verified the person and company create paths and identified the contact line as the remaining PR-specific layout defect.
