# Insights — Agent Guidelines

Explains why a record value is what it is ("Why?") from audit history plus the causation recorded on `action_logs`. Spec: `.ai/specs/2026-10-08-insights-causation-and-explain.md`. Design rule: a false cause is worse than "unknown".

## Always

- Contribute explain support from the OWNING module via `insights.explain.ts` (`defineExplainConfig({ version: 1, ... })` from `@open-mercato/shared/modules/insights/explain`), then run `yarn generate`. Never hardcode another module's records in insights.
- `loadCurrent`, cause resolvers and reference resolvers MUST scope by `ctx.scope.tenantId` and `ctx.scope.organizationIds` in the `where` (null = tenant-wide, [] = nothing) and use decryption helpers; use `@open-mercato/shared/modules/insights/helpers`.
- Return `null` from `loadCurrent` for anything the caller may not see; the route answers an identical `{ "error": "not_found" }`.
- Keep the engine (`lib/engine/*`) pure: inject the clock, no I/O. Add unit tests for every verdict/confidence change.
- Read history only through `ActionLogService.findFieldHistory` / `findHistoryEntryById` / `findLogScopes` (tenant + organization scoped, decrypted, keyset `(created_at, id)`).
- Gate features with `rbacService.userHasAllFeatures` (wildcard-aware) through `createExplainFeatureChecker`; never compare feature arrays by hand. Once a record (or audit entry) is loaded, bind every check to its organization (`createExplainFeatureChecker(rbac, viewer, { organizationId })`).
- Declare a non-empty `requiredFeatures` on every resource and cause/reference resolver (the registry skips declarations without one). Declare `itemResourceKinds` on a collection only when its items write their own audit rows; other child rows never enter the scan.

## Never

- Never emit snapshot values for undeclared keys, past values of others without `audit_logs.view_tenant`, or actor identities of others without it.
- Never mark an entry `proven` without cause columns AND a per-field consistent value; legacy rows (`cause_kind IS NULL`) stay `inferred`.
- Never report a gap when one side lacks the declared path (that is `inferred`, not `unlogged_change`).
- Never treat an undo trace's value before the undo as evidence: it is copied from the undone entry (`source: 'synthesized'`).
- Never reveal whether a referenced log exists: an out-of-scope `caused_by_log_id` is presented exactly like a missing one.
- Never cache `/api/insights/explain*` responses (viewer-redacted, must be fresh).

## Map

| Path | Purpose |
|------|---------|
| `generators.ts`, `lib/explain-registry.ts` | `insights.explain.ts` plugin → `insights-explain.generated.ts` → globalThis registry (duplicates: first wins, logged) |
| `lib/engine/*` | Paths, normalization, chain, gaps, verdicts, confidence, summaries (i18n keys only) |
| `lib/viewer.ts`, `lib/presenter.ts`, `lib/causes.ts` | Scope (D10), visibility matrix, cause/reference resolution with feature + organization checks |
| `services/explainService.ts` | DI `explainService`: `explain`, `describe`, `explainLog` |
| `api/explain/**` | `GET /api/insights/explain`, `/descriptors`, `/log` |
| `cli.ts` | `mercato insights explain:coverage [--tenant] [--org] [--since] [--limit]` |

Verdict semantics: the current value is compared only on the first page (`page.continuation` marks later pages); `OM_INSIGHTS_EXPLAIN_SCAN_MAX` (default 500) bounds rows per request and `truncated` caps confidence at `inferred`.

## Validation

```bash
yarn workspace @open-mercato/core test -- src/modules/insights src/modules/audit_logs
yarn workspace @open-mercato/core typecheck
yarn generate
```
