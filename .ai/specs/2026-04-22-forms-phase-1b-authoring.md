# Forms Module — Phase 1b: Definition Authoring (CRUD + Studio)

> **Parent:** [`2026-04-22-forms-module.md`](./2026-04-22-forms-module.md)
> **Depends on:** [Phase 1a Foundation](./2026-04-22-forms-phase-1a-foundation.md).
> **Unblocks:** 1c (runtime API needs published versions), 2c (advanced fields use the diff UI that lands here).
> **Session sizing:** ~1–1.5 weeks.

## TLDR

- Admin API + UI to create forms, fork drafts, edit, publish, and archive.
- Enforce the immutability invariant at the service layer: any PATCH on a `published` version's `schema`, `ui_schema`, or `roles` is rejected.
- Minimal `FormVersionDiffer` — field-level added/removed/modified — powers the publish-screen preview and is re-used by phase 2c for the full diff viewer.
- Studio MVP is the simple form-based editor (left tree, middle preview, right property panel). Drag-and-drop visual builder is **not** in this phase.
- No submissions exist yet — publish produces a version, nothing consumes it until phase 1c.

## Overview

Phase 1b makes the module usable by an admin. It ships the admin-side API surface (forms CRUD + version lifecycle) and the studio UI (list page + editor page + a lightweight history modal). Every command is undoable where the state change is reversible (root AGENTS.md invariant) and emits the corresponding event from phase 1a's catalog.

## Problem Statement

The entities from 1a exist but nothing writes to them. Without 1b, the module is inert. Admins need to create a form, add fields, publish it, and see version history — but the full replay/diff UX belongs to phase 2c; this phase ships only what's needed to get a working `form_version` into production so phase 1c can build on top.

## Proposed Solution

1. Commands: `form.create`, `form.rename`, `form.archive`, `form.restore`, `form_version.fork_draft`, `form_version.update_draft`, `form_version.publish`, `form_version.archive`.
2. API handlers under `src/api/admin/` following `makeCrudRoute` patterns (root AGENTS.md → API Routes). All handlers export `openApi`.
3. `FormVersionDiffer` service producing `{ added, removed, modified }` field-level diff between any two versions.
4. Service-layer enforcement of immutable published versions + "only one draft per form" invariant.
5. Admin UI: `FormListPage` (table with filters + row actions), `FormEditorPage` (split-pane editor for the single active draft), `FormVersionHistoryPage` modal (timeline + publish dialog).
6. Cache invalidation via `@open-mercato/cache` tags: `forms.form:{id}`, `forms.form.list:{org_id}`, `forms.form_version:{id}`.
7. Publish flow captures `registry_version` at time of publish (from phase 1a's registry) — frozen on the row (R2 mitigation precursor).

## Architecture

### New files

```
packages/forms/src/
├─ commands/
│  ├─ form.ts                       # create/rename/archive/restore (+ undo inverses)
│  └─ form-version.ts               # fork_draft/update_draft/publish/archive
├─ services/
│  └─ form-version-differ.ts
├─ data/
│  └─ validators.ts                 # extended from 1a stub — full command schemas
├─ api/admin/
│  ├─ forms/
│  │  ├─ index.ts                   # GET list, POST create
│  │  └─ [id]/
│  │     ├─ index.ts                # GET detail, PATCH rename, DELETE archive
│  │     ├─ versions/
│  │     │  ├─ fork.ts              # POST fork draft
│  │     │  ├─ [versionId]/
│  │     │  │  ├─ index.ts          # PATCH update_draft
│  │     │  │  ├─ publish.ts        # POST publish
│  │     │  │  └─ diff.ts           # GET diff against :otherVersionId
├─ ui/admin/
│  ├─ forms/
│  │  ├─ page.tsx                   # FormListPage
│  │  ├─ create/page.tsx            # create dialog or page
│  │  └─ [id]/
│  │     ├─ page.tsx                # FormEditorPage
│  │     └─ history/page.tsx        # FormVersionHistoryPage modal route
```

### Service-layer invariants enforced here

1. **Form key uniqueness per organization** — DB UNIQUE constraint lands in 1a; service-layer friendly error maps it to `422 form_key_taken`.
2. **One draft per form** — `form_version.fork_draft` rejects when another `draft` exists for the same `form_id`.
3. **Published is frozen** — `form_version.update_draft` checks `status = 'draft'`; returns `422` otherwise.
4. **No-op publish rejection** — compares new `schema_hash` against the previously-published version; returns `422 no_op_publish` if unchanged.
5. **Registry version pin** — on publish, reads `fieldTypeRegistry.currentVersion()` and writes it to `form_version.registry_version`.

### FormVersionDiffer

```ts
type FieldDiff =
  | { kind: 'added'; key: string; field: FieldDescriptor }
  | { kind: 'removed'; key: string; field: FieldDescriptor }
  | { kind: 'modified'; key: string; changes: Array<{ path: string; before: unknown; after: unknown }> }

function diff(older: CompiledFormVersion, newer: CompiledFormVersion): FieldDiff[]
```

- Runs against compiled `fieldIndex` maps from phase 1a's compiler.
- Order-preserving: `added` and `removed` sorted by section then key; `modified` emits one entry per field with the deep-path change list.
- Pure function — no DB access — so it caches trivially in API handlers.

## Data Models

No new tables. Columns added to `form_version` by phase 1a are filled in by this phase's commands:

- `published_at`, `published_by`, `changelog` — set by `form_version.publish`.
- `registry_version` — set by `form_version.publish`.
- `archived_at` — set by `form_version.archive`.
- `form.current_published_version_id` — advances on publish.

## API Contracts

All handlers are admin-scoped; every request is filtered by `organization_id` from auth context; every input is Zod-validated; every GET exports `openApi`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/forms` | List forms (`status?`, `q?`, `page?`, `pageSize?`) |
| `POST` | `/api/forms` | Create form (`key`, `name`, `description?`, `default_locale`, `supported_locales`) |
| `GET` | `/api/forms/:id` | Form detail + versions summary |
| `PATCH` | `/api/forms/:id` | Rename / update description |
| `DELETE` | `/api/forms/:id` | Archive (soft-delete via `archived_at`) |
| `POST` | `/api/forms/:id/versions/fork` | Fork new draft (`from_version_id?`) |
| `PATCH` | `/api/forms/:id/versions/:versionId` | Update draft (`schema?`, `ui_schema?`, `roles?`, `changelog?`) — **422 if `status != draft`** |
| `POST` | `/api/forms/:id/versions/:versionId/publish` | Publish (`changelog`); emits `forms.form_version.published` |
| `GET` | `/api/forms/:id/versions/:versionId/diff?against=:otherVersionId` | Structural diff |

### Keep `pageSize <= 100` (root AGENTS.md).

### Error shape

- `422 validation_failed` — Zod error.
- `422 form_key_taken` — key collision.
- `422 no_op_publish` — schema unchanged from previous published.
- `422 draft_already_exists` — on fork when a draft already exists.
- `409 version_is_frozen` — on PATCH of a non-draft version.

## Commands & Undoability

| Command | Undoable? | Inverse |
|---|---|---|
| `form.create` | Yes | `form.archive` followed by hard-delete if nothing depends on it |
| `form.rename` | Yes | apply previous name |
| `form.archive` | Yes | `form.restore` |
| `form.restore` | Yes | `form.archive` |
| `form_version.fork_draft` | Yes | delete the draft (safe: no submissions can reference a draft) |
| `form_version.update_draft` | Yes | apply previous `{schema, ui_schema, roles}` snapshot |
| `form_version.publish` | Conditional | demote to draft if no submission has referenced it yet; otherwise the inverse is `form_version.archive` + new version |
| `form_version.archive` | Yes | restore |

## UI/UX

### FormListPage (`/backoffice/forms`)

- `DataTable` with filters (`status`, search by `q`), row actions (edit, view history, archive/restore, view submissions — opens phase 2a).
- Empty state + loading state per UI guidelines.
- Status column uses `StatusBadge` + `StatusMap<'draft'|'active'|'archived'>`.

### FormEditorPage (`/backoffice/forms/:id`)

- Three-pane layout (left structure tree, middle live preview via phase 1a's compiler + placeholder renderers, right property panel).
- Header shows current draft status pill (`DRAFT` amber) + schema hash.
- Changes autosave to the draft (`PATCH .../versions/:versionId` debounced at 2s).
- "+" button to add a field from the registry palette.
- Property panel per field type (adapts via `FieldTypeSpec`).
- Per-field PL/EN label toggle (translation gap indicator).
- "Compiled JSON" collapsible shows the `x-om-*` projection of the selected field.
- "Preview as" role toggle re-slices the preview via `rolePolicyLookup`.
- Publish button opens the history modal.

### FormVersionHistoryPage (modal)

- Vertical timeline of versions with status pills.
- Diff pane (added/removed/modified) when two versions are selected.
- Publish dialog with `changelog` textarea and the amber reassurance callout "Existing submissions pin to the version they were answered against — publishing cannot change them." (Reassurance language is a user-story requirement from the source draft; belongs here.)
- Footer preview: "On publish, emits `forms.form_version.published` and advances `form.current_published_version_id`."
- Full-feature diff viewer (side-by-side, field-level colour-coded) lands in **phase 2c**. This phase ships only the minimum needed for the publish dialog.

## Caching

Tags (via `@open-mercato/cache`):

- `forms.form.list:{organization_id}` — invalidated on any form mutation.
- `forms.form:{id}` — invalidated on rename/archive/publish.
- `forms.form_version:{id}` — invalidated on draft update/publish/archive.

## Risks & Impact Review

### R-1b-1 — Accidental rewrite of a published version

- **Scenario**: A race or misordered check lets a PATCH land on a published row.
- **Severity**: Critical (audit reproducibility).
- **Mitigation**: Service-layer re-reads `status` inside the same transaction as the UPDATE; uses `SELECT ... FOR UPDATE` to prevent lost-update. DB-layer defence in a later phase (CHECK constraint + trigger) is considered but not required here.
- **Residual risk**: Direct SQL bypass outside the service — covered by ops access controls, not by this module.

### R-1b-2 — Diff false positives after key-reorder

- **Scenario**: Two definitions identical modulo JSON key ordering produce a noisy diff.
- **Severity**: Low.
- **Mitigation**: Diff runs against compiled `fieldIndex` (order-independent), not raw JSON. `schemaHash` is computed over canonicalized keys in phase 1a.

### R-1b-3 — No-op publish floods version history

- **Scenario**: Admin clicks publish repeatedly; many identical versions proliferate.
- **Severity**: Low.
- **Mitigation**: `422 no_op_publish` when new `schema_hash` matches previous published.

### R-1b-4 — Undo of publish after submissions exist

- **Scenario**: Admin publishes, a patient submits, admin hits undo; demoting would break the submission's FK-pinned semantic.
- **Severity**: Medium.
- **Mitigation**: `form_version.publish` undo is conditional — the command registers its inverse as a `demote-to-draft` *only if* `SELECT 1 FROM form_submission WHERE form_version_id = :id LIMIT 1` returns nothing. Otherwise the inverse is `form_version.archive`, and the UI explains this at undo time.

## Implementation Steps

1. Extend `data/validators.ts` with full command schemas.
2. Implement commands in `commands/form.ts` and `commands/form-version.ts` with explicit inverses.
3. Implement `FormVersionDiffer` (pure function over compiled versions).
4. Implement API route handlers with `makeCrudRoute` where applicable; export `openApi`.
5. Wire cache invalidation tags.
6. Build `FormListPage`.
7. Build `FormEditorPage` with the three-pane layout, field palette, property panel, preview, "Preview as" toggle, compiled-JSON pane.
8. Build `FormVersionHistoryPage` modal with timeline, diff pane, publish dialog with reassurance + blast-radius footer.
9. Wire translations in `translations.ts` (form name + description + version changelog as translatable fields).
10. Run `yarn generate` and structural cache refresh.

## Testing Strategy

- **Integration — happy path**: create form → fork draft → edit draft → publish v1 → fork new draft → edit → publish v2 → GET diff.
- **Integration — immutability**: attempt to PATCH a published version → 409; service-layer double-check under concurrent PATCH returns 409 for the loser.
- **Integration — tenant isolation**: cross-org GET/PATCH attempts return 404.
- **Integration — no-op publish**: publish with identical schema returns 422.
- **Integration — undo scenarios**: publish undo demotes when no submissions exist (mocked); undo archives when submissions reference the version.
- **Unit — FormVersionDiffer**: added/removed/modified classification; deep-path change listing.
- **UI**: editor save debounce; "Preview as" role toggle changes rendered schema slice; publish dialog surfaces reassurance + blast-radius copy.
- **API contract tests**: every GET route exposes `openApi`; Zod schemas reject malformed payloads.

## Final Compliance Report — 2026-04-22

| Rule | Status | Notes |
|------|--------|-------|
| `makeCrudRoute` used where applicable | Compliant | Forms list + detail route |
| `openApi` exported on GET routes | Compliant | All four GETs listed above |
| Zod validation on every input | Compliant | Validators in `data/validators.ts` |
| Undoability matrix documented | Compliant | Table above |
| Cache tags declared | Compliant | Three tags listed |
| Events emitted via typed catalog | Compliant | `forms.form.*` + `forms.form_version.published` |
| Event IDs frozen | Compliant | Reuses 1a catalog unchanged |
| UI uses DataTable + StatusBadge + semantic tokens | Compliant | No hardcoded status colors |

**Verdict: ready for implementation post-1a.**

## Implementation Status

### Phase 1b — Done (2026-05-08)

Definition authoring landed on top of the phase 1a foundation (`packages/forms/`).

**Shipped**

- Validators extended in `data/validators.ts` with full command + API request schemas (`formCreateCommandSchema`, `formRenameCommandSchema`, `formArchiveCommandSchema`, `formRestoreCommandSchema`, `formVersionForkDraftCommandSchema`, `formVersionUpdateDraftCommandSchema`, `formVersionPublishCommandSchema`, `formVersionArchiveCommandSchema`, `formListQuerySchema`, plus the matching request-body schemas).
- Commands registered via `registerCommand`:
  - `forms.form.create` (Yes/undoable; inverse: hard-delete the just-created row).
  - `forms.form.rename` (Yes/undoable; inverse: apply previous snapshot).
  - `forms.form.archive` (Yes/undoable; inverse: restore previous status/`archived_at`).
  - `forms.form.restore` (Yes/undoable; inverse: archive the form again).
  - `forms.form_version.fork_draft` (Yes/undoable; inverse: delete the new draft — safe because no submission yet references it).
  - `forms.form_version.update_draft` (Yes/undoable; inverse: apply previous `{schema, ui_schema, roles, schemaHash, registryVersion, changelog}` snapshot).
  - `forms.form_version.publish` (Conditional/undoable; inverse: demote to draft when no submission references the version, otherwise archive). The submission probe (`hasSubmissionsForVersion`) uses an information-schema check so it works before phase 1c lands the submission table.
  - `forms.form_version.archive` (Yes/undoable; inverse: restore previous status/`archived_at`).
- `FormVersionDiffer` service at `services/form-version-differ.ts`, registered as DI key `formVersionDiffer`. Pure function over compiled `fieldIndex` maps producing `added`/`removed`/`modified` entries (deep-path change list per descriptor key).
- Service-layer invariants enforced inside `commands/form-version.ts`:
  - One draft per form — `forms.form_version.fork_draft` rejects with `422 forms.errors.draft_already_exists`.
  - Published is frozen — `forms.form_version.update_draft` rejects with `409 forms.errors.version_is_frozen`.
  - No-op publish — compares the compiled `schemaHash` against the previously-published version and rejects with `422 forms.errors.no_op_publish`.
  - `SELECT ... FOR UPDATE` (Kysely) inside the publish transaction prevents lost-update races.
  - Publish reads `fieldTypeRegistry.currentVersion()` and writes it into `form_version.registry_version`.
- Admin API handlers under `api/`:
  - `GET /api/forms`, `POST /api/forms` — list (filters: `status?`, `q?`, `page?`, `pageSize?` ≤100), create.
  - `GET /api/forms/:id`, `PATCH /api/forms/:id`, `DELETE /api/forms/:id` — detail + version summaries, rename, archive.
  - `POST /api/forms/:id/versions/fork`, `GET /api/forms/:id/versions/:versionId`, `PATCH /api/forms/:id/versions/:versionId`.
  - `POST /api/forms/:id/versions/:versionId/publish`, `GET /api/forms/:id/versions/:versionId/diff?against=:otherVersionId`.
  - Every handler exports `openApi`; per-method `metadata` declares `requireAuth: true` and `requireFeatures: ['forms.view']` (reads) / `['forms.design']` (writes). Mutation guard wired via `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` on every POST/PATCH/DELETE.
- Cache invalidation tags resolved via DI from `@open-mercato/cache` (`cacheService.deleteByTags`):
  - `forms.form.list:{organizationId}`
  - `forms.form:{formId}`
  - `forms.form_version:{versionId}`
  - Each command flushes the appropriate tag(s) after a successful write — including the previous `currentPublishedVersionId` on publish.
- Studio UI under `backend/forms/`:
  - `/backend/forms` — list page with `DataTable`, status filter (multi), search, row actions (Edit, History, Archive), `Tag`-based status pills.
  - `/backend/forms/create` — create dialog/form via `CrudForm`.
  - `/backend/forms/[id]` — three-pane editor (`FormStudio`): structure tree with field palette (all 11 v1 types), live preview that consumes `rolePolicyLookup` via the "Preview as" toggle, property panel per field (label, help, editable-by, visible-to, required, sensitive), compiled-JSON pane, header pill with `DRAFT` status + truncated `schema_hash`, autosave debounced at 2 s, and a publish dialog with the amber reassurance copy ("Existing submissions pin to the version they were answered against — publishing cannot change them.") and the blast-radius footer line ("On publish, emits `forms.form_version.published` and advances `form.current_published_version_id`."). Dialog supports `Cmd/Ctrl+Enter` submit and `Escape` cancel.
  - `/backend/forms/[id]/history` — vertical timeline of versions plus a minimal diff pane that consumes the diff API. Full side-by-side diff viewer remains scheduled for phase 2c per the spec.
- Translations declared in `translations.ts`: `forms:form` (`name`, `description`) and `forms:form_version` (`changelog`). Module-local locale strings under `i18n/en.json` (keys `forms.list.*`, `forms.create.*`, `forms.studio.*`, `forms.version.*`, `forms.errors.*`).

**Tests**

- `__tests__/form-version-differ.test.ts` — added/removed/modified classification; deep-path change listing; section-then-key sort order; identical-version null diff.
- `__tests__/commands-form.test.ts` — every command schema accepts/rejects expected shapes (incl. partial updates, role-identifier validation, UUID requirements).
- `__tests__/commands-form-version.test.ts` — fork rejects when draft exists, update rejects when status != draft, publish rejects no-op when previous schema hash matches, publish advances `currentPublishedVersionId` and emits `forms.form_version.published` with the expected payload (Form/Version state transitions verified via stubbed EM + container).
- All 76 forms tests passing (35 from phase 1a + 6 from phase 1c services + 35 from phase 1b new units).

**Verification (2026-05-08)**

- `yarn workspace @open-mercato/forms test` → 76/76 passing.
- `yarn workspace @open-mercato/forms typecheck` → clean.
- `yarn build:packages` → forms built from 55 entry points; all 19 packages green.
- `yarn db:generate` → `forms: no changes` (no entity changes this phase, as designed).
- `yarn generate` → forms appears across `entities.generated.ts`, `events.generated.ts`, `di.generated.ts`, `api-routes.generated.ts` (8 new admin route files), `backend-pages.generated.ts` (4 new pages), `translations-fields.generated.ts`.
- `yarn mercato configs cache structural --all-tenants` → cache purged + 77 generated barrels touched.

**Deviations from the spec text**

1. **API folder layout** — the spec described `src/api/admin/forms/...`. Implementation uses the auto-discovery convention `src/modules/forms/api/...` (the resolver doesn't honor an `admin/` prefix, and routes are registered by `module-id + relative path`). Final URL surface matches the spec exactly: `/api/forms`, `/api/forms/:id`, `/api/forms/:id/versions/...`.
2. **UI folder layout** — `src/ui/admin/...` in the spec; landed at `src/modules/forms/backend/forms/...` per the auto-discovery convention used by every other module.
3. **`createCrud` typing** — the create page calls `createCrud<{ id?: string | null }>('forms', payload)` using the package-relative path (`'forms'` rather than `/api/forms`) because `createCrud` already prefixes `/api/` internally. Functional behavior unchanged.
4. **Cache helpers** — invalidation uses `cacheService.deleteByTags(tags)` (the only public method on the cache service); the spec's `invalidateTag` shorthand isn't part of the package surface.
5. **Mutation-guard wiring** — used `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` (the legacy contract) per the spec text. Both still work via the bridge in `mutation-guard-registry.ts`. The newer `runMutationGuards` API can be migrated to without changing handler shape.
6. **Locale file location** — spec mentioned `apps/mercato/src/locales/en/forms.json`, but the canonical convention (used by every other module) is `<module>/i18n/<locale>.json`. The forms locale therefore lives at `packages/forms/src/modules/forms/i18n/en.json`.
7. **Knex vs. Kysely** — the spec mentioned a "select for update" lock; implementation uses `em.getKysely<any>()` (the standard escape hatch for raw SQL across Open Mercato modules) instead of MikroORM v7's `getKnex()` which is no longer exposed.
8. **Phase 1c overlap** — Phase 1c is in progress concurrently. Its routes (`api/forms/by-key/*`, `api/forms/submissions/*`) currently sit at the duplicated `/forms/forms/...` URL prefix. Phase 1b normalized the lifecycle routes to the spec-correct `/api/forms/...` shape. A cleanup PR may move 1c's runtime routes into `api/by-key/` and `api/submissions/` for symmetry; that's out of scope for 1b.

**Open questions**

- The publish-undo flow currently uses an information-schema probe to detect submissions (so 1b can ship before 1c's table exists). Once 1c lands, this probe transparently flips to a real existence check — no follow-up needed unless we want to keep an explicit dependency declaration.
- The full diff viewer UI lives in 2c per the spec — 1b ships only the minimal pane required by the publish dialog.

## Changelog

### 2026-04-22
- Initial spec split from main.

### 2026-05-08
- Phase 1b implemented and landed. See Implementation Status above.
