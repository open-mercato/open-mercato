# Sales document numbering and inline conflict recovery

Adopted from PR #10206 on 2026-11-23. The branch `fix/issue-9155-sales-document-number-permissions` targets `main`.

## Goal

Enforce the document number edit feature during Sales writes, preserve automatic numbering, and let a user recover their draft after a stale inline save.

## Evidence and scope

The [original issue](https://github.com/open-mercato/open-mercato/issues/9155) defines the authorization boundary. The [source review](https://github.com/open-mercato/open-mercato/pull/10206#pullrequestreview-6014337575) approved the existing permissions and conflict handling. The [hosted regression](https://github.com/open-mercato/open-mercato/actions/runs/45066220975/job/137344131196) reproduced the raw error on both attempts. The remaining code repair belongs in the inline editor that renders the structured response. The [maintainer QA gate](https://github.com/open-mercato/open-mercato/pull/10206#issuecomment-7073534283) tracks final Sales QA separately.

## Progress

- [x] Enforce manual numbering permissions and preserve ordinary resaves. See `634b33925d` and `bc8fa8f446`.
- [x] Preserve drafts after a conflict and contain the mobile Sales draft table. See `a129253b8d` and `842c933bde`.
- [ ] Display the localized conflict in the retained editor and exercise the HTTP error shape in a component regression.
