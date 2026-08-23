# Background work, part 8 — operator surface for leased jobs

**Date**: 2026-08-21
**Status**: Draft v1.2 — implementation spec split out of part 4 v3 (Phase 3). Awaiting review. Depends on part 6 (DTO fields incl. `redrivable`, `stuck`, `mirrorAttempts`, `leaseOwner`, `leaseEpoch`, `nextRunAt`, the re-drive route and its three refusal codes, `progress.job.redriven`, `mirror_stuck`); nothing depends on it.
**Series**: [part 1](./2026-08-21-background-work-01-data-sync-problems.md) — `data_sync` problems (D-n) · [part 2](./2026-08-21-background-work-02-sibling-modules-problems.md) — sibling modules (Q/P/W/S/… ids) · [part 3](./2026-08-21-background-work-03-common-problems-and-requirements.md) — classes C-1…C-14, requirements R-A…R-M, open decisions Δ-1…Δ-11 · [part 4](./2026-08-21-background-work-04-solution.md) — options, decision, shared invariants · [part 5](./2026-08-21-background-work-05-queue-transport-contract.md) — queue transport contract · [part 6](./2026-08-21-background-work-06-leased-jobs-in-progress.md) — leased tier in `progress` · [part 7](./2026-08-21-background-work-07-data-sync-adoption.md) — `data_sync` adoption · [part 8](./2026-08-21-background-work-08-operator-surface.md) — operator surface.
**Scope of this spec**: the UI-only polish that makes the leased tier operable — filters for stuck/parked/unmirrored rows, bulk re-drive and cancel, the `data_sync` dashboard's live refresh, and Retry/Cancel affordances on runs. No schema, no service change, no new route beyond what part 6 ships.

## 📝 TLDR

Part 6 gives operators the facts (`parkedAt`, `errorCode`, `cancelRequestedAt`, `mirrorAttempts`, `leaseOwner`, `leaseEpoch`, `nextRunAt`, the server-derived `redrivable` and `stuck`, `mirror_stuck`, a re-drive route with three refusal codes and a `progress.job.redriven` event); this spec puts them where operators look: a "stuck" filter on the progress list, a "parked" badge and a Re-drive action in the detail view and as a bulk action, a `data_sync.run.*` client broadcast so the dashboard stops polling, and Retry/Cancel on a run row (D-26, R-K2/K3). **Re-drive is offered exactly where part 6 admits it**: every affordance below is enabled from the DTO's `redrivable` flag, which the server derives from the same predicate as the `redrive` statement, so the UI never offers a button the route will refuse with `not_redrivable`.

## 📝 Design

| Surface | Change | Backed by |
|---|---|---|
| `GET /api/progress/jobs` list (existing) | filter `state` ∈ {stuck, parked, cancelling, unmirrored} derived server-side: **parked** = `parked_at is not null`; **cancelling** = `cancel_requested_at` set and non-terminal; **unmirrored** = terminal ∧ `subject_type` set ∧ `domain_mirrored_at is null` (deferred kinds awaiting Q5); **stuck** = part 6's server-derived `stuck` — leased ∧ (`running` ∧ `lease_expires_at < now() − grace` ∧ (`next_run_at is null` ∨ `next_run_at < now() − grace`) ∨ `mirror_attempts >= maxMirrorAttempts`); the `next_run_at` clause is what keeps a slice awaiting its transport retry (`failSlice` released the lease, `next_run_at` minutes ahead) out of the list, exactly as Q1 ignores it. The same pass derives each row's `redrivable` from part 6 §3's predicate (leased ∧ kind registered in this process ∧ (`failed` ∨ `running` ∧ expired lease beyond grace ∧ `next_run_at` passed beyond grace)). Both derivations are the server's because the client sees neither the kind's `maxMirrorAttempts` nor the reconciler grace | part 6 DTO fields; no new column |
| Progress list page | filter chips for the four states; `StatusBadge` tokens `status-warning` (cancelling, stuck) / `status-danger` (parked, unmirrored); row action **Re-drive**, rendered only when `redrivable` (route ACL `progress.update` + kind features); **Cancel** as today (`progress.cancel`, no kind feature) | existing DataTable + `RowActions` |
| Progress detail | "parked — `errorCode`" alert (and "stuck — mirror failed `mirrorAttempts` times" when `stuck` is set and `mirrorAttempts > 0`; "stuck — lease expired" when `stuck` is set and it is not); Re-drive button when `redrivable`, Cancel when non-terminal; `leaseOwner`, `leaseEpoch` and `nextRunAt` ("retrying at …" while a transport backoff is pending) for support; a 409 from Re-drive is shown by its code: `lock_key_held` names the live operation (link), `domain_refused` explains that the domain record is gone, `not_redrivable` that the row changed under the operator (the list refetches) | existing detail sections |
| Bulk actions | Re-drive selected / Cancel selected via the existing bulk-operation pattern (`core:progress` + DataTable bulk guide): **one request per row, per-row outcomes, never all-or-nothing** — rows answering 409 are reported with their refusal code (`lock_key_held` / `not_redrivable` / `domain_refused`) in the operation's result list, the other rows proceed; selection of non-`redrivable` rows is allowed but those rows are skipped client-side and counted as "skipped" rather than sent | part 6 route |
| `data_sync` dashboard | `data_sync.run.*` events (incl. the new `data_sync.run.redriven`) gain `clientBroadcast: true`; the dashboard subscribes with `useAppEvent` and refetches on change instead of polling, so an operator who re-drives a run sees it move within one event | `events` DOM Event Bridge |
| `data_sync` run row | **Retry = re-drive the run's job** (same run id, same `lock_key`, cursor and counters preserved, audit via `progress.job.redriven.by`) — enabled from the run's job `redrivable`; starting a *new* run remains the existing "Run" action and is what an operator uses when Retry answers `domain_refused` or `lock_key_held`; Cancel; "cancelling" rendered from `cancelRequestedAt` | part 6 + part 7 `onRedrive` |

Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel. All strings via locale files. No hardcoded status colours — `{property}-status-{status}-{role}` tokens only.

## 📝 Backward compatibility review

| Surface | Change | Class |
|---|---|---|
| 5 event ids | `data_sync.run.*` gain `clientBroadcast` (payload unchanged); `data_sync.run.redriven` is defined in part 7 and only consumed here | ADDITIVE |
| 7 API routes | list filter param added; nothing removed | ADDITIVE |
| UI | new affordances only | — |

Rollback: revert the UI package; the list filter param is ignored by the previous server.

## 📋 Integration coverage (`.ai/qa/tests/`)

1. Progress list: a parked job appears under the "parked" filter, shows the badge, and Re-drive moves it to pending (assert via the API); a terminal failed (non-parked) job also shows Re-drive; a `completed` and a `cancelled` job do not (`redrivable: false`).
2. Bulk Re-drive on two parked jobs; bulk Cancel on two running jobs → both "cancelling".
2b. **Bulk Re-drive with a partial failure**: select one parked job, one parked job whose lock key is held by a live operation, and one completed job → the result lists one re-driven, one `lock_key_held` naming the live job, one skipped; the re-driven row is `pending`, the others unchanged.
3. `data_sync` dashboard updates within one event of a run transition without a page reload — including after a Retry (`data_sync.run.redriven`).
4. Run row Retry/Cancel: Retry on a parked run re-drives the *same* run (run id unchanged, `sync_runs.status` back to `running`); the cancelling state renders and resolves; Retry on a run whose `sync_runs` row was deleted shows the `domain_refused` message and offers "Run" instead.
5. Screenshots attached for QA (`needs-qa`): list with filters, detail with parked alert, dashboard live update.

## 📋 Implementation Plan

1. List filter param + server-side derivation; OpenAPI; tests.
2. List chips, badges, Re-drive row action; detail alert and buttons; i18n.
3. Bulk Re-drive / Cancel via the bulk-operation pattern with per-row outcomes (409 codes surfaced, non-`redrivable` rows skipped client-side).
4. `clientBroadcast` on `data_sync.run.*` (incl. `redriven`); dashboard subscription; run-row Retry (= re-drive the job) / Cancel.
5. QA tests above; screenshots.

## Changelog

- 2026-08-23 — Draft v1.2 after the third and fifth reviews (PR #5450). Fifth: "stuck" and `redrivable` honour `next_run_at` (a slice inside its transport backoff is neither), and both are read from part 6's DTO instead of re-derived client-side; the detail view's lease owner/epoch, "retrying at" and the stuck alert are backed by the DTO fields part 6 now adds (`leaseOwner`, `leaseEpoch`, `nextRunAt`, `stuck`); Cancel is labelled with its real ACL (`progress.cancel`). Third: every Re-drive/Retry affordance is gated on part 6's server-derived `redrivable` (same predicate as the `redrive` statement) instead of being offered unqualified; the four list states are defined in columns, "stuck" reads `mirror_attempts`; Retry on a run row is defined as re-driving the same job (a fresh run stays "Run"); bulk Re-drive specifies per-row outcomes with the three 409 codes and a QA case (2b) for the mixed result; the dashboard also refreshes on `data_sync.run.redriven`.

- 2026-08-22 — Draft v1: split out of part 4 v3 Phase 3 after review (PR #5450); adds the "unmirrored" state surfaced by part 6's terminal-transition protocol.
