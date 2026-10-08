# Insights — Agent Guidelines

Explains why a record value is what it is ("Why?") from audit history plus the causation recorded on `action_logs`, and projects declared processes into Process X-Ray tables. Specs: `.ai/specs/2026-10-08-insights-causation-and-explain.md`, `.ai/specs/2026-10-08-insights-process-xray.md`. Design rule: a false cause is worse than "unknown".

## Always

- Contribute explain support from the OWNING module via `insights.explain.ts` (`defineExplainConfig({ version: 1, ... })` from `@open-mercato/shared/modules/insights/explain`), then run `yarn generate`. Never hardcode another module's records in insights.
- `loadCurrent`, cause resolvers and reference resolvers MUST scope by `ctx.scope.tenantId` and `ctx.scope.organizationIds` in the `where` (null = tenant-wide, [] = nothing) and use decryption helpers; use `@open-mercato/shared/modules/insights/helpers`.
- Return `null` from `loadCurrent` for anything the caller may not see; the route answers an identical `{ "error": "not_found" }`.
- Keep the engine (`lib/engine/*`) pure: inject the clock, no I/O. Add unit tests for every verdict/confidence change.
- Read history only through `ActionLogService.findFieldHistory` / `findHistoryEntryById` / `findLogScopes` (tenant + organization scoped, decrypted, keyset `(created_at, id)`).
- Gate features with `rbacService.userHasAllFeatures` (wildcard-aware) through `createExplainFeatureChecker`; never compare feature arrays by hand. Once a record (or audit entry) is loaded, bind every check to its organization (`createExplainFeatureChecker(rbac, viewer, { organizationId })`).
- Declare a non-empty `requiredFeatures` on every resource and cause/reference resolver (the registry skips declarations without one). Declare `itemResourceKinds` on a collection only when its items write their own audit rows; other child rows never enter the scan.

- Contribute X-Ray processes from the OWNING module via `insights.process.ts` (`defineProcessConfig({ version: 1, ... })` from `@open-mercato/shared/modules/insights/process`); verify snapshot paths and change keys against the real command (`CommandBus` capture, see `customers/__tests__/insights.process.test.ts`). User ids go into `followupFields` with `valueKind: 'user'` (pseudonymized), never into stage or milestone fields.
- Write the projection only through `lib/projection/store.ts` under a lease (`acquireLease` → fenced `commit` → `releaseLease`); keep `lib/process/*` pure; read audit rows only through `ActionLogService.scanDecrypted` / `scanStateChanges`.
- Bump `PROCESS_DERIVATION_VERSION` (`lib/process/registry.ts`) when derivation rules change: it is part of every per-process contract hash, so each process clears and re-projects itself (`reconcileContracts` in `lib/projection/ingest.ts`; no manual rebuild). Use `compareCodeUnits`, never `localeCompare`, for anything that feeds a hash or a stored order.

## Never

- Never emit snapshot values for undeclared keys, past values of others without `audit_logs.view_tenant`, or actor identities of others without it.
- Never mark an entry `proven` without cause columns AND a per-field consistent value; legacy rows (`cause_kind IS NULL`) stay `inferred`.
- Never report a gap when one side lacks the declared path (that is `inferred`, not `unlogged_change`).
- Never treat an undo trace's value before the undo as evidence: it is copied from the undone entry (`source: 'synthesized'`).
- Never reveal whether a referenced log exists: an out-of-scope `caused_by_log_id` is presented exactly like a missing one.
- Never cache `/api/insights/explain*` responses (viewer-redacted, must be fresh).
- Never link a resolver `href` in the UI unless `isSafeInternalHref` accepts it, and never put record values or labels into the AI tool's summary text (they stay in `facts`; unsafe summary params are JSON-encoded).
- Never claim an automation selected a value when the selection is not recorded: a field provider comparing with a source (e.g. `sales.line_price` vs a catalog price row) reports equality or difference as `inferred` at most, and anything it cannot verify (missing or foreign source, currency mismatch) as `unverifiable`.
- Never register a field explain widget on a global `crud-form:*` pattern: list each form entity id declared in `formEntityIds` in `widgets/injection-table.ts` (header switch + `field:*:after`); `fieldExplainRegistration.test.ts` keeps both in sync.
- Never copy free text, encrypted fields or user ids in clear into `insights_process_*` (values are identifiers, `other`/`none`, or pseudonyms; only the erasure ledger keeps an erased user's id), never hand-roll the pseudonym crypto (`lib/projection/pseudonym.ts`; it never falls back to an unkeyed digest), never bypass the erasure ledger (`insights_process_erasures`, applied in every fenced commit), and never write projection rows outside a fenced transaction.
- Never re-implement ACL evaluation for access explanations: `RbacService.explainAccess` composes `loadAcl`, `resolveFeatureOrganizationAccess` and `authorizeFeatures`, and its decision must keep parity with `userHasAllFeatures` (covered by `auth/services/__tests__/rbacService.explainAccess.test.ts`).

## Map

| Path | Purpose |
|------|---------|
| `generators.ts`, `lib/explain-registry.ts` | `insights.explain.ts` plugin → `insights-explain.generated.ts` → globalThis registry (duplicates: first wins, logged) |
| `lib/engine/*` | Paths, normalization, chain, gaps, verdicts, confidence, summaries (i18n keys only) |
| `lib/viewer.ts`, `lib/presenter.ts`, `lib/causes.ts` | Scope (D10), visibility matrix, cause/reference resolution with feature + organization checks |
| `services/explainService.ts` | DI `explainService`: `explain`, `describe`, `explainLog` |
| `services/accessExplainService.ts` | DI `accessExplainService`: access explanations (ACL catalog validation, other-user gating, detail redaction, `rolesThatWouldGrant` only with `auth.roles.list`, recent ACL changes) over `RbacService.explainAccess` |
| `api/explain/**` | `GET /api/insights/explain`, `/descriptors`, `/log`, `/access` |
| `cli.ts` | `mercato insights explain:coverage [--tenant] [--org] [--since] [--limit]` |
| `lib/client/*` | Browser-side API helpers (`apiCall` + `AbortSignal`), session-cached descriptors (`useExplainDescriptors`, keyed by organization scope version), `useExplanation` (stale requests aborted, `nextBefore` paging), value/actor/date formatting, CrudForm field mapping (`fieldExplain.ts`: form entity id → resource via `formEntityIds`, field id → key / `currentPath` / `cf:<key>`), per-form explain mode (`explainMode.ts`, remembered in local storage), kill switch (`useFieldExplainEnabled`) |
| `components/*` | `WhyDrawer.client`, `WhyExplanation`, `WhyChain`, `CauseChip`, `ConfidenceBadge`, `VerdictBadge`, `LogCausePanel`, `AccessWhyPanel`, `WhyPage.client` (deep-link leaf) |
| `widgets/injection/*` | `record-why` (`backend:record:current`), `deal-status-why` (`detail:customers.deal:status-badges`), `log-cause` (`version-history:entry:after`), `access-why` (`backend:access-denied:after`), `field-explain-toggle` (`crud-form:<formEntityId>:header`) and `field-why` (`crud-form:<formEntityId>:field:*:after`) for the customers deal/person/company forms |
| `lib/fieldExplainToggle*.ts`, `setup.ts` | Kill switch `insights_field_explain` (default on), seeded from `seedDefaults` only when `feature_toggles` is registered in DI |
| `backend/insights/why/page.tsx` | Server page `/backend/insights/why?resourceKind=&resourceId=&field=&itemId=` rendering `WhyPage.client` |
| `ai-tools.ts`, `ai-tools/explain-pack.ts` | Read-only `insights.explain_record` (facts verbatim + deterministic i18n summary; not allowlisted for any agent) |
| `lib/process/*` | X-Ray: `insights.process.ts` registry (boot-time encryption guard, contract hash), pure activity derivation, value sanitizing/cap, case summary |
| `lib/projection/*` | X-Ray: store (CAS lease + fencing with lock timeout, erasure ledger + batched per-org erasure), per-process contract hashes (changed/added process → cleared + queued process-limited rebuild scan; removed → rows kept, filtered), windowed ingest/scan slices (single scan job chain), jobs (ingest, backfill, rebuild, prune, erasure), pinned pseudonym key, sanitized errors, settings, kill switch `insights_xray_ingest`, queues/schedule |
| `workers/xray-*.worker.ts`, `subscribers/xray-*.ts` | Queues `insights-xray-ingest` (2) / `insights-xray-backfill` (1, abandoned-job hook); GDPR erasure ledger on `auth.user.deleted`; ingest schedule on `directory.organization.created` |
| `api/xray/{status,settings,backfill}`, `commands/xray-settings.ts` | `insights.xray.manage` routes; `insights.xray.settings.save` (optimistic lock + CAS) |
| `cli.ts` (X-Ray) | `xray:status`, `xray:backfill [--inline]`, `xray:rebuild [--inline]`, `xray:prune` (`--tenant`, `--org`) |

Verdict semantics: the current value is compared only on the first page (`page.continuation` marks later pages); `OM_INSIGHTS_EXPLAIN_SCAN_MAX` (default 500) bounds rows per request and `truncated` caps confidence at `inferred`.

X-Ray Postgres suite (throwaway DB): `OM_INSIGHTS_XRAY_PG_URL=<url> npx jest src/modules/insights/lib/projection/__tests__/store.pg.test.ts` from `packages/core`.

## Validation

```bash
yarn workspace @open-mercato/core test -- src/modules/insights src/modules/audit_logs
yarn workspace @open-mercato/core typecheck
yarn generate
```
