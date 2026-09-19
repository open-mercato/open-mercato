# Notify — 2026-09-19-pluggable-tax-providers

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-19T07:30:00Z — run started
- Brief: implement the spec `.ai/specs/2026-09-19-pluggable-tax-providers.md` (pluggable tax providers for sales documents), all six phases.
- External skill URLs: none.
- Engine: om-auto-create-pr-loop (steps: 36, --loop: no) — routed by the step threshold of 20.
- Decision: every Step runs `inline`. The phases share one evolving contract, so executor subagents would each re-derive it and risk divergent shapes.
- Decision: the implementation branch forks the task branch, which already carries the spec commit `3afccb3` that spec PR #3 also carries. The spec file is therefore visible in this PR's diff until #3 merges; it is not re-edited here.

## 2026-09-19T09:05:00Z — run resumed, scope amended by the owner
- Resumed through `om-auto-implement-spec 3` → `om-auto-continue-pr-loop 4` (PR #4 carries a `Tracking run folder:` line, so the loop continue engine applies; the step count was not re-applied).
- Owner scope decision: MVP is Phases 1, 2, 3, 4 and 6, in that order. **Phase 5 (commit/adjust/void lifecycle: transaction events, the persistent subscriber, `sales.tax_transaction.record`, undo void) is deferred and MUST NOT be implemented.** Steps 5.1-5.5 flipped from `todo` to `deferred` in PLAN.md.
- The optional `commit`, `adjust` and `void` methods and the `capabilities` block stay in the `TaxProvider` type only (landed in Step 1.1, `lib/providers/types.ts:333-355`); nothing calls them in this run.
- Owner instruction: the implementation PR stays a **draft** against `develop`. No merge, no deploy, no package publish.
- Corrected the Step 1.2 `Commit` cell from the placeholder `pending` to `ed37ac8a9`.
- Resume point: Step 1.3 (TaxInfo and result schemas).

## 2026-09-19T10:20:00Z — spec delta recorded (Step 1.5)
- **Delta from the spec's `TaxRequestLine` / `TaxRequestCharge` tables:** two additive fields on each — `amountGross` and `taxAmount` (plus `amountGross` on the charge). The spec's own field list could not support its own central guarantee: `table-rates` is required to be "an identity over the engine's line math", but from `amountNet` and `taxRate` alone it cannot reproduce a line that carried an explicit `taxAmount` (`lib/calculations.ts:164-167`) or one whose tax came from the gross/net delta heuristic (`:177-180`). Passing the engine's own per line figure makes the identity exact instead of approximate, and it is information a real engine wants anyway (Saleor's `TaxableObject` and commercetools' external rates both carry the current tax).
- Second, smaller delta: `table-rates` emits no jurisdiction detail row for a zero-tax line. A table rate carries no jurisdiction identity, so such a row would say nothing; the spec's TC-SALES-TAX-001 assertion (one breakdown entry per line) still holds for lines that actually carry a rate.
- Both deltas are additive to types that have not shipped; nothing outside this branch depends on them. They are called out in the PR body.

## 2026-09-19T11:05:00Z — checkpoint 1, phase 1 closed
- Steps 1.3 to 1.8 landed, one commit each. `checkpoint-1-checks.md` records the targeted gate.
- Green: `yarn build:packages`, `yarn generate` (no drift), `yarn i18n:check-sync`, `yarn i18n:check-usage` (advisory), `yarn typecheck`, and 116 sales suites / 897 tests.
- Pre-existing failures found and attributed, not caused here: 5 tests in `@open-mercato/cli` (`resolve-environment.test.ts`, `resolver.enterprise.test.ts`). Reproduced on `origin/develop` in this same worktree; this branch touches no file under `packages/cli`.
- Decision: the catalog product-facts read is lazy, off by default for `table-rates`. Without it every one of the eighteen recalculation sites would pay a catalog query per write, and two of the four return sites run inside an open transaction. The built in default consumes no product fact, so the common path adds no query at all.
- UI verification skipped this checkpoint: phase 1 changes no `.tsx`, no component, no route. First UI surface is Step 2.7.
- Integration tests not run this checkpoint: the first acceptance spec lands in Step 2.8.
- Runner recorded: local (`yarn X`); no compose `app` container is running.

## 2026-09-19T13:40:00Z — phase 2 closed; database-level verification of the migration
- Steps 2.1 to 2.8 landed. Phase 2 is complete: columns and migration, persistence, snapshots and undo, invoice and credit memo inheritance, API exposure, the recalculate command and route, the detail page tax section, the lifecycle tax block and TC-SALES-TAX-001.
- **The migration was verified against a real empty database**, not just asserted. Took `omw up --fresh` (sanctioned for a migration-adding task), then completed the provisioning the tool left unfinished: `yarn db:migrate` + `yarn initialize` against the task's own isolated `om_task1` database. Never the shared instance database.
  - `information_schema.columns` reports all **20** new columns across the four `sales_*` document tables (3 on orders, 4 on quotes, 5 on invoices, 5 on credit memos), matching the per table asymmetry exactly.
  - `pg_indexes` reports all **4** partial `*_tax_transaction_ref_idx` indexes.
  - `yarn initialize` then completed on the migrated schema, so the migration does not break a first run.
- **Integration tests and UI screenshots could NOT be captured in this worktree.** `omw up --fresh` reported "ready in 5s" but left the database empty and did not wire `apps/mercato/.env` to it; after completing the migration and initialization by hand, the running dev server still could not authenticate the seeded admin (the encrypted `users.email` values do not match the key the running process holds). This is worktree provisioning, not the change: the change's own unit, typecheck and build coverage is green, and the migration was verified directly against Postgres. Noted on the PR rather than silently skipped.
- `apps/mercato/.env` was temporarily pointed at the isolated database to run the migration and has been restored. It is gitignored and never staged.

## 2026-09-19T15:10:00Z — checkpoint 2, phases 2 and 3 closed
- Steps 2.1 to 3.7 landed, one commit each. `checkpoint-2-checks.md` records the targeted gate.
- Green: build:packages, generate (no drift), typecheck, i18n sync and hardcoded checks, 124 sales suites / 984 tests.
- Decision: `applyTaxColumns` leaves the columns alone for a calculation that ran no tax stage, rather than clearing them. A third party caller of `calculateDocumentTotals` produces exactly that, and wiping a previous provider's result would be a silent data loss.
- Decision: the quote to order conversion now carries the quote's whole tax result instead of resetting `taxStrategyKey`, which would have left an order holding a `tax_info` the key no longer names.
- Decision: `tax_info` is detail-only in the documents API projection, beside the other large JSONB snapshots, but still serializes as `null` on the grid path so the response key and its OpenAPI schema stay stable.
- Decision: the source-scan guards now assert relationships rather than fixed counts, so adding a recalculating command does not break them.
- Remaining in scope: Phase 4 (4.1-4.4) and Phase 6 (6.1-6.4). Phase 5 stays deferred.

## 2026-09-19T17:40:00Z — all in-scope steps complete, final gate passed
- Steps 4.1-4.4 and 6.1-6.4 landed. **All 31 implementable Steps are done**; Phase 5 stays deferred per the owner.
- Full configured gate run in order and recorded in `final-gate-checks.md`. `@open-mercato/core`: 1938 suites / 17,454 tests green. `yarn build:app` builds.
- The gate earned its keep: `yarn i18n:check-usage` caught a genuinely missing key in this branch (`sales.audit.documents.recalculateTax`, the recalculate command's audit label). Added in five locales; the check now reports zero missing.
- The only failing tests in the repo are the 5 pre-existing `@open-mercato/cli` environment tests, reproduced on `origin/develop`.
- Correction landed in Step 4.3 worth a reviewer's attention: `resolveCustomerSnapshot` was reading the customer with a plain `em.findOne`, writing ciphertext into the already-encrypted `customer_snapshot` column. It now uses `findOneWithDecryption`.
- Next: the `om-auto-review-pr` pass, then the summary comment. The PR stays a draft.

## 2026-09-19T18:20:00Z — review pass complete, run finished
- `om-auto-review-pr 4 --autofix` ran as a self-review (the automation authored the PR). Two findings, both fixed in `69ac7b046`.
- **Blocker found and fixed:** the tax stage derived a charge's id from the FILTERED adjustment index when building the request but the UNFILTERED index when applying the result. With a line-scoped adjustment ahead of an anonymous order-scoped one, the two disagreed and the provider's tax for that charge was silently discarded — no error, no message, no fallback status, just a short document. Both sides now read one map built once. The regression test was verified to fail against the pre-fix code before the fix was kept.
- **Minor found and fixed:** the `sales.providers.tax.*` keys were declared but unused, so built in provider names rendered as raw English in every locale on both the settings select and the document detail page.
- Labels applied: `review`, `feature`, `priority-medium`, `risk-high`, `needs-qa`. No `qa-approved` — that is a maintainer's to give. Rationale comment posted.
- PR body rewritten to state the delivered scope, the Phase 5 deferral, the compatibility position and both reasons it stays a draft. Spec PR #3 carries the idempotent implementation-PR link.
- The PR **remains a draft**, as the owner instructed and as the spec's Q7 assumptions guard requires.
