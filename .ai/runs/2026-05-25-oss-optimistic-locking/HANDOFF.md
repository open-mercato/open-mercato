# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-06-04 (resume 6 — QA round-7, Phase 32)
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** COMPLETE — Phase 32 (QA round-7) done. Full ephemeral suite stable across rounds (R1 1094✓/0✗; R3 1093✓/0✗/0 flaky after deferral). Awaiting human re-QA from @alinadivante.

## QA round-7 sources
- @alinadivante https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4616381470 (People-v2, Dictionaries, Timesheets, Integrations, Data Sync)
- @alinadivante https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4616551578 (Job History stale-delete conflict bar)
- Issue #2453 (People-v2 dropdown persistence)

## Done this resume (Phase 32)
- 32.1 (#2453 server): updatePersonCommand flushes scalars before interleaved ensureDictionaryEntry/syncLegacyPrimaryCompanyLink reads. + TC-CRM-2453.
- 32.2 (#2453 client): people-v2 renders ONE CrudForm via useIsMobile (was mobile+desktop dual-render sharing formWrapperRef → header Save hit the hidden stale form). loadData token-pin folded into one re-render.
- 32.3 companies.ts had the same interleaved-read bug (syncEntityTags) — fixed. deals.ts already guarded. companies-v2/deals render the form once. + TC-CRM-2453-COMPANY.
- 32.4 Job History stale-delete → surfaceRecordConflict (unified bar). + TC-LOCK-OSS-036 delete-409 case.
- 32.5 Timesheets: from=2026 partial date no longer 500s (tightened refine + client omits empty params). + TC-STAFF-024 cases.
- 32.6 Integrations 500 = stale local DB missing develop IMAP migration (integration_credentials.user_id). Not a PR regression; green in CI/ephemeral.
- 32.7 Dictionaries save verified already fixed (493346391) — 200 + persists.
- 32.9 Codebase-wide withAtomicFlush audit: same lost-write fixed in sales(updateOrder/updateQuote/return.undo), catalog(updateVariant), directory(deleteOrganization), auth(updateSidebarVariant), resources(updateResource+undo), currencies(updateCurrency), messages(updateDraft), customers(addresses/personCompanyLinks/pipeline-stages). Introduced by atomic-writes #2337 (b46ca23da).
- 32.10 Field-persistence integration tests for every audited command (TC-*-2453-*).
- 32.11 Ephemeral 2-round stabilization; deferred one pre-existing flaky kanban browser test (TC-LOCK-OSS-017 CRM-08, SSE-refresh race; server 409 covered by TC-LOCK-OSS-004) via test.fixme.
- Data Sync: working-as-intended (batchSize is a transient per-run input, not a persisted setting).

## Root-cause pattern (round-7)
MikroORM v7 + withAtomicFlush flushes ONCE at the end. A managed-entity scalar mutation followed by ANY query (em.find/findOne/findWithDecryption/nativeUpdate/sync helper) before that terminal flush drops the pending scalar changeset → write 200s with updated_at bumped but columns never persist. Fix: flush scalars before the interleaved read, still inside { transaction: true } (atomicity preserved). Plus a separate client dual-form-render bug on people-v2 only.

## Verification
- Browser-verified #2453 (people email/status persist after reload; single form) + companies (tags) + currencies pattern.
- Typecheck core: 0 errors. i18n: in sync.
- Full ephemeral suite (fresh migrated Docker DB, OM_OPTIMISTIC_LOCK=all): R1 1094 passed / 0 failed; R2 1 flaky (now deferred); R3 1093 passed / 0 failed / 0 flaky. All TC-*-2453 + TC-LOCK-OSS-036 + TC-STAFF-024 green every round.

## Environment / build notes
- Worktree: `.ai/tmp/auto-continue-pr/pr-2055-20260604-044233`. @open-mercato/core/modules/* resolves to dist — rebuild core (`yarn workspace @open-mercato/core build`) after source edits before browser testing on a worktree dev server.
- Local shared `open-mercato` DB is behind develop (missing IMAP migrations: integration_credentials.user_id, messages.idempotency_key) → integrations list + messages create 500 locally only; both work in the fresh-migrated ephemeral runner.
- Full ephemeral suite: `OM_OPTIMISTIC_LOCK=all ENABLE_CRUD_API_CACHE=true yarn mercato test:integration`. Kill any leftover :5001 listener between runs (teardown can leak the app process → next run fails readiness).
