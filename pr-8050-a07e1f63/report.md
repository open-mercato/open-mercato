## Scoped QA evidence — PASS

Latest-main local merge `7d7d577dae8fdd0f322d74f992af024760303cac` on `repair/batch-a-8050-b5ce1395`, including main `3b2ea82ea78fc478a6b71a99033e27463b0716cd`. Fresh managed production app `http://127.0.0.1:39893`; cold/warm authenticated readiness passed. Core typechecking passed.

Native repository suite: **18 passed**, 0 failed, 0 skipped, 0 flaky; 54.3s. Backend API behavior is the closest changed observable; no UI screenshots invented.

| Scenario | Result / evidence |
|---|---|
| order update persists cf_ values and refreshes the list projection | PASS; `native-results.json` |
| quote update persists cf_ values and refreshes the list projection | PASS; `native-results.json` |
| refuses to undo an order update once a shipment, payment and note were added after it | PASS; `native-results.json` |
| refuses to undo an order update on an order with a return instead of partially wiping it | PASS; `native-results.json` |
| still undoes an order update when nothing changed on the order afterwards | PASS; `native-results.json` |
| refuses to undo an order update once a payment on the order was edited afterwards | PASS; `native-results.json` |
| refuses to undo a bulk line batch once a payment was added after it | PASS; `native-results.json` |
| still undoes a bulk line batch when nothing changed on the order afterwards | PASS; `native-results.json` |
| refuses to undo a quote update once a note was added to the quote afterwards | PASS; `native-results.json` |
| refuses to undo a quote conversion once the created order was shipped | PASS; `native-results.json` |
| undoes two consecutive order updates on an order with a payment | PASS; `native-results.json` |
| a rejected organization selection refuses every batch operation for admin (#8015) | PASS; `native-results.json` |
| a rejected organization selection refuses every batch operation for superadmin (#8015) | PASS; `native-results.json` |
| a rejected organization selection refuses every batch operation for employee (#8015) | PASS; `native-results.json` |
| All organizations refuses both write routes without changing lines or totals (#6458) | PASS; `native-results.json` |
| one batch reaches the same end state as the per-line sequence it replaces | PASS; `native-results.json` |
| a refused entry aborts the whole batch and writes nothing | PASS; `native-results.json` |
| undoing a batch restores the prior line set | PASS; `native-results.json` |

Artifacts: `/home/pkarw/Projects/mercato-development/.ai/cezar/dispatch/a07e1f63-2656-4ccf-8d2c-35345a06d172/units/b5ce1395/evidence/pr-8050-qa/latest-main-local-7d7d577dae8f`. Full script/results/screenshots/native logs and SHA256 manifest remain recoverable locally. Previous pre-merge evidence is retained separately; this report supersedes its current-head QA disposition.

Fresh production app built from this exact local latest-main merge; cold and warm database-authenticated readiness passed.
Native tests retain all existing assertions and cleanup. No tests, retries, timeouts or checks weakened.
Published-head GitHub CI is historical relative to this unpublished merge. New-head remote CI requires Guard-authorized publication, unavailable in this scheduled run. No shared/evidence pushes or merges.
Evidence-only PASS grants no human QA approval. Independent review and existing QA/decision gates remain.
Performance is not benchmarked. Existing shared mobile-width/ancillary loading limits are visible in scoped UI screenshots and are not certified fixed.
No changed rendering surface; real API/Postgres is the closest observable. Mid-transaction injected flush failure and event timing are unit-level observables; local3suites/58tests pass. No editor/browser UI claim.
