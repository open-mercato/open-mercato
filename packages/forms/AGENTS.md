# Forms Package — Agent Guidelines

Use `@open-mercato/forms` for the audit-grade questionnaire / form primitive: versioned form definitions, append-only submission revisions, role-sliced rendering, and GDPR-safe anonymization. First consumer is DentalOS medical questionnaires; same primitives serve B2B onboarding, RFPs, NPS, HR, and maintenance checklists.

The module ships in phases — see `.ai/specs/2026-04-22-forms-module.md` and the per-phase sub-specs (`2026-04-22-forms-phase-1a` … `phase-3`).

## MUST Rules

1. **MUST treat published `form_version` rows as immutable** — once `status = published`, never UPDATE `schema`, `ui_schema`, or `roles`. All edits fork a new `draft` row. Phase 1b enforces this in the command layer; phase 1a only ships the DB-shape constraint (`UNIQUE (form_id, version_number)`).
2. **MUST scope every entity query by `organization_id` AND `tenant_id`** — both columns live on `forms_form` and `forms_form_version` and are mandatory in every read filter.
3. **MUST keep event IDs frozen** — the catalog in `events.ts` is a contract surface (root AGENTS.md § BC § 5). Adding new IDs is additive; renaming/removing is a breaking change requiring the deprecation protocol.
4. **MUST register new field types via `FieldTypeRegistry.register(...)`** with the full `{ validator, renderer, defaultUiSchema, exportAdapter }` quartet. `renderer` may be `null` until the renderer module wires it via `setRenderer(...)`. Never bypass the registry in compilers, runners, or exporters.
5. **MUST add the OM extension keyword to `OM_FIELD_KEYWORDS` / `OM_ROOT_KEYWORDS`** before consuming it in the compiler — `x-om-*` keywords are part of the schema-format contract and must be discoverable from one place.
6. **MUST canonicalize before hashing** — `schema_hash` is the SHA-256 of `canonicalize({ schema, ui_schema })`. Order-sensitive hashes break cache, signed PDFs, and audit trails.
7. **MUST capture `registry_version` at publish time** on `form_version.registry_version`. The renderer (phase 1d) compares it to the live registry to detect drift (R2 mitigation).
8. **MUST resolve services via DI** — `formVersionCompiler` and `fieldTypeRegistry` are the registered keys. Never `new FormVersionCompiler()` outside `di.ts`.

## DI Keys (FROZEN)

| Key | Type | Purpose |
|-----|------|---------|
| `formVersionCompiler` | `FormVersionCompiler` | Compiles `(schema, ui_schema)` into `{ ajv, zod, fieldIndex, rolePolicyLookup, schemaHash, registryVersion }` with LRU cache keyed on `${id}:${updatedAt.toISOString()}` |
| `fieldTypeRegistry` | `FieldTypeRegistry` | Singleton lookup of registered field types — preloaded with the 11 v1 core types |

## Schema Format (v1) — Locked In

Every form definition is a JSON Schema 7-shaped object decorated with `x-om-*` extension keywords. The full keyword catalog lives in `src/modules/forms/schema/jsonschema-extensions.ts`. v1 keywords are FROZEN; new keywords are additive.

| Keyword | Level | Type |
|---------|-------|------|
| `x-om-roles` | root | `string[]` |
| `x-om-default-actor-role` | root | `string` |
| `x-om-sections` | root | `{ key, title: { [locale]: string }, fieldKeys: string[] }[]` |
| `x-om-type` | field | `string` (resolves in `FieldTypeRegistry`) |
| `x-om-label` | field | `{ [locale]: string }` |
| `x-om-help` | field | `{ [locale]: string }` |
| `x-om-editable-by` | field | `string[]` (defaults to `['admin']`) |
| `x-om-visible-to` | field | `string[]` (defaults to editable ∪ `admin`) |
| `x-om-sensitive` | field | `boolean` |
| `x-om-visibility-if` | field | jsonlogic — evaluated by phase 2c |
| `x-om-options` | field | `{ value, label: { [locale]: string } }[]` |
| `x-om-min` / `x-om-max` | field | `number` |
| `x-om-widget` | field | `string` (uiSchema widget override) |

## v1 Field Types (FROZEN core list)

`text`, `textarea`, `number`, `integer`, `boolean`, `date`, `datetime`, `select_one`, `select_many`, `scale`, `info_block`. Vertical extensions (signature, file, tooth chart, body diagram) land in phases 2c/3.

## Module Structure

```text
packages/forms/src/modules/forms/
├── acl.ts                          # Phase 1a — feature catalog
├── events.ts                       # Phase 1a — event ID catalog (FROZEN)
├── events-payloads.ts              # Phase 1a — Zod payload schemas keyed by event ID
├── di.ts                           # Phase 1a — DI registrar
├── index.ts                        # Phase 1a — module metadata
├── setup.ts                        # Phase 1a — defaultRoleFeatures
├── translations.ts                 # Phase 1a — translatable fields stub
├── data/
│   ├── entities.ts                 # Phase 1a — Form, FormVersion (1c adds submission entities)
│   └── validators.ts               # Phase 1a — formKeySchema, localeSchema, roleIdentifierSchema
├── migrations/                     # Per-phase progressive migrations
├── schema/
│   ├── field-type-registry.ts      # Phase 1a — registry + 11 v1 core types
│   └── jsonschema-extensions.ts    # Phase 1a — OM keyword catalog + AJV registration
└── services/
    └── form-version-compiler.ts    # Phase 1a — schema → AJV + Zod + role policy
```

Future phases append `commands/`, `api/`, `ui/`, `subscribers/`, more entities under `data/`, and additional services. The directory above is canonical for phase 1a.

## Phase Map

| Phase | Lands |
|-------|-------|
| 1a Foundation | This phase. Module scaffold, entities, schema, registry, compiler, events catalog, ACL, setup. |
| 1b Authoring | Admin CRUD, fork-draft / publish commands, FormVersionDiffer, studio UI. |
| 1c Submission Core | `form_submission`, `form_submission_actor`, `form_submission_revision`, EncryptionService, RolePolicyService, runtime API. |
| 1d Public Renderer | Hand-rolled FormRunner, ResumeGate, autosave loop, sectioned flow, review step. |
| 2a Admin Inbox | Submission list, drawer, revision replay, reopen, actor assign/revoke. |
| 2b Compliance | Access audit, PDF snapshot, anonymize command + UI. |
| 2c Advanced Fields | Conditional visibility (jsonlogic), version history + diff viewer, signature field, file field. |
| 3 Vertical Extensions | Tooth chart, body diagram, analytics, webhook wiring, consent aggregate. |

## ACL Features

| Feature | Granted by default to | Purpose |
|---------|-----------------------|---------|
| `forms.view` | `admin` | Read forms, versions, and submissions from admin surfaces |
| `forms.design` | `admin` | Create / edit / publish forms (1b consumer) |
| `forms.submissions.manage` | `admin` | Reopen, assign actors, export PDF (2a consumer) |
| `forms.submissions.anonymize` | `admin` | Trigger GDPR erasure (2b consumer) |

When DentalOS or another vertical introduces a `clinician` (or similar) role, extend `setup.ts` `defaultRoleFeatures` to grant `forms.view + forms.submissions.manage` and run `yarn mercato auth sync-role-acls`.

## Cross-Reference

- Parent spec: `.ai/specs/2026-04-22-forms-module.md`
- Phase 1a spec: `.ai/specs/2026-04-22-forms-phase-1a-foundation.md`
- Module Development Quick Reference: root `AGENTS.md` and `packages/core/AGENTS.md`
- Reference module for CRUD copy-paste: `packages/core/src/modules/customers/`
- Event factory: `packages/shared/src/modules/events/factory.ts`
- DI container types: `packages/shared/src/lib/di/container.ts`
