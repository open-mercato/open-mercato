🤖 `om-auto-continue-pr-loop` — checkpoint 8 verification (lightweight)

Steps 8.1–8.3 (20f82cad2, 201594092, c506a70f9) complete — Phase 8 (retention + stored files) closed. Runner: local, reduced validation mode.

| Check | Result |
|---|---|
| Retention service + source-erasure subscriber tests | ✅ 11 tests |
| stored-documents + generate route (incl. storage + fallback) + history service tests | ✅ 47 tests (with 8.1 files) |
| Stored download route + request helper + history columns tests | ✅ 8 + 5 tests; history service 14 tests |
| Package typecheck / build / `yarn generate` / full suites | ⏸ deferred (reduced validation mode) |
| UI / browser verification | ⏸ deferred — needs app + migrated DB |

Delivered:
- **Retention (approved policy):** no automatic expiry; a persistent `*` subscriber handles `<resourceKind>.deleted` for resource kinds with registered templates, removes stored files via `attachmentService.releaseScoped` (exact owner/assignment/partition/scope), then anonymizes history (`resource_label` → `resource_id`, `attachment_id` cleared). Refuses to orphan files when removal is unavailable; failures rethrow for retry.
- **Storage:** after a successful render, `attachmentService.createScoped` stores the bytes in the private `privateAttachments` partition (owner `document_generators:document` + source id, assignment = application-assigned history id) and writes the history row in the same transaction via `persistLink`; storage failure falls back to history without a file.
- **Download:** `GET /api/document-generators/documents/{id}/file` re-checks the template's `requiredFeatures` and reads through `readScoped`; history tables show a download row action only for rows with a stored file; DTO exposes `attachmentId`.
- Spec updated with the retention policy and both implementation notes (partition choice, engine download route).
