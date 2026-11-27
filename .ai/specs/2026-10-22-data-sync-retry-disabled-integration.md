# Data Sync — retry refuses a disabled integration

**Status:** implemented in the PR that fixes #7766
**Module:** `packages/core/src/modules/data_sync`
**Related:**
`.ai/specs/2026-09-16-data-sync-retry-resume-actions.md` (§ `POST /api/data_sync/runs/[id]/retry`),
`.ai/specs/2026-09-02-data-sync-adapter-start-controls.md` (§ `POST /api/data_sync/run`),
`UPGRADE_NOTES.md` → 0.9.0 → 0.9.1 → "Retrying a data sync run refuses a disabled integration"

## TLDR

`POST /api/data_sync/runs/:id/retry` now answers
`409 { "error": "Integration is disabled", "code": "integrationDisabled" }` when the run's integration
is disabled for the caller's tenant and organization. Before, it answered `201` and queued a new run.
This is a status-code change on a documented API route, so it is recorded here with its migration
path. The route URL, request schema, success response, events, ACL features, DI names and database
schema do not change.

## Problem Statement

The three generic ways to start a sync run disagreed about a disabled integration:

| Path | Disabled integration |
|---|---|
| `POST /api/data_sync/run` | `409 { "error": "Integration is disabled" }` |
| Scheduled sync worker | skipped |
| `POST /api/data_sync/runs/:id/retry` | `201`, new `sync_runs` row, queue job and progress job |

An operator could therefore restart an integration that the rest of the system treats as off by
retrying one of its failed or cancelled runs.

## Proposed Solution

The retry route resolves `integrationStateService` and refuses when
`isEnabled(previous.integrationId, { organizationId, tenantId })` is `false`. The check runs after
the existing "run not found" (`404`) and "only failed or cancelled runs" (`409`) checks and before the
overlap check and the mutation guard — the same order as the run route — so a refused retry creates
no run, queue job or progress job and never reaches the mutation guard.

`isEnabled` keeps its existing semantics, which decide who is affected:

- an integration with a state row for the organization uses that row's `isEnabled`;
- a registered integration with no state row uses its definition's `defaultState.isEnabled`, and is
  disabled when the definition declares none;
- an integration id that is no longer registered and has no state row is disabled.

The UI maps the new `code` through `buildRetryFailureMessage`, so all four retry actions (run detail
and dashboard row, each with Retry and Retry from the beginning) show "The integration is disabled.
Enable it before retrying this run." instead of the generic retry failure.

## API Contracts

### `POST /api/data_sync/runs/[id]/retry`

| Case | Before | After |
|---|---|---|
| Run not found in scope | `404` | `404` (unchanged) |
| Run not failed or cancelled | `409` | `409` (unchanged) |
| Integration disabled for the caller's organization | `201 { id, progressJobId }` | `409 { "error": "Integration is disabled", "code": "integrationDisabled" }` |
| Integration enabled | `201 { id, progressJobId }` | `201 { id, progressJobId }` (unchanged) |

`error` is translated server-side like the route's other translated errors; clients branch on
`code`, which is stable. `code` follows the route's existing `parametersStale` refusal.

### `POST /api/data_sync/run` — unchanged

Already refuses a disabled integration with `409` and the same `error` text.

## Migration & Backward Compatibility

**Contract surface:** API routes (`BACKWARD_COMPATIBILITY.md` §7). The URL, request schema and
success response shape are unchanged. One input that used to succeed now fails: a retry while the
integration is disabled answers `409` instead of `201`. The `409` body adds a `code` field.

**Why no deprecation window:** the old answer contradicted the run endpoint and the scheduler, which
already refuse a disabled integration; keeping it would keep a way to start work on an integration
the operator switched off. There is no old behaviour to bridge to — the only way to keep it is to
enable the integration, which is the migration below.

**Who is affected:** a client that retries runs of an integration while it is disabled, including a
provider-owned integration an operator explicitly disabled (for example `sync_excel`) and an
integration id that is no longer registered and has no enabled state row. A client that only retries
runs of enabled integrations sees no change.

**Client migration:**

1. Enable the integration for the organization (the integration detail page, or
   `PUT /api/integrations/:id/state` with `isEnabled: true`) before retrying the run.
2. Treat `409` with `code: "integrationDisabled"` on retry as "enable first", not as a transient
   failure — retrying again without enabling returns the same `409`.
3. Branch on `code`, not on the `error` text, which is localized.

**Rollback:** reverting the route change restores `201` for a disabled integration. No data
migration exists to undo; refused retries created no rows.

**Documentation:** `UPGRADE_NOTES.md` (0.9.0 → 0.9.1),
`apps/docs/docs/api/integrations-data-sync.mdx` (retry response), data_sync `AGENTS.md`.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A script retries runs of a disabled integration and now fails | Low | Documented `code` and migration step; same behaviour as the run endpoint | The script must enable the integration first |
| Synthetic integration ids in tests now resolve disabled | Low | TC-DS-013 seeds an enabled state row and removes it in `finally` | None |
| Operators still see the Retry button while disabled | Low | Translated refusal message explains the next step | Button visibility unchanged (non-goal) |

## Non-goals

- Hiding the Retry button for a disabled integration.
- Adding an "integration enabled" check to provider-specific start routes outside the generic
  run/retry/scheduler paths (tracked separately in #7768).

## Testing

- Unit `api/runs/[id]/__tests__/retry-integration-state.test.ts`: failed and cancelled runs while
  disabled answer `409` with `code`, create no run and never reach the overlap lookup or mutation
  guard; enabled answers `201`.
- Unit `buildRetryFailureMessage` maps `integrationDisabled` to the translated message.
- Integration TC-DS-015 (API): disabled → `409` + `code`, no new run; enabled → `201`.
- Integration TC-DS-015 (UI): run detail Retry shows the translated message and stays on the run.

## Changelog

- 2026-10-22: Recorded the retry refusal and its client migration.
