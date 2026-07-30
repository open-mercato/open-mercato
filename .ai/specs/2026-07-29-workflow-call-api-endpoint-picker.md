# Workflow Call API Endpoint Picker

## TLDR

Add an authenticated workflow endpoint catalog and a structured picker for `CALL_API` activities. Workflow authors can discover internal Open Mercato API operations, fill required and optional parameters, inspect declared request and response schemas, and catch incomplete catalog-backed configuration before saving. Existing manually authored `CALL_API` definitions remain editable and executable without migration.

**Scope:**

- Read-only `GET /api/workflows/endpoints` catalog derived from the canonical generated OpenAPI document.
- Reusable `CALL_API` picker across every current workflow activity authoring host.
- Method/path search, required and optional parameter inputs, request/response schema hints, and pre-save validation.
- Primitive path/query/header parameters that use their location's default OpenAPI serialization.
- Backward-compatible save/reload/edit behavior for existing manual configurations.
- Unit, API, component, integration, and headed desktop/narrow-viewport coverage.

**Non-goals:**

- Changing `CALL_API` runtime execution, SSRF controls, initiating-user role resolution, or target-operation authorization.
- Fixing or replacing OpenAPI response-schema generation tracked by [#4230](https://github.com/open-mercato/open-mercato/issues/4230).
- Requiring every route to declare request or response schemas.
- Structured serialization of array/object parameters or non-default OpenAPI `style`, `explode`, or `allowReserved` combinations.
- Replacing the advanced/manual JSON editor or adding a second HTTP activity type.
- Persisting endpoint metadata in a database.
- Extending the picker to webhooks or signal configuration in this change.

## Overview

The workflows editor currently requires authors to enter `CALL_API` configuration as raw JSON. Issue [#4235](https://github.com/open-mercato/open-mercato/issues/4235) asks for endpoint discovery, parameter hints, response schemas, and upfront validation.

The closest market reference is n8n's [HTTP Request node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), which separates method, URL, query parameters, headers, and body while preserving raw configuration options. Open Mercato adopts the same structured-first/manual-fallback principle, but derives choices from its own generated OpenAPI surface and retains the existing `CALL_API` persistence and execution contracts.

## Problem Statement

Workflow authors must already know internal paths, methods, parameter names, and response shapes. The editor cannot distinguish required from optional endpoint inputs, declared OpenAPI schemas are unavailable at the point of configuration, and incomplete catalog-backed values are not detected before save.

The solution must improve authoring without creating a second source of endpoint truth, weakening runtime authorization, exposing tenant data, or invalidating existing workflow definitions.

## Prerequisite

The picker consumes the canonical generated OpenAPI document. Accurate response hints depend on [#4230](https://github.com/open-mercato/open-mercato/issues/4230) landing first. This specification does not absorb that independently deployable generator fix:

- implementation of this specification must start from a base where #4230 is merged and verified;
- the catalog exposes only schemas actually declared by the canonical document;
- missing or generic fallback schemas render an honest localized “not declared” state;
- the picker remains usable for method, path, and parameter discovery when a schema is absent.

## Proposed Solution

1. Project the canonical generated OpenAPI document into a minimal workflow endpoint catalog.
2. Expose the projection through an authenticated, feature-gated read API.
3. Add one reusable `CALL_API` configuration editor to every existing workflow activity authoring host.
4. Continue persisting `config.endpoint`, `config.method`, `config.headers`, and `config.body`.
5. Preserve raw JSON editing, unknown keys, and free-text endpoints as the compatibility fallback.
6. Validate required parameters only when the author selects a known catalog operation.

### Design Decisions

| Decision | Rationale |
| --- | --- |
| Build from the canonical generated OpenAPI document | Keeps the picker aligned with the exact enabled route surface and avoids a second registry. |
| Pass the canonical document through the existing app API dispatch boundary | The lazy package route cannot safely rediscover every app route; the app already owns generated route/OpenAPI artifacts. |
| Cache the structural projection per server process | The generated route surface changes on generation plus restart/deploy, not per request. |
| Omit undeclared response schemas | A missing state is safer than presenting a generic fallback as a real contract. |
| Keep endpoint text editing and raw JSON | Existing definitions and custom internal endpoints must remain editable without catalog coupling. |
| Validate only catalog selections | The editor can prove required parameters only for a matched declared operation. |
| Structure only primitive parameters with default serialization | Unsupported OpenAPI serialization remains visible but routes authors to the unchanged manual editor instead of generating a potentially incorrect request. |
| Do not filter catalog items by every target route's ACL | The catalog is authoring metadata guarded by workflow-definition access. Runtime authorization remains authoritative; uniform per-route visibility metadata is a separate capability. |

### Alternatives Considered

| Alternative | Why rejected |
| --- | --- |
| Persist endpoint metadata | Duplicates generated structural data and creates synchronization and migration work. |
| Call the public API-docs HTTP route | Adds an avoidable network/auth dependency and can drift from the in-process enabled route surface. |
| Replace `CALL_API` with a normalized persisted model | Breaks the stable definition contract and existing definitions. |
| Reject endpoints absent from the catalog | OpenAPI coverage is additive and manual internal endpoints are valid. |
| Bundle response-schema generator repair | #4230 is independently deployable and already tracked separately. |

## User Stories

- A workflow author searches operations by path, method, summary, or tag instead of memorizing routes.
- A workflow author sees required and optional parameters separately and receives an appropriate input for each supported location.
- A workflow author inspects declared request and response fields while configuring the activity.
- A workflow author receives a visible validation error for unresolved required catalog parameters before save.
- An existing workflow owner opens, saves, reloads, edits, and executes a manual `CALL_API` configuration unchanged.

## Architecture

```text
canonical generated OpenAPI document
                 |
                 v
project operations, parameters, and declared schemas
                 |
                 v
process-cached workflow endpoint catalog
                 |
                 v
GET /api/workflows/endpoints
                 |
                 v
reusable CALL_API picker
                 |
                 v
existing activity.config contract
```

The workflows module owns the projection, endpoint matching/composition helpers, API route, picker, validation, translations, and tests. The app and create-app API catch-all routes provide the generated OpenAPI document through an additive handler context field so the lazy workflows route consumes the exact app-specific document without loading every route module a second time.

The catalog route uses normal request-container/authentication resolution, requires tenant and organization context, and requires `workflows.definitions.view`. It returns structural metadata only. Catalog visibility never grants permission to invoke an operation.

The unchanged runtime executor continues to:

- accept only `/api/*` or same-host endpoints according to the existing SSRF policy;
- execute under the initiating user's resolved roles;
- apply the target route's normal authentication, tenant, organization, and feature guards;
- preserve existing interpolation and retry/error semantics.

Pure endpoint helpers match concrete or interpolated paths to declared templates and compose supported path/query/header values. Structured composition is limited to primitive `string`, `number`, `integer`, and `boolean` parameters whose serialization is absent or matches the OpenAPI default for their location: `simple`/`explode: false` for path and header parameters, and `form`/`explode: true` for query parameters, always without `allowReserved: true`. Literal path and query values are URI-encoded; complete workflow interpolation tokens such as `{{context.recordId}}` remain intact. Optional empty path segments are omitted rather than serialized as generated placeholders.

Array/object parameters and parameters with non-default serialization remain listed as manual-only metadata. The picker does not generate placeholders or claim validation coverage for them; it shows localized guidance to configure the existing endpoint, headers, or raw JSON fields manually.

### Frontend Architecture Contract

#### Server/Client Boundary Map

| Surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| Existing definition create/edit hosts | Existing route/page roots, unchanged | Existing activity editors plus `EndpointPicker` | `GET /api/workflows/endpoints` | No new page-root client boundary. |
| Existing visual editor | Existing visual-editor page root, unchanged | Existing node/edge dialogs plus `EndpointPicker` | `GET /api/workflows/endpoints` | React Flow ownership remains unchanged. |

#### `"use client"` Ledger

| File | Browser-only reason | Imported by | Heavy dependencies | Hydration/cleanup risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `components/fields/EndpointPicker.tsx` | Search/popover state, lazy loading, parameter editing | Current activity editors | None; existing UI primitives only | Abort-safe request state; no global listeners/providers | Server rendering cannot provide interactive editing. |
| `components/fields/EndpointPickerParts.tsx` | Small client-rendered picker rows and schema hints | `EndpointPicker.tsx` | None | Stateless | Keeping presentation separate prevents one oversized client file. |

#### Budgets

| Budget | Target |
| --- | --- |
| New client page roots | 0 |
| New/touched client files over 300 LOC | 0 without an explicit review exception |
| New heavy browser libraries | 0 |
| New global providers/bootstrap imports | 0 |
| Hydration/interactivity evidence | Component tests plus headed save/reload/edit flows |
| Static boundary evidence | `corepack yarn check:client-boundaries` when available, otherwise targeted typecheck/build |
| Runtime evidence | Desktop and 390 px wide route load with no new document overflow or page/app console errors |

### Commands, Events, Cache, and Side Effects

- No new domain commands, mutations, events, subscribers, jobs, database writes, or cache invalidations.
- The process cache contains structural, non-tenant endpoint metadata only.
- Cache reset is exported for deterministic tests; normal refresh occurs on generation plus application restart/deploy.
- Catalog request failures are non-destructive: the current config remains intact and manual editing stays available.

## Data Models

No persisted entities or migrations are introduced.

```ts
type WorkflowEndpointParam = {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  type: string
  supported: boolean
  unsupportedReason?: 'non_primitive' | 'serialization'
}

type WorkflowEndpointDescriptor = {
  path: string
  method: string
  summary: string
  tag: string
  params: WorkflowEndpointParam[]
  hasRequestSchema: boolean
  requestSchema?: Record<string, unknown>
  responseSchema?: Record<string, unknown>
}
```

The catalog contains no credentials, examples, request bodies, tenant records, workflow execution data, or PII.

## API Contracts

### `GET /api/workflows/endpoints`

- Authentication: required.
- Tenant and organization context: required.
- Feature: `workflows.definitions.view`.
- Request body: none.
- Pagination: none; this is a finite structural registry assembled once per process.
- Route exports: method-scoped `metadata` plus `openApi`.

Example response:

```json
{
  "items": [
    {
      "path": "/api/customers/people/{id}",
      "method": "GET",
      "summary": "Get a customer person",
      "tag": "Customers",
      "params": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "type": "string",
          "supported": true
        }
      ],
      "hasRequestSchema": false,
      "responseSchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string" }
        }
      }
    }
  ]
}
```

Errors:

| Status | Condition |
| --- | --- |
| `400` | Missing tenant or organization context |
| `401` | Unauthenticated |
| `403` | Missing workflow-definition view feature |
| `500` | Catalog projection failure |

All response shapes are backed by Zod/OpenAPI declarations. Internal failures return a minimal localized error and do not expose paths, stack traces, or document contents.

### Existing `CALL_API` Contract

No field is removed, renamed, or narrowed:

```json
{
  "endpoint": "/api/customers/people/{{context.personId}}?include=details",
  "method": "GET",
  "headers": {},
  "body": {}
}
```

Picker-owned parameter values are composed into the existing endpoint, headers, and body fields. Unknown config keys remain untouched.

## UI/UX and Internationalization

- Keep the endpoint as a visible, labeled text input.
- “Browse endpoints” opens a searchable popover grouped by OpenAPI tag.
- Search matches method, path, summary, and tag.
- Each result shows method, path, and summary.
- Selecting a result writes method/path and renders required inputs before optional inputs.
- Parameter rows show location and primitive type.
- Unsupported parameter shapes/serialization remain visible with translated manual-configuration guidance and never receive generated values or validation claims.
- Empty required catalog parameters use `aria-invalid` and translated semantic error text before submit.
- Declared request and response schemas render compact top-level field hints.
- Missing schemas render translated “not declared” copy.
- Loading uses shared loading primitives; recoverable catalog failure uses `<Alert status="warning" ...>` and preserves current values.
- Controls use existing UI primitives, semantic tokens, DS spacing/type scales, visible labels, `focus-visible` behavior, and `aria-label` on icon-only buttons.
- Existing dialogs retain `Cmd/Ctrl+Enter` submit and `Escape` cancel.
- The picker remains usable at 390 px viewport width without document horizontal overflow.
- All copy uses `workflows.endpointPicker.*` keys in `en`, `de`, `es`, and `pl`.

## Migration & Backward Compatibility

- No data migration or backfill.
- `CALL_API` runtime behavior and persisted fields remain unchanged.
- Existing manual definitions round-trip unchanged, including unknown config keys.
- `GET /api/workflows/endpoints` and the optional handler-context field are additive contract surfaces.
- Free-text endpoint editing and raw JSON remain supported.
- Required-parameter validation applies only to namespaced placeholders generated by the picker. Unknown manual endpoints and manually authored braces are not rejected.
- Array/object parameters and non-default OpenAPI serialization remain manual-only; no existing manual configuration is normalized or rejected.
- The implementation must not rename an API route, activity type, ACL feature, event ID, DI key, import path, or widget spot.

## Implementation Plan

### Phase 0: Prerequisite Read-back

1. Verify #4230 is merged into the current contribution base.
2. Prove the canonical generated OpenAPI document carries real declared response objects and retains an honest missing-schema state.
3. Re-run duplicate and active-claim discovery for #4235 before implementation admission.

### Phase 1: Catalog and Pure Helpers

1. Add endpoint matching/composition, supported-serialization classification, and schema-hint helpers with focused unit tests.
2. Add the server-only generated-OpenAPI projection with deterministic ordering and test-only cache reset.
3. Add Zod/OpenAPI response schemas and the guarded catalog GET route.
4. Pass the canonical generated document through the app and create-app API handler context.

### Phase 2: Structured Authoring

1. Add the reusable picker using `apiCall`, shared UI primitives, translated states, and no new production dependency.
2. Integrate it into all current activity authoring hosts: definition transitions, visual node/edge dialogs, and CrudForm-backed variants.
3. Retain raw JSON/manual endpoint editing and unknown-field preservation.
4. Add locale and host-level component tests.

### Phase 3: Integration and Release Evidence

1. Add a self-contained Playwright case for browse, select, required validation, optional parameters, schema hints, save, API read-back, reload, edit, update, execution, and cleanup.
2. Run targeted unit/API/component tests, typechecks, package build, lint, client-boundary checks, and the focused Playwright case.
3. Complete headed desktop and narrow-viewport QA against the exact candidate.

### Expected File Manifest

| Area | Action | Purpose |
| --- | --- | --- |
| `packages/core/src/modules/workflows/lib/endpoint-path.ts` | Add | Pure matching, composition, encoding, and placeholder helpers |
| `packages/core/src/modules/workflows/lib/endpoint-schema.ts` | Add | Safe schema/field projection helpers |
| `packages/core/src/modules/workflows/lib/endpoint-catalog.ts` | Add | Server-only OpenAPI projection and process cache |
| `packages/core/src/modules/workflows/lib/call-api-editor-validation.ts` | Add | Shared picker-owned required-parameter validation |
| `packages/core/src/modules/workflows/api/endpoints/route.ts` | Add | Authenticated endpoint catalog |
| `packages/core/src/modules/workflows/api/openapi.ts` | Modify | Zod/OpenAPI catalog response declarations |
| App and create-app API catch-all routes | Modify | Provide canonical OpenAPI document to lazy route context |
| `packages/core/src/modules/workflows/components/fields/EndpointPicker*.tsx` | Add | Bounded interactive picker and presentation parts |
| Existing workflow activity editors and `formConfig.tsx` | Modify | Reuse picker and shared validation |
| Definition create/edit and visual-editor hosts | Modify only where needed | Use translated validation without changing page ownership |
| `packages/core/src/modules/workflows/i18n/*.json` | Modify | Localized picker copy |
| Workflows unit/component/API and `__integration__` tests | Add/modify | Contract, compatibility, and lifecycle coverage |

## Testing Strategy

### Unit and Component

- Exact/template path matching, trailing slashes, method mismatch, deterministic ambiguous matches.
- Required and optional primitive path/query/header values using each location's default OpenAPI serialization.
- Array/object parameters plus non-default `style`, `explode`, and `allowReserved` combinations are marked manual-only and never structurally composed or validated.
- URI encoding of literals while preserving complete workflow interpolation tokens.
- Optional empty path omission and stale picker-generated header cleanup.
- Catalog projection, deterministic ordering, declared/missing schemas, and cache reset.
- Picker loading, search, selection, required ordering, schema hints, failure fallback, and manual configuration.
- Every classic and CrudForm host preserves manual config and surfaces picker-owned validation.

### API

- Authorized request returns projected structural items.
- Missing scope, unauthenticated, and missing-feature paths return `400`, `401`, and `403`.
- Projection failure returns a minimal `500`.
- Generated OpenAPI includes the catalog response contract.
- Catalog responses contain no examples, credentials, tenant data, or request payloads.

### Integration and Headed QA

- Create every workflow fixture in the test; do not depend on seeded/demo data.
- Browse and select a real operation with required and optional parameters.
- Prove required validation blocks/surfaces submission until resolved.
- Prove optional values may remain empty and declared schema hints are visible.
- Save, read back through the definition API, reload, edit, update, and read back again.
- Execute a safe catalog-backed `CALL_API` and assert terminal success plus expected response shape.
- Repeat critical interaction at desktop and 390 px viewport width.
- Assert no document horizontal overflow and no new page/app console errors.
- Delete created definitions in `finally`; retain only immutable execution records when no supported delete route exists.

## Risks & Impact Review

### Endpoint Metadata Exposure

- **Scenario:** An author sees route names or schema fields for operations they cannot execute.
- **Severity:** Medium.
- **Mitigation:** Require authenticated tenant/organization context and `workflows.definitions.view`; return structural schemas only; state clearly that target-operation authorization is enforced only at runtime.
- **Detection:** Route authorization tests plus payload-shape tests.
- **Residual risk:** Route names remain visible to workflow authors. Per-operation catalog visibility is deferred until route metadata has a uniform authorization map.

### Stale Structural Catalog

- **Scenario:** Generated routes change without a restart and the picker shows stale operations.
- **Severity:** Low.
- **Mitigation:** Build from the canonical generated artifact, cache only per process, and document generation plus restart as the refresh boundary.
- **Detection:** Generator/catalog tests and deploy-time read-back.
- **Residual risk:** Local hot development can require a restart.

### Incomplete or Misleading Schemas

- **Scenario:** An operation lacks a useful request/response schema.
- **Severity:** Medium.
- **Mitigation:** Make #4230 a prerequisite, include only declared schemas, and render an honest missing state.
- **Detection:** Projection tests covering declared and absent schemas.
- **Residual risk:** Authoring quality still depends on route owners maintaining accurate declarations.

### Catalog Failure

- **Scenario:** Projection or client loading fails.
- **Severity:** Low.
- **Mitigation:** Preserve current config, show translated recoverable feedback, and keep manual editing.
- **Detection:** API failure and component fallback tests.
- **Residual risk:** Discoverability is temporarily unavailable.

### Existing Configuration Regression

- **Scenario:** Manual endpoints are reformatted, rejected, or lose unknown config fields.
- **Severity:** High.
- **Mitigation:** Write only picker-owned fields, keep raw JSON, validate only picker-generated placeholders, and add save/reload/edit plus execution regression coverage.
- **Detection:** Host-level component tests and the self-contained Playwright lifecycle.
- **Residual risk:** A manual value that intentionally matches picker placeholder syntax must remain distinguishable through namespacing.

### Unsupported OpenAPI Serialization

- **Scenario:** The picker incorrectly serializes an array/object parameter or a non-default OpenAPI style.
- **Severity:** Medium.
- **Mitigation:** Limit structured composition to primitive parameters using location defaults; mark every other declared parameter manual-only and preserve the raw editor.
- **Detection:** Projection and composition tests cover primitive defaults, arrays, objects, non-default `style`/`explode`, and `allowReserved`.
- **Residual risk:** Authors must manually configure advanced serialization until a separately specified capability adds safe structured support.

### Large Catalog UI Cost

- **Scenario:** Hundreds of operations make the popover slow or difficult to scan.
- **Severity:** Low.
- **Mitigation:** Lazy load, in-memory text filtering, deterministic grouping, bounded scroll, and no heavy combobox dependency.
- **Detection:** Runtime QA against a representative generated catalog and client-file budget review.
- **Residual risk:** Very large installations may later justify server search or virtualization; current evidence does not.

## Final Compliance Report — 2026-07-29

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/ds-rules.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root/workflows guides | Preserve tenant scope and `CALL_API` SSRF/identity behavior | Compliant | Catalog is scoped; executor is unchanged. |
| Core API routes | Export method metadata and `openApi` | Compliant | The new GET route declares both. |
| Root/UI guides | Use `apiCall`, shared primitives, i18n, semantic tokens, and accessible validation | Compliant | UI/UX and implementation sections require them. |
| Backward compatibility | Existing definition/API contracts remain stable | Compliant | Additive GET/context field; manual config retained. |
| QA guide | Self-contained executable integration coverage | Compliant | Fixtures, two read-backs, execution, and cleanup are explicit. |
| Frontend contract | Bound client islands and prove hydration/interactivity | Compliant | Ledger, budgets, and runtime evidence are explicit. |
| Optimistic locking | New editable entity writes carry versions | N/A | No entity or write endpoint is added. |
| Encryption/data | Sensitive persisted fields use encryption/scoping | N/A | No persistence or business records are read. |
| Commands/events | Mutations use canonical commands/events | N/A | No new mutation or side effect is introduced. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Transient models match API contract | Pass | Descriptor fields map directly to the GET response. |
| API contract matches UI | Pass | Every picker hint comes from the declared projection. |
| Compatibility matches validation | Pass | Only picker-owned placeholders are guarded. |
| Risks cover read, cache, UI, and legacy paths | Pass | Exposure, staleness, schemas, failure, scale, and regression are covered. |
| Cache strategy matches writes | Pass | Process structural cache; no write invalidation path exists. |
| Frontend boundaries match file plan | Pass | No page root/provider change or heavy dependency. |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant: approved for implementation after #4230, merged-spec, claim, and repository admission gates are satisfied.**

## Changelog

### 2026-07-29

- Added the initial public specification for issue #4235.
- Kept the independently deployable response-schema generator work in #4230 as a prerequisite rather than bundling it.
- Defined the additive catalog API, structured authoring hosts, manual compatibility path, frontend budgets, and end-to-end verification.
- Reviewed the current n8n structured HTTP Request authoring model as the market reference.
- Bounded structured parameter composition to primitive default OpenAPI serialization and made advanced serialization explicitly manual-only.
