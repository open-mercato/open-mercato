# Checkpoint 11 — QA round-5 completion (steps 30.9–30.15 + develop merge)

**When:** 2026-06-02 (resume 4 — final)
**Commits:** fbedf4781 (#2409 planner), bdfbd6266 (merge develop), 9804986d1 (workflows), 153bb13f6 (webhooks), c40032a08 (data_sync), 557e22fa2 (dictionaries), 00ab27cac (perspectives), b44dcc437 (TC-LOCK-OSS-013)

## Merge with develop
- Resolved conflicts: `packages/core/package.json` (took develop's pdfjs-dist ^6.0.227 + kept resend ^6.12.3 — used by inbox_ops) and `yarn.lock` (took develop's + `yarn install --mode=update-lockfile`). All other files auto-merged. PR is MERGEABLE.

## Fixes landed (round-5 total = 14 commits)
Customer Users, Customer Roles, Organizations, Inbox Settings, #2410 selector, Feature Toggles Global, Pay Links+Checkout Templates, Sidebar Customization, #2409 planner, Workflow visual editor (client surfacing), Webhooks, Data Sync schedule, Dictionaries, Saved Views (perspectives).

## Not-applicable / already-protected (verified, no code)
- Integrations marketplace: stateless state endpoint, no DB updated_at → unlockable without architecture change.
- Notification Delivery: singleton settings blob (one row, POST upsert) → no per-record conflict.
- Scheduled Jobs: makeCrudRoute + CrudForm auto-derive → already enforced.
- Customers module config (PipelineSettings/DictionarySettings): already send headers (verified checkpoint-9).

## Deferred (documented, recommend follow-up issue)
- #2411 + System/User Entities defs: EAV definitions.manage(read)/definitions.batch(write) scope-asymmetry; locking should follow the scope fix.

## Verification (FULL)
- **Integration (live, ephemeral env, fresh DB + migrations):** `yarn mercato test:integration TC-LOCK-OSS` → **23/23 passed** (incl. new TC-LOCK-OSS-013 for the customer_accounts custom route). No regressions.
- **Unit (touched areas + guards):** 23 suites / **135 tests** green — customer_accounts, inbox_ops, feature_toggles, auth/sidebar, workflows, data_sync, dictionaries, perspectives + `optimistic-lock-ui-coverage` + `optimistic-lock-editable-entities`.
- **Webhooks unit:** 4/4.
- **Typecheck:** `turbo typecheck` @open-mercato/core + @open-mercato/ui clean.
- Each fix shipped as an atomic commit with a per-fix test and a per-issue PR comment to @alinadivante.
