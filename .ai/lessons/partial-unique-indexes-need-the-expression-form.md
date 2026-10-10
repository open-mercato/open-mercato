---
title: "A partial unique index needs the expression form, or it is not unique"
modules: ["transport_operations","fleet_management","financial","hr_management","staff","entities","data_sync","checkout"]
areas: ["module-data","database-migrations"]
topics: ["database-migrations","optimistic-locking","data-integrity","module-boundaries"]
---

# A partial unique index needs the expression form, or it is not unique

A user reported that creating and editing vehicles accepted duplicate plate numbers and duplicate
sequence numbers. Both entities **declared** the constraint:

```ts
@Index({ name: 'fleet_vehicles_plate_unique_idx', properties: ['organizationId', 'tenantId', 'plateNumber'],
         options: { unique: true, where: 'deleted_at IS NULL' } })
```

The live database said otherwise:

```
fleet_vehicles_plate_unique_idx     | CREATE INDEX ...              ← no UNIQUE
transport_vehicles_plate_unique_idx | CREATE INDEX ...              ← no UNIQUE
transport_vehicles_vin_unique_idx   | CREATE INDEX ...              ← no UNIQUE
```

`options: { unique: true, where }` compiles to a **plain** index under this MikroORM version. The
index is created, it carries a name ending in `_unique_idx`, it appears in `\d`, and it constrains
nothing. The only way to see it is `indexdef` — `CREATE INDEX` versus `CREATE UNIQUE INDEX`.

Measured scope: **15 indexes** in a live database whose names say `unique` while `indexdef` does not.

```
select indexname from pg_indexes
where indexname like '%unique%' and indexdef not like '%UNIQUE%';
```

## The form that works

```ts
@Index({
  name: 'fleet_vehicles_plate_unique_idx',
  expression:
    'create unique index "fleet_vehicles_plate_unique_idx" on "fleet_vehicles" ("organization_id", "tenant_id", "plate_number") where deleted_at is null',
})
```

`expression` is passed through as SQL, so the predicate and the uniqueness both survive. The financial
module's Phase-1 changelog already recorded this ("the `options: { unique: true }` form the reference
module uses silently degrades to a plain index"), which is why its account codes, period keys and entry
numbers are genuinely unique — the note was read as a local quirk rather than swept repo-wide.

## Why the generator will not tell you

After switching the entity to `expression`, `yarn db:generate` reports **"no changes"**. The snapshot
already contains an index with that *name*, and the differ compares index names, not their SQL. The
index is therefore on the schema-diff blind spot: the migration has to be hand-written (drop, then
create) and the module's `.snapshot-open-mercato.json` updated to the `expression` shape in the same
change, or the next `db:generate` will keep disagreeing with the entity in one direction or the other.

## A unique index can fail to apply

`create unique index` fails outright when duplicates already exist, so this change is not a pure
schema change — it is a data change with a precondition. Fleet data held a duplicate plate
(`A B C 1234`, ×2) and a duplicate sequence (`123456789`, ×2), each of which blocks the migration.
Report the duplicates and let the owner decide how to resolve them; do not silently rewrite rows to
make a migration pass.

## Rules

- A partial unique index MUST be declared with `@Index({ expression: 'create unique index …' })`.
- A constraint is the **guarantee**; a `beforeCreate`/`beforeUpdate` check is the **message**. Ship
  both: the index stops the duplicate, the check turns it into a 409 that names the field instead of a
  500 from the driver.
- When a partial-update command validates a unique field, fall back to the stored value
  (`input.plateNumber ?? current.plateNumber`) and exclude the edited row (`id: { $ne: … }`) —
  otherwise an edit that only changes the model either re-checks the wrong value or rejects itself.
- Treat an absent/blank identity field as *no value* rather than as a value to match, or every row
  without one collides with every other.
- Verify uniqueness claims against `pg_indexes.indexdef`, never against the index name or `\d`.
