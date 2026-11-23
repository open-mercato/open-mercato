# Address contact layout on PR #9643

Adopted from the [QA report](https://github.com/open-mercato/open-mercato/pull/9643#issuecomment-7091306909) on 2026-11-23. The existing person and company address flows accept a recipient name of up to 200 characters and a phone of up to 50. Users need to be able to read both values within an address tile on desktop and mobile.

## Progress

### Phase 1. Contain long contact values

- [ ] 1.1 Correct the shared address tile layout and exercise both reported viewport widths in the CRM browser regression.

Independent review and human QA cover the broader address-book feature. The previous QA run verified the person and company create paths and identified the contact line as the remaining PR-specific layout defect.
