# Code-Based Workflow Definitions with Type-Safe Builder API

## TLDR

**Key Points:**
- Introduce a `defineWorkflow()` TypeScript builder API that provides compile-time type safety for step IDs, transition references, and activity definitions — turning runtime `STEP_NOT_FOUND` errors into TS compiler errors.
- Code-based workflow definitions live purely in memory (populated at bootstrap from a generated registry). No DB row is created until a user customizes the definition.
- Add a `workflows.ts` auto-discovery convention at module root, following the established `events.ts` / `search.ts` pattern.

**Scope:**
- `packages/shared/src/modules/workflows/` — builder API and types
- `packages/cli/src/lib/generators/extensions/` — generator extension for `workflows.ts` discovery
- `packages/core/src/modules/workflows/` — in-memory registry, executor integration, API merge logic
- `packages/core/src/modules/workflows/data/` — `code_workflow_id` column for override tracking

**Out of Scope:**
- Visual editor changes for building code-based definitions (existing editor unchanged)
- Activity function registry with compile-time function reference checking (Phase 4 / future spec)
- Deploy-time command infrastructure (prerequisite for any future boot-time DB sync approach)
- Variable interpolation type safety (`{{context.foo}}` remains stringly-typed)

**Concerns:**
- Executor currently reads definitions exclusively from DB; the read path must be extended to check the in-memory registry as a fallback.
- The executor currently always reads the latest definition from DB on every step/resume. Code-based definitions follow the same live-read pattern — changes on redeploy affect running instances immediately (consistent with existing behavior for DB-edited definitions).
- API list endpoint must merge two sources (code registry + DB) without duplicates.

## Overview

The workflows module stores all definitions as JSONB rows in the `workflow_definitions` table. Definitions are created via the REST API or visual editor. This works for user-defined workflows but creates friction for developers who want to ship workflows as part of their module code:

- A typo in `fromStepId: 'reviw'` instead of `'review'` is only caught at runtime.
- Definitions are not version-controlled in git — no PR reviews, no diffs, no rollbacks.
- Modules that need workflows (e.g., sales needing an order-approval flow) must seed them via `setup.ts` with raw JSON, which is loosely coupled and untyped.

This spec introduces a TypeScript-first workflow definition experience: developers write `workflows.ts` files with typed definitions built via `defineWorkflow()`. These are auto-discovered, aggregated by the generator, and loaded into an in-memory registry at bootstrap. The executor reads from this registry (falling back from DB), and the API merges both sources for the UI.

**Critical design choice:** Code-based definitions do NOT sync to the database. They live in memory only. A DB row is created only when a user customizes (overrides) a code-based definition. This avoids boot-time sync problems with horizontal scaling (no distributed locking exists in the platform), and avoids the need for a deploy-time command (which doesn't exist yet).

> **Market Reference:** Temporal (workflow engine) uses code-first workflow definitions exclusively — all workflow logic is TypeScript/Go/Python code, with no DB-stored definitions. We adopt the code-first principle but preserve the existing DB-based approach for user-created workflows (hybrid model). We reject Temporal's "code only" stance because Open Mercato's visual editor and user-defined workflows are a core feature.

## Problem Statement

1. **No compile-time safety:** Workflow definitions are JSONB blobs. Step IDs, transition references, and activity configs are plain strings validated only at runtime. A typo in `fromStepId` causes `STEP_NOT_FOUND` only when the workflow executes — potentially in production, potentially after the transition is first reached (which may be days after deployment).

2. **Definitions not version-controlled:** DB-only definitions are not tracked in git. Teams cannot review workflow changes in PRs, diff definitions across releases, or roll back to a previous version without manual DB manipulation.

3. **No module co-location:** A module that needs a workflow must seed it via `setup.ts` + JSON files in `examples/`. This is a loose convention with no type checking, no auto-discovery, and no generator integration.

4. **Seed fragility:** The current `seedExampleWorkflows()` in `lib/seeds.ts` uses shallow structural comparison (step count, transition count) to detect changes. This misses changes to activity configs, conditions, step properties, or any non-structural modification.

5. **No source tracking:** There is no way to distinguish a definition created by the visual editor from one seeded by code. This makes it impossible to know whether a definition can be safely overwritten or should be preserved as a user customization.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Builder API in `@open-mercato/shared` | Shared has zero domain deps. Builder produces plain data objects (no DB, no DI). Any module in any package can use it. Follows `createModuleEvents()` precedent. |
| `workflows.ts` auto-discovery file | Follows established convention: `events.ts`, `search.ts`, `acl.ts`, `setup.ts` are all single files at module root. |
| In-memory registry, no DB sync | No distributed locking exists. No deploy-time command exists. Boot-time sync with horizontal scaling would race. Memory-only is safe, simple, and horizontally scalable (every instance loads the same code). |
| DB row created only on user customization | Clean separation: code owns the baseline, DB owns user overrides. Avoids phantom rows and sync drift. |
| No `source` column — derive from `code_workflow_id` | If `code_workflow_id` is set, it's an override. If null, it's user-created. If not in DB, it's code-defined. One column instead of two redundant ones. |
| No definition snapshot (matches existing behavior) | The executor always reads the latest definition on every step/resume. Code-based definitions follow the same pattern — code changes on redeploy affect running instances immediately, just like DB edits today. This preserves the ability to hot-fix running workflows. |
| Output matches existing `WorkflowDefinitionData` | No new JSONB schema. The executor, validators, and visual editor all work unchanged. |
| Generic type parameter for step IDs | TypeScript const inference captures step IDs as a literal union. Transitions constrain `fromStepId`/`toStepId` to this union. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Boot-time DB sync (code → DB upsert) | No distributed locking; horizontal scaling races. Requires a deploy-time hook that doesn't exist. |
| CLI command for syncing (`yarn mercato workflows sync`) | Would work but adds deploy pipeline coupling. In-memory approach is simpler and achieves the same outcome without any sync. |
| Lazy sync on first API hit | Adds latency to first request, complex invalidation, still has write contention. |
| YAML/JSON definition files | No type safety — the whole point is compile-time step reference checking. |
| Decorator-based API (`@WorkflowStep()`) | Codebase uses functional patterns, not class-based. `createModuleEvents()` is the precedent. |
| Store definitions in both code and DB always | Violates single source of truth. Drift is inevitable without a reliable sync mechanism. |

## User Stories / Use Cases

- **Module developer** wants to **ship a workflow as part of their module** so that **it's available out of the box without manual setup and is version-controlled in git**.
- **Module developer** wants **compile-time feedback when referencing step IDs in transitions** so that **typos are caught before deployment, not at runtime**.
- **Platform admin** wants to **see which workflows are code-defined vs user-created** so that **they know which ones will reset on deploy vs which are their customizations**.
- **Platform admin** wants to **customize a code-based workflow** (e.g., add a step, change an activity config) so that **they can adapt it to their business without forking the module code**.
- **Platform admin** wants to **reset a customized workflow back to the code version** so that **they can undo their changes and get the latest upstream definition**.

## Architecture

### Builder API

The builder lives at `packages/shared/src/modules/workflows/builder.ts`. It follows the `createModuleEvents()` pattern.

```typescript
import { defineWorkflow } from '@open-mercato/shared/modules/workflows/builder'

const orderApproval = defineWorkflow({
  workflowId: 'sales.order-approval',
  workflowName: 'Order Approval',
  description: 'Approval workflow for high-value orders',
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'review', stepName: 'Manager Review', stepType: 'USER_TASK',
      userTaskConfig: { assignedTo: '{{context.managerId}}', slaDuration: 'PT24H' },
    },
    { stepId: 'approved', stepName: 'Approved', stepType: 'AUTOMATED' },
    { stepId: 'rejected', stepName: 'Rejected', stepType: 'AUTOMATED' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ] as const,
  transitions: [
    { transitionId: 'to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
    { transitionId: 'approve', fromStepId: 'review', toStepId: 'approved', trigger: 'manual' },
    { transitionId: 'reject', fromStepId: 'review', toStepId: 'rejected', trigger: 'manual' },
    { transitionId: 'approved-end', fromStepId: 'approved', toStepId: 'end', trigger: 'auto',
      activities: [{
        activityId: 'update-status',
        activityName: 'Update Order Status',
        activityType: 'UPDATE_ENTITY',
        config: { entityType: 'sales:order', status: 'approved' },
      }],
    },
    { transitionId: 'rejected-end', fromStepId: 'rejected', toStepId: 'end', trigger: 'auto' },
    // Compile error: '"reviw"' is not assignable to '"start" | "review" | "approved" | "rejected" | "end"'
    // { transitionId: 'bad', fromStepId: 'reviw', toStepId: 'end', trigger: 'auto' },
  ],
})

// Module auto-discovery export
export const workflows = [orderApproval]
```

**How type safety works:**

```typescript
export function defineWorkflow<
  const TSteps extends readonly StepDefinition<string>[],
>(config: WorkflowBuilderConfig<TSteps>): CodeWorkflowDefinition

type ExtractStepIds<T extends readonly StepDefinition<string>[]> =
  T[number]['stepId']

interface WorkflowBuilderConfig<
  TSteps extends readonly StepDefinition<string>[],
> {
  workflowId: string
  workflowName: string
  description?: string
  version?: number
  enabled?: boolean
  metadata?: WorkflowMetadata
  steps: TSteps
  transitions: TransitionDefinition<ExtractStepIds<TSteps>>[]
  triggers?: TriggerDefinition[]
}

interface TransitionDefinition<TStepId extends string> {
  transitionId: string
  fromStepId: TStepId    // ← constrained to step ID union
  toStepId: TStepId      // ← constrained to step ID union
  trigger: TransitionTrigger
  // ... remaining fields match existing schema
}
```

The `const` modifier on `TSteps` tells TypeScript to infer literal types for the `stepId` values. `ExtractStepIds` extracts the union of all step IDs from the tuple. Transitions then constrain `fromStepId`/`toStepId` to this union.

**Workflow ID convention:** Prefix with module name using dot notation: `module.workflow-name` (e.g., `sales.order-approval`, `workflows.demo-checkout`). This follows the same namespacing convention as event IDs (`module.entity.action`) and ACL features (`module.action`). Unlike those systems, the workflows generator extension validates uniqueness at `yarn generate` time — duplicate `workflowId` across modules is a hard error. This is cheap to add since we're building a new generator extension.

The shared `workflowDefinitionDataSchema` `workflowId` regex permits dots so that module-prefixed code IDs round-trip through customize/PUT validation without escaping. Earlier the validator only accepted `[a-z0-9-]`; it was widened to `[a-z0-9.-]` so that `code:<workflowId>` payloads (which embed the dotted ID inside the persisted JSONB) validate successfully.

**Runtime behavior:** `defineWorkflow()` also validates the definition against `workflowDefinitionDataSchema` at call time (import-time). This catches issues that TypeScript can't (e.g., missing START step, no transitions). Validation errors throw with a clear message including the `workflowId`.

**Output type:**

```typescript
interface CodeWorkflowDefinition {
  workflowId: string
  workflowName: string
  description: string | null
  version: number
  enabled: boolean
  metadata: WorkflowMetadata | null
  definition: WorkflowDefinitionData  // existing JSONB shape
  moduleId: string                    // set by generator from discovery context
}
```

### Auto-Discovery and Generator

**Convention file:** `workflows.ts` at module root.

```typescript
// packages/core/src/modules/sales/workflows.ts
export const workflows = [orderApproval, returnProcess]
export default workflows
```

**Generator extension:** `packages/cli/src/lib/generators/extensions/workflows.ts`
- Follows the exact pattern of `createEventsExtension()`:
  - `scanModule()` calls `ctx.processStandaloneConfig()` with `relativePath: 'workflows.ts'`
  - Looks for exports `default` or `workflows`
  - `generateOutput()` produces `workflows.generated.ts`

**Generated output:** `apps/mercato/.mercato/generated/workflows.generated.ts`

```typescript
// AUTO-GENERATED — do not edit
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows/builder'
import * as WORKFLOWS_sales from '../../packages/core/src/modules/sales/workflows'
// ...

export const codeWorkflowDefinitions: Array<{ moduleId: string; definitions: CodeWorkflowDefinition[] }> = [
  { moduleId: 'sales', definitions: (WORKFLOWS_sales.default ?? WORKFLOWS_sales.workflows ?? []) },
  // ...
]
```

### In-Memory Registry

**Location:** `packages/core/src/modules/workflows/lib/code-registry.ts`

```typescript
// Singleton registry populated at bootstrap
const registry = new Map<string, CodeWorkflowDefinition>()

export function registerCodeWorkflowDefinitions(
  entries: Array<{ moduleId: string; definitions: CodeWorkflowDefinition[] }>
): void

export function getCodeWorkflowDefinition(workflowId: string): CodeWorkflowDefinition | null

export function getAllCodeWorkflowDefinitions(): CodeWorkflowDefinition[]

export function hasCodeWorkflowDefinition(workflowId: string): boolean
```

**Bootstrap wiring:** Called from `apps/mercato/src/bootstrap.ts` (or the generated bootstrap), similar to how event configs and search configs are registered:

```typescript
import { codeWorkflowDefinitions } from '.mercato/generated/workflows.generated'
registerCodeWorkflowDefinitions(codeWorkflowDefinitions)
```

### Executor Integration

**Current flow:** `startWorkflow()` → `findWorkflowDefinition(em, workflowId, version, tenantId)` → DB query.

**New flow:** `findWorkflowDefinition()` gains a two-source lookup:

```
1. Query DB for (workflowId, tenantId) — finds user definitions and code overrides
2. If not found in DB → check code registry by workflowId
3. If found in code registry → construct virtual WorkflowDefinition object
4. If not found anywhere → throw WORKFLOW_NOT_FOUND
```

**Live-read behavior (unchanged):** The executor always reads the latest definition on every step, resume, signal, and retry — same as today. For code-based definitions, this means changes deployed via a new release take effect immediately on running instances, just like editing a DB definition today. This is intentional: it preserves the ability to hot-fix a broken workflow without cancelling running instances.

### API Merge Logic

**GET /api/workflows/definitions** — the list endpoint merges two sources:

```
1. Fetch all DB definitions for the tenant
2. Fetch all code registry definitions
3. For each code definition:
   - If a DB row exists with code_workflow_id matching this workflowId → use DB row (derive source='code_override')
   - Otherwise → include code definition (derive source='code')
4. Include all DB rows with code_workflow_id=null as-is (derive source='user')
5. Return merged list, sorted by workflowName
```

The list endpoint executes split `find` and `count` queries (rather than `findAndCount`) so that pagination metadata stays consistent when the merge layer drops shadowed code definitions. Tests under `__integration__/TC-WF-010.spec.ts` assert this contract.

**Legacy seed alignment:** Pre-existing tenants seeded via `seedExampleWorkflows()` carried `workflowId`s that did not match the new code-defined IDs (`workflows.demo-checkout`, etc.). To prevent the merge layer from showing both the legacy seeded row AND the code definition as separate entries, a one-shot rename migration aligns the legacy IDs with their code counterparts (see Migration & Compatibility).

**GET /api/workflows/definitions/:id** — single definition:

```
1. Try DB lookup by id (UUID)
2. If not found, try code registry by workflowId (id param may be workflowId for code defs)
3. Return with appropriate source marker
```

### Commands & Events

- **Command**: `workflows.definition.customize` — creates a DB override from a code definition
- **Command**: `workflows.definition.resetToCode` — deletes the DB override, reverting to code version
- **Event**: `workflows.definition.customized` — emitted when user overrides a code definition
- **Event**: `workflows.definition.resetToCode` — emitted when override is removed

## Data Models

### WorkflowDefinition (modified)

New column:

| Column | Type | Default | Nullable | Description |
|--------|------|---------|----------|-------------|
| `code_workflow_id` | `varchar(100)` | — | Yes | The `workflowId` from the code registry this row overrides. Null for user-created definitions. |

The `source` concept is derived at query time, not stored:
- `code_workflow_id IS NOT NULL` → code override
- `code_workflow_id IS NULL` → user-created
- Not in DB (code registry only) → code-defined

### WorkflowInstance (unchanged)

No changes needed. The instance stores `definitionId`, `workflowId`, and `version` as before. The executor continues to fetch the latest definition on every step/resume — code-based definitions are resolved from the in-memory registry using the same live-read pattern.

### CodeWorkflowDefinition (new shared type, not a DB entity)

```typescript
interface CodeWorkflowDefinition {
  workflowId: string
  workflowName: string
  description: string | null
  version: number
  enabled: boolean
  metadata: WorkflowMetadata | null
  definition: WorkflowDefinitionData
  moduleId: string
}
```

## API Contracts

### GET /api/workflows/definitions (modified response)

Each item in the response gains:

```typescript
{
  // ... existing fields ...
  source: 'code' | 'user' | 'code_override'  // NEW
  codeModuleId: string | null                  // NEW — module that defines it (null for user)
  isCodeBased: boolean                         // NEW — convenience flag
}
```

Code-based definitions that have no DB row use a synthetic ID format: `code:<workflowId>` (to distinguish from UUID-based DB IDs in the UI).

### GET /api/workflows/definitions/:id (modified)

Accepts both UUID (DB definitions) and `code:<workflowId>` (code definitions). Response includes `source` field.

### PUT /api/workflows/definitions/:id (modified behavior)

- Accepts the full edit-form payload, including `triggers` embedded inside the `definition` object (the visual editor and form serialize triggers as part of the definition rather than as a sibling field).
- If target is a code-based definition (`code:<workflowId>`):
  - If no DB row exists for this `workflowId` in the tenant → creates a new DB row with `code_workflow_id=workflowId`.
  - If a soft-deleted override row exists for this `workflowId` in the tenant → revives it (clears `deletedAt`, applies updates, re-flushes). This is required because the unique constraint on `(workflow_id, tenant_id)` would otherwise reject a fresh insert after a prior `reset-to-code`.
  - Returns the resulting DB row.
- If target is already an override (`code_workflow_id` set): updates the DB row as before.
- If target is a user-created definition: updates as before.

### POST /api/workflows/definitions/:id/customize (new)

Dedicated entry point for the "Customize" action on code-based definitions. Used by the UI button in the definition list and detail page banners.

- Accepts only `code:<workflowId>` IDs. UUID targets return `400`.
- Resolves the code definition from the in-memory registry; `404` if not found.
- Materializes the override:
  - If no DB row exists for `workflowId` in the tenant → inserts a new row with `code_workflow_id=workflowId` and the code definition's payload as the starting state.
  - If a soft-deleted override row exists → revives it (clears `deletedAt`, refreshes `updatedAt`, leaves the previously-customized payload intact so that a customize-after-reset-after-customize sequence behaves predictably).
- Returns the materialized DB row in the same envelope as `GET .../:id`.
- Routed through the standard CRUD mutation guard so feature gates and audit hooks fire consistently.
- The legacy `PUT` against `code:<workflowId>` IDs is retained for parity with bulk import tooling, but `/customize` is the documented path going forward.

### POST /api/workflows/definitions/:id/reset-to-code (new)

- Only valid for definitions with `code_workflow_id` set (code overrides).
- Hard-deletes the DB override row (no soft-delete) so that a subsequent customize re-materializes from the code registry rather than reviving a stale payload.
- Wired through the CRUD mutation guard, matching the conventions used by other workflow write endpoints.
- Returns the code registry version.
- Response: `200 { definition: CodeWorkflowDefinition, message: 'Reset to code version' }`
- Error: `404` if not a code override, `409` if instances are running against this override.

### OpenAPI

All new/modified endpoints include `openApi` exports per existing convention.

## Internationalization (i18n)

New locale keys:

| Key | English | Context |
|-----|---------|---------|
| `workflows.source.code` | `Code-defined` | Badge label |
| `workflows.source.user` | `User-created` | Badge label |
| `workflows.source.code_override` | `Customized` | Badge label |
| `workflows.source.code.readonly_banner` | `This workflow is defined in code. Customize it to make changes.` | Detail page banner |
| `workflows.source.code_override.banner` | `This workflow has been customized from its code-defined version.` | Detail page banner |
| `workflows.actions.customize` | `Customize` | Action button |
| `workflows.actions.reset_to_code` | `Reset to code version` | Action button |
| `workflows.actions.reset_confirm` | `This will discard your customizations and restore the code-defined version. Continue?` | Confirmation dialog |

## UI/UX

### Definition List Page

- Inline badge next to the workflow name (not a separate column): "Code" (`info`) for code-defined, "Customized" (`warning`) for code overrides. No badge for user-created (default state needs no indicator).
- Code-defined rows use `code:<workflowId>` as their link target.

### Definition Detail Page

- **Code-defined:** Read-only view. Banner: "This workflow is defined in code. Customize it to make changes." Primary action: "Customize" button (creates DB override, navigates to edit).
- **Code override:** Editable. Banner: "This workflow has been customized from its code-defined version." Secondary action: "Reset to code version" (with confirmation dialog).
- **User-created:** Unchanged behavior.

### Visual Editor

- For code-defined workflows: opens in read-only mode (no drag/drop, no add/remove).
- For code overrides: full editor, same as user-created.

## Migration & Compatibility

### Database Migration

- Add `code_workflow_id varchar(100) NULL` to `workflow_definitions`.
- All existing rows get `code_workflow_id=null` (user-created), preserving current behavior.
- No data backfill needed.

### Legacy Seed ID Rename Migration

A follow-up migration (`Migration20260428102318`) renames legacy `seedExampleWorkflows()`-produced `workflowId`s to their code-defined counterparts so that the merge layer treats them as the same definition rather than two siblings:

- Per rename pair `{ from, to }`:
  - Update `workflow_definitions.workflow_id` from the legacy ID to the code-defined ID.
  - Update `workflow_instances.workflow_id` for instances pointing at definitions that match.
- The `down()` reverses both updates and is conflict-aware: it skips rows where reverting would collide with an existing row in the same tenant. The two `down()` statements are ordered so that `workflow_definitions` is renamed before `workflow_instances` joins back through `definition_id`, preventing dangling references mid-migration.

### Backward Compatibility

- **Existing definitions:** Continue working unchanged. `source='user'` is the default.
- **Existing instances:** No changes to `WorkflowInstance`. Executor continues live-reading definitions as before.
- **Existing API consumers:** New fields (`source`, `codeModuleId`, `isCodeBased`) are additive. No fields removed.
- **Existing seeds:** The current `seedExampleWorkflows()` mechanism in `setup.ts` can be gradually migrated to `workflows.ts`. Both can coexist — seeded definitions remain `source='user'` in the DB.
- **Auto-discovery:** `workflows.ts` is a new optional convention. Modules without it are unaffected.
- **Contract surface classification:** `workflows.ts` export convention is STABLE (new, additive). `defineWorkflow()` function signature is STABLE.

### Breaking Changes

None. This is fully additive.

## Implementation Plan

### Phase 1: Builder API + Auto-Discovery + Registry

1. Create `packages/shared/src/modules/workflows/builder.ts` — `defineWorkflow()` with const generic type inference
2. Create `packages/shared/src/modules/workflows/types.ts` — shared types (`CodeWorkflowDefinition`, builder interfaces)
3. Create `packages/cli/src/lib/generators/extensions/workflows.ts` — generator extension (follow `events.ts` pattern)
4. Register extension in `packages/cli/src/lib/generators/extensions/index.ts`
5. Create `packages/core/src/modules/workflows/lib/code-registry.ts` — in-memory registry
6. Wire bootstrap: register code definitions from `workflows.generated.ts`
7. Create example `packages/core/src/modules/workflows/workflows.ts` — migrate existing example JSON to builder API
8. Unit tests for builder (type safety, Zod validation, error messages)
9. Run `yarn generate` and verify output

### Phase 2: Executor + API Integration

1. DB migration: add `code_workflow_id` to `workflow_definitions`
2. Update `WorkflowDefinition` entity with new column
3. Modify `findWorkflowDefinition()` to check code registry as fallback
4. Modify list/detail API endpoints to merge code registry + DB
5. Add derived `source` to API serializer and OpenAPI schema
6. Integration tests: start workflow from code definition, verify execution uses live code registry

### Phase 3: Override + Reset Support

1. Implement customize flow: `PUT` on code definition creates `code_override` DB row
2. Implement `POST /api/workflows/definitions/:id/reset-to-code`
3. UI: add source badge to definition list
4. UI: add banners and action buttons to detail page
5. UI: read-only mode for visual editor on code-defined workflows
6. Add i18n keys
7. Integration tests: customize, verify override, reset, verify code version restored

### Phase 4: Activity Registry (Future Spec)

Deferred to a separate spec. Covers:
- `registerWorkflowFunction()` for type-safe `EXECUTE_FUNCTION` references
- Generator extension for aggregating registered functions
- Builder API extension: typed `fn` field on function activities

### File Manifest

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `packages/shared/src/modules/workflows/builder.ts` | Create | 1 | `defineWorkflow()` builder with type inference |
| `packages/shared/src/modules/workflows/types.ts` | Create | 1 | Shared types for code workflow definitions |
| `packages/cli/src/lib/generators/extensions/workflows.ts` | Create | 1 | Generator extension for `workflows.ts` discovery |
| `packages/cli/src/lib/generators/extensions/index.ts` | Modify | 1 | Register workflows extension |
| `packages/core/src/modules/workflows/lib/code-registry.ts` | Create | 1 | In-memory code definition registry |
| `packages/core/src/modules/workflows/workflows.ts` | Create | 1 | Example code-based workflow definitions |
| `apps/mercato/src/bootstrap.ts` | Modify | 1 | Register code definitions at bootstrap |
| `packages/core/src/modules/workflows/data/entities.ts` | Modify | 2 | Add `codeWorkflowId` column |
| `packages/core/src/modules/workflows/lib/workflow-executor.ts` | Modify | 2 | Code registry fallback in `findWorkflowDefinition()` |
| `packages/core/src/modules/workflows/api/` | Modify | 2 | Merge code + DB definitions in list/detail |
| `packages/core/src/modules/workflows/events.ts` | Modify | 3 | Add customized/reset events |
| `packages/core/src/modules/workflows/backend/` | Modify | 3 | UI badges, banners, read-only mode |

### Testing Strategy

- **Unit tests (Phase 1):**
  - Builder produces valid `WorkflowDefinitionData` (passes Zod validation)
  - Builder rejects invalid configs (missing START step, orphan transitions) at runtime
  - Type tests: verify that invalid step ID references produce TS errors (using `ts-expect-error`)
- **Integration tests (Phase 2):**
  - Start a workflow from a code-based definition
  - Verify instance stores `definitionSnapshot`
  - List endpoint returns both code and DB definitions with correct `source`
  - Detail endpoint resolves `code:<workflowId>` IDs
- **Integration tests (Phase 3):**
  - Customize a code definition → verify DB row created with `source='code_override'`
  - Update the override → verify DB row updated
  - Reset to code → verify DB row deleted, code version returned
  - Verify running instances on overridden definition continue executing

## Risks & Impact Review

### Data Integrity Failures

- **Instance definition drift:** If a code definition changes between deploys (e.g., step removed, transition renamed) and an instance is mid-flight, the instance could reference steps/transitions that no longer exist.
  - Mitigation: This is the same behavior as editing a DB definition today — the executor always reads the latest version. Developers must treat code definition changes the same as DB edits: avoid removing steps/transitions that running instances may be on. This is an existing operational concern, not a new one introduced by this spec.
  - Residual: No new risk. Matches existing behavior exactly.

- **Override orphaning:** If a code definition is removed from code but a `code_override` DB row exists, the override references a non-existent base.
  - Mitigation: The override is still a valid definition (it stores the full JSONB). It continues working. The "Reset to code version" action would fail gracefully (code version not found).

### Cascading Failures & Side Effects

- **Registry population failure:** If `workflows.generated.ts` has an import error (e.g., module removed but generated file stale), bootstrap fails.
  - Mitigation: Same risk as `events.generated.ts`. Fixed by running `yarn generate`. No new risk introduced.

- **Event triggers on code definitions:** Code definitions can declare `triggers`. The event trigger service currently reads triggers from DB definitions only.
  - Mitigation: Phase 2 must extend the trigger service to also read from code registry. Until then, triggers on code-based definitions are not active (documented limitation).

### Tenant & Data Isolation Risks

- **Code registry is global (not tenant-scoped):** The in-memory registry is shared across all tenants. Code definitions are the same for all tenants.
  - Mitigation: This is by design. Code definitions are platform-level, not tenant-specific. Tenant-specific customizations are DB rows scoped by `tenant_id` and `organization_id`.

### Migration & Deployment Risks

- **Zero downtime:** Migration adds nullable/defaulted columns only. No data backfill. Safe for rolling deployments.
- **Rollback safe:** If the feature is rolled back, `code_workflow_id` is null on all existing rows and ignored. Code registry simply isn't populated. DB-only behavior resumes.

### Operational Risks

- **Memory footprint:** Each code definition is a small JSONB object (~1-10 KB). Even 100 definitions would be <1 MB. Negligible.
- **Stale generated files:** If a developer adds `workflows.ts` but forgets `yarn generate`, definitions won't appear. Same existing risk as `events.ts`. Mitigated by CI checks.

### Risk Register

#### Running instance breaks on code definition change
- **Scenario**: Deploy changes step IDs in a code definition while an instance is mid-execution referencing old step IDs.
- **Severity**: Medium
- **Affected area**: Workflow executor, running instances
- **Mitigation**: This is identical to the existing risk of editing a DB definition while instances are running — the executor always reads the latest definition. No new risk introduced. Developers should follow the same operational practice: avoid removing steps/transitions that active instances may occupy.
- **Residual risk**: Accepted — matches existing behavior. Future work could add definition versioning with per-instance pinning, but that's a separate concern for both code and DB definitions.

#### Code definition removed but override exists
- **Scenario**: Developer removes a `workflows.ts` entry. A tenant has a `code_override` DB row for it.
- **Severity**: Low
- **Affected area**: Reset-to-code action, source badge
- **Mitigation**: Override row remains functional (stores full definition). "Reset to code" action returns error explaining code version no longer exists. UI shows `code_override` badge. No data loss.
- **Residual risk**: Cosmetic — override badge may be confusing without a code base to compare against. Acceptable.

#### Duplicate workflowId between code and user definition
- **Scenario**: User creates a DB definition with the same `workflowId` as a code definition.
- **Severity**: Medium
- **Affected area**: List/detail API, executor resolution
- **Mitigation**: DB lookup takes precedence (checked first). The code definition is effectively shadowed. API list endpoint deduplicates by `workflowId`, preferring DB rows. Show a warning in the create form if `workflowId` matches a code definition.
- **Residual risk**: User could intentionally shadow a code definition. This is acceptable — it's equivalent to a code override without using the override mechanism.

#### Duplicate workflowId across code modules
- **Scenario**: Two modules declare workflows with the same `workflowId` in their `workflows.ts`.
- **Severity**: High
- **Affected area**: Generator, code registry
- **Mitigation**: The generator extension validates `workflowId` uniqueness at `yarn generate` time and emits a hard error. This is a build-time check — conflicts never reach runtime.
- **Residual risk**: None after generator validation.

#### Soft-deleted override revival on re-customize
- **Scenario**: A tenant customizes a code definition (DB override created), runs `reset-to-code` (override hard-deleted in current implementation), then customizes again. If a prior implementation soft-deleted the override row, the re-customize would collide on the `(workflow_id, tenant_id)` unique constraint.
- **Severity**: Medium
- **Affected area**: `POST .../customize`, `PUT .../:id` for `code:*` targets
- **Mitigation**: Both write paths look up any existing override (including soft-deleted) before insert; if found, they revive the row by clearing `deletedAt` and applying updates. `reset-to-code` itself uses hard-delete so the common path inserts cleanly, but the revival branch protects against any historical soft-deleted rows still in the database.
- **Residual risk**: None. Cross-organization conflicts within the same tenant are not blocked — any organization in the tenant can revive the soft-deleted row, matching the tenant-scoped unique constraint semantics.

#### Event triggers not active for code definitions (Phase 2 gap)
- **Scenario**: Code definition declares triggers, but trigger service only reads from DB.
- **Severity**: Medium
- **Affected area**: Workflow event triggering
- **Mitigation**: Phase 2 extends trigger service to read from code registry. Documented as known limitation until Phase 2 is complete.
- **Residual risk**: None after Phase 2.

## Final Compliance Report — 2026-04-28

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Code registry uses plain data objects. No cross-module ORM links. |
| root AGENTS.md | Filter by organization_id for tenant-scoped entities | Compliant | DB queries for overrides are tenant-scoped. Code registry is global by design (platform-level definitions). |
| root AGENTS.md | Use DI (Awilix) to inject services | Compliant | Code registry registered in `di.ts`. |
| root AGENTS.md | API routes MUST export openApi | Compliant | New/modified endpoints include openApi. |
| root AGENTS.md | Validate inputs with zod | Compliant | Builder validates against existing `workflowDefinitionDataSchema`. |
| root AGENTS.md | UUID PKs for DB entities | Compliant | Override rows use UUID PKs. Code definitions use synthetic `code:<workflowId>` IDs (not DB PKs). |
| packages/shared AGENTS.md | MUST NOT add domain-specific logic | Compliant | Builder produces plain data objects. No DB, DI, or domain imports. |
| packages/shared AGENTS.md | MUST use precise types — no `any` | Compliant | Builder uses Zod schemas + generics. |
| packages/cli AGENTS.md | Generator extension follows existing pattern | Compliant | Follows `createEventsExtension()` pattern exactly. |
| packages/core AGENTS.md | CRUD routes use makeCrudRoute | N/A | No new CRUD routes. Existing routes are modified. |
| root AGENTS.md | Event IDs: module.entity.action | Compliant | `workflows.definition.customized`, `workflows.definition.resetToCode` |
| root AGENTS.md | Backward Compatibility Contract | Compliant | All changes additive. No removed fields, endpoints, or conventions. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `source` and `codeModuleId` in both entity and API response |
| API contracts match UI/UX section | Pass | Badges, banners, and actions align with API `source` field |
| Risks cover all write operations | Pass | Customize (creates row), reset (deletes row) covered |
| Commands defined for all mutations | Pass | `customize` and `resetToCode` commands defined |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — ready for implementation. Post-implementation fixes through 2026-04-28 (dedicated `/customize` endpoint, soft-deleted override revival, embedded triggers in PUT, dotted `workflowId` regex, mutation-guard wiring on reset, list `find`/`count` split, legacy seed-ID rename migration, removal of cross-organization customize block) were re-reviewed against the same compliance matrix with no regressions.

## Changelog

### 2026-04-14
- Initial specification
- Design decision: in-memory registry with no DB sync (avoids horizontal scaling issues)
- Design decision: no definition snapshot — executor uses live-read pattern (matches existing behavior for DB definitions)
- Four-phase implementation plan: builder → executor integration → override support → activity registry

### 2026-04-15
- Phase 1 shipped: `defineWorkflow()` builder in `@open-mercato/shared/modules/workflows`, generator extension for `workflows.ts` auto-discovery, in-memory `code-registry`, bootstrap wiring registering `codeWorkflowDefinitions` from the generated aggregate. Unit tests cover builder type inference and Zod validation.

### 2026-04-20
- Phase 2 shipped: `code_workflow_id varchar(100) NULL` column added to `workflow_definitions`; `findWorkflowDefinition()` falls back to the in-memory registry when no DB row matches; list and detail endpoints merge code registry + DB sources; `source`, `codeModuleId`, and `isCodeBased` added to API serializer and OpenAPI schema. Integration tests exercise starting a workflow from a code definition.

### 2026-04-22
- Phase 3 shipped: customize/reset-to-code routes wired up, definition list shows `Code` / `Customized` badges, detail page shows source banners, visual editor opens read-only on code-defined workflows, i18n keys added.

### 2026-04-24
- Added dedicated `POST /api/workflows/definitions/:id/customize` endpoint as the documented entry point for materializing a code-based definition into a tenant DB override (PR #1444 follow-up commit `1f76646e7`).
- Fixed soft-deleted override revival in the customize flow so a customize-after-reset sequence no longer collides on `(workflow_id, tenant_id)` (`978be2ccf`).
- `PUT` against `code:<workflowId>` IDs retained as a fallback path; both write paths share the revive-or-insert branch.

### 2026-04-25
- PUT/customize payloads now accept the edit-form shape with triggers embedded inside the `definition` object, fixing a regression where the visual editor's serialized payload was rejected by validation (`8c677eb41`, PRs #1586/#1601).

### 2026-04-26
- Widened the shared `workflowDefinitionDataSchema` `workflowId` regex to permit dots so module-prefixed code IDs (`workflows.demo-checkout`, `sales.order-approval`) round-trip through customize/PUT without escaping (`ef5d9cf48`).

### 2026-04-27
- Wired `reset-to-code` through the CRUD mutation guard for parity with other workflow mutations and simplified the list merge implementation (`78b7afe53`).
- Added integration coverage for the `/customize` endpoint and a regression test for the full-payload PUT path (`087212df5`); added a UI integration test for the Customize / Reset-to-code flow (`c73bb6092`).
- Aligned legacy `seedExampleWorkflows()` IDs with code-defined IDs via `Migration20260428102318` so the merge layer treats them as the same definition (`a24f9d305`).
- Realigned definitions-list tests with the new split `find` / `count` query path (`715e013af`); covered list badge flip, edit persistence, and read-only code-detail rendering (`b8041b7eb`).

### 2026-04-28
- Removed the cross-organization customize block: any organization within the tenant can now revive a soft-deleted override row, matching the tenant-scoped unique constraint semantics. The previous 409 response (and corresponding OpenAPI entry) was dropped from `/customize` and the `code:*` PUT path.
- Corrected the `Migration20260428102318` `down()` ordering so `workflow_definitions` is renamed before `workflow_instances` joins back through `definition_id`, eliminating a transient mismatch during rollback.
- Switched override insert/delete paths from `persistAndFlush`/`removeAndFlush` to explicit `persist`+`flush` / `remove`+`flush` for consistency with surrounding code.
