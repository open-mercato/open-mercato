# Forms Module — Phase 1a: Foundation

> **Parent:** [`2026-04-22-forms-module.md`](./2026-04-22-forms-module.md)
> **Depends on:** none — must land first.
> **Unblocks:** 1b (Authoring), 1c (Submission Core).
> **Session sizing:** ~1 week of focused work for one agent/engineer.

## TLDR

- Scaffold the `@open-mercato/forms` module shell per root AGENTS.md conventions.
- Introduce the two "definition-side" entities (`form`, `form_version`) and their migration.
- Ship the JSON Schema + OM-extensions format, the field-type registry (v1 core types only), and the `FormVersionCompiler` that produces AJV + Zod + role-policy lookup from a compiled version.
- Wire ACL features, setup hooks, event catalog, translations stub, and `registry.ts` DI bindings — so every later phase imports from a stable base.
- **No user-facing behavior yet**: this phase lands infrastructure, not pages or APIs with business effects. Phase 1b turns this into an admin-usable CRUD.

## Overview

Phase 1a is foundational plumbing: module files, a clean migration, a compiler, a registry. It is intentionally boring. The goal is that every subsequent phase can `import { FormVersionCompiler } from '@open-mercato/forms/services/form-version-compiler'` (or equivalent) and that the migration produced here never has to be rewritten — later phases add tables via *additive* migrations, not rewrites.

## Problem Statement

Without a firm foundation, downstream phases either duplicate concerns (e.g. each phase writing its own JSON-Schema validator) or embed brittle coupling (e.g. the renderer importing studio code). Phase 1a solves this by defining the *contract surface* other phases consume: schema format, field-type registry, compiler output shape, event IDs, ACL features, DI keys.

## Proposed Solution

1. Create `packages/forms/` workspace with `package.json`, `mikro-orm.config.ts`, `AGENTS.md`, `index.ts`, `registry.ts`, `acl.ts`, `setup.ts`, `events.ts`, `translations.ts`.
2. Define MikroORM entities: `Form`, `FormVersion`.
3. Emit a single migration creating `forms_form` and `forms_form_version` tables with required indexes and the UNIQUE `(organization_id, key)` constraint.
4. Ship the v1 JSON Schema meta-schema + `x-om-*` extensions under `src/schema/jsonschema-extensions.ts`.
5. Ship the field-type registry (`src/schema/field-type-registry.ts`) with v1 core types: `text`, `textarea`, `number`, `integer`, `boolean`, `date`, `datetime`, `select_one`, `select_many`, `scale`, `info_block`. Each entry: `{ validator, renderer: null, defaultUiSchema, exportAdapter }`. Renderers land in phase 1d; storing `null` here keeps the registry shape stable.
6. Implement `FormVersionCompiler` (`src/services/form-version-compiler.ts`): given `(schema, uiSchema)`, returns `{ ajv, zod, fieldIndex, rolePolicyLookup, schemaHash }`. Caches per `(version_id, updated_at)`.
7. Declare the event catalog via `createModuleEvents()` — the concrete payload shapes live here; emission lives in phases 1b/1c/2b.
8. Register ACL features in `acl.ts` and declare them in `setup.ts defaultRoleFeatures`.
9. Add `AGENTS.md` at module root describing the conventions this phase enforces (immutable versions, schema format lock-in, DI key names).

## Architecture

### Module files landing this phase

```
packages/forms/
├─ src/
│  ├─ entities/
│  │  ├─ form.ts
│  │  └─ form-version.ts
│  ├─ services/
│  │  └─ form-version-compiler.ts
│  ├─ schema/
│  │  ├─ field-type-registry.ts
│  │  └─ jsonschema-extensions.ts
│  ├─ events.ts
│  ├─ acl.ts
│  ├─ setup.ts
│  ├─ translations.ts
│  ├─ registry.ts
│  └─ index.ts
├─ migrations/
│  └─ <timestamp>-create-forms-foundation.ts
├─ mikro-orm.config.ts
├─ package.json
└─ AGENTS.md
```

### FormVersionCompiler output contract

```ts
type CompiledFormVersion = {
  schemaHash: string                // SHA-256 of canonicalized schema + uiSchema
  ajv: ValidateFunction             // compiled AJV validator
  zod: z.ZodTypeAny                 // Zod mirror for API layer
  fieldIndex: Record<string, FieldDescriptor>   // flat map by field key
  rolePolicyLookup: (role: string, fieldKey: string) => {
    canRead: boolean
    canWrite: boolean
  }
  registryVersion: string           // pinned at publish time for R2 mitigation
}
```

- Cache key: `${version_id}:${updated_at.toISOString()}`.
- Cache eviction: LRU bounded by `FORMS_COMPILER_CACHE_MAX` (default 200).
- Compile failure on unregistered `x-om-type` produces a typed `FormCompilationError` — surfaced at publish time in phase 1b.

## Data Models

### `form` (singular)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid | FK id to organizations |
| `key` | text | `UNIQUE (organization_id, key)` |
| `name` | text | |
| `description` | text | nullable |
| `status` | text | `draft` \| `active` \| `archived` |
| `current_published_version_id` | uuid | nullable; FK id to `form_version` |
| `default_locale` | text | |
| `supported_locales` | text[] | |
| `created_by` | uuid | FK id |
| `archived_at` | timestamptz | nullable |
| `created_at` / `updated_at` | timestamptz | implied |

Indexes: `(organization_id, key)` unique; `(organization_id, status)`.

### `form_version`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `form_id` | uuid | FK id |
| `organization_id` | uuid | Denormalized |
| `version_number` | int | Monotonic per form |
| `status` | text | `draft` \| `published` \| `archived` |
| `schema` | jsonb | JSON Schema + `x-om-*` extensions |
| `ui_schema` | jsonb | Layout/widgets/conditional rules |
| `roles` | jsonb | Array of role identifiers |
| `schema_hash` | text | SHA-256 of canonicalized `schema`+`ui_schema` |
| `registry_version` | text | Pinned at publish — used by R2 mitigation |
| `published_at` | timestamptz | nullable |
| `published_by` | uuid | nullable |
| `changelog` | text | nullable |
| `archived_at` | timestamptz | nullable |

Invariants: one `draft` per `form_id`; `(form_id, version_number)` unique. **Service-layer immutability check** (published rows reject UPDATE on `schema`, `ui_schema`, `roles`) — enforced in phase 1b's command layer, but the DB constraint landing here is the unique `(form_id, version_number)` index that prevents accidental duplication.

## Schema Format

v1 OM extensions (authoritative list — consumed by every downstream phase):

| Keyword | Level | Meaning |
|---------|-------|---------|
| `x-om-roles` | root | Array of role identifiers |
| `x-om-default-actor-role` | root | Role auto-assigned on start |
| `x-om-sections` | root | Ordered section list |
| `x-om-type` | field | Field type key (must resolve in registry) |
| `x-om-label` | field | `{ [locale]: string }` |
| `x-om-help` | field | `{ [locale]: string }` |
| `x-om-editable-by` | field | Array of roles; defaults to `["admin"]` |
| `x-om-visible-to` | field | Array of roles; defaults to union of editable + `admin` |
| `x-om-sensitive` | field | Triggers log/trace redaction + per-field encryption hardening |
| `x-om-visibility-if` | field | jsonlogic expression (evaluated in phase 2c) |
| `x-om-options` | field (select) | `{ value, label: {locale:string} }[]` |
| `x-om-min` / `x-om-max` | field (scale/number) | Bounds |
| `x-om-widget` | field | uiSchema widget override |

## API Contracts

**None ship this phase.** API handlers land in phase 1b (admin) and 1c (runtime). This phase only ships the Zod schemas that those handlers will consume (`src/data/validators.ts` — empty shell with the `formKeySchema`, `localeSchema`, `roleIdentifierSchema` primitives).

## Events

Catalog declared via `createModuleEvents()` in `events.ts`. Each event has a fully-typed payload. **Emission** is the responsibility of the phase that owns the corresponding mutation. The catalog itself is a contract surface — the IDs are frozen (root AGENTS.md BC contract § 5).

```ts
// events.ts (phase 1a)
export const eventsConfig = createModuleEvents({
  'forms.form.created': z.object({ formId: z.string().uuid(), organizationId: z.string().uuid() }),
  'forms.form.archived': z.object({ formId: z.string().uuid() }),
  'forms.form_version.published': z.object({
    formId: z.string().uuid(),
    versionId: z.string().uuid(),
    versionNumber: z.number().int(),
    publishedBy: z.string().uuid(),
  }),
  'forms.submission.started': z.object({ submissionId: z.string().uuid(), formVersionId: z.string().uuid() }),
  'forms.submission.revision_appended': z.object({
    submissionId: z.string().uuid(),
    revisionId: z.string().uuid(),
    savedBy: z.string().uuid(),
    savedByRole: z.string(),
    changedFieldKeys: z.array(z.string()),
  }),
  'forms.submission.submitted': z.object({ submissionId: z.string().uuid() }),
  'forms.submission.reopened': z.object({ submissionId: z.string().uuid() }),
  'forms.submission.actor_assigned': z.object({
    submissionId: z.string().uuid(),
    userId: z.string().uuid(),
    role: z.string(),
  }),
  'forms.submission.anonymized': z.object({ submissionId: z.string().uuid() }),
  'forms.attachment.uploaded': z.object({ attachmentId: z.string().uuid(), submissionId: z.string().uuid() }),
} as const)
```

## Access Control

`acl.ts` features introduced this phase:

| Feature | Purpose |
|---------|---------|
| `forms.view` | Read forms/versions/submissions from admin surfaces |
| `forms.design` | Create/edit/publish forms (used by 1b) |
| `forms.submissions.manage` | Reopen, assign actors, export PDF (used by 2a) |
| `forms.submissions.anonymize` | Trigger GDPR erasure (used by 2b) |

`setup.ts defaultRoleFeatures`: map to platform roles (`admin` → all four; a future `clinician` role → `forms.view` + `forms.submissions.manage`).

## DI Bindings (`registry.ts`)

- `formVersionCompiler` → `FormVersionCompiler` (singleton)
- `fieldTypeRegistry` → `FieldTypeRegistry` (singleton)

Phases 1b/1c/2b will add more.

## Risks & Impact Review

### R-1a-1 — Registry shape churn

- **Scenario**: Post-1a, field type spec needs a new property (e.g. `migrate` function); every downstream phase breaks.
- **Severity**: Medium.
- **Mitigation**: Registry entries are typed as `FieldTypeSpec` with optional properties only after the required trio `{ validator, defaultUiSchema, exportAdapter }`. Additions are forward-compatible. `renderer` is the *only* intentionally-nullable required property in 1a (filled by 1d).
- **Residual risk**: Renaming a required property still breaks BC — the BC contract § 2 (Type Definitions) applies.

### R-1a-2 — Compiler cache staleness

- **Scenario**: Cache keyed on `(version_id, updated_at)` misses when a draft is edited in-place without bumping `updated_at`.
- **Severity**: Low (MikroORM bumps `updated_at` on save; covered by tests).
- **Mitigation**: Unit test explicitly patches `updated_at` to simulate stale cache; asserts recompile happens.

### R-1a-3 — Registry version drift between publish and render (R2 precursor)

- **Scenario**: `form_version.registry_version` pinned at publish, but runtime registry advances; render silently uses new semantics.
- **Severity**: High (legal defensibility of old submissions).
- **Mitigation (partial)**: Column lands here; enforcement ("warn on registry mismatch at render time") lands in 1d. 1a owns only the *capture* of the pinned value on publish (actual publish command in 1b reads the current registry version).

## Implementation Steps

1. Scaffold `packages/forms/` with `package.json`, `tsconfig`, `mikro-orm.config.ts`, empty `AGENTS.md`.
2. Write entities `Form`, `FormVersion`.
3. Run `yarn db:generate` to produce the migration.
4. Implement `jsonschema-extensions.ts` with the v1 OM extension meta-schema (AJV-compatible).
5. Implement `FieldTypeRegistry` with the 11 core types (no renderers yet).
6. Implement `FormVersionCompiler` with canonicalization (sort keys for `schema_hash`), AJV compile, Zod mirror, role-policy lookup, field index, LRU cache.
7. Declare events in `events.ts`.
8. Declare features in `acl.ts`; wire `setup.ts defaultRoleFeatures`.
9. Declare DI bindings in `registry.ts`.
10. Enable the module in `apps/mercato/src/modules.ts`; run `yarn generate`; run `yarn mercato configs cache structural --all-tenants`.
11. Add AGENTS.md for the module capturing the conventions introduced here.

## Testing Strategy

- **Unit — FormVersionCompiler**:
  - Valid schema compiles; `schemaHash` is stable across key reordering.
  - Invalid schema (missing `type` on property) produces `FormCompilationError` with path.
  - Unregistered `x-om-type` fails compile with helpful message.
  - `editable-by` referencing a role not in `x-om-roles` fails compile.
  - Cache hit on repeated compile with same `(id, updated_at)`; cache miss on changed `updated_at`.
- **Unit — FieldTypeRegistry**: each of 11 core types round-trips through its `validator` + `exportAdapter`.
- **Unit — Schema meta-schema**: rejects `x-om-type` not being a string; rejects `x-om-editable-by` not being an array of strings.
- **Integration — migration**: fresh DB, apply migration, assert two tables + indexes; reverse migration is clean.
- **Smoke — module boot**: `yarn generate` passes; module appears in registry; no TS errors in a consuming build.

## Final Compliance Report — 2026-04-22

| Rule | Status | Notes |
|------|--------|-------|
| Singular entity/event naming | Compliant | `form`, `form_version`; events namespaced `forms.*` |
| No cross-module ORM relations | Compliant | `organization_id`, `created_by` stored as FK ids |
| Tenant scoping | Compliant | `organization_id` on both entities |
| BC contract — events frozen | Compliant | Full catalog declared up-front with final IDs |
| BC contract — type definitions stable | Compliant | Registry spec shape locked; additions optional-only |
| Zod validation shells | Compliant | `data/validators.ts` primitives ready for phase 1b |
| Migration generated, not hand-written | Compliant | Produced via `yarn db:generate` |

**Verdict: ready for implementation.**

## Implementation Status

### Phase 1a — Done (2026-05-08)

Foundation landed in `packages/forms/` (new top-level workspace package).

**Shipped**
- Workspace scaffold: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `build.mjs`, `watch.mjs`, `jest.config.cjs`, `AGENTS.md`, `CLAUDE.md`, root `src/index.ts` barrel.
- Module files at `packages/forms/src/modules/forms/`: `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `events-payloads.ts` (Zod payload schemas), `translations.ts`, `di.ts`.
- Entities `Form` (`forms_form`) and `FormVersion` (`forms_form_version`) in `data/entities.ts` with all required indexes, including `UNIQUE (organization_id, key)` on form and `UNIQUE (form_id, version_number)` on form_version.
- Validators stub at `data/validators.ts`: `formKeySchema`, `localeSchema`, `roleIdentifierSchema` Zod primitives.
- JSON Schema OM extensions meta-schema at `schema/jsonschema-extensions.ts` — keyword catalog, per-keyword validators, `addOmKeywords(ajv)` registration.
- `FieldTypeRegistry` at `schema/field-type-registry.ts` preloaded with all 11 v1 core types (`text`, `textarea`, `number`, `integer`, `boolean`, `date`, `datetime`, `select_one`, `select_many`, `scale`, `info_block`); `renderer: null` on every entry — phase 1d will call `setRenderer(...)`.
- `FormVersionCompiler` at `services/form-version-compiler.ts` returning `{ schemaHash, ajv, zod, fieldIndex, rolePolicyLookup, registryVersion }`, LRU cache keyed on `${id}:${updatedAt.toISOString()}` with `FORMS_COMPILER_CACHE_MAX` (default 200), `FormCompilationError` class with typed codes (`MISSING_TYPE`, `UNKNOWN_TYPE`, `ROLE_NOT_DECLARED`, `INVALID_REGEX_PATTERN`, `INVALID_EXTENSION`, `AJV_COMPILE_FAILED`, `INVALID_SCHEMA_SHAPE`).
- Events catalog (`events.ts`) declaring all 10 event IDs from the parent spec with `createModuleEvents`. Event IDs are FROZEN per BC contract § 5.
- DI registration (`di.ts`): `formVersionCompiler` and `fieldTypeRegistry` singletons.
- ACL features (`acl.ts`): `forms.view`, `forms.design`, `forms.submissions.manage`, `forms.submissions.anonymize`. Setup grants admin all four.
- Migration `Migration20260508135459_forms.ts` with snapshot at `migrations/.snapshot-open-mercato.json` — generated via `yarn db:generate`.
- 35 unit tests across 3 files (`field-type-registry.test.ts`, `jsonschema-extensions.test.ts`, `form-version-compiler.test.ts`) — all passing.
- Module enabled in `apps/mercato/src/modules.ts`; workspace dependency added to `apps/mercato/package.json`.

**Verification (2026-05-08)**
- `yarn build:packages`: pass (forms built from 14 entry points; all 19 packages green).
- `yarn workspace @open-mercato/forms test`: 35/35 passing.
- `yarn workspace @open-mercato/forms typecheck`: clean.
- `yarn generate`: forms appears in `entities.generated.ts`, `events.generated.ts`, `di.generated.ts`.
- `yarn db:generate`: forms reports `no changes` after the foundation migration is committed.
- `yarn mercato configs cache structural --all-tenants`: clean.

**Deviations from the spec text**
1. **DI file is `di.ts`, not `registry.ts`** — the actual generator (resolver in `packages/cli/src/lib/resolver.ts`) and root AGENTS.md "Optional Module Files" table both use `di.ts` with `register(container)`. Used the convention.
2. **Module nested at `src/modules/forms/`, not flat at `src/`** — required by the auto-discovery resolver (`pkgDirFor()` looks for `packages/<pkg>/src/modules/<module>`). Mirror of `packages/onboarding`, `packages/webhooks`, `packages/content`.
3. **No `mikro-orm.config.ts`** — no other workspace package has one; entities are auto-discovered via `yarn generate` and the central app's mikro-orm wiring.
4. **Event payload schemas live in a sibling `events-payloads.ts`** — `createModuleEvents()` does not take Zod payloads, so the typed payload schemas are exported alongside the catalog as `formsEventPayloadSchemas` for downstream emitters to validate against.

## Changelog

### 2026-04-22
- Initial spec split from `2026-04-22-forms-module.md` main spec.

### 2026-05-08
- Phase 1a implemented and landed. See Implementation Status above.
