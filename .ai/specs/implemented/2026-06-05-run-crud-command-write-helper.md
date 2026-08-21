# runCrudCommandWrite — Unified Command-Write Helper

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | izqzmyli (rajan.bor@boringcode.pl) |
| **Co-Author** | Claude Opus 4.8 |
| **Created** | 2026-06-05 |
| **Related** | [#2598](https://github.com/open-mercato/open-mercato/issues/2598), [#2333](https://github.com/open-mercato/open-mercato/issues/2333), [#2596](https://github.com/open-mercato/open-mercato/issues/2596), [PR #2549](https://github.com/open-mercato/open-mercato/pull/2549), [SPEC-018 Atomic Phased Flush](./SPEC-018-2026-02-05-safe-entity-flush.md), [BACKWARD_COMPATIBILITY.md](../../BACKWARD_COMPATIBILITY.md), [packages/shared/AGENTS.md](../../packages/shared/AGENTS.md), [packages/core/AGENTS.md](../../packages/core/AGENTS.md) |

## TLDR
**Key Points:**
- Today command authors compose three independent helpers in a brittle, easy-to-miss order: fork `EntityManager` → `withAtomicFlush(...)` → `setCustomFieldsIfAny(...)` → `emitCrudSideEffects(...)`.
- Add `runCrudCommandWrite(...)` — a single BC-compatible helper in `packages/shared/src/lib/commands/` that owns the EM fork, the atomic-flush boundary, the custom-field write, and the side-effect queue, in the only correct sequence.
- Old helpers (`withAtomicFlush`, `setCustomFieldsIfAny`, `emitCrudSideEffects`) remain exported unchanged. The new helper composes them; it does not replace them.
- Migrate exactly one representative path (`customers.deals.update`) in the same change to prove the helper on a real command. No repo-wide rewrite.

**Scope:**
- New file `packages/shared/src/lib/commands/runCrudCommandWrite.ts` exporting `runCrudCommandWrite` and its option types.
- Re-export from `packages/shared/src/lib/commands/index.ts`.
- Migrate the `execute` path of `updateDealCommand` in `packages/core/src/modules/customers/commands/deals.ts` as the working example.
- Unit tests in `packages/shared/src/lib/commands/__tests__/runCrudCommandWrite.test.ts` covering the four acceptance criteria from #2598.
- Doc updates in `packages/shared/AGENTS.md` and `packages/core/src/modules/customers/AGENTS.md`.

**Concerns:**
- Side-effect queueing MUST happen strictly after the DB write phases commit AND the custom-field write resolves; if either earlier step throws, no `markOrmEntityChange` may be enqueued.
- Entities that are created inside a phase (e.g. `createDeal`) are not in scope at call time — the helper must accept a lazy resolver for the side-effect target so the caller can return a closure-captured entity.
- The helper MUST stay framework-side only: no domain types, no module-specific imports. It belongs to `@open-mercato/shared`.

## Overview
`packages/shared/src/lib/commands/` already exposes three independent primitives that, when composed in the wrong order or against the wrong `EntityManager` / `DataEngine`, lead to subtle data and observability bugs:

- `withAtomicFlush(em, phases, { transaction })` — phased scalar/relation mutations with one terminal flush, optionally wrapped in a transaction (SPEC-018).
- `setCustomFieldsIfAny({ dataEngine, entityId, recordId, tenantId, organizationId, values, notify })` — durable EAV write through `DataEngine.setCustomFields`.
- `emitCrudSideEffects({ dataEngine, action, entity, identifiers, events, indexer })` — queues a `markOrmEntityChange(...)` so the CommandBus flushes the index/event side-effects after the command completes.

Today every command repeats the boilerplate that wires these together. The review on PR #2549 surfaced that this composition is *too* easy to get subtly wrong:

- custom fields can be written on a `DataEngine` whose underlying `EntityManager` differs from the one the phases ran on,
- side effects can be queued before all write phases are truly complete,
- future command authors may not understand when to fork, flush, or join a transaction,
- the relationship between custom fields and `withAtomicFlush` is not visible at the call site.

This spec introduces a single high-level helper that makes the correct sequence the only ergonomic option, without removing the underlying primitives.

## Problem Statement
1. **Composition is convention, not contract.** Every command must remember the (1) fork, (2) flush, (3) custom fields, (4) side effects ordering. Nothing in the type system enforces it.
2. **Failure isolation is weak.** If a phase throws inside `withAtomicFlush`, the transaction rolls back — but if `setCustomFieldsIfAny` throws between the flush and the side-effect emit, the entity is already persisted *and* the index/event queue still fires from the next CommandBus tick because authors sometimes shuffle the order.
3. **`DataEngine` / `EntityManager` divergence.** Authors occasionally pass a stale `dataEngine` resolved before the fork, or fork a second EM in helper code, breaking the intent of "one consistent persistence boundary per command".
4. **High learning curve.** New contributors must read three module-specific reference files (`customers/commands/people.ts`, `deals.ts`, `companies.ts`) to learn the pattern.

## Proposed Solution
Add a single helper in `@open-mercato/shared/lib/commands/runCrudCommandWrite`:

```ts
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'

let deal!: CustomerDeal

await runCrudCommandWrite({
  ctx,
  entityId: 'customers:customer_deal',
  action: 'updated',
  scope: { tenantId: record.tenantId, organizationId: record.organizationId },
  customFields: custom,
  events: dealCrudEvents,
  indexer: dealCrudIndexer,
  phases: [
    async ({ em }) => {
      // scalar / relation mutations, calls to syncDealPeople(em, ...), etc.
    },
  ],
  sideEffect: () => ({
    entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
  }),
})
```

The helper owns, in order:

1. `EntityManager` selection — either uses the `em` the caller already forked, or forks a fresh one from `ctx.container.resolve('em')`.
2. `withAtomicFlush(em, phases, { transaction: true })` — phases run inside one transaction, with one terminal `em.flush()`.
3. `setCustomFieldsIfAny({ dataEngine, ... })` — runs ONLY after the phase flush has resolved successfully, on the same `DataEngine` instance resolved from `ctx.container`.
4. `emitCrudSideEffects({ dataEngine, action, entity, identifiers, events, indexer, syncOrigin })` — runs ONLY after the custom-field write resolves. Uses the entity returned by `sideEffect()` so callers can pass a closure-captured entity created inside a phase.

If any step throws, none of the later steps run. The transaction rollback already covers the phase failure case; for the custom-field failure case the side-effect emit is simply skipped (which is what we want — the index event would otherwise advertise a half-written record).

### Why `sideEffect` is a callback, not a value
`createDeal` creates the entity inside the first phase; at call time the entity reference does not yet exist. A callback evaluated *after* `withAtomicFlush` resolves lets callers return the closure-captured entity. For `update` paths the callback simply returns the entity loaded before the phases, but the callback shape is uniform.

### Why custom fields stay on `DataEngine`, not on the forked EM
`DataEngine.setCustomFields` already encapsulates the EAV write, validation, encryption, and event emission. The helper resolves the `DataEngine` from `ctx.container` once, after the phases commit, so caller and helper observe the same engine. There is no reason to push EAV writes through the forked phase EM — they go through the EAV table on the DataEngine's own EM, and the framework already guarantees that boundary is correct.

### Why we do not merge custom-field writes into the phase transaction
Custom fields are stored in their own EAV table via `DataEngine.setCustomFields`, which encapsulates validation, HTML sanitization, encryption, and (optionally) event emission. Pulling that path into the phase transaction would couple every command to internal DataEngine details and break BC for callers that pass custom fields without phases. Running it strictly after the phase transaction keeps the helper a thin sequencer.

## Architecture

```
+----------------------------+      +---------------------------------+
|  runCrudCommandWrite       |      | Existing primitives (unchanged) |
+----------------------------+      +---------------------------------+
| 1. Fork EM                 |--->  | ctx.container.resolve('em').fork|
| 2. Run phases + atomic     |--->  | withAtomicFlush(em, phases,     |
|    flush in transaction    |      |   { transaction: true })        |
| 3. Resolve DataEngine      |--->  | ctx.container.resolve('dataEngine')
| 4. Custom-field write      |--->  | setCustomFieldsIfAny(...)       |
| 5. Side-effect queue       |--->  | emitCrudSideEffects(...)        |
+----------------------------+      +---------------------------------+
```

Strict await ordering between steps 2, 4, and 5 enforces the failure contract: a thrown error short-circuits all later steps.

## Data Models
No data-model changes. The helper is pure orchestration.

## API Contracts
No HTTP/API contract changes. This is a framework-side helper consumed only by command implementations.

### TypeScript shape

```ts
// packages/shared/src/lib/commands/runCrudCommandWrite.ts
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type {
  CrudEventAction,
  CrudEventsConfig,
  CrudIndexerConfig,
  CrudEntityIdentifiers,
} from '@open-mercato/shared/lib/crud/types'

export type CrudCommandWritePhase = (args: { em: EntityManager }) => void | Promise<void>

export type CrudCommandWriteSideEffectTarget<TEntity> = {
  entity: TEntity
  identifiers: CrudEntityIdentifiers
}

export type CrudCommandWriteScope = {
  tenantId: string | null
  organizationId: string | null
}

export type RunCrudCommandWriteOptions<TEntity> = {
  ctx: CommandRuntimeContext
  entityId: string
  action: CrudEventAction
  scope: CrudCommandWriteScope
  phases: CrudCommandWritePhase[]
  customFields?: Record<string, unknown>
  notifyCustomFields?: boolean
  events?: CrudEventsConfig<TEntity>
  indexer?: CrudIndexerConfig<TEntity>
  syncOrigin?: string | null
  sideEffect: () => CrudCommandWriteSideEffectTarget<TEntity>
  em?: EntityManager
  transaction?: boolean
  dataEngine?: DataEngine
}

export type RunCrudCommandWriteResult = { em: EntityManager }

export async function runCrudCommandWrite<TEntity>(
  opts: RunCrudCommandWriteOptions<TEntity>,
): Promise<RunCrudCommandWriteResult>
```

## UI/UX
N/A — framework-side.

## Configuration
No env vars, no feature flags.

## Alternatives Considered
1. **Replace the three primitives with the helper.** Rejected — violates the BC contract for third-party modules already calling `withAtomicFlush` / `setCustomFieldsIfAny` / `emitCrudSideEffects` directly.
2. **Make `phases` accept a single async function instead of an array.** Rejected — the array shape already exists in `withAtomicFlush`; preserving it keeps the mental model uniform.
3. **Auto-detect entity identifiers from the entity object.** Rejected — entities differ in field naming (`id` vs `recordId`, scoping conventions). An explicit callback is cheaper than per-entity reflection logic.
4. **Push side-effect queueing inside `withAtomicFlush`.** Rejected — SPEC-018 explicitly says side effects MUST fire after commit. The helper preserves that invariant.
5. **A class with builder methods (`.phase(...).customFields(...).emit(...)`).** Rejected — three-line object literal is clearer and matches the rest of the command codebase style.

## Implementation Approach

### Phase 1 — Helper + tests (single commit)
1. Add `packages/shared/src/lib/commands/runCrudCommandWrite.ts` implementing the shape above.
2. Re-export `runCrudCommandWrite` and its public types from `packages/shared/src/lib/commands/index.ts`.
3. Add `packages/shared/src/lib/commands/__tests__/runCrudCommandWrite.test.ts` covering:
   - **AC1**: phases run on the helper-forked EM (or the caller-supplied EM if passed), and `setCustomFieldsIfAny` is called with the `DataEngine` resolved from `ctx.container` exactly once.
   - **AC2**: if a phase throws, `setCustomFieldsIfAny` is never called and `markOrmEntityChange` is never called; the transaction is rolled back.
   - **AC3**: if `setCustomFieldsIfAny` throws, `markOrmEntityChange` is never called.
   - **AC4**: on the happy path, `markOrmEntityChange` is called exactly once with the `entity`, `identifiers`, `events`, `indexer`, `action`, `syncOrigin` forwarded verbatim.
   - Plus: when `customFields` is undefined or empty, `setCustomFieldsIfAny` is not invoked but the emit still happens.

### Phase 2 — Representative migration (single commit)
1. Replace the `await withAtomicFlush(...)` + `setCustomFieldsIfAny(...)` + `emitCrudSideEffects(...)` triple in `updateDealCommand.execute` (`packages/core/src/modules/customers/commands/deals.ts`) with a single `runCrudCommandWrite({ ... })` call.
2. Keep the closure event emit (`customers.deal.won` / `customers.deal.lost`) AFTER `runCrudCommandWrite` — that is a domain event distinct from the CRUD side-effect queue.
3. Leave every other command path (`createDealCommand`, `undo`, `people.ts`, `companies.ts`, etc.) untouched to demonstrate BC.

### Phase 3 — Docs (single commit)
1. Add a `runCrudCommandWrite` row to `packages/shared/AGENTS.md` under the `commands/` library directory.
2. Add a note to `packages/core/AGENTS.md` → "Entity Update Safety" section pointing to the helper as the default for new commands that touch entity + custom fields + side effects.
3. Add a row to `packages/core/src/modules/customers/AGENTS.md` "Undoable Commands Pattern" referencing `updateDealCommand` as the canonical migration example.
4. Add the spec to `.ai/specs/README.md` Pending table.

### Phase 4 — Validation (no commit; PR description)
1. `yarn workspace @open-mercato/shared test`
2. `yarn workspace @open-mercato/core test`
3. `yarn typecheck` (or scoped equivalent)

## Migration Path
- **Existing call sites**: no migration required. The triple `withAtomicFlush` + `setCustomFieldsIfAny` + `emitCrudSideEffects` continues to work and is the documented fallback for cases the helper doesn't fit (e.g., commands with multiple separate transactions per phase set, like `createDealCommand`).
- **New call sites**: prefer `runCrudCommandWrite` for any command that writes an entity + custom fields + side effects in one logical operation.
- **Opportunistic migration**: subsequent PRs may migrate one command per PR; no repo-wide change in this issue.

## Backward Compatibility
| Surface | Classification | Impact |
|---------|----------------|--------|
| `withAtomicFlush` export | STABLE | Unchanged |
| `setCustomFieldsIfAny` export | STABLE | Unchanged |
| `emitCrudSideEffects` export | STABLE | Unchanged |
| `runCrudCommandWrite` export | ADDITIVE | New helper, opt-in |
| `RunCrudCommandWriteOptions` type | ADDITIVE | New public type |
| `CrudCommandWritePhase` type | ADDITIVE | New public type |
| `customers.deals.update` semantics | UNCHANGED | Helper composes the same primitives in the same order |

No deprecations. No symbol renames. No import-path moves.

## Success Metrics
- All four acceptance criteria from #2598 covered by passing unit tests in `runCrudCommandWrite.test.ts`.
- `updateDealCommand` ships migrated; its existing command tests continue to pass without modification.
- `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/core test`, and `yarn typecheck` all green.
- No changes to API responses or event payloads observed in integration tests for the customers module.

## Open Questions
- Should we expose a `runCrudCommandUndo` companion helper for the undo path (which also calls `emitCrudUndoSideEffects` + sometimes resets custom fields)? Out of scope for this issue; track separately if needed.
- Should the helper accept multiple atomic-flush "groups" so commands like `createDealCommand` (two separate transactions) can migrate cleanly? Out of scope; opportunistic follow-up.

## Changelog

### 2026-06-05
- Initial draft.
