# SPEC: Add Missing OpenAPI Response Specs for Workflows API

- **Issue**: open-mercato/open-mercato#333
- **Status**: Draft
- **Author**: AI-assisted
- **Date**: 2026-04-12

## TLDR

The Workflows module still exposes several `z.any()` placeholders in OpenAPI response docs for instance and event endpoints. We should replace them with route-accurate schemas, but the fix is not a single entity-to-schema mapping: the affected endpoints return a mix of raw entity-like payloads, executor result payloads, lightweight background-start payloads, and enriched event view models.

This spec updates the response documentation strategy so generated OpenAPI stays truthful to current runtime behavior. The implementation should remove `z.any()` from the affected route docs without changing endpoint URLs, runtime logic, or persisted data.

## Overview

The workflows module already has centralized OpenAPI helpers for tasks, signals, validation, and shared pagination/error shapes. The missing coverage sits in the instance and event routes, where response schemas still use `z.any()` placeholders.

The key constraint is accuracy: OpenAPI output is consumed by documentation, SDK/type generation, and LLM-facing tooling. Because several routes serialize different views of the same underlying entities, the new schemas must be derived from actual route responses, not directly from ORM entities alone.

## Problem Statement

Seven workflows route files still use `z.any()` in their `openApi` exports. This causes three concrete problems:

- Generated API docs lose useful structure for workflows instances and events.
- OpenAPI-derived consumers cannot infer correct response types for those endpoints.
- The docs imply less stable contracts than the code actually provides.

The issue is more subtle than "replace `z.any()` with entity schemas." Current routes return different response shapes:

- `POST /api/workflows/instances` returns a created instance plus lightweight background execution metadata.
- `POST /api/workflows/instances/:id/retry` returns an instance plus the workflow executor's `ExecutionResult`.
- `GET /api/workflows/events` returns enriched event list items with nested workflow instance summary data.
- `GET /api/workflows/instances/:id/events` returns raw event rows plus standard pagination.
- `GET /api/workflows/events/:id` returns a detail view with nested workflow instance detail.

If we document these routes with overly generic or incorrect shared schemas, we replace `z.any()` with misleading contracts, which is worse than leaving them loose.

## Scope

### Affected Endpoints

| # | File | Method | Endpoint | Current Placeholder |
|---|------|--------|----------|---------------------|
| 1 | `api/instances/route.ts` | GET | `/api/workflows/instances` | `data: z.array(z.any())` |
| 2 | `api/instances/route.ts` | POST | `/api/workflows/instances` | `instance: z.any()`, `execution: z.any()` |
| 3 | `api/instances/[id]/route.ts` | GET | `/api/workflows/instances/:id` | `data: z.any()` |
| 4 | `api/instances/[id]/cancel/route.ts` | POST | `/api/workflows/instances/:id/cancel` | `data: z.any()` |
| 5 | `api/instances/[id]/retry/route.ts` | POST | `/api/workflows/instances/:id/retry` | `instance: z.any()`, `execution: z.any()` |
| 6 | `api/instances/[id]/events/route.ts` | GET | `/api/workflows/instances/:id/events` | `data: z.array(z.any())` |
| 7 | `api/events/route.ts` | GET | `/api/workflows/events` | `items: z.array(z.any())` |
| 8 | `api/events/[id]/route.ts` | GET | `/api/workflows/events/:id` | `eventData: z.any()`, `context: z.any()` |

### Not Affected

- `api/definitions/route.ts`
- `api/definitions/[id]/route.ts`
- `api/instances/[id]/advance/route.ts`
- `api/instances/[id]/signal/route.ts`
- `api/instances/validate-start/route.ts`
- `api/tasks/route.ts`
- `api/tasks/[id]/route.ts`
- `api/tasks/[id]/claim/route.ts`
- `api/tasks/[id]/complete/route.ts`
- `api/signals/route.ts`

### Out of Scope

- Changing runtime response payloads
- Normalizing inconsistent date or ID serialization across workflows routes
- Refactoring executor/domain types from `Record<string, any>` to stricter runtime types
- Changing permissions, business logic, or database schema

## Proposed Solution

Add route-accurate OpenAPI schemas for the affected workflows instance and event responses. Reuse shared primitives where the payload is truly shared, but do not force all affected routes through a single entity-derived schema.

The implementation should follow this separation:

- Shared primitive schemas in `api/openapi.ts` for reusable pieces such as workflow instance rows, workflow event rows, execution result summaries, workflow instance summary blocks, and common pagination/error wrappers.
- Route-specific response schemas in `api/openapi.ts` or route-local composition where the wrapper shape is unique.
- JSON-like dynamic fields documented as `z.unknown()` unless the route guarantees an object shape.

The guiding rule is: document what the route actually serializes today.

## Architecture

### Design Principles

1. **Route contracts first**
   Build response schemas from actual `NextResponse.json(...)` payloads, not from ORM entities or internal TypeScript types alone.

2. **Shared primitives, not forced unification**
   Centralize reusable fragments such as `workflowInstanceStatus`, `workflowInstanceResponse`, `workflowExecutionResult`, and `workflowEventListItem`, but allow distinct wrappers for list/detail/retry/create responses.

3. **OpenAPI accuracy over aspirational typing**
   If a field can currently contain arbitrary JSON, document it as `z.unknown()` rather than narrowing it to `z.record(z.unknown())` unless the route enforces an object.

4. **No runtime behavior changes**
   This spec is limited to response documentation quality. If we later want to normalize workflows response serialization, that should happen under a separate spec.

### Schema Ownership

- `api/openapi.ts` should own reusable response/documentation primitives for the workflows API.
- Route files should compose those primitives in `openApi.responses`.
- Runtime validators in `data/validators.ts` remain request/input-oriented and should not be treated as automatic response schemas unless they already match serialized output.

## Data Models

This spec introduces or documents the following response models.

### 1. `workflowInstanceResponseSchema`

Represents the serialized workflow instance object returned by:

- `GET /api/workflows/instances`
- `GET /api/workflows/instances/:id`
- `POST /api/workflows/instances/:id/cancel`
- `POST /api/workflows/instances/:id/retry` under `data.instance`

Expected fields:

- `id`
- `definitionId`
- `workflowId`
- `version`
- `status`
- `currentStepId`
- `context`
- `correlationKey`
- `metadata`
- `startedAt`
- `completedAt`
- `pausedAt`
- `cancelledAt`
- `errorMessage`
- `errorDetails`
- `retryCount`
- `tenantId`
- `organizationId`
- `createdAt`
- `updatedAt`
- `deletedAt`

Notes:

- Do not include `previousStepId`; it is not part of the current instance entity/response contract.
- Use `z.unknown()` for `context`, `metadata`, and `errorDetails` unless route-level guarantees are added.

### 2. `workflowExecutionResultSchema`

Represents the serialized executor result returned by `executeWorkflow(...)` and used by `POST /api/workflows/instances/:id/retry`.

Expected fields:

- `status`
- `currentStep`
- `context`
- `events`
- `errors` optional
- `executionTime`

Nested event summary fields:

- `eventType`
- `occurredAt`
- `data` optional

### 3. `workflowBackgroundStartSchema`

Represents the lightweight execution metadata returned by `POST /api/workflows/instances` after background kickoff.

Expected fields:

- `status`
- `currentStep`
- `message`

This is intentionally different from `workflowExecutionResultSchema`.

### 4. `workflowEventRowSchema`

Represents a raw workflow event row suitable for `GET /api/workflows/instances/:id/events`.

Expected fields:

- `id`
- `workflowInstanceId`
- `stepInstanceId`
- `eventType`
- `eventData`
- `occurredAt`
- `userId`
- `tenantId`
- `organizationId`

### 5. `workflowEventListItemSchema`

Represents the enriched list item returned by `GET /api/workflows/events`.

Expected fields:

- `id`
- `workflowInstanceId`
- `stepInstanceId`
- `eventType`
- `eventData`
- `occurredAt`
- `userId`
- `workflowInstance` nullable

Nested `workflowInstance` summary fields:

- `id`
- `workflowId`
- `workflowName`
- `status`

### 6. `workflowEventDetailSchema`

Represents the detail payload returned by `GET /api/workflows/events/:id`.

Expected fields:

- `id`
- `workflowInstanceId`
- `stepInstanceId`
- `eventType`
- `eventData`
- `occurredAt`
- `userId`
- `tenantId`
- `organizationId`
- `workflowInstance` nullable

Nested `workflowInstance` detail fields:

- `id`
- `workflowId`
- `version`
- `status`
- `currentStepId`
- `correlationKey`
- `startedAt`
- `completedAt`
- `context`

## API Contracts

### GET `/api/workflows/instances`

Response shape:

```ts
{
  data: workflowInstanceResponseSchema[],
  pagination: {
    total: number,
    limit: number,
    offset: number,
    hasMore: boolean,
  }
}
```

### POST `/api/workflows/instances`

Response shape:

```ts
{
  data: {
    instance: workflowInstanceResponseSchema,
    execution: workflowBackgroundStartSchema,
  },
  message: string,
}
```

### GET `/api/workflows/instances/:id`

Response shape:

```ts
{
  data: workflowInstanceResponseSchema,
}
```

### POST `/api/workflows/instances/:id/cancel`

Response shape:

```ts
{
  data: workflowInstanceResponseSchema,
  message: string,
}
```

### POST `/api/workflows/instances/:id/retry`

Response shape:

```ts
{
  data: {
    instance: workflowInstanceResponseSchema,
    execution: workflowExecutionResultSchema,
  },
  message: string,
}
```

### GET `/api/workflows/instances/:id/events`

Response shape:

```ts
{
  data: workflowEventRowSchema[],
  pagination: {
    total: number,
    limit: number,
    offset: number,
    hasMore: boolean,
  }
}
```

### GET `/api/workflows/events`

Response shape:

```ts
{
  items: workflowEventListItemSchema[],
  total: number,
  page: number,
  pageSize: number,
  totalPages: number,
}
```

### GET `/api/workflows/events/:id`

Response shape:

```ts
workflowEventDetailSchema
```

## UI/UX

No UI runtime behavior changes are expected. The user-facing impact is indirect:

- Generated documentation becomes readable and more trustworthy.
- SDK/type consumers gain more precise response typing.
- LLM or MCP tooling that relies on OpenAPI-derived types can build better payload/context understanding.

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Schema definitions drift from actual route payloads | High | OpenAPI output, SDK generation, AI tooling | Define schemas from route responses first; verify generated output after implementation | Low |
| A single shared event schema is applied to incompatible list/detail/raw event responses | High | Workflows events documentation | Keep separate schemas for raw row, enriched list item, and detail payload | Low |
| Dynamic JSON fields are narrowed too aggressively | Medium | Event/context/error payload docs | Use `z.unknown()` by default for unconstrained JSON fields | Low |
| Existing serialization inconsistencies remain visible in docs | Medium | Generated OpenAPI clarity | Document current behavior honestly; defer normalization to a separate spec | Medium |
| Over-centralization in `api/openapi.ts` makes route docs harder to maintain | Low | Code maintainability | Centralize only shared primitives and small composed responses | Low |

## Phasing

### Phase 1: Define Shared Response Primitives

Add missing reusable schemas to `packages/core/src/modules/workflows/api/openapi.ts`:

1. `workflowInstanceResponseSchema`
2. `workflowExecutionEventSummarySchema`
3. `workflowExecutionResultSchema`
4. `workflowBackgroundStartSchema`
5. `workflowEventRowSchema`
6. `workflowEventInstanceSummarySchema`
7. `workflowEventListItemSchema`
8. `workflowEventDetailSchema`
9. Any shared pagination wrapper reuse needed for affected routes

### Phase 2: Replace `z.any()` in Affected Route Docs

Update the affected route files to compose the new schemas:

- `api/instances/route.ts`
- `api/instances/[id]/route.ts`
- `api/instances/[id]/cancel/route.ts`
- `api/instances/[id]/retry/route.ts`
- `api/instances/[id]/events/route.ts`
- `api/events/route.ts`
- `api/events/[id]/route.ts`

### Phase 3: Verify Accuracy

1. Type-check the package build.
2. Regenerate generated artifacts.
3. Inspect generated OpenAPI output to confirm the placeholders are gone and response shapes match route behavior.
4. Add or update automated assertions where practical for generated schema output or route doc structure.

## Implementation Plan

### Step 1: Audit Existing Route Payloads

Before editing schemas, confirm the exact JSON shape returned by each route and map it into a response contract table. This prevents entity-based assumptions from leaking into docs.

### Step 2: Add OpenAPI-Specific Response Schemas

Implement the missing schemas in `api/openapi.ts` using serialized response shapes, not ORM field types alone.

Guidance for dynamic JSON fields:

- Use `z.unknown()` for `context`, `eventData`, `metadata`, and `errorDetails` unless the route guarantees an object.
- Prefer separate nested schemas for workflow instance summaries versus full workflow instance payloads.

### Step 3: Update Route `openApi` Exports

Replace each `z.any()` usage with the route-appropriate schema composition:

- `workflowBackgroundStartSchema` for create-start execution payloads
- `workflowExecutionResultSchema` for retry execution payloads
- `workflowEventRowSchema` for instance event history
- `workflowEventListItemSchema` for global event listing
- `workflowEventDetailSchema` for event detail

### Step 4: Verify Generator Output

Run:

- `yarn build:packages`
- `yarn generate`

Then inspect the generated OpenAPI artifact and confirm:

- none of the targeted workflows response schemas still contain `z.any()` placeholders
- response models match the route payloads described in this spec
- nested workflow event payloads remain correctly represented

## Integration Test Coverage

This change does not require new end-to-end UI coverage, but it does require contract verification for generated API docs.

Minimum coverage expectations:

1. Confirm the affected route modules still export valid `openApi` docs after schema replacement.
2. Verify generated OpenAPI output includes typed response schemas for:
   - `/api/workflows/instances`
   - `/api/workflows/instances/{id}`
   - `/api/workflows/instances/{id}/cancel`
   - `/api/workflows/instances/{id}/retry`
   - `/api/workflows/instances/{id}/events`
   - `/api/workflows/events`
   - `/api/workflows/events/{id}`
3. Verify the create and retry endpoints do not share the same execution schema unless their runtime payloads are explicitly aligned in code.

If there is no stable automated generator assertion pattern in this area yet, document the manual verification performed in the implementation PR and treat generator regression coverage as follow-up work.

## Migration & Backward Compatibility

This spec does not change runtime endpoints, HTTP methods, or response payloads. It updates the documented response schemas for existing routes.

Compatibility notes:

- No API URL or method changes.
- No response fields should be removed from documented output relative to current runtime behavior.
- OpenAPI output is still a published contract for documentation and generated consumers, so inaccurate tightening is a compatibility risk.
- If implementation uncovers a desire to normalize runtime payloads, that must happen in a separate spec with explicit migration handling.

## Final Compliance Report

| Check | Status | Notes |
|------|--------|-------|
| Required spec sections present | Pass | Added TLDR, Overview, Proposed Solution, Architecture, Data Models, API Contracts, Risks, Phasing, Test Coverage, Compliance, Changelog |
| Matches root Task Router guidance | Pass | Scoped to workflows module API/OpenAPI documentation |
| Backward compatibility section included | Pass | Clarifies docs-only scope and downstream contract risk |
| Implementation-accurate route modeling | Pass with caution | Must still verify route payloads during implementation before final merge |
| Integration coverage described | Pass | Focused on generated OpenAPI verification |

## Size Estimate

| Dimension | Estimate |
|-----------|----------|
| Files changed | 8 |
| Lines added | ~140-180 |
| Lines modified | ~40-60 |
| Complexity | Low to medium |
| Risk | Medium |
| Estimated effort | Small to moderate (~2-4 hours) |

## Changelog

- **2026-04-12**: Rewrote the spec to model actual route response shapes, added required spec sections, clarified risks, and expanded verification expectations.
