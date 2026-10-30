# Checkpoint 9 — Steps 8.1..8.5 (incl. 8.4-review-fix)

- **Recorded:** 2026-10-23T08:49:20Z
- **Steps:** 8.1, 8.2, 8.3, 8.4, 8.4-review-fix, 8.5 (commits 0be444c63..5060a3549)
- **Touched areas:** `packages/core` `attachments`: document structure entities + migration `Migration20261023080922_attachments` (offline-generated, with encryption-map backfill) + `encryption.ts`; partition flags (validators, API, settings dialog — UI); page-scoped OCR + OCR engine; queue + worker; upload subscriber; purge on delete / `releaseScoped`
- **Runner:** local mode; UI against an isolated ephemeral app

| Check | Result | Notes |
|---|---|---|
| core `attachments` jest | ✅ pass | 46 suites, 434 tests |
| core `tsc --noEmit` | ✅ pass | 0 errors |
| `yarn build:packages` | ✅ pass | the first ephemeral start failed because core `dist` predated Step 8.1's `encryption.ts`; rebuilt, then green |
| `yarn i18n:check-sync` | ✅ pass | |
| UI: partition settings dialog (ephemeral app) | ✅ pass | probe: index switch disabled until extraction is on; both switch on; plaintext warning shown. Screenshot: `checkpoint-9-artifacts/screenshot-partition-structure-switches.png` (throwaway spec, not committed) |
| Migration applied locally | ⏭️ not run | `yarn db:migrate` is Ask-First; the ephemeral app applied it to its own container DB during startup without errors |

## Notes for review
- Review fix: a failed/timed-out re-extraction no longer supersedes a good live extraction (saved as a soft-deleted failure row); mid-job attachment deletion aborts without writes.
- Structure is purged (hard delete, idempotent) in the same unit of work as attachment deletion; search-record deletion is Phase 4.
