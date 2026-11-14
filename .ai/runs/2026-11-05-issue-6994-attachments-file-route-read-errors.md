# Execution plan — distinguish missing attachment files from failed storage reads (adopted from PR #7044)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-11-05 because PR #7044 carried no execution plan.
**PR:** #7044 · **Branch:** `fix/issue-6994-attachments-file-route-read-errors` (fork `bluepaprica`) · **Base:** `main`
**Author:** @pidubiel — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal
Make `GET /api/attachments/file/<id>` return 404 `STORAGE_FILE_MISSING` for a missing object and 500 `STORAGE_READ_FAILED` for other read failures, with logging and telemetry (issue #6994), and clear the remaining review blockers: a compatibility spec and HTTP-level integration coverage.

## Scope
- `packages/core/src/modules/attachments/api/file/[id]/route.ts` (already changed)
- A spec under `.ai/specs/` recording the response-contract change (Migration & Backward Compatibility)
- `.ai/specs/2026-10-01-attachment-storage-validation.md`: check that its promise to keep "provider operational errors" semantics is still accurate
- New Playwright integration test under `packages/core/src/modules/attachments/__integration__/`

## Non-goals
- `AttachmentService` read parity (declined by the reviewer as out of scope for this route).
- Changing the image route or any other attachment endpoint.
- Changing the response body beyond `error` + `code`.

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is the 404/500 split with logging and telemetry | PR body, issue #6994 | high |
| Missing-file telemetry is done | review by @haxiorz on 2026-11-05 ("Resolved") | high |
| A spec with Migration & BC is required | review by @haxiorz on 2026-11-05, finding 1; BACKWARD_COMPATIBILITY.md step 5 | high |
| HTTP integration tests are required (missing file → 404, non-missing fault → 500, redacted body, cleanup in `finally`) | review by @haxiorz on 2026-11-05, finding 2; `.ai/review-checklist.md` §20 | high |
| CI is green on `55d6e4e58d` | same review, validation gate table | high |

## Assumptions
- A new focused spec (`2026-11-05-attachment-file-read-error-semantics.md`) is better than inflating an existing one; the storage-validation spec only gets a cross-reference line.
- The non-missing read fault in the integration test must be deterministic without relying on file permissions, because a root runner ignores them. Default: replace the stored file with a directory at the same path, so the read fails with `EISDIR`. If the test can't reach the storage path from the runner, ask for a maintainer waiver instead of faking it.
- The integration test assumes the local storage driver is used in CI.

## Risks
- The integration test has to manipulate storage on disk next to the app server. That only works when the test runner and the app share a filesystem, which holds for the current CI setup but is environment-dependent.
- Labels can't be changed from this account (read permission), so a maintainer has to switch `changes-requested` to `review`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Route splits missing-file 404 from read-failure 500, with logging, telemetry, and unit tests — 55d6e4e58d

### Phase 2: Compatibility record

- [x] 2.1 Add spec documenting file-route read-error semantics with Migration & Backward Compatibility — 4ed6eb07a3
- [x] 2.2 Cross-reference the new spec from the attachment storage-validation spec — 4ed6eb07a3
- [x] 2.3 Reference the spec in the PR description — PR body

### Phase 3: HTTP integration coverage

- [x] 3.1 Integration test: missing backing file returns 404 STORAGE_FILE_MISSING — 221ff79abf
- [x] 3.2 Integration test: non-missing read fault returns 500 STORAGE_READ_FAILED with a redacted body — 221ff79abf

### Phase 4: Finalize

- [ ] 4.1 Full validation gate and re-request review from @haxiorz
