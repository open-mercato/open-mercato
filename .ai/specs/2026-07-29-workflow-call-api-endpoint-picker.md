# Workflow Call API Endpoint Picker

## TLDR

Add an authenticated workflow endpoint catalog and a structured picker for `CALL_API` activities. Workflow authors can discover internal Open Mercato API operations, fill required and optional parameters, inspect bounded request and response hints, and catch incomplete catalog-backed configuration before saving. A versioned, picker-owned parameter bag keeps dynamic values typed until the executor interpolates and safely serializes them for their OpenAPI location. Existing manually authored `CALL_API` definitions remain editable and execute through the unchanged legacy path without migration.

**Scope:**

- Read-only, searchable, cursor-paginated `GET /api/workflows/endpoints` catalog derived from the canonical generated OpenAPI document.
- Reusable `CALL_API` picker across every current workflow activity authoring host.
- Method/path search, required and optional parameter inputs, bounded request/response field hints, and pre-save validation.
- Primitive path/query/header parameters that use their location's default OpenAPI serialization.
- Optional versioned `config.endpointPicker` state plus runtime interpolation-before-serialization for picker-managed values.
- Backward-compatible save/reload/edit behavior for existing manual configurations.
- Unit, API, component, integration, and headed desktop/narrow-viewport coverage.

**Non-goals:**

- Changing `CALL_API` SSRF controls, initiating-user role resolution, target-operation authorization, or the execution path for definitions without `config.endpointPicker`.
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
4. Continue persisting `config.endpoint`, `config.method`, `config.headers`, and `config.body`, and add optional versioned `config.endpointPicker` state as the source of truth for picker-managed parameters.
5. At execution, interpolate picker-managed values while they are still typed, serialize each resolved value for its declared OpenAPI location, and merge only the fields owned by the picker into the existing request.
6. Preserve raw JSON editing, unknown keys, free-text endpoints, and the existing executor path when `config.endpointPicker` is absent.
7. Validate required parameters only when the author selects a known catalog operation.

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
| Persist a discriminated picker-state version | Runtime serialization must not infer ownership or parameter location from a rendered URL, and future shapes need an explicit compatibility boundary. |
| Interpolate before location-specific serialization | Dynamic values can contain `/`, `?`, `%`, `&`, Unicode, or header-sensitive characters that cannot be safely encoded while preserving raw `{{...}}` tokens in a composed URL. |
| Keep the endpoint catalog bounded and server-searchable | The client needs compact authoring hints, not arbitrary nested OpenAPI schema objects or an unbounded registry payload. |
| Do not filter catalog items by every target route's ACL | The catalog is authoring metadata guarded by workflow-definition access. Runtime authorization remains authoritative; uniform per-route visibility metadata is a separate capability. |

### Alternatives Considered

| Alternative | Why rejected |
| --- | --- |
| Persist endpoint metadata | Duplicates generated structural data and creates synchronization and migration work. |
| Call the public API-docs HTTP route | Adds an avoidable network/auth dependency and can drift from the in-process enabled route surface. |
| Replace `CALL_API` with a normalized persisted model | Breaks the stable definition contract and existing definitions; an optional additive picker state is sufficient. |
| Reject endpoints absent from the catalog | OpenAPI coverage is additive and manual internal endpoints are valid. |
| Bundle response-schema generator repair | #4230 is independently deployable and already tracked separately. |
| Encode the composed endpoint before interpolation | Either encodes the interpolation delimiters or leaves resolved reserved characters unescaped; it cannot satisfy both requirements. |
| Return raw request/response schema objects | Makes response size and browser work proportional to arbitrary schema depth and operation count. |

## User Stories

- A workflow author searches operations by path, method, summary, or tag instead of memorizing routes.
- A workflow author sees required and optional parameters separately and receives an appropriate input for each supported location.
- A workflow author inspects declared request and response fields while configuring the activity.
- A workflow author receives a visible validation error for unresolved required catalog parameters before save.
- A workflow author uses a dynamic value containing reserved characters and the executor sends the correctly serialized path, query, or header value.
- An existing workflow owner opens, saves, reloads, edits, and executes a manual `CALL_API` configuration unchanged.

## Architecture

```text
canonical generated OpenAPI document
                 |
                 v
project operations, parameters, and bounded field hints
                 |
                 v
process-cached workflow endpoint catalog
                 |
                 v
searchable/paginated GET /api/workflows/endpoints
                 |
                 v
reusable CALL_API picker
                 |
                 v
versioned config.endpointPicker state
                 |
                 v
interpolate typed values -> serialize by location -> merge owned fields
                 |
                 v
existing CALL_API request pipeline
```

The workflows module owns the projection, endpoint matching/composition helpers, API route, picker, validation, translations, and tests. The app and create-app API catch-all routes provide the generated OpenAPI document through an additive handler context field so the lazy workflows route consumes the exact app-specific document without loading every route module a second time.

The catalog route uses normal request-container/authentication resolution, requires tenant and organization context, and requires `workflows.definitions.view`. It returns structural metadata only. Catalog visibility never grants permission to invoke an operation.

Definitions without `config.endpointPicker` follow the unchanged runtime executor. Definitions with version `1` picker state enter a narrow structured-parameter stage before the existing request pipeline. Both paths continue to:

- accept only `/api/*` or same-host endpoints according to the existing SSRF policy;
- execute under the initiating user's resolved roles;
- apply the target route's normal authentication, tenant, organization, and feature guards;
- preserve existing retry/error semantics and interpolation context.

Pure endpoint helpers match concrete paths to declared templates and preview supported path/query/header values. Structured composition is limited to primitive `string`, `number`, `integer`, and `boolean` parameters whose serialization is absent or matches the OpenAPI default for their location: `simple`/`explode: false` for path and header parameters, and `form`/`explode: true` for query parameters, always without `allowReserved: true`.

The activity dispatcher detects and validates raw `endpointPicker` state before its current recursive interpolation pass. This prevents the preview endpoint from turning a resolved picker value into URL syntax before ownership is known. At runtime, the structured stage:

1. validates the exact kind/version marker and the self-contained operation/tuple structural invariants;
2. takes `operation.path`/`operation.method` as the authoritative picker-owned base, removes ledger-owned query/header entries from the raw preview fields, and retains all unowned entries;
3. resolves retained manual query/header entries, body, and unknown config fields through their existing interpolation semantics;
4. resolves each picker value through the same interpolation context without first concatenating it into a URL;
5. rejects missing required values, non-primitive resolved values, and carriage-return/newline characters in header values;
6. serializes resolved path parameters as encoded path-segment values, query parameters with the default form rules, and header parameters as validated strings;
7. replaces declared path placeholders, merges the serialized query values after retained unowned query entries, and merges serialized headers after retained unowned `config.headers`;
8. passes the resulting endpoint, headers, method, interpolated body, and unknown fields into the existing SSRF/auth/request/retry pipeline.

For a picker-owned identity, the state value wins over a same-name preview entry. Within state, duplicate identities are invalid rather than last-write-wins. The executor never uses the interpolated preview path as the structured request path; the preview exists for readability, raw/manual fallback after detach, and backward-compatible storage only.

The same preparation helper runs at both current `CALL_API` boundaries. Immediate execution prepares the effective request config before calling `executeCallApi`. Async enqueue prepares and serializes it before writing the job payload, preserving today's enqueue-time workflow-context snapshot; the payload contains the effective legacy-shaped endpoint/method/headers/body without the picker marker, so both activity-worker implementations and retry behavior remain unchanged. Definitions without the exact marker continue through the current blanket interpolation code at both boundaries.

This ordering means a resolved value such as `a/b?c=%&name=Żółć` is serialized as data rather than request syntax. The implementation must use standards-aware URL/parameter APIs and must not use a single global replacement or pre-interpolation escaping pass.

OpenAPI requires every path parameter to declare `required: true`. Missing path values block save and execution. A malformed document that declares an optional path parameter marks that operation manual-only; the picker never omits a path segment or invents a placeholder.

Cookie parameters, array/object parameters, and parameters with non-default serialization remain listed as unsupported metadata. The picker does not generate placeholders or claim validation coverage for them. An operation with any required unsupported parameter is discoverable but wholly manual-only; optional unsupported parameters show localized guidance while supported primitive parameters remain structured.

### Frontend Architecture Contract

#### Server/Client Boundary Map

| Surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| Existing definition create/edit hosts | Existing route/page roots, unchanged | Existing activity editors plus `EndpointPicker` | `GET /api/workflows/endpoints` | No new page-root client boundary. |
| Existing visual editor | Existing visual-editor page root, unchanged | Existing node/edge dialogs plus `EndpointPicker` | `GET /api/workflows/endpoints` | React Flow ownership remains unchanged. |

#### `"use client"` Ledger

| File | Browser-only reason | Imported by | Heavy dependencies | Hydration/cleanup risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `components/fields/EndpointPicker.tsx` | Search/popover state, debounced paginated loading, parameter editing | Current activity editors | None; existing UI primitives only | Abort-safe request state; no global listeners/providers | Server rendering cannot provide interactive editing. |
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
- The only execution change is the pure structured-parameter stage for definitions that explicitly carry the exact marked, supported `config.endpointPicker` state.
- The process cache contains structural, non-tenant endpoint metadata only.
- Cache reset is exported for deterministic tests; normal refresh occurs on generation plus application restart/deploy.
- Catalog request failures are non-destructive: the current config remains intact and manual editing stays available.

## Data Models

No persisted entities or migrations are introduced.

```ts
type WorkflowEndpointPrimitiveType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'unknown'

type WorkflowEndpointParam = {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required: boolean
  type: WorkflowEndpointPrimitiveType
  supported: boolean
  unsupportedReason?:
    | 'non_primitive'
    | 'serialization'
    | 'location'
    | 'optional_path'
    | 'reserved_header'
}

type WorkflowEndpointFieldHint = {
  name: string
  type: WorkflowEndpointPrimitiveType | 'object' | 'array'
  required: boolean
  description?: string
}

type WorkflowEndpointSchemaHint = {
  rootType: WorkflowEndpointPrimitiveType | 'object' | 'array'
  fields: WorkflowEndpointFieldHint[]
  truncated: boolean
}

type WorkflowEndpointRequestHint = WorkflowEndpointSchemaHint & {
  mediaType: string
}

type WorkflowEndpointResponseHint = WorkflowEndpointSchemaHint & {
  status: string
  mediaType: string
}

type WorkflowEndpointDescriptor = {
  path: string
  method: string
  summary: string
  tag: string | null
  params: WorkflowEndpointParam[]
  pickerSupported: boolean
  pickerUnsupportedReason?: 'required_parameter' | 'malformed_path'
  hasRequestSchema: boolean
  hasResponseSchema: boolean
  requestHint?: WorkflowEndpointRequestHint
  responseHint?: WorkflowEndpointResponseHint
}

type CallApiEndpointPickerParamV1 = {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  type: Exclude<WorkflowEndpointPrimitiveType, 'unknown'>
  value: string | number | boolean | null
}

type CallApiEndpointPickerStateV1 = {
  kind: 'open-mercato.workflow.call-api.endpoint-picker'
  version: 1
  operation: {
    path: string
    method: string
  }
  params: CallApiEndpointPickerParamV1[]
}
```

`config.endpointPicker` is optional. It activates structured behavior only when `kind` exactly matches `open-mercato.workflow.call-api.endpoint-picker`; an older definition containing an unrelated `endpointPicker` key without that marker remains opaque and follows the legacy path. A matching marker with an unsupported version returns the explicit unsupported-version error. A future persisted shape adds another discriminated version; it does not reinterpret version `1`. The state is limited to 100 unique `(in, name)` parameter entries. Header identities are compared case-insensitively; path and query identities are case-sensitive.

The parameter tuples are the ownership ledger:

- `operation.path` and `operation.method` own the picker-selected path template and method;
- every `('query', name)` tuple owns only that query key;
- every `('header', name)` tuple owns only that header key;
- every `('path', name)` tuple owns only the matching declared placeholder;
- `config.body`, unknown config fields, query keys absent from the ledger, and header keys absent from the ledger remain manual and untouched.

On operation switch, the editor uses the previous ledger to remove only its old picker-owned query/header values, replaces the picker-owned path/method with the new operation, and composes the new preview. Matching parameter tuples may be retained only when location, name, and primitive type are identical. “Detach from catalog” removes only `endpointPicker` and leaves `endpoint`, `method`, `headers`, `body`, and unknown keys exactly as shown in the latest preview; that snapshot then follows the legacy/manual path. If a free-text endpoint edit no longer matches `operation.path`, the UI clearly offers either to detach while keeping the edit or restore the catalog preview; it never silently rewrites the manual edit. In raw JSON, an unsupported marked state version is preserved for editing but definition validation and execution return a specific unsupported-version error rather than falling back to an unsafe interpretation.

Version `1` is the self-contained execution authority; runtime never rereads the live catalog. Validation requires the exact marker; a supported HTTP method; a canonical `/api/*` path template; exactly one required path tuple for every `{name}` placeholder; no undeclared or duplicate path tuple; no duplicate query/header identity; finite number values; and matching `config.method`/`operation.method` preview values at save time. The editor validates newly selected metadata against the current descriptor before persisting it. Runtime revalidates the self-contained structural invariants and treats `operation.method`, the persisted parameter `type`, and persisted `required` flags as authoritative. This does not create a new authorization boundary: a raw-config author can already choose the method, URL, headers, and values.

If an operation disappears or its catalog metadata changes after save, the stored version `1` request continues to execute under the existing SSRF, identity, and target-route guards. On edit, a missing/mismatched descriptor produces a translated stale-selection state and offers detach or explicit reselection; the editor never silently rewrites persisted parameter semantics from a newer catalog.

The runtime serializer rejects duplicate tuple identities and picker-managed versions of `Authorization`, `Content-Type`, `X-Tenant-Id`, `X-Organization-Id`, and `X-Workflow-Instance-Id`, matched case-insensitively. Those catalog header parameters are marked `reserved_header` and manual-only. This restriction is additive to picker state; existing manual definitions retain their current behavior.

The catalog contains no credentials, examples, raw request/response schemas, request bodies, tenant records, workflow execution data, or PII. Each operation has at most 100 parameter descriptors and each schema hint contains at most 32 top-level fields; `WorkflowEndpointSchemaHint.truncated` is true whenever nested detail or additional top-level fields are omitted. Projected paths are capped at 2,048 Unicode code points, summaries at 240, tags at 120, parameter/field names at 200, and descriptions at 160. Display-only summary/tag/description text may be safely shortened. An operation with too many parameters or an over-limit path/parameter identity is omitted from the picker catalog and remains available through manual `CALL_API` authoring rather than exposing a misleading truncated contract.

### Deterministic OpenAPI Projection

- Merge path-level parameters first and operation-level parameters second; an operation-level `(in, name)` replaces the matching path-level declaration.
- Include `cookie` parameters as `supported: false` with reason `location`. If any required parameter is unsupported for any reason, set `pickerSupported: false` with reason `required_parameter`; the item remains discoverable but can only copy method/path into the manual editor and never creates `endpointPicker` state.
- An optional path declaration sets `pickerSupported: false` with reason `malformed_path`. Every well-formed path declaration is required.
- Select the lexicographically first non-empty tag after normalization; return `null` and use localized “Untagged” presentation when no tag exists. Use the OpenAPI summary, then operation description, then `` `${method} ${path}` `` as the deterministic summary fallback.
- `hasRequestSchema`/`hasResponseSchema` mean the selected OpenAPI content declares a schema; a hint is present only when that declaration can be safely projected by the rules below.
- Resolve local document `$ref` values only, with cycle detection. A missing, external, or cyclic reference preserves the relevant `has*Schema: true` signal but omits the hint and never leaks the reference target.
- For request content, select exact `application/json`, otherwise the lexicographically first media type ending in `+json`; non-JSON request bodies have no structured hint.
- For responses, select the lowest explicit numeric `2xx` status, otherwise `default`; within it use the same JSON media-type rule. Other statuses/media types remain outside the compact hint.
- For an object schema, project sorted top-level properties. `allOf` unions sorted top-level properties and required sets; incompatible definitions for the same property use type `unknown`. `oneOf`/`anyOf` include only properties present in every branch, mark a field required only when every branch requires it, and set `truncated: true`. Array/scalar roots return their `rootType` with no invented fields. Nested object/array detail is represented by the field type only and sets `truncated: true`.

## API Contracts

### `GET /api/workflows/endpoints`

- Authentication: required.
- Tenant and organization context: required.
- Feature: `workflows.definitions.view`.
- Request body: none.
- Query:
  - `q?: string` — case-insensitive search over method, path, summary, and tag; trimmed and capped at 200 Unicode code points.
  - `cursor?: string` — opaque continuation token bound to the normalized search and deterministic catalog ordering.
  - `limit?: number` — default `25`, minimum `1`, maximum `50`.
- Route exports: method-scoped `metadata` plus `openApi`.
- Response budget: one serialized page must remain below 512 KiB. The server accumulates deterministically ordered descriptors until either `limit` or the byte ceiling would be exceeded, returns at least one capped descriptor when a match exists, and advances `nextCursor` from the last emitted item. DTO caps, byte-aware paging, the Zod response schema, and a worst-case contract test enforce the ceiling.

Example response:

```json
{
  "items": [
    {
      "path": "/api/customers/people/{id}",
      "method": "GET",
      "summary": "Get a customer person",
      "tag": "Customers",
      "pickerSupported": true,
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
      "hasResponseSchema": true,
      "responseHint": {
        "status": "200",
        "mediaType": "application/json",
        "rootType": "object",
        "fields": [
          {
            "name": "id",
            "type": "string",
            "required": true
          }
        ],
        "truncated": false
      }
    }
  ],
  "nextCursor": null
}
```

Errors:

| Status | Condition |
| --- | --- |
| `400` | Missing tenant/organization context or invalid search/pagination input |
| `401` | Unauthenticated |
| `403` | Missing workflow-definition view feature |
| `500` | Catalog projection failure |

All response shapes are backed by Zod/OpenAPI declarations. Internal failures return a minimal localized error and do not expose paths, stack traces, or document contents.

### Existing `CALL_API` Contract

No field is removed, renamed, or narrowed. Manual definitions remain valid:

```json
{
  "endpoint": "/api/customers/people/{{context.personId}}?include=details",
  "method": "GET",
  "headers": {},
  "body": {}
}
```

Picker-authored definitions add one optional field:

```json
{
  "endpoint": "/api/customers/people/{{context.personId}}?include={{context.include}}",
  "method": "GET",
  "headers": {},
  "body": {},
  "endpointPicker": {
    "kind": "open-mercato.workflow.call-api.endpoint-picker",
    "version": 1,
    "operation": {
      "path": "/api/customers/people/{id}",
      "method": "GET"
    },
    "params": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "type": "string",
        "value": "{{context.personId}}"
      },
      {
        "name": "include",
        "in": "query",
        "required": false,
        "type": "string",
        "value": "{{context.include}}"
      }
    ]
  }
}
```

The visible `endpoint` and `headers` remain a readable preview/manual fallback, but `endpointPicker` is authoritative for its ledger entries. The editor recomposes only picker-owned entries. At runtime, version `1` state is validated and interpolated before serialization; the generated values override only matching owned endpoint/query/header entries. Unknown config keys, unowned query/header entries, and `body` remain untouched.

For picker state, a required value is missing when it is `null` or an empty/whitespace-only string after interpolation. Optional `null`/empty values are omitted for query/header parameters; path parameters are always required. Any residual unresolved interpolation token, including one embedded in mixed text, is invalid for every non-omitted picker value. A resolved array, object, or non-finite number is also invalid. These failures use stable internal error codes so the editor/execution UI can render localized copy without leaking values.

| Error code | Condition |
| --- | --- |
| `WORKFLOW_CALL_API_PICKER_UNSUPPORTED_VERSION` | `endpointPicker.version` is not implemented |
| `WORKFLOW_CALL_API_PICKER_INVALID_STATE` | Operation/tuple ownership invariants, caps, or preview method consistency fail |
| `WORKFLOW_CALL_API_PICKER_MISSING_PARAMETER` | A required value resolves to missing/blank |
| `WORKFLOW_CALL_API_PICKER_UNRESOLVED_PARAMETER` | A non-omitted value retains an interpolation token |
| `WORKFLOW_CALL_API_PICKER_INVALID_PARAMETER_VALUE` | A value resolves to an object, array, non-finite number, or CR/LF header |
| `WORKFLOW_CALL_API_PICKER_RESERVED_HEADER` | Picker state attempts to own a reserved executor header |

Errors may identify the parameter by non-secret `in`/`name`, but never include the configured or resolved value.

## UI/UX and Internationalization

- Keep the endpoint as a visible, labeled text input.
- “Browse endpoints” opens a searchable popover grouped by OpenAPI tag.
- Search matches method, path, summary, and tag through debounced server search; scrolling requests cursor pages and stale requests are aborted.
- Each result shows method, path, and summary.
- Selecting a supported result writes method/path and renders required inputs before optional inputs. A manual-only result can copy method/path but never creates marked picker state or claims completeness.
- Parameter rows show location and primitive type.
- Unsupported locations, shapes, or serialization remain visible with translated manual-configuration guidance and never receive generated values or validation claims.
- Empty required catalog parameters use `aria-invalid` and translated semantic error text before submit.
- Declared request and response schemas render compact top-level field hints and a translated truncated indicator when deeper/additional detail was omitted.
- `has*Schema: false` renders translated “not declared” copy; a declared schema with no safe JSON projection renders a distinct translated “hint unavailable” state.
- Loading uses shared loading primitives; recoverable catalog failure uses `<Alert status="warning" ...>` and preserves current values.
- Controls use existing UI primitives, semantic tokens, DS spacing/type scales, visible labels, `focus-visible` behavior, and `aria-label` on icon-only buttons.
- Existing dialogs retain `Cmd/Ctrl+Enter` submit and `Escape` cancel.
- Detach confirmation states that the current preview becomes manual configuration; no endpoint, header, body, or unknown value is removed.
- The picker remains usable at 390 px viewport width without document horizontal overflow.
- All copy uses `workflows.endpointPicker.*` keys in `en`, `de`, `es`, and `pl`.

## Migration & Backward Compatibility

- No data migration or backfill.
- `config.endpointPicker` is an optional additive field. No existing field changes meaning.
- Definitions without `config.endpointPicker` use the byte-for-byte existing interpolation and request path.
- Definitions with supported picker state opt into the structured stage; its serialization semantics are versioned with the state.
- Existing manual definitions round-trip unchanged, including unknown config keys.
- A pre-existing unmarked `endpointPicker` key remains unknown and follows the legacy path. Only the exact reserved `kind` marker opts in; this marker and its versioned payload become an additive documented contract surface.
- `GET /api/workflows/endpoints` and the optional handler-context field are additive contract surfaces.
- Free-text endpoint editing and raw JSON remain supported.
- Required-parameter validation applies only to the tuples persisted in `config.endpointPicker`. Unknown manual endpoints and manually authored braces are not rejected.
- Unsupported future picker versions are preserved by raw editing but rejected explicitly by save/execution until supported; they are never treated as version `1` or silently executed through the legacy path.
- Stale/removed catalog operations keep their persisted version `1` semantics until explicit detach/reselection; runtime does not depend on the current catalog.
- Cookie/array/object parameters and non-default OpenAPI serialization remain manual-only; no existing manual configuration is normalized or rejected.
- The implementation must not rename an API route, activity type, ACL feature, event ID, DI key, import path, or widget spot.

## Open Questions

None. The carry-forward review resolved persisted ownership/versioning, interpolation/serialization order, catalog authority and drift, deterministic OpenAPI projection, bounded transport, unsupported parameter locations, and detach behavior.

## Implementation Plan

### Phase 0: Prerequisite Read-back

1. Verify #4230 is merged into the current contribution base.
2. Prove the canonical generated OpenAPI document carries real declared response objects and retains an honest missing-schema state.
3. Re-run duplicate and active-claim discovery for #4235 before implementation admission.

### Phase 1: Catalog and Pure Helpers

1. Add endpoint matching/preview helpers, supported-serialization classification, bounded schema-hint helpers, and picker-state schemas with focused unit tests.
2. Add the server-only generated-OpenAPI projection with deterministic ordering, bounded DTOs, search/cursor helpers, and test-only cache reset.
3. Add Zod/OpenAPI query/response schemas and the guarded catalog GET route.
4. Pass the canonical generated document through the app and create-app API handler context.

### Phase 2: Structured Authoring

1. Add a pure version `1` request-preparation serializer that validates state, interpolates each typed value, serializes by location, and merges only ledger-owned fields at immediate-execution and enqueue boundaries.
2. Add the reusable picker using `apiCall`, shared UI primitives, translated states, and no new production dependency.
3. Integrate it into all current activity authoring hosts: definition transitions, visual node/edge dialogs, and CrudForm-backed variants.
4. Retain raw JSON/manual endpoint editing, unowned query/header entries, and unknown-field preservation.
5. Add locale, executor, and host-level component tests.

### Phase 3: Integration and Release Evidence

1. Add a self-contained Playwright case for browse, select, required validation, optional parameters, schema hints, save, API read-back, reload, edit, update, execution, and cleanup.
2. Run targeted unit/API/component tests, typechecks, package build, lint, client-boundary checks, and the focused Playwright case.
3. Complete headed desktop and narrow-viewport QA against the exact candidate.

### Expected File Manifest

| Area | Action | Purpose |
| --- | --- | --- |
| `packages/core/src/modules/workflows/lib/endpoint-path.ts` | Add | Pure matching, preview composition, ownership, and placeholder helpers |
| `packages/core/src/modules/workflows/lib/endpoint-schema.ts` | Add | Bounded top-level field-hint projection helpers |
| `packages/core/src/modules/workflows/lib/endpoint-catalog.ts` | Add | Server-only OpenAPI projection, search/cursors, budgets, and process cache |
| `packages/core/src/modules/workflows/lib/call-api-endpoint-picker.ts` | Add | Versioned state validation plus runtime interpolation/serialization/merge |
| `packages/core/src/modules/workflows/lib/call-api-editor-validation.ts` | Add | Shared picker-state authoring validation |
| `packages/core/src/modules/workflows/data/validators.ts` | Modify | Marker-aware optional picker schema that validates marked state and preserves unmarked legacy values |
| `packages/core/src/modules/workflows/lib/activity-executor.ts` | Modify | Invoke structured preparation before immediate execution and async enqueue; preserve legacy path otherwise |
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
- Cookie/array/object parameters plus non-default `style`, `explode`, and `allowReserved` combinations are marked unsupported and never structurally composed or validated; a required unsupported parameter makes the operation manual-only.
- Runtime interpolation followed by location-specific serialization for literals, complete tokens, and mixed interpolation containing spaces, `/`, `?`, `%`, `&`, `=`, `#`, `+`, and Unicode.
- Immediate and async-enqueue coverage proves marked picker state is detected before recursive config interpolation, enqueue-time context is preserved, worker payloads are effective legacy-shaped configs, and the interpolated preview path is never used for a structured request.
- Required missing/unresolved values, optional query/header omission, malformed optional OpenAPI path declarations, CR/LF header rejection, non-primitive resolved values, duplicate tuple identities, and case-insensitive reserved-header rejection.
- Ledger merge precedence, same-name query/header collisions, unowned query/header preservation, operation switching, stale picker-owned cleanup, exact detach snapshots, endpoint mismatch, save/reload, stale/removed catalog operations, unmarked legacy `endpointPicker` collisions, and unsupported marked versions.
- Legacy definitions without marked `endpointPicker` state, including an unmarked same-name key, produce the same executor inputs as before this change.
- Catalog projection covers path/operation parameter precedence, tag/summary fallback, request media selection, response status/media selection, local/cyclic refs, `allOf`/`oneOf`/`anyOf`, scalar/array roots, cookie parameters, deterministic ordering, search/cursor stability, declared/missing/truncated hints, identifier/field/description caps, omitted over-limit operations, byte-aware paging below 512 KiB, and cache reset.
- Picker loading, debounced search, pagination, stale-request abort, selection, required ordering, schema hints, truncated state, failure fallback, and manual configuration.
- Every classic and CrudForm host preserves manual config and surfaces picker-owned validation.

### API

- Authorized request returns projected structural items.
- Missing scope, unauthenticated, and missing-feature paths return `400`, `401`, and `403`.
- Projection failure returns a minimal `500`.
- Generated OpenAPI includes the catalog response contract.
- Invalid `q`, `cursor`, and `limit` return `400`; cursors cannot be reused with a different search.
- Catalog responses contain no raw schema objects, examples, credentials, tenant data, or request payloads.

### Integration and Headed QA

- Create every workflow fixture in the test; do not depend on seeded/demo data.
- Browse and select a real operation with required and optional parameters.
- Prove required validation blocks/surfaces submission until resolved.
- Prove optional values may remain empty and declared schema hints are visible.
- Save, read back through the definition API, reload, edit, update, and read back again.
- Execute a safe catalog-backed `CALL_API` whose dynamic path/query values contain reserved characters and Unicode; assert the target receives the intended decoded values and the workflow reaches terminal success.
- Switch catalog operations after saving values and prove only picker-owned query/header entries are removed while manual entries survive.
- Reload the editor and prove the versioned picker selection, typed values, and ownership behavior round-trip.
- Repeat critical interaction at desktop and 390 px viewport width.
- Assert no document horizontal overflow and no new page/app console errors.
- Delete created definitions in `finally`; retain only immutable execution records when no supported delete route exists.

## Risks & Impact Review

### Endpoint Metadata Exposure

- **Scenario:** An author sees route names or schema fields for operations they cannot execute.
- **Severity:** Medium.
- **Mitigation:** Require authenticated tenant/organization context and `workflows.definitions.view`; return bounded structural field hints only; state clearly that target-operation authorization is enforced only at runtime.
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
- **Mitigation:** Activate the structured path only for the exact reserved kind plus supported version, leave unmarked legacy collisions opaque, use the parameter tuples as the exact ownership ledger, keep raw JSON, and add save/reload/edit plus legacy executor regression coverage.
- **Detection:** Host-level component tests and the self-contained Playwright lifecycle.
- **Residual risk:** A manual query/header key colliding with a picker-owned identity is intentionally controlled by the picker until the author detaches that operation.

### Dynamic Value Serialization

- **Scenario:** Interpolation produces request syntax such as `/`, `?`, `%`, `&`, Unicode, or CR/LF instead of a parameter value.
- **Severity:** High.
- **Mitigation:** Persist typed parameter values separately, interpolate each value before location-specific serialization, reject invalid resolved types/header characters, and merge only after serialization.
- **Detection:** Executor unit tests and an integration target that asserts decoded path/query values for reserved-character and Unicode cases.
- **Residual risk:** Advanced OpenAPI styles remain manual-only.

### Picker Ownership Drift

- **Scenario:** Save/reload or operation switching loses which query/header fields the picker owns and removes manual configuration.
- **Severity:** High.
- **Mitigation:** Persist a versioned tuple ledger; define exact collision, detach, switch, and unsupported-version behavior; never infer ownership from placeholder text.
- **Detection:** Component/executor round-trip and collision matrices plus Playwright switch/reload coverage.
- **Residual risk:** Raw JSON authors can intentionally create invalid picker state and receive a specific validation/execution error until they repair or remove it.

### Catalog Drift After Save

- **Scenario:** A route's OpenAPI metadata changes or disappears and silently alters an existing request.
- **Severity:** Medium.
- **Mitigation:** Treat persisted version `1` state as self-contained execution authority; use the current catalog only for new selection and stale-state UI guidance; require explicit detach/reselection.
- **Detection:** Save/reload tests against changed and removed descriptors plus executor tests without a catalog.
- **Residual risk:** A target route can still change its real runtime contract and reject the old request, as it can for every existing manual `CALL_API`.

### Unsupported OpenAPI Serialization

- **Scenario:** The picker incorrectly serializes a cookie/array/object parameter or a non-default OpenAPI style.
- **Severity:** Medium.
- **Mitigation:** Limit structured composition to primitive path/query/header parameters using location defaults; mark every other declared parameter unsupported, make operations with required unsupported parameters manual-only, and preserve the raw editor.
- **Detection:** Projection and composition tests cover primitive defaults, cookie/array/object parameters, non-default `style`/`explode`, and `allowReserved`.
- **Residual risk:** Authors must manually configure advanced serialization until a separately specified capability adds safe structured support.

### Large Catalog UI Cost

- **Scenario:** Hundreds of operations or deeply nested schemas make the response/browser work unbounded.
- **Severity:** Medium.
- **Mitigation:** Server-side search, cursor pages capped at 50 items, compact top-level hints capped at 32 fields, capped descriptions, no raw schema objects, and a 512 KiB page ceiling.
- **Detection:** Worst-case DTO size contract test, search/cursor API tests, runtime QA against a representative full generated catalog, and client-file budget review.
- **Residual risk:** A very broad search can still require multiple pages, but each request and rendered batch stays bounded.

## Final Compliance Report — 2026-07-30

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
| Root/workflows guides | Preserve tenant scope and `CALL_API` SSRF/identity behavior | Compliant | Catalog is scoped; only explicit versioned picker state enters the pure structured stage before existing guards. |
| Core API routes | Export method metadata and `openApi` | Compliant | The new GET route declares both. |
| Root/UI guides | Use `apiCall`, shared primitives, i18n, semantic tokens, and accessible validation | Compliant | UI/UX and implementation sections require them. |
| Backward compatibility | Existing definition/API contracts remain stable | Compliant | Additive GET/context/state fields; definitions without picker state retain the legacy path. |
| QA guide | Self-contained executable integration coverage | Compliant | Fixtures, two read-backs, execution, and cleanup are explicit. |
| Frontend contract | Bound client islands and prove hydration/interactivity | Compliant | Ledger, budgets, and runtime evidence are explicit. |
| Optimistic locking | New editable entity writes carry versions | N/A | No entity or write endpoint is added. |
| Encryption/data | Sensitive persisted fields use encryption/scoping | N/A | No persistence or business records are read. |
| Commands/events | Mutations use canonical commands/events | N/A | No new domain mutation/event is introduced; the opt-in executor transformation is pure. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Transient/persisted models match API contract | Pass | Bounded descriptors map to GET; version `1` state maps to the additive config validator. |
| API contract matches UI | Pass | Search, cursor pages, truncation, and every picker hint come from the declared projection. |
| Compatibility matches validation | Pass | Only the exact reserved kind/version is interpreted; unmarked key collisions and legacy/manual definitions retain the legacy path. |
| Risks cover read, cache, UI, runtime, and legacy paths | Pass | Exposure, staleness, serialization, ownership, schemas, failure, scale, and regression are covered. |
| Cache strategy matches writes | Pass | Process structural cache; no write invalidation path exists. |
| Frontend boundaries match file plan | Pass | No page root/provider change or heavy dependency. |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant: approved for implementation after #4230, merged-spec, claim, and repository admission gates are satisfied.**

## Changelog

### 2026-07-30

- Replaced pre-interpolation URL composition with versioned picker-owned parameter state and runtime interpolation-before-serialization.
- Defined exact query/header/path ownership, merge precedence, detach/switch behavior, reserved-header handling, and unsupported-version errors.
- Replaced raw schema objects and the unbounded registry response with compact capped field hints plus server search/cursor pagination and a response-size budget.
- Defined deterministic OpenAPI projection for tags, parameter overrides/locations, JSON media types, response statuses, references, and composed schemas.
- Made persisted version `1` state self-contained across catalog drift, guarded activation with an exact kind marker, and specified immediate/queued execution boundaries.
- Corrected path semantics: OpenAPI path parameters are required, and malformed optional declarations are manual-only.
- Expanded executor, ownership, payload-budget, round-trip, and reserved-character/Unicode coverage in response to PR review.

### 2026-07-29

- Added the initial public specification for issue #4235.
- Kept the independently deployable response-schema generator work in #4230 as a prerequisite rather than bundling it.
- Defined the additive catalog API, structured authoring hosts, manual compatibility path, frontend budgets, and end-to-end verification.
- Reviewed the current n8n structured HTTP Request authoring model as the market reference.
- Bounded structured parameter composition to primitive default OpenAPI serialization and made advanced serialization explicitly manual-only.
