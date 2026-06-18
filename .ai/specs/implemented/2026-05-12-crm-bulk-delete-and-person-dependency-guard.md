# CRM Bulk Delete UX + Person Delete Dependency Guard

## TLDR

CRM bulk delete on the People / Companies / Deals list pages used to run a tight `for` loop and surface only an aggregate "{n} of {total} … failed" toast — making it impossible for the user to see *why* particular rows could not be deleted (e.g. "linked deals"). It also pushed one undo entry per row into the operations banner, so undoing 50 deletions meant clicking Undo 50 times.

This change:

1. Extracts the per-row try/catch into a shared `runBulkDelete()` utility (`@open-mercato/ui/backend/utils/bulkDelete`) that returns `{ succeeded, failures }`, where each failure preserves the server's `error.message` and `error.code`.
2. Adds `groupBulkDeleteFailures()` so the page can render **one toast per failure code** (e.g. "3 companies could not be deleted: linked deals (2).") instead of a single opaque counter.
3. Adds `coalesceLastOperations(count, options)` on the `om:last-operations` store so the per-row entries pushed by individual `customers.*.delete` commands are merged into a single bulk entry whose `bulkUndoTokens[]` lets the banner Undo button replay every token in one click. `markUndoSuccess()` now accepts `string | string[]` so legacy single-token callers stay unchanged.
4. Adds a server-side dependency guard to `customers.people.delete` that mirrors the existing `customers.companies.delete` guard: if any `CustomerDealPersonLink` rows still reference the person, the command throws `CrudHttpError(422, { error, code: 'PERSON_HAS_DEPENDENTS' })` with a translated, count-aware message — instead of silently cascading through the link rows on the way to deleting the person. **This is a behavior change** for the `DELETE /api/customers/people?id=...` endpoint.

## Overview

CRM list pages (`packages/core/src/modules/customers/backend/customers/{companies,people,deals}/page.tsx`) all implement a bulk-delete affordance on the DataTable. Before this change, each page reimplemented the same try/catch loop and produced the same low-information UX. The bulk-delete failure surface is the most common place where users hit business-integrity errors (e.g. "this person is on an active deal"), so this is where the missing diagnostics hurt most.

In parallel, the operations banner (`packages/ui/src/backend/operations/LastOperationBanner.tsx`) is wired to the per-command audit-log entries. Each individual `customers.people.delete` command emits its own undo token, so a bulk delete naturally pushed N entries onto the stack and the user only saw the *last* row in the banner; the previous ones became reachable only via the full Last Operations history.

The person-delete guard closes an inconsistency between people and companies: the company delete already refuses with 422 + `COMPANY_HAS_DEPENDENTS` when dependents exist, but person delete silently swept dependent link rows and continued. This is risky for accidental deletes from the UI (no warning) and for AI agents (which call `customers.people.delete` directly via the Command bus).

## Problem Statement

- **Bulk failure UX is non-diagnostic.** Users get only "N of M people deleted; X failed" with no per-row reason. The server returns the reason on the per-row response but the loop discarded it.
- **Bulk Undo is N clicks.** The operations store assumes one entry per command. A bulk action pushes N entries, all interleaved with each other, all visible only after re-opening the full history.
- **Person delete is too permissive.** Compared with company delete, it silently deletes dependent link rows. There is no spec or `openApi.errors` declaration covering this divergence.

## Proposed Solution

### 1. Shared bulk-delete utility

New file: `packages/ui/src/backend/utils/bulkDelete.ts`.

```ts
export type BulkDeleteFailure = {
  id: string
  code: string | null
  message: string
}

export type BulkDeleteOutcome<T extends { id: string }> = {
  succeeded: T[]
  failures: BulkDeleteFailure[]
}

export async function runBulkDelete<T extends { id: string }>(
  rows: T[],
  deleteOne: (row: T) => Promise<void>,
  options?: { fallbackErrorMessage?: string },
): Promise<BulkDeleteOutcome<T>>
```

`runBulkDelete` preserves both the thrown `Error.message` and a string `code` if the thrown value exposes one (CRUD errors decode the server's `{ error, code }` body into the thrown `Error` via `apiCallOrThrow` / `deleteCrud`).

`groupBulkDeleteFailures(failures)` buckets failures by `code || message || 'unknown'` so the page can flash one toast per distinct reason. The bucket retains `sampleMessage` (the first message in the bucket); failures with the same code but message variations (e.g. counts) collapse — flagged in code as intentional.

### 2. Operations store: bulk coalesce

Two additions in `packages/ui/src/backend/operations/store.ts`:

- `OperationEntry` gains two optional fields: `bulkUndoTokens?: string[]` and `bulkCount?: number`. Both round-trip through `hydrateEntry` so persisted entries survive a page reload.
- `coalesceLastOperations(count, options)` replaces the last N entries on the stack with a single synthetic entry holding `bulkUndoTokens` (the ordered list of all per-row tokens). It refuses when the tail's `commandId`s don't all match `options.commandId`, so an interleaved sequence (e.g. user did one delete, then changed pages, then bulk-deleted) cannot coalesce across boundaries.

`markUndoSuccess(undoTokens: string | string[])` accepts both shapes. The single-token shape is the legacy contract. The array shape removes any stack entry whose `bulkUndoTokens` overlap the supplied set — i.e. it operates on whole bulk batches.

### 3. Banner replays per-token

`LastOperationBanner.handleUndo` now iterates `operation.bulkUndoTokens` (or `[operation.undoToken]` for non-bulk legacy entries) in reverse order, calling `POST /api/audit_logs/audit-logs/actions/undo` once per token. On full success it calls `markUndoSuccess(tokens)` and refreshes. On partial failure it records the completed tokens and flashes the server's error.

### 4. Person delete dependency guard

In `customers.people.delete.execute` (`packages/core/src/modules/customers/commands/people.ts`), before any `nativeDelete` runs:

```ts
const dealLinks = await em.count(CustomerDealPersonLink, { person: record })
if (dealLinks > 0) {
  const { translate } = await resolveTranslations()
  throw buildPersonHasDependentsError(translate, { dealLinks })
}
```

`buildPersonHasDependentsError` mirrors `buildCompanyHasDependentsError` and returns a `CrudHttpError(422, { error, code: 'PERSON_HAS_DEPENDENTS' })` with a count-aware, translated message. The translation falls back to the English string if the key is missing.

### 5. OpenAPI error declarations

The shared CRUD OpenAPI factory (`packages/shared/src/lib/openapi/crud.ts`) now forwards an optional `del.errors: OpenApiResponseDoc[]`. The customers `people` and `companies` routes declare the 422 / `PERSON_HAS_DEPENDENTS` and 422 / `COMPANY_HAS_DEPENDENTS` responses respectively, so the generated OpenAPI doc surfaces both as documented failure modes.

## Architecture

### Affected paths

| Path | Change |
|------|--------|
| `packages/ui/src/backend/utils/bulkDelete.ts` | New shared helper. |
| `packages/ui/src/backend/utils/__tests__/bulkDelete.test.ts` | Unit tests for outcome shape, fallback message, and code grouping. |
| `packages/ui/src/backend/operations/store.ts` | New `coalesceLastOperations`; `markUndoSuccess` signature widened to `string | string[]`; new optional `bulkUndoTokens` / `bulkCount` on `OperationEntry`. |
| `packages/ui/src/backend/operations/__tests__/store.test.ts` | New jsdom tests for coalesce + bulk-aware undo. |
| `packages/ui/src/backend/operations/LastOperationBanner.tsx` | Reverse-token iteration; partial-failure accounting. |
| `packages/core/src/modules/customers/commands/people.ts` | New `buildPersonHasDependentsError` + guard in `deletePersonCommand`. |
| `packages/core/src/modules/customers/commands/__tests__/deletePerson.test.ts` | Two cases: 422 path and no-blocker path. |
| `packages/core/src/modules/customers/backend/customers/{companies,people,deals}/page.tsx` | Bulk delete uses `runBulkDelete` + `coalesceLastOperations`; grouped failure flashes via `groupBulkDeleteFailures`. |
| `packages/core/src/modules/customers/api/{people,companies}/route.ts` | `openApi.del.errors` declares 422 + code. |
| `packages/core/src/modules/customers/i18n/{en,de,es,pl}.json` | New `…bulkDelete.operationLabel` and `customers.people.delete.{blocked,blockers.deals}` keys. |
| `packages/shared/src/lib/openapi/crud.ts` | `CrudDeleteConfig.errors?` added (additive, BC-safe). |

### Backward Compatibility (per `BACKWARD_COMPATIBILITY.md`)

- **Function signatures**: `markUndoSuccess(string)` → `markUndoSuccess(string | string[])` — widening; existing single-string callers unaffected.
- **Types**: `OperationEntry` gains optional fields only; persisted state from older versions hydrates correctly.
- **Convention files**: `CrudDeleteConfig` gains optional `errors`. No existing module is required to pass it.
- **API behavior**: `DELETE /api/customers/people` now returns 422 + `PERSON_HAS_DEPENDENTS` for previously-succeeding inputs. The success shape is unchanged; the URL, method, and request schema are unchanged. The new failure mode is declared in `openApi.errors`. Treated as a behavior change rather than a contract surface removal — disclosed in CHANGELOG and listed in "Migration & Backward Compatibility" below.

### Migration & Backward Compatibility

- **API callers** (third-party automation, AI agents, integrations) that delete a person with linked deals will now receive HTTP 422 with `code: 'PERSON_HAS_DEPENDENTS'`. To migrate: unlink or reassign the deals first (via `customers.deals.update` or by deleting the link directly), then re-issue the delete.
- **UI**: handled — `runBulkDelete` surfaces the 422 message in the per-failure toast.
- **Generated OpenAPI**: regenerated automatically by `yarn generate`; the 422 response is now documented for both `DELETE /api/customers/people` and `DELETE /api/customers/companies`.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|-----------|----------|
| External delete clients break on 422 | Medium | `DELETE /api/customers/people` consumers | CHANGELOG entry; openApi.errors; matches existing company-delete behavior so the parity message is "use the same flow you already use for companies". | Operators must communicate the change to integration owners. |
| Bulk undo partial failures move the entry to `undone` with the full token list, so a later redo replays never-undone tokens | Low | `LastOperationBanner` + audit-logs redo | The redo endpoint already rejects tokens that were never consumed; user sees error toast and refreshes. Improved partial-state tracking would require server-side batch undo. | Limited to the partial-failure path which is itself rare. |
| `groupBulkDeleteFailures` collapses code+different-message rows into one toast | Low | UX | Documented in code; group key chosen as `code || message` so missing-code groups keep per-message granularity. | Future: append "(+N more variations)" hint if it ever matters. |

## Final Compliance Report

- Architecture: bulk-delete utility lives in `@open-mercato/ui` (UI infra), grouping is pure data, store change is additive.
- Security: no new endpoints, no scope changes, tenant isolation unchanged (the new guard reads `CustomerDealPersonLink` keyed on the already tenant-scoped `record`).
- Naming: snake_case DB columns unchanged; camelCase identifiers; module/event/command IDs unchanged.
- Required exports: factory unchanged; routes still export `openApi` + `metadata`; commands still register through `registerCommand`.
- ACL: unchanged.
- i18n: 7 new keys across en/de/es/pl (3 `.bulkDelete.operationLabel` + 2 `customers.people.delete.*` blocker keys + … see PR diff). `yarn i18n:check-sync` and `yarn i18n:check-usage` both clean.
- Tests: 12 new UI tests (bulkDelete + store), 2 new command tests (deletePerson guard).
- Backward compatibility: see section above.

## Changelog

- 2026-05-12 — Initial spec, written retroactively to cover the bulk-delete UX refactor and the 422 `PERSON_HAS_DEPENDENTS` behavior change. *(@haxiorz)*
