# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-06-04 (resume 6 — QA round-7, Phase 32)
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** COMPLETE — Phase 32 incl. ARCH fix (withAtomicFlush per-phase). Two ephemeral rounds stable (1093 passed, 0 failed, 0 flaky each). Awaiting human re-QA from @alinadivante.

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

## QA SWEEP TASK (resume 8 — in progress) — comprehensive CrudForm data-persistence audit
**Goal:** Verify EVERY CrudForm saves all fields incl. custom fields (browser-confirmed). Root-cause failures. File GitHub issues (owner fixes separately). Comprehensive report → PR #2055. Scope = issue #2333 (SQL transaction-safety umbrella) + its merged PRs: #2343 #2355(2336) #2374(2337) #2368(2338) #2360(2339) #2356(2341) #2376(2335) #2377(2342) #2383 #2348.

**Root-cause family (confirmed):** the #2333 atomic-writes work wrapped writes in withAtomicFlush/em.transactional but left interleaved reads (em.find/findOne/findWithDecryption/nativeUpdate/sync helper / resolveDictionaryEntryValue) between scalar mutations and the flush → MikroORM v7 UOW-LOSS (200 OK + updated_at bumped, columns not persisted). #2333 taxonomy calls this UOW-LOSS.

**Already FIXED on this branch (do NOT re-report):**
- Framework: withAtomicFlush now flushes per-phase (fe22b4c8e).
- 13 withAtomicFlush commands restructured (clean phases): people, companies, addresses, personCompanyLinks, pipeline-stages, sales documents (updateOrder/updateQuote/returns.undo), catalog variants, directory orgs, auth sidebarPreferencesService, resources, currencies, messages updateDraft.
- shipments updateShipmentCommand (em.transactional) — c496f9b65.
- detail-page delete error surfacing (companies/people/deals) — 99c54dbc7.

**STILL TO QA / likely-affected (per #2333 findings, NOT yet verified/fixed here):**
- em.transactional callers other than shipments: sales payments updatePayment (CRITICAL), createPaymentCommand, convertQuoteToOrderCommand, sales createOrder/createQuote (custom-field flush mid-build), deals.createDeal (two txns), interactions, catalog products create/update, attachments.
- Custom-field persistence on EDIT, esp. MULTICHOICE/array: deal "require legal review/competitive risk" (reported, task #10), product "required resources" multichoice (reported, task #11). Likely a custom-field-array write/read path issue distinct from UOW-LOSS.
- makeCrudRoute direct-ORM entity+custom-field path (#2376) — verify custom fields persist on edit for makeCrudRoute entities (todos, etc.).
- Non-command routes: auth ACL, dictionaries, perspectives, quotes/send.

**Method:** dynamic workflow agents do em.transactional audit + custom-field root cause + CrudForm inventory; main agent browser-confirms; create GH issues per confirmed failure; write report at .ai/analysis/2055-crudform-persistence-qa.md → post to PR #2055.

## QA SWEEP — results (resume 8b)
- Umbrella #2466 created (child of #2333); PR #2055 + #2333 cross-linked; report at .ai/analysis/2055-crudform-persistence-qa.md.
- Probed OK: business_rules rule, catalog product, sales payment (false-positive cleared), dictionaries, + all fixed commands.
- INCONCLUSIVE: EAV custom records (example:todo) — list is query-index-backed/async so API readback unreliable; PUT 200; NEEDS UI QA. feature_toggles needs superadmin to probe. communication_channels has no field-edit endpoint.
- Remaining tracked as checklist in #2466.
