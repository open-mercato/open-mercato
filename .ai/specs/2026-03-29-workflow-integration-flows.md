# Workflow Integration Flows

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-29 |
| **Builds on** | `packages/core/src/modules/workflows`, 2026-03-29-integration-commands-events, 2026-03-29-integration-projects |
| **Related** | 2026-03-29-google-workspace-integration, ANALYSIS-007-akeneo-pim-integration, SPEC-045 Integration Marketplace, SPEC-045b Data Sync Hub |

## TLDR

**Key Points:**
- Extend the `workflows` module so it becomes the orchestration layer for Zapier-style integration automations: external integration event in, mapped workflow execution, integration command out.
- Reuse the current workflow engine instead of inventing a second automation runtime. Add only the missing workflow-native pieces: typed integration triggers, typed integration command activities, external-event dedupe, project-aware connection selection, and editor support.
- Keep the scope intentionally narrow: **single-record, event-driven automation** in workflows; **bulk ETL/catalog sync** stays in `data_sync`.

**Scope:**
- New workflow trigger metadata for integration events on top of the existing `eventPattern` model
- New workflow activity type: `EXECUTE_INTEGRATION_COMMAND`
- Idempotent trigger receipt tracking for webhook/poll duplicates
- Workflow editor support for selecting integration source events, destination commands, projects, and field mappings
- Run-time correlation between workflow instances and integration sessions/projects
- Provider follow-up notes for Akeneo and Google Sheets, without modifying their existing specs

**Concerns:**
- The current workflows module advertises `PARALLEL_FORK`, `PARALLEL_JOIN`, and `WAIT_FOR_TIMER`, but those step types are not implemented yet. This spec MUST NOT depend on them.
- `2026-03-29-integration-commands-events.md` and `2026-03-29-integration-projects.md` remain prerequisite contracts. This spec assumes their additive contracts exist before workflow-specific UI/runtime work begins.

## Overview

The repository already has most of the orchestration primitives needed for integration flows:

- `packages/core/src/modules/workflows/lib/event-trigger-service.ts` can start workflows from arbitrary event patterns and map payload fields into workflow context.
- `packages/core/src/modules/workflows/lib/activity-executor.ts` can run automated activities synchronously or via queue.
- `packages/core/src/modules/workflows/lib/activity-executor.ts` already supports safe internal mutation through commands (`UPDATE_ENTITY`) and internal APIs (`CALL_API`).
- `packages/core/src/modules/workflows/components/DefinitionTriggersEditor.tsx` and `ActivitiesEditor.tsx` already provide a visual editor for triggers and automated steps.

The gap is not orchestration. The gap is that workflows still see integrations only as raw strings and ad hoc HTTP calls:

- triggers are plain `eventPattern` strings, not typed integration events
- activities have no first-class way to execute integration commands through provider-owned credentials/state/project logic
- duplicate webhook deliveries would start duplicate workflows
- the editor does not know what a provider can emit or execute

### Market Reference

**Studied:** Zapier, n8n

**Adopted:**
- typed trigger/action catalogs
- connection-aware source and destination selection
- declarative field mapping from source payload to destination action input
- per-run correlation metadata for observability

**Rejected:**
- a second workflow runtime dedicated to integrations
- generic script/code nodes in MVP
- polling-heavy, bulk synchronization as a workflow concern
- direct provider-to-provider coupling outside the integration registry/gateway

## Problem Statement

Today, the target use case:

> “When a new product appears in Akeneo, write a row to Google Sheets, and later replace either the source or the destination without changing the orchestration model.”

cannot be implemented cleanly inside the existing platform.

### Current Workflow Module Gaps

1. **Triggers are stringly typed.**
   `WorkflowDefinitionTrigger` stores only `eventPattern` plus generic filters/context mappings. This is enough for `sales.orders.created`, but not enough for connection-aware integration flows that need provider, event, and project selection.

2. **Activities are integration-unaware.**
   The current activity palette is `SEND_EMAIL`, `CALL_API`, `UPDATE_ENTITY`, `EMIT_EVENT`, `CALL_WEBHOOK`, `EXECUTE_FUNCTION`. Using `CALL_WEBHOOK` or `CALL_API` for provider actions would duplicate credential lookup, readiness checks, project resolution, and logging logic that belongs in the integrations layer.

3. **External events are not deduplicated.**
   `processEventTriggers()` starts a workflow for every matching event. That is acceptable for internal CRUD events, but unsafe for inbound webhooks and polling-derived integration events, which are routinely delivered more than once.

4. **The editor cannot discover provider capabilities.**
   Users cannot browse “Akeneo events” or “Google Sheets commands” while designing a workflow. They must know IDs and payload shapes ahead of time.

5. **The runtime cannot express source and destination projects explicitly.**
   Multi-configuration per integration is being introduced by the integration-projects spec, but workflows currently have no place to store and resolve project-aware source/destination configuration.

6. **There is no boundary between workflow automation and bulk sync.**
   Without a clear spec, workflow automation risks turning into an ad hoc replacement for `data_sync`, which would be slower, less observable, and harder to make idempotent.

## Proposed Solution

Treat `workflows` as the orchestration surface for **integration events + integration commands**, while leaving transport and provider behavior inside the integrations system.

### Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|------------|-----------|
| 1 | Workflow runtime primitive | **New activity type, not new step type** | The engine already models automation through `AUTOMATED` steps with activities. `EXECUTE_INTEGRATION_COMMAND` fits that shape cleanly. |
| 2 | Trigger model | **Extend existing embedded workflow triggers** | Keep `eventPattern` for backward compatibility, add typed integration metadata on top for editor/runtime enrichment. |
| 3 | Flow scope | **Single-record, event-driven flows only** | The engine lacks loops/timers/parallel production support. Bulk reconciliation belongs in `data_sync`. |
| 4 | Dedupe boundary | **Receipt table in workflows** | External event idempotency is an orchestration concern once a workflow is started. |
| 5 | Provider resolution | **Always through `integrationGateway`** | No raw HTTP from workflows to providers. Provider-owned auth/state/projects stay centralized. |
| 6 | Mapping model | **Declarative key/value mappings using existing interpolation semantics** | Reuses the current `{{context.*}}` style, keeps editor behavior understandable, avoids code nodes. |
| 7 | Readiness behavior | **Editor warns; runtime fails fast** | Disabled/unconfigured destinations should not silently skip writes. |
| 8 | Session correlation | **Propagate `sessionId` from source event into destination commands** | Enables auditability and later SSE/progress linking without inventing a new correlation model. |

### Core Flow Model

1. A provider emits a declared integration event such as `sync_akeneo.product.created`.
2. The existing wildcard subscriber in `workflows/subscribers/event-trigger.ts` receives it.
3. `event-trigger-service.ts` matches the workflow trigger and computes a **dedupe key**.
4. If the dedupe key was already accepted for the same trigger in the same tenant/org, the event is ignored.
5. Otherwise, the workflow starts with:
   - the raw event payload
   - typed integration source metadata
   - a propagated `sessionId`
   - source integration/project labels in instance metadata
6. Automated steps can execute `EXECUTE_INTEGRATION_COMMAND` activities such as `sync_google_sheets.write-row`.
7. Activity output is written back into workflow context and can feed later transitions or activities.

### Example: Akeneo -> Google Sheets

```text
Trigger:
  Integration: sync_akeneo
  Project: production
  Event: sync_akeneo.product.created

Workflow:
  START
    -> AUTOMATED: execute sync_akeneo.get-product
    -> AUTOMATED: execute sync_google_sheets.write-row
    -> END
```

Mapped destination input:

```json
{
  "spreadsheetId": "{{context.sheet.spreadsheetId}}",
  "sheetName": "Products",
  "values": [
    "{{context.get_product.result.identifier}}",
    "{{context.get_product.result.values.name.en_US[0].data}}",
    "{{context.get_product.result.values.sku[0].data}}"
  ]
}
```

## User Stories / Use Cases

- **Tenant admin** wants to configure a workflow from **Akeneo product created** to **Google Sheets append row** so that catalog events can drive spreadsheets without writing custom glue code.
- **Tenant admin** wants to keep the same workflow and switch the destination from **Google Sheets** to a future integration command so that orchestration remains reusable and provider-agnostic.
- **Tenant admin** wants to select **source project** and **destination project** independently so that one tenant can connect multiple Akeneo instances and multiple Google accounts.
- **Operator** wants to inspect a workflow instance and see **which integration event started it** and **which integration command it executed** so that failures are debuggable.
- **Provider author** wants to expose commands/events once in the integration definition so that workflows, forms, and future modules can consume the same contract.

## Architecture

### Current Module Analysis

The existing workflows module is a good fit for orchestration, but only after a few targeted additions:

- `packages/core/src/modules/workflows/lib/event-trigger-service.ts`
  already supports pattern matching, filters, context mapping, and concurrency limits, but it has no idempotent external-event receipt tracking.
- `packages/core/src/modules/workflows/lib/activity-executor.ts`
  already supports provider-adjacent actions (`CALL_WEBHOOK`, `CALL_API`), but those would bypass integration credentials, project resolution, and provider-specific readiness logic.
- `packages/core/src/modules/workflows/components/DefinitionTriggersEditor.tsx`
  lets users define triggers, but only through raw event patterns.
- `packages/core/src/modules/workflows/components/ActivitiesEditor.tsx`
  lets users define activities, but it has no capability-aware integration action editor.
- `packages/core/src/modules/workflows/lib/step-handler.ts`
  does not support loops or timers for production flow design, so MVP must stay single-record and linear.

### Target Runtime

```text
Provider event/webhook
  -> integrations event contract
  -> event bus
  -> workflows wildcard subscriber
  -> trigger matcher + dedupe receipt
  -> workflow instance created
  -> automated step(s)
  -> integrationGateway.execute(...)
  -> provider command handler
  -> workflow context updated
  -> END / failure / user task
```

### Package-Level Changes

| Package / Module | Change |
|------------------|--------|
| `packages/shared/src/modules/integrations/types.ts` | Add narrow shared types for integration command/activity descriptors consumed by workflows |
| `packages/core/src/modules/integrations/` | Provide project-aware `integrationGateway` and capability APIs from the prerequisite specs |
| `packages/core/src/modules/workflows/data/validators.ts` | Extend trigger/activity schemas for integration-aware metadata |
| `packages/core/src/modules/workflows/lib/event-trigger-service.ts` | Add dedupe key evaluation and receipt persistence |
| `packages/core/src/modules/workflows/lib/activity-executor.ts` | Add `EXECUTE_INTEGRATION_COMMAND` handler |
| `packages/core/src/modules/workflows/components/*` | Add source-event and destination-command editors using capability discovery |

### Commands & Events

This spec does not define provider business events itself. It consumes the event/command catalog defined by `2026-03-29-integration-commands-events.md`.

Workflow-specific additions:

- **New activity type**: `EXECUTE_INTEGRATION_COMMAND`
- **No new frozen public event IDs required for MVP**
  Runtime audit remains in workflow events and integration logs. If later UX needs browser-side flow progress, use existing `progress.job.*` events instead of inventing a separate workflow broadcast stream.

## Data Models

### Modified JSON Model: `WorkflowDefinitionTrigger`

Keep the existing shape and add optional typed integration metadata:

```typescript
interface WorkflowDefinitionTrigger {
  triggerId: string
  name: string
  description?: string | null
  eventPattern: string
  enabled: boolean
  priority: number
  config?: WorkflowEventTriggerConfig | null
  integrationSource?: {
    kind: 'integration_event'
    integrationId: string
    eventId: string
    projectSlug?: string
    dedupeKeyExpression?: string
  } | null
}
```

Rules:
- `eventPattern` remains required for backward compatibility and matches `integrationSource.eventId` when `integrationSource.kind === 'integration_event'`
- `projectSlug` is optional and defaults to `default`
- `dedupeKeyExpression` defaults to the source event `deliveryId` when present

### Modified JSON Model: `ActivityDefinition`

Extend the existing activity type enum:

```typescript
type ActivityType =
  | 'SEND_EMAIL'
  | 'CALL_API'
  | 'UPDATE_ENTITY'
  | 'EMIT_EVENT'
  | 'CALL_WEBHOOK'
  | 'EXECUTE_FUNCTION'
  | 'WAIT'
  | 'EXECUTE_INTEGRATION_COMMAND'
```

New config contract:

```typescript
interface ExecuteIntegrationCommandConfig {
  integrationId: string
  commandId: string
  projectSlug?: string
  inputMapping: Array<{ key: string; value: string }>
  outputKey?: string
  idempotencyKeyExpression?: string
}
```

Rules:
- `inputMapping` uses existing workflow interpolation semantics
- `outputKey` defaults to `activityId`
- `idempotencyKeyExpression` is optional; when omitted, the propagated workflow/session key is reused

### New Entity: `WorkflowTriggerReceipt`

Table: `workflow_trigger_receipts`

Purpose: prevent duplicate workflow starts from repeated integration deliveries.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK | Primary key |
| `workflow_definition_id` | uuid | NOT NULL | Workflow definition that owns the trigger |
| `trigger_id` | text | NOT NULL | Embedded trigger ID |
| `event_name` | text | NOT NULL | Declared event that was received |
| `dedupe_key` | text | NOT NULL | Resolved dedupe key |
| `workflow_instance_id` | uuid | NULL | Started instance, if any |
| `source_integration_id` | text | NULL | Provider ID, when known |
| `source_project_slug` | text | NULL | Project slug used for matching |
| `status` | text | NOT NULL | `accepted`, `ignored`, `failed` |
| `tenant_id` | uuid | NOT NULL | Tenant scope |
| `organization_id` | uuid | NOT NULL | Organization scope |
| `created_at` | timestamptz | NOT NULL | Audit timestamp |

Indices:
- `UNIQUE(trigger_id, dedupe_key, tenant_id, organization_id)`
- `INDEX(workflow_definition_id, created_at)`
- `INDEX(source_integration_id, source_project_slug, created_at)`

Retention:
- keep receipts for at least 30 days
- prune through a scheduled worker or existing maintenance path

### Workflow Instance Metadata

No new `workflow_instances` columns are required for MVP.

Store source/destination linkage in:
- `correlationKey`
- `metadata.labels`
- `context.__trigger`

Required labels for integration-started runs:
- `source_integration_id`
- `source_project_slug`
- `source_event_id`
- `source_session_id`

## API Contracts

### Existing Workflow Definition CRUD

The existing routes remain the write surface:

- `GET /api/workflows/definitions`
- `POST /api/workflows/definitions`
- `GET /api/workflows/definitions/:id`
- `PUT /api/workflows/definitions/:id`

Additive payload extension only:

```json
{
  "definition": {
    "triggers": [
      {
        "triggerId": "akeneo_product_created",
        "name": "Akeneo Product Created",
        "eventPattern": "sync_akeneo.product.created",
        "integrationSource": {
          "kind": "integration_event",
          "integrationId": "sync_akeneo",
          "eventId": "sync_akeneo.product.created",
          "projectSlug": "production",
          "dedupeKeyExpression": "{{context.deliveryId}}"
        }
      }
    ],
    "steps": [
      {
        "stepId": "write_sheet",
        "stepType": "AUTOMATED",
        "activities": [
          {
            "activityId": "append_row",
            "activityName": "Append Google Sheets Row",
            "activityType": "EXECUTE_INTEGRATION_COMMAND",
            "config": {
              "integrationId": "sync_google_sheets",
              "projectSlug": "marketing",
              "commandId": "write-row",
              "inputMapping": [
                { "key": "spreadsheetId", "value": "{{context.sheetId}}" },
                { "key": "sheetName", "value": "Products" }
              ],
              "outputKey": "google_sheets_write"
            }
          }
        ]
      }
    ]
  }
}
```

### Capability Discovery APIs Used by the Editor

This spec reuses the integrations APIs from the prerequisite specs:

- `GET /api/integrations/:id/capabilities`
- `GET /api/integrations/:id/projects`

The workflows editor uses them to populate:
- source integration picker
- source event picker
- destination integration picker
- destination command picker
- project selectors

### New Workflow Utility Endpoint

#### `POST /api/workflows/definitions/preview-integration-command`

Purpose:
- validate a mapped integration command input before the workflow definition is saved
- surface provider readiness and schema errors in the editor

Request:

```json
{
  "integrationId": "sync_google_sheets",
  "projectSlug": "marketing",
  "commandId": "write-row",
  "sampleContext": {
    "product": { "identifier": "SKU-123" }
  },
  "inputMapping": [
    { "key": "spreadsheetId", "value": "abc123" },
    { "key": "sheetName", "value": "Products" },
    { "key": "values", "value": "[\"{{context.product.identifier}}\"]" }
  ]
}
```

Response:

```json
{
  "ok": true,
  "isReady": true,
  "resolvedInput": {
    "spreadsheetId": "abc123",
    "sheetName": "Products",
    "values": ["SKU-123"]
  },
  "schemaIssues": []
}
```

### Authorization

Workflow definition management keeps existing workflow ACLs.

Additional rule:
- previewing or saving a workflow that references an integration command/event requires that the integration is visible to the user (`integrations.view`)

Execution rule:
- runtime command execution relies on system-managed credentials and does **not** require the triggering user to hold `integrations.credentials.manage`
- it does require the workflow definition to be editable only by authorized backend users

## Internationalization (i18n)

New keys required under `workflows.*`:
- trigger source mode labels (`custom event`, `integration event`)
- integration picker labels and empty states
- project selector labels
- command selector labels and readiness warnings
- dedupe key helper copy
- preview/validation feedback

Provider-facing labels stay in provider specs and packages.

## UI/UX

### Trigger Editor

Extend `DefinitionTriggersEditor.tsx`:

- add source mode switch:
  - `Custom Event Pattern`
  - `Integration Event`
- for integration events, render:
  - integration picker
  - project picker
  - event picker
  - dedupe key expression field
  - existing filter conditions and context mapping editors
- use `EventSelect` only for raw event-pattern mode; use integration capabilities for integration-event mode

### Activity Editor

Extend `ActivitiesEditor.tsx`, `ActivityArrayEditor.tsx`, and `NodeEditDialog*`:

- add `Execute Integration Command` activity type
- render:
  - destination integration picker
  - destination project picker
  - command picker
  - mapping editor reusing the current `MappingArrayEditor` interaction model
  - output key field
  - preview button backed by `preview-integration-command`

### Definition List / Detail

Add lightweight flow metadata in workflow list/detail views:
- source integration/event badge
- destination integration/command badge
- “integration flow” filter using workflow metadata tags

### Instance Detail

Show in the workflow instance page:
- source event name
- source integration/project
- propagated session ID
- executed integration command summary with success/failure state

## Migration & Compatibility

### Backward Compatibility

This spec is additive only.

- existing workflow definitions remain valid
- existing workflow trigger JSON remains valid
- existing activity types remain unchanged
- existing APIs keep the same paths and semantics
- no frozen event IDs or integration IDs are renamed

### Database Migration

Add one new table:
- `workflow_trigger_receipts`

No destructive changes are required.

### Rollout Order

1. Finalize and implement the additive integration command/event contracts
2. Finalize and implement integration projects
3. Add workflow runtime support for dedupe and command execution
4. Add workflow editor support
5. Add provider follow-up work

### Explicit Non-Goals

- no replacement of `data_sync` for bulk imports/exports
- no generic code/script node
- no dependency on unimplemented timer/parallel workflow steps
- no provider-specific logic inside `workflows`

## Provider Follow-Up Notes

This section records required provider deltas **without editing the original specs**.

### Akeneo (`packages/sync-akeneo/`, no standalone spec file yet)

| Area | Required change | Why |
|------|-----------------|-----|
| Integration definition | Declare commands such as `get-product`, `list-products`, `get-family`, `get-category` | Workflows need callable source-side enrichment actions |
| Event contract | Emit declared product/category/family events with stable payload keys, `deliveryId`, `sessionId`, `integrationId`, and project metadata | Workflow triggers need typed events and dedupe keys |
| Delta source | If Akeneo cannot push required events directly, add a provider-owned reconciliation path that converts API deltas into integration events | Workflows must not own provider polling logic |
| Logging/idempotency | Ensure command handlers and event emitters write provider-safe logs without leaking credentials | Workflow execution depends on provider observability |

### Google Sheets (`2026-03-29-google-workspace-integration.md`, package not yet present)

| Area | Required change | Why |
|------|-----------------|-----|
| Connector commands | Ensure `write-row` exists and is stable; add `update-row` / `lookup-row` if row updates are a target use case | Workflows need destination actions beyond raw webhooks |
| Output schemas | Define precise output schema for row write/update operations | Workflow preview and validation need typed outputs |
| Source events | If Google Sheets is also used as a source, define row-change derivation and stable event payloads | Workflows need source triggers, not only actions |
| Project/account mapping | Ensure project-aware OAuth/account resolution is explicit in provider runtime | One workflow may target a different Google account than the source provider |
| Idempotency | Make `write-row` support an idempotency strategy where possible, or document duplicate-write behavior | Workflow retries must not silently create duplicate rows |

### Commands & Events Spec Follow-Up

`2026-03-29-integration-commands-events.md` must explicitly guarantee:
- declared provider events are registered in the platform event registry
- command execution is project-aware
- provider events expose enough metadata for dedupe and correlation

This workflow spec assumes those points are part of the finalized prerequisite contract.

## Implementation Plan

### Phase 1: Contracts

1. Finalize the shared integration contracts required by workflows:
   - project-aware `integrationGateway`
   - stable command/event capability APIs
   - declared provider events visible to the event registry
2. Add shared narrow types for workflow consumption without leaking provider internals.
3. Document readiness, session, and idempotency semantics that workflow runtime can rely on.

### Phase 2: Workflow Runtime

1. Extend workflow validators and persisted JSON shapes for `integrationSource` and `EXECUTE_INTEGRATION_COMMAND`.
2. Add `workflow_trigger_receipts` and receipt persistence in `event-trigger-service.ts`.
3. Add `EXECUTE_INTEGRATION_COMMAND` to `activity-executor.ts` using `integrationGateway.execute(...)`.
4. Propagate `sessionId`, source integration/project labels, and destination command metadata into workflow instance context and logs.

### Phase 3: Workflow Editor

1. Extend trigger editor UI for typed integration-event selection.
2. Extend activity editor UI for typed integration-command selection and input mapping.
3. Add preview endpoint and UI affordance.
4. Add instance/detail badges for source and destination metadata.

### Phase 4: Provider Enablement

1. Add Akeneo command/event contracts needed for source flows.
2. Add Google Sheets destination commands and, if required later, source events.
3. Ship at least one example flow definition: `Akeneo product created -> Google Sheets append row`.

### Integration Coverage

Required integration coverage for this feature:

| Surface | Coverage |
|---------|----------|
| `POST /api/workflows/definitions` | Save workflow with integration trigger + command activity |
| `PUT /api/workflows/definitions/:id` | Update source/destination mappings |
| `POST /api/workflows/definitions/preview-integration-command` | Mapping preview success + schema error + not-ready destination |
| `GET /api/integrations/:id/capabilities` | Editor capability loading for source and destination |
| `GET /api/integrations/:id/projects` | Project-aware flow setup |
| Event bus -> workflow subscriber | Deduped start from repeated provider event |
| Workflow instance execution | Successful command execution, provider failure, retry-safe behavior |
| Backend workflow editor pages | Trigger/command pickers, mapping editor, readiness warnings |
| Workflow instance detail page | Source/destination metadata visibility |

### Testing Strategy

- unit tests for trigger dedupe key evaluation and receipt persistence
- unit tests for `EXECUTE_INTEGRATION_COMMAND` activity execution and context output
- integration tests for repeated source-event delivery producing a single workflow instance
- integration tests for project-aware source and destination resolution
- integration tests for `Akeneo -> Google Sheets` example flow using provider stubs or test providers

## Risks & Impact Review

#### Duplicate External Event Delivery
- **Scenario**: A provider webhook or reconciliation run emits the same event twice and two identical workflows start.
- **Severity**: High
- **Affected area**: Workflow automation, external writes, audit trail
- **Mitigation**: Persist `WorkflowTriggerReceipt` with a unique `(trigger_id, dedupe_key, tenant_id, organization_id)` constraint and default dedupe to provider `deliveryId`
- **Residual risk**: Providers that cannot supply a stable delivery key must rely on configured expressions, which can still be misconfigured by tenants

#### Wrong Project Resolution
- **Scenario**: A workflow reads from one project and writes using another project's credentials unintentionally, or falls back to `default` silently.
- **Severity**: High
- **Affected area**: Data integrity, tenant operations, provider-side writes
- **Mitigation**: Persist explicit `projectSlug` in trigger/activity config, surface it in the editor, and log resolved source/destination projects on every run
- **Residual risk**: Renaming concepts at the UI layer can still confuse operators; instance detail pages must expose the final resolved projects clearly

#### Workflow Becomes a Shadow Data Sync Engine
- **Scenario**: Users model high-volume imports in workflows because provider commands exist, causing poor performance and weak resumability.
- **Severity**: Medium
- **Affected area**: Workflows runtime, queue throughput, operator expectations
- **Mitigation**: Scope this spec to single-record event-driven automation and document bulk sync as `data_sync` only
- **Residual risk**: Some tenants will still try to build batch flows manually; docs and editor hints should steer them away

#### Duplicate Destination Writes on Retry
- **Scenario**: A workflow activity retries after a timeout and the destination command performs the same write twice.
- **Severity**: High
- **Affected area**: External systems, audit logs
- **Mitigation**: Support `idempotencyKeyExpression` in the activity config and propagate session-level correlation to provider commands
- **Residual risk**: Some providers cannot guarantee true idempotency; those commands must document duplicate-write semantics

#### Provider Events Missing from Event Registry
- **Scenario**: A provider declares integration events, but they are not visible to workflow trigger discovery or runtime validation.
- **Severity**: High
- **Affected area**: Workflow editor, trigger runtime
- **Mitigation**: Make declared provider events a prerequisite of the integration commands/events contract
- **Residual risk**: Until that prerequisite ships, this workflow extension remains partially blocked

#### Sensitive Data Leakage Through Workflow Context
- **Scenario**: Provider command output or inbound event payload stores secrets or large blobs in workflow context or logs.
- **Severity**: Medium
- **Affected area**: Audit logs, instance detail UI, compliance
- **Mitigation**: Providers must emit sanitized event payloads; workflow preview/runtime must log schema-safe summaries rather than raw credential-bearing payloads
- **Residual risk**: Third-party APIs may return noisy or oversized payloads, requiring provider-specific redaction

## Final Compliance Report — 2026-03-29

### AGENTS.md Files Reviewed
- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | Spec keeps provider/workflow links as IDs and metadata only |
| `AGENTS.md` | Always filter by `organization_id` | Compliant | New receipt table is tenant/org scoped |
| `AGENTS.md` | Event IDs are frozen once published | Compliant | Spec introduces no renamed public event IDs |
| `.ai/specs/AGENTS.md` | Non-trivial changes need a spec | Compliant | This document is the standalone spec for the workflow extension |
| `packages/core/AGENTS.md` | API route files MUST export `openApi` | Compliant | New workflow utility endpoint is specified with the same requirement |
| `packages/core/AGENTS.md` | Events must be declared in module `events.ts` | Compliant with dependency | Workflow runtime consumes provider-declared events from the prerequisite commands/events contract |
| `packages/core/src/modules/workflows/AGENTS.md` | Use event triggers and signals for cross-module integration | Compliant | The design starts workflows from events and invokes providers through a gateway, not direct imports |
| `packages/core/src/modules/workflows/AGENTS.md` | Keep activity handlers idempotent | Compliant | Dedupe and idempotency keys are explicit runtime requirements |
| `packages/shared/AGENTS.md` | Export narrow interfaces, avoid `any`/`unknown` | Compliant | Shared additions are described as narrow typed contracts |
| `packages/ui/AGENTS.md` | Use `EventSelect` for generic event selection | Compliant | Raw event mode still uses `EventSelect`; integration mode uses capabilities APIs |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Trigger/activity JSON additions are reflected in payload examples |
| API contracts match UI/UX section | Pass | Editor additions map directly to contract additions |
| Risks cover all write operations | Pass | Destination writes and duplicate-trigger risks are explicit |
| Commands defined for all mutations | Pass | New external writes go through `EXECUTE_INTEGRATION_COMMAND` |
| Cache strategy covers all read APIs | Pass | No new cache dependency is required in this spec |

### Non-Compliant Items

None in this document itself.

### Verdict

- **Fully compliant**: Approved as a follow-on specification. Implementation sequencing still depends on the prerequisite integration command/project contracts landing first.

## Changelog

### 2026-03-29
- Initial specification for workflow-native integration flows
