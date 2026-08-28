# Background work, part 8 — operator surface for leased jobs

**Date**: 2026-08-21
**Status**: Draft v1 — implementation spec split out of part 4 v3 (Phase 3). Awaiting review. Depends on part 6 (DTO fields, re-drive route, `mirror_stuck`); nothing depends on it.
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, open decisions Δ-1…Δ-11 · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, shared invariants · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport contract · [part 6](./2026-08-21-background-work-06-leased-jobs-in-progress.md) — leased tier in `progress` · [part 7](./2026-08-21-background-work-07-data-sync-adoption.md) — `data_sync` adoption · [part 8](./2026-08-21-background-work-08-operator-surface.md) — operator surface.
**Scope of this spec**: the UI-only polish that makes the leased tier operable — filters for stuck/parked/unmirrored rows, bulk re-drive and cancel, the `data_sync` dashboard's live refresh, and Retry/Cancel affordances on runs. No schema, no service change, no new route beyond what part 6 ships.

## 📝 TLDR

Part 6 gives operators the facts (`parkedAt`, `errorCode`, `cancelRequestedAt`, `mirror_stuck`, a re-drive route); this spec puts them where operators look: a "stuck" filter on the progress list, a "parked" badge and a Re-drive action in the detail view and as a bulk action, a `data_sync.run.*` client broadcast so the dashboard stops polling, and Retry/Cancel on a run row (D-26, R-K2/K3).

## 📝 Design

| Surface | Change | Backed by |
|---|---|---|
| `GET /api/progress/jobs` list (existing) | filter `state` ∈ {stuck, parked, cancelling, unmirrored} derived server-side from `parked_at`, `cancel_requested_at`, `domain_mirrored_at`, lease expiry | part 6 DTO fields; no new column |
| Progress list page | filter chips for the four states; `StatusBadge` tokens `status-warning` (cancelling, stuck) / `status-danger` (parked, unmirrored); row action **Re-drive** (`progress.update` + kind features) | existing DataTable + `RowActions` |
| Progress detail | "parked — `errorCode`" alert; Re-drive / Cancel buttons; last lease owner and epoch for support | existing detail sections |
| Bulk actions | Re-drive selected / Cancel selected via the existing bulk-operation pattern (`core:progress` + DataTable bulk guide) | part 6 route |
| `data_sync` dashboard | `data_sync.run.*` events gain `clientBroadcast: true`; the dashboard subscribes with `useAppEvent` and refetches on change instead of polling | `events` DOM Event Bridge |
| `data_sync` run row | Retry (re-drive the run's job) and Cancel affordances; "cancelling" rendered from `cancelRequestedAt` | part 6 |

Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel. All strings via locale files. No hardcoded status colours — `{property}-status-{status}-{role}` tokens only.

## 📝 Backward compatibility review

| Surface | Change | Class |
|---|---|---|
| 5 event ids | `data_sync.run.*` gain `clientBroadcast` (payload unchanged) | ADDITIVE |
| 7 API routes | list filter param added; nothing removed | ADDITIVE |
| UI | new affordances only | — |

Rollback: revert the UI package; the list filter param is ignored by the previous server.

## 📋 Integration coverage (`.ai/qa/tests/`)

1. Progress list: a parked job appears under the "parked" filter, shows the badge, and Re-drive moves it to pending (assert via the API).
2. Bulk Re-drive on two parked jobs; bulk Cancel on two running jobs → both "cancelling".
3. `data_sync` dashboard updates within one event of a run transition without a page reload.
4. Run row Retry/Cancel; the cancelling state renders and resolves.
5. Screenshots attached for QA (`needs-qa`): list with filters, detail with parked alert, dashboard live update.

## 📋 Implementation Plan

1. List filter param + server-side derivation; OpenAPI; tests.
2. List chips, badges, Re-drive row action; detail alert and buttons; i18n.
3. Bulk Re-drive / Cancel via the bulk-operation pattern.
4. `clientBroadcast` on `data_sync.run.*`; dashboard subscription; run-row Retry/Cancel.
5. QA tests above; screenshots.

## Changelog

- 2026-08-22 — Draft v1: split out of part 4 v3 Phase 3 after review (PR #5450); adds the "unmirrored" state surfaced by part 6's terminal-transition protocol.
