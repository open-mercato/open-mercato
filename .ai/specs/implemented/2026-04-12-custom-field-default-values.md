# Custom Field Default Values

## TLDR

**Key Points:**
- Issue [#824](https://github.com/open-mercato/open-mercato/issues/824) asks for default values on custom attributes so newly created records can start with predefined values such as a default status.
- The repo already contains partial `defaultValue` support in the public `CustomFieldDefinition` type, CLI field-definition creation, and module-seeded custom field definitions, but that support is not carried through the admin definitions API, field editor UI, or `CrudForm` initialization path.
- This spec completes that contract end to end: persist and expose `configJson.defaultValue`, let admins manage it in the field definition editor, and apply defaults only on create flows when the form has no explicit value for that field.
- Dictionary-backed custom fields are an important first-class case. The issue screenshot points at a customer status dictionary entry and implies the desired workflow of defaulting a custom attribute to a configured dictionary entry such as `customer`.

**Scope:**
- `packages/core/src/modules/entities/`
- `packages/ui/src/backend/custom-fields/FieldDefinitionsEditor.tsx`
- `packages/ui/src/backend/utils/customFieldDefs.ts`
- `packages/ui/src/backend/utils/customFieldForms.ts`
- `packages/ui/src/backend/CrudForm.tsx`
- Tests for custom field definitions payloads, form mapping, and create-flow default application

**Out of Scope:**
- Retroactively backfilling existing records with defaults
- Changing dictionary entry schema to add a separate `isDefault` flag
- Applying defaults during edit flows when a persisted record already exists
- Complex expression-based defaults such as "today", "current user", or computed formulas

**Concerns:**
- Defaults must not overwrite explicit user input or existing stored values.
- Type-specific validation is required, especially for `dictionary`, `select`, `boolean`, numeric, and multi-value fields.
- The implementation must preserve backward compatibility because `defaultValue` is already part of the shared public type surface.

## Overview

Open Mercato already models custom fields as a tenant-scoped extensibility layer built around `CustomFieldDef.configJson` plus UI generation through `CrudForm`. In practice, the platform can define field labels, visibility, validation, options, dictionaries, relations, and editor hints, but it does not consistently expose or apply field defaults.

Issue #824 requests that administrators be able to specify a default value for a custom attribute so a new record can start with a meaningful initial value. The issue example is a CRM contact creation flow where every new contact should receive a predefined status.

During analysis, the repository revealed that this feature is only partially implemented today:
- `defaultValue` already exists on the public `CustomFieldDefinition` type in [packages/shared/src/modules/entities.ts](/Users/mariuszlewczuk/Projects/omML/packages/shared/src/modules/entities.ts:46).
- CLI creation for entity field definitions already accepts `--default` / `--defaultValue` and stores `configJson.defaultValue` in [packages/core/src/modules/entities/cli.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/entities/cli.ts:196).
- Module-backed field installation preserves `defaultValue` in [packages/core/src/modules/entities/lib/field-definitions.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/entities/lib/field-definitions.ts:27) and [packages/core/src/modules/entities/lib/install-from-ce.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/entities/lib/install-from-ce.ts:38).
- Several seeded customer custom fields already declare defaults in [packages/core/src/modules/customers/customFieldDefaults.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/customFieldDefaults.ts:15). **Important nuance:** the currently seeded examples happen to be `boolean` fields (`defaultValue: false`), but the storage-side implementation is not boolean-only. The CLI already writes integer, float, boolean, and string-like defaults into `configJson.defaultValue`, and the installer path preserves whatever `defaultValue` appears in `CustomFieldDefinition`. What is unproven today is the runtime consumption path, especially for dictionary, select, and non-boolean UX flows.

However, the value disappears for runtime consumers:
- `GET /api/entities/definitions` does not return `defaultValue` in its normalized payload in [packages/core/src/modules/entities/api/definitions.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/entities/api/definitions.ts:247).
- The admin `FieldDefinitionsEditor` provides no control for default values in [packages/ui/src/backend/custom-fields/FieldDefinitionsEditor.tsx](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/custom-fields/FieldDefinitionsEditor.tsx:829).
- The custom-field DTO and form-mapping path omit default handling in [packages/ui/src/backend/utils/customFieldDefs.ts](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/utils/customFieldDefs.ts:5) and [packages/ui/src/backend/utils/customFieldForms.ts](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/utils/customFieldForms.ts:57).
- `CrudForm` merges explicit `initialValues`, but does not fill missing custom fields from definition defaults in [packages/ui/src/backend/CrudForm.tsx](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/CrudForm.tsx:1851).

The result is a broken end-to-end contract: the platform claims to support custom field defaults at the type and installation layer, but the admin UI and generated forms do not honor them.

## Problem Statement

The current implementation fails in four ways:

1. **Admin users cannot configure defaults from the main UI**
   The field definitions editor exposes labels, descriptions, options, visibility, and validation rules, but no default-value control.

2. **Existing defaults are effectively invisible**
   Defaults coming from module-seeded `ce.ts` fields or CLI-created definitions can be stored in `configJson`, but the normalized definitions response strips them before UI consumers see them.

3. **Generated forms do not apply defaults for new records**
   `CrudForm` auto-loads custom fields and injects them into create/edit flows, but missing field values stay empty unless every host page manually supplies `initialValues`.

4. **Dictionary-based CRM scenarios are blocked**
   The issue screenshot shows a customers dictionary list with an annotation pointing to a desired default value on the `customer` entry. The intended user story is clear: a dictionary-backed custom attribute such as status should be able to preselect a configured entry for new records.

Without fixing this, administrators must either:
- train users to remember a value on every create form,
- hardcode per-page defaults in individual modules,
- or rely on the CLI for something that should be manageable in the backend UI.

## Issue and Screenshot Analysis

Issue URL: `https://github.com/open-mercato/open-mercato/issues/824`

Issue title: `feat: Custom Atributes - Default Value`

The screenshot embedded in the issue was downloaded and inspected during this analysis. It shows:
- the Customers configuration area under backend settings,
- the "Customers dictionaries" section with status-like entries such as `active`, `customer`, `inactive`, and `prospect`,
- a red annotation reading "Default Value" with an arrow pointing at the `customer` row's action area (near the Edit button) in the dictionary entries table.

### Screenshot Interpretation Ambiguity

**Important ambiguity:** The screenshot annotation points at the **dictionary entries management table**, not at a field definition editor. Two valid interpretations exist:

| Interpretation | What the reporter may want | Implementation approach |
|---------------|---------------------------|------------------------|
| **A — Entry-level default** | Mark a dictionary entry as "the default" directly in the entries table | Add `isDefault` flag to `DictionaryEntry`; show toggle in entries editor |
| **B — Field-definition default** | Set a default value on the custom field definition that uses this dictionary | Expose `configJson.defaultValue` in the field definitions editor (this spec's approach) |

The issue body says only: *"To allow specifying a default value for a custom field. This is helpful, for example, when adding a new contact — all newly created contacts could automatically be assigned a predefined status."* This text supports interpretation B, but the screenshot's visual annotation squarely targets the dictionary entries table, which supports interpretation A.

**Decision:** This spec proceeds with interpretation B (field-definition-level defaults) because:
- the issue body explicitly asks for "a default value for a custom field,"
- the existing shared/public contract already includes `CustomFieldDefinition.defaultValue`,
- and the field-definition approach solves the broader contract gap already present in code.

Interpretation A (`isDefault` on `DictionaryEntry`) remains a viable dictionary-specific convenience alternative and is documented below, but it should not replace the primary recommendation of this spec unless product direction explicitly narrows the scope to dictionaries only.

### Inferences from the screenshot

- The reporter is likely thinking in terms of "make this value the default selection" rather than "type an arbitrary literal in a hidden JSON blob."
- Dictionary-backed defaults are the most concrete scenario we should optimize for in the first UX pass.
- The desired admin experience should be understandable to non-technical operators who manage statuses and field behavior from the backend.

This spec therefore treats dictionary-backed defaults as a core requirement, not a niche add-on.

## Current-State Analysis

### What already exists

The following contract pieces already support `defaultValue` conceptually:

| Surface | Current State |
|---------|---------------|
| Shared type | `CustomFieldDefinition.defaultValue?: string | number | boolean | null` exists |
| Module-declared custom fields | `defaultValue` is preserved during install from `ce.ts` |
| CLI | `mercato entities` CLI can write `configJson.defaultValue` |
| DB storage | `CustomFieldDef.configJson` is flexible JSON and already stores this data |

### What is missing

| Surface | Gap |
|---------|-----|
| Definitions API response | `defaultValue` is not included in the normalized DTO |
| OpenAPI schema | `defaultValue` is not documented in the definitions response schema |
| UI DTO | `CustomFieldDefDto` does not expose `defaultValue` |
| Admin field editor | No way to inspect or edit defaults |
| Form mapping | Default metadata is not carried from definition to form field |
| Create-form initialization | Missing values are not populated from defaults |
| Tests | No end-to-end coverage proving defaults survive definitions -> DTO -> create form |

### Root Cause

This is not a single missing input field. It is a multi-layer inconsistency caused by `defaultValue` being added to the shared model and installer paths without completing the runtime consumption path.

## Proposed Solution

Complete the custom-field default-value contract across storage, API normalization, admin editing, and create-flow form initialization.

### Functional Rules

1. `defaultValue` remains stored in `CustomFieldDef.configJson.defaultValue`.
2. `GET /api/entities/definitions` includes `defaultValue` in each item when present.
3. The field definitions editor lets admins view and update `defaultValue` in a type-aware way.
4. `CrudForm` applies a custom field default only when all of the following are true:
   - the form is in a create-like state,
   - the field is present in the loaded custom field definitions,
   - no explicit value exists in `initialValues`,
   - no current form value exists yet for that field.
5. Edit flows must not overwrite existing stored values with defaults.
6. Explicit host-provided `initialValues` always win over definition defaults.
7. A default must be validated and normalized according to the field kind before it is persisted or applied.

### Supported Kinds in Phase 1

| Kind | Supported default format | Notes |
|------|--------------------------|-------|
| `text` | string | Empty string allowed if intentionally configured |
| `multiline` | string | Stored as plain string |
| `integer` | number | Reject non-numeric values |
| `float` | number | Reject non-numeric values |
| `boolean` | boolean | Stored and applied as checkbox state |
| `select` (single) | string or number | Must match declared options when static options exist |
| `select` (multi) | deferred | Excluded from Phase 1 — the main blocker is runtime normalization and UX semantics for array defaults, not storage |
| `dictionary` | string | Use dictionary entry `value` token, not entry UUID |
| `currency` | string | Must match available currency option value |
| `date` | string | ISO-like date token as already expected by the form field |
| `datetime` | string | ISO datetime string |
| `relation` | deferred | Not included in Phase 1 due to unresolved UX and storage semantics |
| `attachment` | unsupported | No default attachment payload in Phase 1 |

### Phase-1 Restrictions

- `select` (multi) defaults are excluded because they introduce extra runtime normalization and UI-state complexity: array defaults, option reconciliation, clear/reset semantics, and consistent dirty-state behavior. Additive type widening is not itself the main blocker.
- `relation` defaults are excluded from implementation because relation fields typically need stable record identifiers, option loading, and clearer UX than a raw text token.
- `attachment` defaults are excluded because file ownership and storage references make a simple literal default unsafe.
- Expression-based defaults such as `now()`, `current_user`, or `copy from org setting` are out of scope.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Keep `defaultValue` inside `configJson` | No schema redesign is needed; this is already the contract used by CLI and installer paths |
| Apply defaults in `CrudForm`, not ad hoc in each module page | Keeps behavior consistent for all generated create flows using custom fields |
| Do not apply defaults on edit | Prevents accidental overwrites and respects persisted data |
| Use dictionary entry `value` as the default token | Stable with existing field input behavior and avoids tying defaults to entry UUIDs in form payloads |
| Validate defaults before save | Prevents invalid hidden state from breaking forms later |
| Add type-aware admin controls for common kinds | Reduces misconfiguration and matches the mental model shown by the issue screenshot |

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Host-page-only defaults via `initialValues` | Repeats logic across modules and does not solve admin-managed fields |
| Add a separate `default` column to `custom_field_defs` | Unnecessary schema churn; `configJson` already models this safely |
| Apply defaults server-side only on POST | Would leave forms visually empty and surprise users at save time |
| Add `isDefault` directly on dictionary entries and derive field defaults from that | See detailed analysis below — this is a **viable simpler alternative** for the dictionary-only use case |
| Apply defaults for edit when the current stored value is null | Hard to define consistently across modules and can mask intentional nulls |

### Alternative Deep Dive: `isDefault` on `DictionaryEntry`

This alternative was initially dismissed in one line but deserves deeper analysis because it may match the reporter's intent (see Screenshot Interpretation Dispute).

**How it would work:**
- Add an `is_default` boolean column to the `dictionary_entries` table (default `false`).
- Add a toggle/checkbox in the `DictionaryEntriesEditor` component for each entry row.
- Enforce at most one default entry per dictionary (clear previous default on toggle).
- When `CrudForm` initializes a dictionary-backed custom field with no value, query the dictionary entries for the one marked `isDefault` and apply it.

**Advantages:**
- The admin sets the default exactly where the screenshot points — the dictionary entries table.
- Zero changes to field definitions, DTOs, field definition editor, or the definitions API.
- Automatically applies to *every* custom field using that dictionary, not just one.
- Implementation scope: ~1 DB column, ~1 migration, ~1 UI toggle, ~1 CrudForm lookup. Estimated at roughly 10% of this spec's scope.
- No backward compatibility risk — purely additive column and UI.

**Disadvantages:**
- Only solves dictionary-backed fields; does not address `text`, `integer`, `boolean`, `select`, or other kinds.
- Couples "default" semantics to the dictionary layer rather than the field definition layer.
- If the same dictionary is used for two fields and they need different defaults, this cannot express that.

**Recommendation:** Keep this alternative documented as a possible follow-on or narrowed-scope product choice for dictionary-only defaults. The primary recommendation of this spec remains field-definition-level defaults because that is what the issue text and current code contract most directly support.

## Architecture

### 1. Definitions normalization

Update `GET /api/entities/definitions` in [packages/core/src/modules/entities/api/definitions.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/entities/api/definitions.ts:247) to include:
- `defaultValue` from `d.configJson.defaultValue`
- response schema support in `customFieldDefinitionSchema`

This is additive-only and backward compatible.

### 2. Admin editor UX

Extend [FieldDefinitionsEditor.tsx](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/custom-fields/FieldDefinitionsEditor.tsx:829) with a `Default value` section:
- `boolean`: checkbox
- `integer` / `float`: numeric input
- `text` / `multiline` / `date` / `datetime` / `currency`: text-like input
- `select`: picker from configured static options when present; fallback text input when options come only from URL
- `dictionary`: selector based on the configured dictionary entries

FieldRegistry kind-specific editors may augment or replace the common control where needed. For `dictionary`, the dictionaries module already owns field-kind-specific configuration UI, so it should also provide a type-safe default entry selector rather than forcing a raw text input.

#### Dictionary default selector — implementation detail

The dictionary default selector is the **primary UX element** for the most concrete use case. It must be well-specified:

- **Data/query reuse:** Reuse the dictionary entry loading/query layer where practical, such as the existing `useDictionaryEntries` hook from [packages/core/src/modules/dictionaries/components/hooks/useDictionaryEntries.ts](packages/core/src/modules/dictionaries/components/hooks/useDictionaryEntries.ts). Direct reuse of `DictionarySelectControl` is optional, not required — it is a runtime field input component and may not fit definition-editor UX cleanly without adaptation.
- **Prerequisite guard:** If `dictionaryId` has not been set on the field definition yet, the default selector must be **disabled** with a hint: "Select a dictionary first." Do not render an empty dropdown that fetches nothing.
- **Display:** Show human-readable `label` (with `color`/`icon` if available) but store the entry `value` token as the default.
- **Large dictionaries:** If the dictionary has many entries, the selector should be search-enabled (consistent with how dictionary fields already render in forms).
- **Stale default detection:** If the stored `defaultValue` does not match any current entry `value` in the dictionary, the selector must show a **warning indicator** (e.g., "Default entry not found — it may have been deleted or renamed") and allow the admin to clear or re-select. Do not silently swallow stale defaults in the editor — runtime forms may ignore them, but the admin editor must surface the problem.
- **Entry deletion cascade:** When a dictionary entry is deleted, the platform does not automatically clear `configJson.defaultValue` on field definitions referencing it. This is acceptable for Phase 1, but the editor must handle the mismatch gracefully as described above.

### 3. Form metadata

Update [packages/ui/src/backend/utils/customFieldDefs.ts](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/utils/customFieldDefs.ts:5) to include `defaultValue` on `CustomFieldDefDto`.

Update [packages/ui/src/backend/utils/customFieldForms.ts](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/utils/customFieldForms.ts:57) so the form field metadata retains `defaultValue` for downstream initialization.

### 4. Create-flow initialization in CrudForm

Enhance [packages/ui/src/backend/CrudForm.tsx](/Users/mariuszlewczuk/Projects/omML/packages/ui/src/backend/CrudForm.tsx:1851) with a one-time default application pass that runs after custom field definitions are available and before the user begins editing.

#### Create/edit mode detection

`CrudForm` does not currently expose a durable explicit `isCreate` prop, and relying on `initialValues.id` alone is too brittle for this codebase. Not every edit flow is guaranteed to provide a truthy top-level `id`, and some clone/embedded/custom-entity flows may not map cleanly to that heuristic.

The implementation should therefore avoid a naïve `initialValues.id` check. Preferred approaches, in order:

1. Add an explicit create-mode signal to the host/`CrudForm` contract if the implementation touches shared form behavior broadly.
2. If that is too large for Phase 1, apply defaults only in host flows that already know they are create pages and can opt into default application explicitly.
3. Treat clone/duplicate behavior as a product decision made by the host flow, not by a blind form heuristic.

This spec requires the implementation to choose a deterministic create-mode contract before coding begins. "Infer from top-level `id`" is not sufficient by itself.

#### Async timing and race condition mitigation

Custom field definitions load asynchronously via a query hook. The user may begin typing before definitions arrive. The implementation must handle this:

1. Use a **ref-based guard** (`defaultsAppliedRef`) initialized to `false`.
2. When definitions become available AND `defaultsAppliedRef.current === false`:
   - Compute default values from definitions.
   - For each defaulted field, check if the current form value is truly absent. **Do not overwrite** any field the user has already touched or intentionally cleared.
   - Merge defaults into form state via the form's `setValue` (or equivalent batch update).
   - Set `defaultsAppliedRef.current = true`.
3. If definitions refetch or change, **do not reapply**. The ref guard prevents this.
4. If the user clears a field that was filled by a default, the cleared value must be respected — no re-application.

#### Dirty-state baseline

After merging defaults, reset the form's dirty tracking baseline to include the applied defaults. This ensures the form does not appear dirty immediately after opening a create page with defaults.

#### Rules summary

- Compute defaults from loaded custom-field definitions.
- Skip any field already present in `initialValues`.
- Skip any field already set in current form state.
- Treat `undefined` as the safe "missing" sentinel by default. Be careful with `null`, empty string, and empty array — those may represent intentional user actions or host-provided values, not absence.
- Merge defaults into form values exactly once (ref-guarded).
- Treat merged values as part of the clean baseline so the form does not appear dirty.

### 5. Validation and normalization helper

Add a shared helper in the entities/custom-fields layer to:
- normalize raw configured defaults by kind,
- validate against options or dictionary tokens when possible,
- return either a normalized default or "no usable default".

This helper should be reused by:
- admin definition save validation,
- `CrudForm` default application,
- future server-side default enforcement if later desired.

## Data Models

### Existing model retained

No new table or column is required.

`custom_field_defs.config_json` already stores:
- `label`
- `description`
- `options`
- `dictionaryId`
- `validation`
- `defaultValue`

### Effective config contract

The effective custom field config JSON for supported kinds is:

```ts
type CustomFieldConfig = {
  label?: string
  description?: string
  options?: Array<string | number | boolean | { value: string | number | boolean; label?: string | null }>
  optionsUrl?: string
  dictionaryId?: string
  dictionaryInlineCreate?: boolean
  multi?: boolean
  editor?: string
  input?: string
  validation?: Array<{ rule: string; param?: unknown; message?: string }>
  defaultValue?: string | number | boolean | null | Array<string | number | boolean>
}
```

### Normalization rules

| Kind | Stored normalized shape |
|------|-------------------------|
| `boolean` | `true` or `false` |
| `integer` | JavaScript number with integer semantics |
| `float` | JavaScript number |
| `text` / `multiline` / `date` / `datetime` / `currency` | string |
| `select` (single) | scalar matching an option value |
| `select` (multi) | deferred to Phase 2 |
| `dictionary` | string token equal to dictionary entry `value` |

## API Contracts

### GET `/api/entities/definitions`

Additive response change:

```json
{
  "items": [
    {
      "key": "status",
      "kind": "dictionary",
      "label": "Status",
      "dictionaryId": "uuid",
      "defaultValue": "customer"
    }
  ]
}
```

### POST `/api/entities/definitions`

The existing request shape already accepts `configJson` as a passthrough object via `upsertCustomFieldDefSchema`. The behavior change is:
- `configJson.defaultValue` becomes a documented supported field,
- invalid defaults return `400`,
- dictionary defaults are validated only when a `dictionaryId` is configured.

### OpenAPI updates

Update `customFieldDefinitionSchema` and related docs in [packages/core/src/modules/entities/api/definitions.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/entities/api/definitions.ts:452) to document:
- `defaultValue` as optional additive field
- scalar or array behavior for supported kinds where practical to express

## UI / UX

### Field definition editor

Add a "Default value" control placed near kind-specific configuration, not hidden below visibility toggles.

Expected behavior:
- If the field kind changes to a kind incompatible with the stored default, the editor should either clear the default or show a validation error before save.
- For `dictionary`, the editor should show human labels but store the entry `value`.
- For `select` with static options, the editor should render the known options.
- Multi-select default editing is deferred to Phase 2 (see Phase-1 Restrictions).

### Create forms

When a user opens a create page for an entity with custom field defaults:
- the default values should already be visible in the form,
- the user can still change or clear them,
- the form should not be marked dirty just because defaults were applied automatically.

### Edit forms

When a user opens an existing record:
- stored values win,
- missing stored values remain missing unless the host page explicitly chooses to prefill them,
- no automatic backfill occurs.

## Integration Coverage

This feature affects both platform APIs and backend UI paths.

### API paths

- `GET /api/entities/definitions`
- `POST /api/entities/definitions`
- `POST /api/entities/definitions.batch`

### Key UI paths

- Backend data designer field definition editor for system entities
- Backend data designer field definition editor for user entities
- `CrudForm` create pages for any entity using `entityId` / `entityIds` custom field auto-loading
- Dictionary-backed custom field definition editing flow

## Testing Plan

### Unit / component coverage

1. Definitions API normalization test
   - stored `configJson.defaultValue` appears in `GET /api/entities/definitions`

2. DTO/form mapping test
   - `CustomFieldDefDto.defaultValue` survives fetch + mapping layers

3. `CrudForm` default application test
   - create form with custom fields receives defaults
   - defaults do not override explicit `initialValues`
   - defaults are not applied twice
   - form baseline stays clean after default injection

4. Admin editor component test
   - default value control renders for supported kinds
   - invalid numeric default is rejected
   - dictionary default selector stores dictionary entry `value`

5. Installer regression test
   - module-seeded `defaultValue` remains preserved and visible through definitions payload

### Integration coverage

Add self-contained integration tests covering:

| Test ID | Scenario |
|---------|----------|
| `TC-ENT-DEF-DEFAULT-001` | Create/update custom field definition with `defaultValue`; verify GET definitions returns it |
| `TC-ENT-DEF-DEFAULT-002` | Dictionary-backed custom field default is returned and applied on create |
| `TC-ENT-DEF-DEFAULT-003` | Edit existing record with stored custom field value does not get overwritten by default |
| `TC-ENT-DEF-DEFAULT-004` | Explicit create-page `initialValues` override definition default |

## Migration & Backward Compatibility

This change is additive and aligns the implementation with an already-published contract.

### Why this is backward compatible

- `CustomFieldDefinition.defaultValue` already exists on the public shared type.
- Persisted `configJson.defaultValue` values already exist for some CLI and module-seeded flows.
- Adding `defaultValue` to normalized API responses is an additive response-field change, which is allowed by the backward compatibility contract.
- No route URL, method, entity ID, ACL feature, or import path is removed or renamed.

### ⚠️ Multi-select default requires a type-widening change

The existing shared type at [entities.ts:53](packages/shared/src/modules/entities.ts#L53) declares:

```ts
defaultValue?: string | number | boolean | null
```

This spec's effective config contract adds `Array<string | number | boolean>` to support multi-select defaults. This is a **type-widening change** on the `CustomFieldDefinition` type, which is classified as STABLE under the backward compatibility contract. Widening a union type is additive-only and does not break existing consumers that handle the narrower type, but:

- Consumers performing exhaustive type checks (e.g., `switch` on `typeof defaultValue`) may not handle arrays.
- Serialization/deserialization code that assumes scalar `defaultValue` will silently drop arrays or error.

**Mitigation options:**
1. **Defer multi-select defaults to Phase 2** — keep the existing scalar type unchanged in Phase 1. This is the recommended approach.
2. **Widen the type now** — add `Array<string | number | boolean>` to the union and document it in RELEASE_NOTES.md as a minor type expansion. Low breakage risk but requires auditing all consumers.

**Decision:** Phase 1 excludes multi-select defaults. The shared type remains unchanged. Multi-select support is deferred until Phase 2 with an explicit type-widening PR.

### Compatibility cautions

- Consumers that assumed missing defaults in the definitions payload may now receive an extra optional field.
- Create forms using shared `CrudForm` behavior may start prepopulating fields that were previously blank. This is intended, but it changes create-form UX.

### No deprecation required

No public contract is being removed or renamed. This is a completion of an already additive type surface.

## Open Questions

These must be resolved before implementation begins:

| # | Question | Impact if wrong | Recommended action |
|---|----------|-----------------|-------------------|
| 1 | Does the reporter want entry-level defaults (interpretation A) or field-definition defaults (interpretation B)? | Building the wrong feature entirely | Ask the reporter on issue #824 |
| 2 | Should clone/duplicate flows receive defaults for empty fields? | UX surprise if defaults appear in cloned records | Confirm with product — spec currently treats clone as create-like |
| 3 | Is the `value` field on dictionary entries immutable once created? | If `value` can be renamed, stored defaults become stale silently | Audit dictionary entry update logic; consider `value` immutability constraint |

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Defaults overwrite real data on edit | High | Backend forms | Apply defaults only in create-like flows and only when field has no existing value | Low |
| Invalid default token breaks field rendering | Medium | Field editor + create forms | Validate and normalize defaults by kind before save and before apply | Low |
| Dictionary default becomes stale after entry rename | Low | Dictionary-backed fields | Store entry `value`, not label; labels can change safely | Low |
| Dictionary entry deletion leaves invalid default | Medium | Admin config | Surface empty/invalid selection in editor and ignore unusable default at runtime | Medium |
| Multi-select defaults mismatch runtime field shape | Medium | Select/tags fields | Normalize arrays consistently and cover with tests | Low |
| Defaults cause forms to appear dirty on load | Medium | CrudForm UX | Include default-applied values in clean baseline snapshot | Low |
| Existing seeded defaults remain invisible in some host flow | Medium | Cross-module consistency | Centralize behavior in definitions DTO + CrudForm rather than per-page logic | Low |
| Screenshot interpretation is wrong — reporter wanted `isDefault` on entries | High | Feature mismatch | Clarify with reporter before implementation (see Open Questions) | Medium |
| Multi-select defaults break shared type contract | High | Backward compatibility | Defer multi-select to Phase 2 (see Migration section) | Low |
| User types before definitions load, defaults overwrite input | Medium | CrudForm UX | Ref-guarded one-shot application that skips non-empty fields (see Architecture §4) | Low |
| Dictionary entry `value` renamed after default is set | Medium | Stale defaults | Surface warning in editor; runtime ignores unresolvable defaults | Medium |

## Rollout Notes

### Recommended Phase 1 scope narrowing

The issue provides one concrete scenario: dictionary-backed status defaults. All existing seeded defaults are booleans. Phase 1 should focus on **dictionary** and **boolean** kinds first, with remaining kinds (`text`, `integer`, `float`, `select` single, `currency`, `date`, `datetime`) following in Phase 1b once the core pipeline is proven.

This narrowing reduces:
- Editor UI surface from 10+ kind-specific controls to 2 (checkbox for boolean, dictionary entry selector for dictionary).
- Validation complexity to two well-defined shapes.
- Risk of shipping untested kind-specific defaults that break forms.

Remaining kinds are low-effort additions once the pipeline is complete — each requires only a kind-specific editor control and a normalization rule.

### Recommended implementation order

1. Normalize and document `defaultValue` in definitions API and DTOs.
2. Add editor UI for **dictionary** and **boolean** kinds.
3. Add `CrudForm` default application logic.
4. Add unit and integration coverage, with explicit dictionary-default end-to-end tests.
5. *(Phase 1b)* Add editor UI and normalization for remaining scalar kinds.

This ordering keeps the contract observable early and reduces debugging ambiguity.

## Final Compliance Report

| Check | Status | Notes |
|-------|--------|-------|
| TLDR included | PASS | Present |
| Overview included | PASS | Present |
| Problem statement included | PASS | Present |
| Proposed solution included | PASS | Present |
| Architecture included | PASS | Present |
| Data models included | PASS | Existing JSON contract documented |
| API contracts included | PASS | Definitions routes covered |
| Risks & impact review included | PASS | Present with severity/mitigation/residual risk |
| Migration & backward compatibility included | PASS | Additive-only analysis included |
| Key UI/API integration coverage listed | PASS | Present |
| Spec matches current naming convention | PASS | Uses date-based filename, not legacy `SPEC-*` prefix |

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — API normalization + DTO | Done | 2026-04-12 | `defaultValue` added to `candidateBase`, `customFieldDefinitionSchema`, and `CustomFieldDefDto` |
| Phase B — Admin editor UI | Done | 2026-04-12 | Boolean checkbox, dictionary entry selector (with stale detection), select picker, numeric input, text input for all supported kinds |
| Phase C — CrudForm default application | Done | 2026-04-12 | Ref-guarded one-shot effect, create-only via `operation === 'create'`, dirty baseline update |
| Phase D — Unit/integration tests | Done | 2026-04-12 | API normalization test + CrudForm default application tests (3 scenarios) |
| Phase 1b — Remaining scalar kinds editor | Done | 2026-04-12 | All scalar kinds included in Phase B editor (text, multiline, integer, float, select single, currency, date, datetime) |

### Files Modified

| File | Change |
|------|--------|
| `packages/core/src/modules/entities/api/definitions.ts` | Added `defaultValue` to `candidateBase` normalization and `customFieldDefinitionSchema` |
| `packages/ui/src/backend/utils/customFieldDefs.ts` | Added `defaultValue` to `CustomFieldDefDto` type |
| `packages/ui/src/backend/custom-fields/FieldDefinitionsEditor.tsx` | Added kind-aware default value controls (boolean, numeric, text-like, select with static options) |
| `packages/core/src/modules/dictionaries/fields/dictionary.tsx` | Added `DictionaryDefaultSelector` component with stale-default warning; wired into `DictionaryFieldDefEditor` |
| `packages/ui/src/backend/CrudForm.tsx` | Added ref-guarded default application effect for create flows |

## Changelog

| Date | Change |
|------|--------|
| 2026-04-12 | Initial analysis spec created from issue #824. Documents current partial `defaultValue` support, screenshot interpretation, and the end-to-end completion plan. |
| 2026-04-12 | **Review pass.** Added: Screenshot Interpretation Dispute section documenting ambiguity between entry-level vs field-definition defaults. Expanded `isDefault` on `DictionaryEntry` alternative with full pros/cons analysis. Identified multi-select default as a BC-breaking type-widening change — deferred to Phase 2. Added concrete CrudForm implementation sketch (create-detection heuristic, async timing with ref guard, dirty-state baseline). Added dictionary default selector implementation detail (component reuse, prerequisite guard, stale default detection, large-dictionary search). Narrowed recommended Phase 1 scope to dictionary + boolean kinds. Added Open Questions section with 3 blocking questions. Added 4 new risk entries. Noted that all existing seeded defaults are boolean-only — dictionary defaults are entirely untested. |
