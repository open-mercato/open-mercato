# SPEC: Custom-entity record edit-form save fails — reserved keys (`id`/`updated_at`/`updatedAt`) validated as custom fields

- Status: **Implemented** on this branch (fix applied in `packages/core/src/modules/entities/api/records.ts`); proposed for upstream contribution.
- Date: 2026-06-15
- Area: `entities` module (custom entities / records API + generic records edit form)
- Severity: **High** — every save from the generic custom-entity **edit** form returns HTTP 400; editing any custom-entity record through the UI is impossible.
- Related: the optimistic-locking contract (`CrudForm` auto-derives `updatedAt`), and `.ai/specs/2026-06-15-system-entity-full-editor-custom-fields.md` (separate `entities` editor bug).

## 1. Problem

Editing an existing custom-entity record via the generic records edit page, e.g.
`/backend/entities/user/<entityId>/records/<recordId>`, and clicking **Save** fails with HTTP 400:

```json
{
  "error": "Validation failed",
  "fields": {
    "cf_id": "[internal] Unknown custom field",
    "cf_updated_at": "[internal] Unknown custom field",
    "cf_updatedAt": "[internal] Unknown custom field"
  }
}
```

The save never persists. This reproduces for **any** custom entity (verified across several, including the bundled `example:todo`); it is independent of which field the user changed. Creating a *new* record usually works (no `id`/`updated_at` present yet), so the bug is specific to the **edit** path.

## 2. Root cause

The records write handlers validate the submitted `values` as custom fields with `rejectUndeclaredKeys: true`, but the edit form submits the record's **system columns** alongside the custom-field values.

### 2.1 The form submits reserved keys

The generic edit page
(`packages/core/src/modules/entities/backend/entities/user/[entityId]/records/[recordId]/page.tsx`)
loads the full record as `initialValues` and renders it with `CrudForm`. `CrudForm` keeps `id`
(record identity) and `updated_at`/`updatedAt` (used by the **default-on optimistic locking** to
derive the `x-om-ext-optimistic-lock-expected-updated-at` header — see root `AGENTS.md`) in its
value bag. On submit it `PUT`s the whole bag as `values`. Observed request body:

```json
{ "entityId": "example:todo", "recordId": "123e4567-e89b-12d3-a456-426614174000",
  "values": { "id": "123e4567-e89b-12d3-a456-426614174000", "priority": 3, /* …other declared custom fields… */,
              "updated_at": "2026-06-14T23:07:31.007Z",
              "updatedAt":  "2026-06-14T23:07:31.007Z" } }
```

### 2.2 The API validates them as custom fields

In `packages/core/src/modules/entities/api/records.ts`, both `POST` and `PUT` do:

```ts
const norm = normalizeValues(values)
const check = await validateCustomFieldValuesServer(em, {
  entityId, organizationId, tenantId, values: norm, rejectUndeclaredKeys: true,
})
if (!check.ok) return NextResponse.json({ error: 'Validation failed', fields: check.fieldErrors }, { status: 400 })
```

`validateCustomFieldValuesServer` (`packages/core/src/modules/entities/lib/validation.ts`) treats
every key in `norm` as a custom field (prefixing `cf_`) and, with `rejectUndeclaredKeys: true`,
returns `Unknown custom field` for any key not in `custom_field_defs`. `id`, `updated_at` and
`updatedAt` are **system columns, not custom fields**, so they are rejected and the whole save 400s.

### 2.3 Confirmation

- A `PUT` with `values: { priority: 3 }` (no system keys) → **200**, value persisted.
- A `PUT` with the exact form payload (incl. `id`/`updated_at`/`updatedAt`) → **400** with the errors above.
- After the fix (§3), the same full payload → **200**, and the edit form Save redirects to the list with the value saved (verified in-browser).

## 3. Fix (implemented)

Strip reserved/system record columns from `values` before custom-field validation **and** before the
write, in **both** `POST` and `PUT` of `packages/core/src/modules/entities/api/records.ts`,
immediately before `const norm = normalizeValues(values)`:

```ts
// Strip reserved record/system columns the edit form echoes back from the loaded record
// (`id`, plus `updated_at`/`updatedAt` used for optimistic locking). They are not custom
// fields; without this they validate as cf_id / cf_updated_at / cf_updatedAt and are
// rejected as "Unknown custom field", which fails EVERY custom-entity edit-form save.
for (const reservedKey of ['id', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'deleted_at', 'deletedAt']) {
  delete (values as any)[reservedKey]
}
const norm = normalizeValues(values)
```

**Why API-side (not only the form):** the data engine + records API are the shared write path for
the generic form, AI tools, imports, and any third-party caller. Stripping reserved keys at the API
boundary fixes all of them and is defensive against `CrudForm` legitimately carrying `updatedAt`
(required by optimistic locking). It does not change the persisted record: `id`/timestamps are
managed by the data engine, never by custom-field values.

**Reserved set:** `id`, `created_at`, `createdAt`, `updated_at`, `updatedAt`, `deleted_at`,
`deletedAt`. These are the audit/identity columns a record read can echo back. (Optional hardening:
also strip `tenant_id`/`tenantId`/`organization_id`/`organizationId`/`entity_id`/`entityId` if a
future read shape includes them; not required for the observed bug.)

### Alternative considered (secondary, optional)
Have the records edit page submit only declared custom-field values (e.g. filter `initialValues`
through the known `cfDefs` before `updateCrud`). Cleaner at the source, but narrower (only fixes the
one form) and easy to regress as new value sources are added. Recommend keeping the API-side strip as
the canonical fix; the form-side filter is optional defense-in-depth.

## 4. Affected files
- `packages/core/src/modules/entities/api/records.ts` — `POST` and `PUT` handlers (the strip; **the fix**).
- `packages/core/src/modules/entities/lib/validation.ts` — `validateCustomFieldValuesServer` / `rejectUndeclaredKeys` (no change; referenced for the rejection behavior).
- `packages/core/src/modules/entities/backend/entities/user/[entityId]/records/[recordId]/page.tsx` — edit form that submits the reserved keys (no change required; optional source-side filter per §3 alternative).

## 5. Test plan

Unit (`packages/core/src/modules/entities/api/__tests__/records-submit.test.ts` or new):
- `PUT` with `values` containing `id` + `updated_at` + `updatedAt` + declared fields → **200**, record updated, reserved keys NOT written as custom fields. (New — covers the fix.)
- `PUT` with an actually-undeclared custom key (e.g. `values.not_a_field`) → still **400** `Unknown custom field`. (Guards that `rejectUndeclaredKeys` still works for genuine typos.)
- `POST` (create) with `id`/`updated_at` present → **200**, ignored. (Symmetry.)

Integration (Playwright, matches the live repro):
- Open a custom-entity record edit page, change a field, **Save** → 200, redirect to the records list, value persisted. (Pre-fix: 400, stays on page.)

Manual (done): on a custom-entity record, edited a field and clicked **Save** → redirected to the records list with the value persisted (pre-fix: 400, stayed on the page).

## 6. Backward compatibility
- API surface unchanged: `POST`/`PUT /api/entities/records` keep their URL, request schema, and response shapes. The change only **narrows** the inputs that 400 (records that happen to include their own `id`/timestamps now succeed). No FROZEN/STABLE contract is removed; the change is behavioral within the existing contract (per `BACKWARD_COMPATIBILITY.md`, no deprecation bridge required).
- No DB or schema change. Stored records are unaffected (reserved keys were never valid custom-field values).
- `rejectUndeclaredKeys` protection for genuine unknown keys is preserved.
