## Scoped QA evidence — PARTIAL (OSS PASS; enterprise runtime pending)

Latest-main local merge `5a63714e6c8939d02416dcd3f3ae17b0ee3e2f89` on `repair/batch-a-8216-b5ce1395`, including main `3b2ea82ea78fc478a6b71a99033e27463b0716cd`. Fresh managed production app `http://127.0.0.1:45989`; cold/warm authenticated readiness passed. Core typechecking passed.

Native repository suite: **3 passed**, 0 failed, 0 skipped, 0 flaky; 24.7s. Fresh browser matrix: **13/13 PASS**,0remaining fixtures.

| Scenario | Result / evidence |
|---|---|
| 01-source-default | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/01-source-default.png` |
| 02-confirmation-Escape | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/02-confirmation-Escape.png` |
| 03-empty-read-only-adjustments | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/03-empty-read-only-adjustments.png` |
| 04-long-content-mobile-scroll | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/04-long-content-mobile-scroll.png` |
| 05-loading | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/05-loading.png` |
| 06-read-error-500 | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/06-read-error-500.png` |
| 06-read-error-403 | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/06-read-error-403.png` |
| 07-missing-record | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/07-missing-record.png` |
| 08-real-view-only403 | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/08-real-view-only403.png` |
| 09-real-no-permission | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/09-real-no-permission.png` |
| 10-real-stale409 | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/10-real-stale409.png` |
| 11-CtrlEnter-switch-correct-money | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/11-CtrlEnter-switch-correct-money.png` |
| 12-switch-error500 | PASS; `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89/12-switch-error500.png` |
| a mirrored order keeps its own header and line amounts across writes | PASS; `native-results.json` |
| returns, rejected writes and repeated writes never move the source-owned header | PASS; `native-results.json` |
| the migration defaults existing rows to computed and round-trips without touching amounts | PASS; `native-results.json` |

Artifacts: `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8216-qa/latest-main-local-5a63714e6c89`. Full script/results/screenshots/native logs and SHA256 manifest remain recoverable locally. Previous pre-merge evidence is retained separately; this report supersedes its current-head QA disposition.

Fresh production app built from this exact local latest-main merge; cold and warm database-authenticated readiness passed.
Native tests retain all existing assertions and cleanup. No tests, retries, timeouts or checks weakened.
Published-head GitHub CI is historical relative to this unpublished merge. New-head remote CI requires Guard-authorized publication, unavailable in this scheduled run. No shared/evidence pushes or merges.
Evidence-only PASS grants no human QA approval. Independent review and existing QA/decision gates remain.
Performance is not benchmarked. Existing shared mobile-width/ancillary loading limits are visible in scoped UI screenshots and are not certified fixed.
Focused external-amount command/return/calculation tests:3suites/58tests passed on this local head. No shipped browser case covers the external-mode flow; a concrete automation follow-up accompanies the manual evidence.
Preserves local source repair d8cae70a9f: ItemsSection relative overflow-x-auto; direct product source repair by this run. A separate commit removes two inherited enterprise quote-session test.slow() overrides; its actual enterprise runtime validation remains pending (OSS QA environment does not activate record_locks). Assertions/shared runner settings are untouched. Existing Related-documents mobile overflow is tracked#7206; Low inherited QA observations tracked#8240. Spec decisions remain unfilled.

UI automation follow-up: https://github.com/open-mercato/open-mercato/pull/8216#issuecomment-6512861747
