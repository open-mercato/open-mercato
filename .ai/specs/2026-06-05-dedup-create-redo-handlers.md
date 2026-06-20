# Deduplicate create-command / redo-handler logic

## Overview

PR #2552 (issue #2506) added id-preserving `redo` handlers to every undoable
`*.create` command. The behavior is correct, but the implementation duplicates a
large amount of code: each command now encodes its field set up to **four** times
(the `Snapshot` type, the snapshot loader, the redo seed/restore mapping, and the
original `execute` create mapping). Across ~50 command files this is ~3.7k added
lines, most of it mechanical repetition.

This spec refactors the redo implementation so the field mapping for a created row
(or row graph) is declared **once** and reused by both `execute` and `redo`, with
**no behavior change**. It is a pure internal refactor of code introduced in the
same PR; the redo contract, snapshots, undo tokens, and integration tests are
unchanged.

**Reference:** PR #2552, Issue #2506. Builds on the framework added in that PR
(`CommandHandler.redo`, `CommandExecutionOptions.redoLogEntry`,
`@open-mercato/shared/lib/commands/redo`).

---

## Problem Statement

For a typical single-row create command (e.g. `currencies.currencies.create`) the
same field list appears in four places:

1. `type CurrencySnapshot = { ... }` — the after-snapshot shape.
2. `loadCurrencySnapshot()` — entity → snapshot (read every column).
3. `currencySeedFromSnapshot()` — snapshot → create seed (revive dates).
4. `execute`'s `em.create(Currency, { ... })` — input → entity.

(3) is pure duplication introduced by the redo work: it re-lists every field that
already lives in the snapshot, differing from (2) only by `new Date(...)` revival.
There are **22** such `xSeedFromSnapshot` helpers.

For multi-row creates (`customers.people`, `customers.companies`,
`catalog.products`, `catalog.variants`, `sales.returns`,
`customers.interactions`, …) the `redo` handler re-implements the **entire**
entity-graph construction by hand, duplicating `execute`'s `em.create(...)` calls
field-for-field for each entity in the graph (~10 commands, the largest blocks of
duplicated code in the PR).

Duplication of this kind is a maintenance hazard: a future column addition or
default change must be mirrored across 2–4 sites per command or redo silently
drifts from create.

---

## Goals

- Declare each created row's field mapping **once**, reused by `execute` and `redo`.
- Delete all `xSeedFromSnapshot` helpers for single-row creates.
- Collapse the multi-row hand-rolled `redo` graphs onto a single shared
  per-command builder also used by `execute`.
- Zero behavior change: same ids preserved, same side effects, same snapshots,
  same undo tokens. All existing unit + integration tests stay green unchanged.
- No new contract surface beyond additive, BC-safe tweaks to the `makeCreateRedo`
  config (all new fields optional).

## Non-Goals

- No change to the redo route, command bus, undo/snapshot plumbing, or the
  `CommandHandler.redo` contract.
- No change to which commands are undoable.
- No change to integration-test expectations.
- Not migrating bespoke delegating redos that intentionally forward to another
  command's redo (e.g. `customers.todos` → `customers.interactions`); those are
  already thin and non-duplicative.

---

## Design

### 1. Snapshot-as-seed for single-row creates (framework)

Enhance `makeCreateRedo` in `packages/shared/src/lib/commands/redo.ts` so the
after-snapshot can be reused **directly** as the create seed, removing the need
for a per-command `seedFromSnapshot`:

- `seedFromSnapshot` becomes **optional**. When omitted, the default seed is the
  snapshot itself, shallow-cloned, with declared date fields revived from ISO
  strings to `Date`.
- New optional `dateFields?: string[]` — snapshot keys to convert from string to
  `Date`. Defaults to the common columns present on the snapshot
  (`createdAt`, `updatedAt`, `deletedAt`). Commands with extra date columns
  (e.g. `expiresAt`, `returnedAt`, `nextInteractionAt`) list them explicitly.
- `getSnapshotId` becomes **optional**, defaulting to `(snapshot) => snapshot.id`.

This is sound because the existing single-row snapshots are already a faithful
serialized row whose keys equal entity property names; the only transformation in
the current `xSeedFromSnapshot` helpers is date revival. The default reviver
reproduces that transformation generically.

Resulting per-command config shrinks from a ~15-line seed helper + config to:

```ts
redo: makeCreateRedo<Currency, CurrencySnapshot, CurrencyCreateInput, { currencyId: string }>({
  entityClass: Currency,
  events: currencyCrudEvents,
  buildResult: (entity) => ({ currencyId: entity.id }),
  afterRestore: async ({ em, entity }) => {
    if (entity.isBase) {
      await enforceBaseCurrency(em, entity.id, entity.organizationId, entity.tenantId)
      await em.flush()
    }
  },
})
```

The explicit `seedFromSnapshot` override is retained for the rare snapshot whose
keys diverge from entity columns; such cases keep their helper and the spec
documents why.

### 2. Shared materializer for multi-row creates

For each multi-row create, extract a single builder that constructs and persists
the entity graph from a plain `values` object, and call it from **both**
`execute` (values derived from validated input) and `redo` (values derived from
the after-snapshot):

```ts
type PersonGraphValues = { /* entity + profile fields, id optional */ }

function buildPersonGraph(em: EntityManager, values: PersonGraphValues) {
  const entity = em.create(CustomerEntity, { ...values.entity })
  const profile = em.create(CustomerPersonProfile, { ...values.profile, entity })
  em.persist(entity); em.persist(profile)
  return { entity, profile }
}

// execute: values from parsed input (no id → DB generates)
// redo:    values from snapshot (id present → restore-in-place via restoreCreatedRow,
//          else create with the original id)
```

`redo` continues to use `restoreCreatedRow` for the root row (clear `deletedAt`
if the row survived the undo, else recreate with the original id), then applies
the graph builder for child rows. The field mapping for each entity in the graph
now lives in exactly one place.

Where a graph has post-persist side effects shared between create and redo
(e.g. `syncEntityTags`, `enforceBaseCurrency`, dictionary upserts), those helpers
already exist and are called from both paths; the refactor does not change them.

### 3. Optional: generic row serializer for snapshot loaders

Where a single-row snapshot loader is a pure column copy (no related data,
no decryption-specific shaping), it may be replaced with a shared
`serializeRowSnapshot(entity, { dateFields })` helper to remove duplication (2).
This is opportunistic — applied only where it is a clean 1:1 column copy, and
skipped where the loader shapes nested/related data. Snapshot **types** stay
explicit (they document the persisted shape and back the undo payload typing).

---

## Affected Surfaces

### Framework
- `packages/shared/src/lib/commands/redo.ts` — optional `seedFromSnapshot`,
  optional `getSnapshotId`, new `dateFields`, default date-reviving seed,
  optional `serializeRowSnapshot` export.

### Single-row creates (drop `seedFromSnapshot`, shrink config)
`currencies.currencies`, `currencies.exchange_rates`, `sales.configuration`,
`planner.availability-rule-sets`, `catalog.prices`,
`catalog.productUnitConversions`, `catalog.priceKinds`, `catalog.optionSchemas`,
`catalog.offers`, `catalog.categories`, `staff.team-roles`, `staff.teams`,
`staff.leave-requests`, `staff.timesheets-projects`, `staff.timesheets-entries`,
`scheduler.jobs`, plus any single-row hand-rolled redos convertible to the
factory (`customers.tags`, `customers.labels`, `customers.dictionaries`,
`customers.entity-roles`, `customers.deals`, `customers.comments`,
`customers.addresses`, `customers.personCompanyLinks`, `resources.*`, `staff.*`,
`sales.notes`, `sales.payments`, `sales.shipments`, `directory.organizations`,
`feature_toggles.global` where applicable). Each conversion verified individually
against its snapshot shape before applying.

### Multi-row creates (extract shared `buildXGraph`)
`customers.people`, `customers.companies`, `customers.interactions`,
`catalog.products`, `catalog.variants`, `sales.returns`,
`staff.team-members` — and any other create whose `execute` builds more than one
row.

---

## Backward Compatibility

Pure internal refactor of code added in the same PR. The only contract-surface
touch is the `makeCreateRedo` config type, changed **additively**: previously
required fields (`seedFromSnapshot`, `getSnapshotId`) become optional with
defaults, and a new optional `dateFields` is added. No exported symbol is removed
or renamed; no runtime behavior changes. Per `BACKWARD_COMPATIBILITY.md` this is
ADDITIVE-ONLY on the (newly introduced) helper signature. See
"Migration & Backward Compatibility" below.

### Migration & Backward Compatibility
- `makeCreateRedo` callers that still pass `seedFromSnapshot`/`getSnapshotId`
  continue to compile and behave identically (overrides win over defaults).
- No published release has shipped the required-field form of this config, so no
  external consumer depends on it; the change is internal to PR #2552.

---

## Testing

This refactor must not change behavior, so the existing tests are the contract:

- Unit: `packages/shared` command/redo unit tests must stay green. Add focused
  unit tests for the new default date-reviving seed and `dateFields` handling in
  `makeCreateRedo`.
- Integration (unchanged, must still pass):
  - `currencies/__integration__/TC-CUR-REDO-409.spec.ts`
  - `customers/__integration__/TC-UNDO-003-redo-keeps-id.spec.ts`
  - `customers/__integration__/TC-UNDO-004-bridge-undo.spec.ts`
- Static gate: `yarn build:packages`, `yarn generate`, `yarn typecheck`,
  `yarn lint`, `yarn i18n:check-sync`, `yarn i18n:check-usage`.

No new integration paths are introduced (no new API/UI surface), so no new
integration specs are required by this refactor; the redo behavior they cover is
preserved.

---

## Phases

1. **Framework** — enhance `makeCreateRedo` (optional `seedFromSnapshot` +
   `getSnapshotId`, `dateFields`, default reviving seed, `serializeRowSnapshot`);
   add unit tests. Gate: `build:packages` + shared unit tests + typecheck.
2. **Single-row migration (batch A: factory users)** — convert the 16 commands
   already using `makeCreateRedo` to drop `seedFromSnapshot`. Gate: typecheck +
   affected unit tests.
3. **Single-row migration (batch B: convertible hand-rolled)** — convert
   hand-rolled single-row redos to the factory where the snapshot is a clean
   row. Gate: typecheck.
4. **Multi-row migration** — extract `buildXGraph` shared between execute/redo
   for the multi-row commands. Gate: typecheck + integration smoke for
   `customers.people` redo.
5. **Full verification** — `build:packages`, `generate`, `typecheck`, `lint`,
   i18n checks, shared unit tests, and the three integration specs above.
   ds-guardian N/A (no UI change).

---

## Changelog

- 2026-06-05: Initial spec authored for the PR #2552 dedup refactor.
- 2026-06-05: Partial implementation landed on `fix/issue-2506-redo-create-keep-id`.
  Framework (snapshot-as-seed) + 9 commands deduped (currencies, exchange_rates,
  catalog priceKinds/optionSchemas, staff teams/team-roles, customers tags/labels,
  customers.people multi-row materializer). Remaining single-row/multi-row commands
  and discovered `makeCreateRedo` limitations tracked in
  `.ai/runs/2026-06-05-dedup-create-redo/HANDOFF.md`. Status: in-progress.
- 2026-06-05 (rev 2): Extended `makeCreateRedo` with additive hooks (`findRow`,
  `beforeRestore`, `logEntry`→`afterRestore`, `transaction`) and converted 5 more
  hand-rolled redos (resource-types, customers/resources comments, sales.notes,
  staff.comments). Total: **15 commands deduped + framework**. Remaining create
  redos are genuinely not convertible (multi-entity / already-factored / no
  deletedAt column / no created side effects / in-tx fixup / syncOrigin / bridges)
  — enumerated in HANDOFF.md. Gate: build ✓, generate ✓, typecheck ✓ (21/21),
  unit ✓ (core 5428, shared 1166). Integration specs still owed a live-app run.
