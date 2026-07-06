# SPEC: Harden HybridQueryEngine custom-entity classification — ORM-backed ids before the `custom_entities` probe

- Status: **Implemented** on this branch (`packages/core/src/modules/query_index/lib/engine.ts`); proposed for upstream contribution.
- Date: 2026-06-15
- Area: `query_index` module (`HybridQueryEngine` read-path storage classifier)
- Severity: **High** — a single active `custom_entities` row for an ORM-backed system entity silently re-routes *every* list/detail read of that whole entity type to the (empty) doc-storage table. This is the #2939 read-path-poisoning failure mode, reachable through a door the existing guards do not cover.
- Related: #2939 / #2942 (doc-storage rows poisoning read classification) and the doc-storage write seam `assertCustomEntityStorageEntityId`. Prerequisite for a planned follow-up that allows a presentation-metadata overlay on system entities (separate PR).

## 1. Problem

`HybridQueryEngine.isCustomEntity(entity)` is the platform-wide read-path classifier that decides whether `query()` reads an entity from its base ORM table (+ query index) or from doc storage (`custom_entities_storage`). It is **row-first**: it probes `custom_entities` for an active registration **before** considering whether the id is backed by a registered ORM table.

```ts
// BEFORE (packages/core/src/modules/query_index/lib/engine.ts)
const row = await db.selectFrom('custom_entities').select('id')
  .where('entity_id', '=', entity).where('is_active', '=', true).executeTakeFirst()
if (row) {
  result = true                                                   // custom => doc storage
} else if (resolveRegisteredEntityTableName(this.em, entity) !== null) {
  result = false                                                  // ORM-backed => base table (#2939 guard)
} else {
  result = await this.hasCustomEntityStorageRows(entity)
}
```

The `else if` ORM-backed guard (added for #2939, so that *stray* `custom_entities_storage` rows cannot hijack reads) is only reached **when no active `custom_entities` row exists**. If an active `custom_entities` row exists for an ORM-backed system id (e.g. `customers:customer_person_profile` → `CustomerPersonProfile`, or `customers:customer_deal` → `CustomerDeal`), branch 1 fires and the id is classified as doc-storage-backed — so `query()` routes the entire entity type to the empty `custom_entities_storage` table and every list/detail read returns nothing.

This is the exact asymmetry that makes the system-entity metadata-overlay use case unsafe: the records API (`classifyRecordsEntity`, `records.ts`) and the doc-storage write guard (`assertCustomEntityStorageEntityId`, `@open-mercato/shared/lib/data/engine`) both check `isOrmBackedSystemEntityId` **first**, but the read classifier trusted an active registration row over ORM-table resolution.

## 2. Root cause

Branch ordering. For an ORM-backed system entity, storage classification must be driven by the ORM-table resolution (`isOrmBackedSystemEntityId` = registry membership **and** `resolveRegisteredEntityTableName`), never by the mere existence of a `custom_entities` row. The read classifier was the only one of the three classification seams that did not enforce this ordering.

## 3. Fix (implemented)

Short-circuit ORM-backed system ids to `false` (base table) **before** probing `custom_entities`, mirroring the records API and the write guard:

```ts
// AFTER
if (isOrmBackedSystemEntityId(this.em, entity)) {
  result = false                                                  // ORM-backed => base table, ignore any custom_entities/storage rows (#2939)
} else {
  const row = await db.selectFrom('custom_entities').select('id')
    .where('entity_id', '=', entity).where('is_active', '=', true).executeTakeFirst()
  if (row) {
    result = true
  } else if (resolveRegisteredEntityTableName(this.em, entity) !== null) {
    // Non-registry id whose entity segment collides with an ORM class name (e.g. `user:todo`
    // vs the example module's `Todo`): resolves to a table but is NOT a system entity. Stray
    // storage rows still must not hijack reads. (Behavior preserved exactly.)
    result = false
  } else {
    result = await this.hasCustomEntityStorageRows(entity)        // read/write symmetry (behavior preserved)
  }
}
```

`isOrmBackedSystemEntityId` is imported from `@open-mercato/shared/lib/data/engine` (already used by the `entities` API and the records API — no new dependency direction).

**Why this is minimal and safe:** the only classification that changes is "ORM-backed system id **with** an active `custom_entities` row": previously `true` (poison) → now `false` (correct, base table). Every other case is byte-for-byte preserved:
- ORM-backed id with no row → already `false` (was via the `else if`, now via the short-circuit).
- Non-ORM-backed collision id (`user:todo`) with/without a row → unchanged (`else` branch keeps the `resolveRegisteredEntityTableName` collision guard and the `hasCustomEntityStorageRows` fallback).
- Genuinely custom entity (no ORM table) with an active row → still `true` (doc storage).

Surfaces that intentionally read doc records for a dual-declared id keep using `forceCustomEntityStorage` in `QueryOptions` (unchanged; bypasses `isCustomEntity` entirely).

## 4. Affected files
- `packages/core/src/modules/query_index/lib/engine.ts` — `isCustomEntity` reorder + import of `isOrmBackedSystemEntityId`. **The fix.**
- `packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts` — fake-Kysely `custom_entities` row support + two regression tests.
- No change to `@open-mercato/shared/lib/data/engine` (`isOrmBackedSystemEntityId`, `assertCustomEntityStorageEntityId`), `records.ts` (`classifyRecordsEntity`), or any migration/schema.

## 5. Test plan

Unit (`hybrid-engine.test.ts`, extends the existing `#2939` classification suite):
- **New, red→green:** an active `custom_entities` row for an ORM-backed entity (`customers:customer_deal`) → `isCustomEntity` returns `false` and `query()` reads `customer_deals`, not `custom_entities_storage`. (Verified to FAIL on the unpatched classifier with `Expected: false, Received: true`, and PASS after the fix.)
- **New, over-reach guard:** a genuinely custom entity with no ORM table but an active registration row → still classifies as `true` (doc storage).
- **Kept green:** existing #2939 stray-doc-row test, read/write-symmetry test, `forceCustomEntityStorage` test, and all coverage/sort/decrypt tests (24/24 in the suite; 62/62 across `query_index`; 48/48 across `entities` API).

## 6. Backward compatibility
- No public contract change: `QueryEngine.query` URL/types/response shapes unchanged. `isCustomEntity` is private. The change only **corrects** classification for ORM-backed ids carrying an active registration row — a state that today only produces broken (empty) reads.
- No DB or schema change. No new ACL/feature, event, or DI surface.
- Per `BACKWARD_COMPATIBILITY.md`: behavioral fix within the existing contract; no deprecation bridge required.

## 7. Follow-up (separate PR)
With the read classifier hardened, an active `custom_entities` overlay row for an ORM-backed system entity is inert for storage classification. That unblocks safely persisting a presentation-metadata overlay (label/description/defaultEditor) for system entities from the full “Edit Definitions” editor — tracked separately and stacked on this PR.
