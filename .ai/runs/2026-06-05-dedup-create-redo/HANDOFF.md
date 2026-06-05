# Handoff — dedup create/redo refactor (PR #2552)

**Spec:** `.ai/specs/2026-06-05-dedup-create-redo-handlers.md`
**Plan:** `.ai/runs/2026-06-05-dedup-create-redo/PLAN.md`
**Branch:** `fix/issue-2506-redo-create-keep-id` · **PR:** #2552 · **Issue:** #2506
**Last verified:** `yarn typecheck` ✓ (21/21), shared unit tests ✓ (1162). Integration suite NOT yet re-run (needs live ephemeral app).

## Resume in a fresh session

```
/auto-continue-pr 2552
```
Reads PLAN.md, resumes from the first unchecked step. This handoff is the narrative; PLAN.md is the checklist source of truth.

## What this refactor does

Removes the create↔redo code duplication introduced by PR #2552, with **zero behavior change**, using two patterns:
1. **Snapshot-as-seed** (single-row): the after-snapshot doubles as the create seed, so `redo` stops re-enumerating fields. Enabled by the framework change in `packages/shared/src/lib/commands/redo.ts` (`makeCreateRedo` now has optional `seedFromSnapshot`/`getSnapshotId`, a `dateFields` option, and `reviveSnapshotSeed`/`serializeRowSnapshot` helpers).
2. **Shared materializer** (multi-row): one `buildXGraph(em, values)` called by BOTH `execute` and `redo` so the entity-graph field mapping lives once. Reference: `customers/commands/people.ts` → `buildPersonGraph`.

## Done (committed + pushed)

| Commit | Scope |
|--------|-------|
| `74219116d` | Framework: snapshot-as-seed support in `makeCreateRedo` + unit tests (`packages/shared/.../redo.ts`, `__tests__/redo.test.ts`) |
| `5e81e2454` | Single-row A: `currencies.currencies`, `currencies.exchange_rates` |
| `319676f23` | Multi-row: `customers.people` → `buildPersonGraph` (execute + redo) |
| `145061e7f` | Single-row A: `catalog.priceKinds`, `catalog.optionSchemas`, `staff.teams`, `staff.team-roles` |
| `579711fe2` | Single-row factory: `customers.tags`, `customers.labels` |
| `5f67773ff` | Multi-row: `customers.interactions` → `buildInteractionGraph` |

Net: duplicated mapping removed across **10 commands** + framework (additive/BC-safe).

## Verification (this session)
- `yarn build:packages` ✓ · `yarn generate` ✓ · `yarn typecheck` ✓ (21/21)
- Unit tests ✓ — **core 5428**, **shared 1162** (enterprise had a flaky worker-exit; green on re-run)
- `yarn lint` — app-level ESLint rule-loading crash is **pre-existing/environmental** (`react/no-direct-mutation-state` plugin vs ESLint version); unrelated to the core/shared changes here.
- Integration specs (TC-CUR-REDO-409 / TC-UNDO-003 / TC-UNDO-004) — NOT re-run (need live ephemeral app).

## Safe ceiling reached
Every remaining create command was evaluated and **intentionally left as-is** because the current `makeCreateRedo` cannot preserve its behavior, OR it already factors redo via a seed helper (no duplication to remove):
- Already factored (no dup): `catalog.products`, `catalog.variants`, `staff.team-members`, `staff.timesheets-projects`, `staff.timesheets-entries`, `staff.leave-requests`.
- Genuinely different execute-vs-redo logic: `sales.returns` (recompute-vs-snapshot + find-or-create header), `customers.companies` (create interleaved with surviving-row update).
- Non-1:1 seeds (cloneJson / mergeProviderSettings / fresh ts / non-column `custom` key): `sales.configuration` (×5), `planner.availability-rule-sets`, `scheduler.jobs`.
- Factory-capability blockers (see below): `customers.dictionaries`, `customers.comments`, `customers.addresses`, `customers.entity-roles`, `customers.activities` (deprecated bridge), `resources.comments`, `resources.resource-types`.

To go further requires the factory enhancements listed next.

## Decision rule used (apply for remaining work)

- **Option A (snapshot-as-seed):** use when the after-snapshot keys map 1:1 to entity property names and the only transform is date revival. Drop the `seedFromSnapshot` function; add `dateFields` for date columns beyond `createdAt/updatedAt/deletedAt`. STRONGLY preferred for single-row (net code reduction).
- **Option B (shared materializer):** use for multi-row creates, or single-row with genuine relation-FK remap. Do NOT use Option B for trivial single-row — it adds a third field enumeration (net increase).
- **Leave original:** if neither is safely behavior-preserving. A kept hand-rolled redo is no worse than the current PR; the spec explicitly permits this.

## Remaining work (not yet done)

### Phase 2.4 — existing `makeCreateRedo` single-row, not yet visited
- `sales/commands/configuration.ts` (channel, deliveryWindow, shippingMethod, paymentMethod, taxRate) — seeds use `cloneJson`, `mergeProviderSettings`, fresh `new Date()` timestamps, conditional `startsAt/endsAt`. Mostly Option B or leave; evaluate each.
- `planner/commands/availability-rule-sets.ts` — inline seed; check 1:1.
- `scheduler/commands/jobs.ts` — check 1:1.

### Phase 3 — hand-rolled single-row create redos
Convert to `makeCreateRedo` where clean (like tags). Already evaluated as **NOT safely convertible** (left as-is, reasons noted):
- `customers.dictionaries` (create is an upsert; redo emits no `created` side effects, returns a mode).
- `customers.comments`, `customers.addresses`, `resources.comments` (pre-create relation existence validation that throws 404; `withAtomicFlush` transaction).
- `customers.entity-roles` (encrypted entity → `findOneWithDecryption`; nested snapshot id; extended result shape).
- `customers.activities` (deprecated bridge delegating to `customers.interactions` redo).
- `resources.resource-types` (custom-field restore reads `payload.customAfter`, which the factory's `afterRestore` does not receive).

Not yet evaluated: `customers.todos`, `customers.personCompanyLinks`, `customers.deals` (multi-entity → likely Phase 4), `resources.activities`, `resources.resources`, `resources.tag-assignments`, `staff.activities`, `staff.addresses`, `staff.comments`, `staff.job-histories`, `staff.tag-assignments`, `sales.notes`, `sales.payments`, `sales.shipments`, `directory.organizations`, `feature_toggles.global`, `planner.availability`.

### Phase 4 — multi-row materializer (biggest remaining duplication)
`customers.companies`, `customers.interactions`, `catalog.products`, `catalog.variants`, `sales.returns`, `staff.team-members`. Follow the `buildPersonGraph` pattern.

## Factory limitations discovered (candidate follow-up enhancements)

These block converting several hand-rolled redos; enhancing `makeCreateRedo` would unlock them:
1. `afterRestore` receives `{ em, ctx, entity, snapshot }` only — NOT `logEntry`/full undo payload. Custom-field restore that reads `payload.customAfter` can't run. → pass `logEntry` to `afterRestore`.
2. Internal find uses plain `em.findOne`, not `findOneWithDecryption` — encrypted entities can't use the factory. → optional `findRow` override.
3. No pre-create relation existence/scope validation hook (handlers that `requireX(...)` + throw 404 before create). → optional `beforeRestore`/validate hook.
4. No transaction-wrapping option for the restore flush.

## Verification still owed before marking PR complete
- `yarn build:packages`, `yarn generate`, `yarn typecheck` ✓ (typecheck currently green), `yarn lint`, `yarn i18n:check-sync`/`usage`, `yarn test`.
- Integration specs (need live ephemeral app): `currencies/__integration__/TC-CUR-REDO-409.spec.ts`, `customers/__integration__/TC-UNDO-003-redo-keeps-id.spec.ts`, `customers/__integration__/TC-UNDO-004-bridge-undo.spec.ts`.
- Merge conflict with `develop` was already resolved earlier in this branch (returns.ts import merge).
