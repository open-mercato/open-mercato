# SPEC: System-entity full-editor save fails with "System entities cannot be registered as custom entities"

- Status: **Implemented** across two stacked PRs — read-classifier hardening (#3106, see
  `2026-06-15-query-index-orm-backed-classification-hardening.md`) and this metadata-overlay change
  (`packages/core/src/modules/entities/api/entities.ts`). Proposed for upstream contribution.
- Date: 2026-06-15
- Area: `entities` module (custom entities / custom fields, EAV) + `query_index` (read classifier, via #3106)
- Severity: High (blocks editing field definitions + metadata for any system entity via the full editor)
- Related history: #2411 (`7bf54b807`) introduced system-entity metadata persistence; #2939 (`c5fa98eaa`) introduced the guard that broke it; #3106 hardens the read classifier this fix depends on.

## 1. Problem

When a user opens the full "Edit Definitions" editor for a **system** entity (source `code`), e.g.
`customers:customer_person_profile`, at:

- Page: `packages/core/src/modules/entities/backend/entities/system/[entityId]/page.tsx`
  (a thin re-export of `.../entities/user/[entityId]/page.tsx`)
- Route: `/backend/entities/system/<entityId>`

clicking **Save** failed with HTTP 400:

```json
{ "error": "System entities cannot be registered as custom entities",
  "code": "system_entity_records_blocked", "entityId": "customers:customer_person_profile" }
```

The **inline** "Edit custom fields" dialog (which POSTs only to `/api/entities/definitions.batch`)
saved the **same** field definitions for the **same** system entity with no error. Both surfaces are
supposed to let an operator attach custom **field definitions** to a system entity; only the full
editor was broken.

## 2. Root cause

### 2.1 The full editor makes two calls; the first trips the guard

`handleCrudFormSubmit` (`.../entities/user/[entityId]/page.tsx`) makes two API calls on every save,
regardless of `entitySource`:

1. `POST /api/entities/entities` — upserts a `CustomEntity` row carrying entity-level metadata
   (`label`, `description`, `defaultEditor`; `showInSidebar` only for custom). For `code`-sourced
   entities `buildEntityMetadataPayload('code', …)` returns a metadata-only payload
   (`label`/`description`/`defaultEditor`).
2. `POST /api/entities/definitions.batch` — writes the field **definitions** (only `CustomFieldDef` /
   `CustomFieldEntityConfig`; never a `CustomEntity` row; never calls the system-entity guard).

The first call is unconditional (by design from #2411, whose goal was to persist label/description/
defaultEditor for system entities via a `CustomEntity` overlay, with the GET merge pinning
`source: 'code'`). The `isOrmBackedSystemEntityId` guard added in #2939 rejected that call outright,
so the full-editor Save 400s while the inline dialog (call #2 only) succeeds.

### 2.2 Why the broad guard existed — and why a naive re-allow was unsafe

#2939 added the guard to stop a `CustomEntity` registration from flipping query-engine storage
classification to doc storage for an ORM-backed entity (the #2939/#2942 read-poisoning failure).
A first proposal ("Option A: just write a metadata-only overlay and return ok") was **verified
unsafe**: the read-path classifier `HybridQueryEngine.isCustomEntity` probed `custom_entities` for an
active row **before** checking ORM-table resolution, so an active overlay row for an ORM-backed system
entity would re-route every list/detail read of the whole type to the empty `custom_entities_storage`
table — re-opening #2939 through metadata alone. `showInSidebar=false` and the GET `source:'code'` pin
do not help (the classifier consults neither).

The asymmetry: the records API (`classifyRecordsEntity`) and the doc-storage write guard
(`assertCustomEntityStorageEntityId`) both key off `isOrmBackedSystemEntityId` **first**; only the read
classifier was row-first.

## 3. Fix (implemented, two stacked PRs)

**PR-1 — read-classifier hardening (#3106).** Reorder `HybridQueryEngine.isCustomEntity` to
short-circuit `isOrmBackedSystemEntityId(em, entity) → base table` **before** the `custom_entities`
probe, mirroring the records API and the write guard. After this, an active `custom_entities` overlay
row for an ORM-backed system entity is inert for storage classification. (Full write-up:
`2026-06-15-query-index-orm-backed-classification-hardening.md`.)

**PR-2 — metadata overlay (this change).** In `POST /api/entities/entities`
(`packages/core/src/modules/entities/api/entities.ts`), replace the unconditional 400 for ORM-backed
system entities with a **metadata-only overlay** write:

- Persist only `label` / `description` / `defaultEditor`.
- Force `showInSidebar = false` and leave `labelField` untouched, so the overlay can neither surface a
  records UI nor relabel the system entity's record routing.
- Return `ok`. Genuine (non-ORM-backed) custom entities keep their full behavior, including
  `showInSidebar` / `labelField`.

The doc-storage **write** guards are unchanged and still fire: `assertCustomEntityStorageEntityId`
(create/update/delete record) and `classifyRecordsEntity` (records API) keep rejecting doc-storage
writes / records-UI access for ORM-backed system entities. So an operator can edit a system entity's
label/description/defaultEditor and its field definitions, but cannot create doc-storage records for it.

## 4. Affected files
- `packages/core/src/modules/query_index/lib/engine.ts` — `isCustomEntity` reorder (**PR-1 / #3106**).
- `packages/core/src/modules/entities/api/entities.ts` — `POST` metadata-overlay branch; dropped the
  now-unused `SYSTEM_ENTITY_RECORDS_BLOCKED_CODE` import (**PR-2 / this change**).
- `packages/core/src/modules/entities/api/__tests__/entities.api.test.ts` — POST overlay tests (PR-2).
- `packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts` — classifier tests (PR-1).
- No change to `@open-mercato/shared/lib/data/engine`, `records.ts`, the editor page, or any migration.
  No client gate needed in the editor: it already posts a metadata-only payload for `code` source, so
  the server change alone makes Save succeed.

## 5. Test plan

Unit (Jest):
- `entities.api.test.ts` (PR-2): POST for an ORM-backed system entity persists a metadata-only overlay
  (`showInSidebar` forced false, `labelField` ignored) and returns 200 — verified red→green
  (`Expected 200, Received 400` on the pre-fix handler). POST for a genuine custom entity still persists
  full fields. GET overlay-merge tests stay green (`source: 'code'` preserved).
- `hybrid-engine.test.ts` (PR-1): active `custom_entities` row for an ORM-backed id no longer reroutes
  reads to doc storage (red→green); genuinely custom entity with a row still routes to doc storage.
- `definitions.batch` tests stay green (system-entity definitions unaffected).
- Suite results: `query_index` 62/62, `entities` API 50/50; core typecheck clean.

Integration / manual (matches the repro):
- System full editor: edit + Save `customers:customer_person_profile` → no 400, redirect to
  `/backend/entities/system?flash=Definitions saved&type=success`; metadata + definitions persist.
- Regression: list/detail reads of `customers:customer_person_profile` (and other ORM-backed system
  entities) still resolve against their ORM tables — the #2939/#2942 scenario stays closed.

## 6. Backward compatibility
- `POST /api/entities/entities` keeps its URL, request schema (`upsertCustomEntitySchema`), and
  200/400 response shapes. The change only **narrows** the inputs that 400 (system-entity metadata
  overlays now succeed). The `system_entity_records_blocked` rejection stays in force for the genuine
  doc-storage paths (`assertCustomEntityStorageEntityId`, `classifyRecordsEntity`).
- No DB/schema change; the overlay uses the existing `CustomEntity` columns from #2411.
- Per `BACKWARD_COMPATIBILITY.md`: behavioral change within the existing contract; no deprecation bridge.

## 7. Changelog
- 2026-06-15: Verified Option A unsafe without classifier hardening; split into PR-1 (#3106 read
  classifier) + PR-2 (metadata overlay). Implemented both; added red→green regression tests for each.
