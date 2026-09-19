# Checkpoint 2 — Phases 2 and 3 closed (Steps 2.1 to 3.7)

**Date:** 2026-09-19
**Steps landed this checkpoint:** 2.1–2.8, 3.1–3.7 (15 Steps)
**Runner:** local (`yarn X`). No compose `app` container is running.

## Targeted validation

| Command | Result |
|---|---|
| `yarn build:packages --cache-dir=/srv/om/cache/turbo` | ✅ 38/38 |
| `yarn generate` | ✅ clean, no drift |
| `yarn typecheck` (whole repo) | ✅ 38/38 |
| `yarn i18n:check-sync` | ✅ 5 locales in sync (60 new keys added this checkpoint) |
| `yarn i18n:check-hardcoded` | ✅ neither new component reports a hardcoded string |
| `yarn test` (`@open-mercato/core`, `modules/sales`) | ✅ **124 suites, 984 tests** |

## Database-level verification of the document migration

Not merely asserted. `omw up --fresh` (sanctioned for a migration-adding task) plus a hand-completed
`yarn db:migrate` + `yarn initialize` against this task's own isolated `om_task1` database — never
the shared instance database:

- `information_schema.columns`: all **20** new columns across the four `sales_*` document tables,
  matching the per table asymmetry (3 orders / 4 quotes / 5 invoices / 5 credit memos).
- `pg_indexes`: all **4** partial `*_tax_transaction_ref_idx` indexes.
- `yarn initialize` then completed on the migrated schema, so a first run is not broken.

## UI verification and integration tests

**Could not be captured in this worktree.** `omw up --fresh` reported ready but left the database
empty and did not wire `apps/mercato/.env` to it; after completing the migration and initialization
by hand, the running dev server still could not authenticate the seeded admin (the encrypted
`users.email` values do not match the key the running process holds). This is worktree provisioning,
not the change. Five Playwright acceptance specs ship with the branch and will run in CI:

| Spec | Proves |
|---|---|
| TC-SALES-TAX-001 | No amount moves under the default provider; provenance persisted; invoice inherits it |
| TC-SALES-TAX-002 | A selected provider replaces the table rate math; two jurisdictions in the breakdown |
| TC-SALES-TAX-003 | A throw and a timeout both degrade to an estimate, never a failed write; recalculation recovers |
| TC-SALES-TAX-004 | The selection is scoped, not global |
| TC-SALES-TAX-005 | The settings surface never carries a secret in either direction |

## What phases 2 and 3 establish

- Five provenance columns per document, written in the same atomic phase as the totals, carried
  through every snapshot and undo, and inherited onto invoices and credit memos.
- The fields exposed on every document API, with `tax_info` detail-only so a grid page does not
  fetch a blob per row.
- A recalculate command and route that re-runs the provider without touching a line or header field.
- A detail-page section that makes a fallback visible and offers the retry.
- Per organization selection with its own options, timeout and ship from address, read through a
  scope-keyed cache that degrades to the row whenever it is unavailable.
- Credentials resolved lazily through a closure and provably absent from serialized contexts, event
  payloads, stored documents and logs.
- Every fallback emitting `sales.tax.calculation.failed` and reporting under one error fingerprint.
