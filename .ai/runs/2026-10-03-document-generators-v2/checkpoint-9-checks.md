🤖 `om-auto-continue-pr-loop` — checkpoint 9 verification (lightweight)

Steps 9.1, 9.2, 6.2-review-fix, 10.1 (8c4b4a54c, 524d99d7d, ce105adc3, 4e561f456) complete. Runner: local, reduced validation mode.

| Check | Result |
|---|---|
| Registry/versioning, validators, http, routes, components, history service tests (engine) | ✅ 17 suites / 166 tests |
| Shared `BaseDocumentService` test (archived versions) | ✅ 6 tests |
| Sales document-generators tests (draft derivation, labels, Markdown banner, registration) | ✅ 5 suites / 56 tests |
| `DraftWatermark` structural test | ✅ |
| `yarn template:sync` (check) | ✅ in sync |
| Typecheck / build / `yarn generate` / `db:generate` drift / full suites / lint / client boundaries | ⏸ deferred — Step 10.2, needs user approval |
| Integration tests + browser evidence | ⏸ deferred — Step 10.3, needs running app + migrated DB |

Delivered:
- **Versioning:** code-defined `version` + `archivedVersions`, latest by default, `template_version` on preview/generate (`400 unknown_template_version` before any fetch), recorded in new `template_version` column (additive migration, hand-written + snapshot), version selector in preview when archived versions exist.
- **Draft watermark:** Sales derives `isDraft` server-side (missing / `draft` / `pending_approval` / `rejected`; unknown custom statuses are final); engine `DraftWatermark` primitive; Markdown banner.
- **CSP fix:** `frame-src` now allows `blob:` in the app and the create-app template (Blob PDF preview would otherwise be blocked).
- **Docs:** `framework/document-generators/overview` + working example module under `apps/docs/static/examples/document-generators/invoices/`; spec Implementation Status, "Not yet verified" list and changelog updated.
