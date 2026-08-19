# CrudForm Injected Widget Payloads

## 📝 TLDR

Make values collected by `InjectionFieldWidget` fields available to the server-side request lifecycle that already knows the created record ID. `CrudForm` will publish those values through an explicit, request-scoped sidecar that is merged into requests made by the existing `apiCall`/`createCrud` helpers. API interceptors and CRUD lifecycle code can consume the sidecar without changing entity schemas or requiring every host page to forward a new callback argument.

## Resolved assumptions (autonomous defaults)

- **Use a request-body sidecar rather than changing `onAfterSave` signatures.** This is additive and works with existing host pages such as the core customers create form.
- **Keep the sidecar namespaced and out of entity values.** The sidecar is available to API interceptors as a reserved property and is removed from the entity payload before persistence; this avoids accidental schema or database writes.
- **Expose the sidecar to API interceptors, not persistent event payloads in this phase.** Interceptors already receive the original request and response together, which is sufficient for the issue's transactional use case and avoids changing every CRUD event type.
- **Do not add a new UI surface.** Existing injected fields and CRUD forms remain visually unchanged; browser verification will exercise the existing customers create route where available.

## 📝 Problem Statement

Injected CrudForm fields are rendered and validated by the browser, but their values are removed before the host `onSubmit` receives the entity payload. On create, `onAfterSave` also runs with a context derived before the response, so a widget cannot reliably combine its values with the new record ID. The documented extension-header workaround is functional but relies on an undocumented convention and requires a custom interceptor/header protocol per module.

## 📝 Proposed Solution

Add a public `CrudForm` request-payload contract. During submit, CrudForm collects active injected field values under a reserved sidecar key and opens a request-scoped body context while it invokes the unchanged host `onSubmit` callback. `apiCall` merges the sidecar into JSON request bodies created within that scope. On the server, CRUD API interceptors receive the sidecar on both `before` and `after` hooks through the existing `InterceptorRequest.body`; the CRUD factory strips the reserved key before mapping entity input so persistence behavior is unchanged.

The sidecar is intentionally opt-in to the form's injected fields, absent when no injected values exist, and limited to JSON-compatible data. Nested values are preserved. Scope nesting follows the existing request-header stack so concurrent or nested calls do not leak payloads across requests.

## 📝 Architecture

- `packages/shared/src/lib/crud/widget-payload.ts` owns the reserved key, JSON-safe normalization, and extraction helpers shared by UI and CRUD factory code.
- `packages/ui/src/backend/utils/apiCall.ts` gains a request-scoped body stack and merges its resolved sidecar into object JSON request bodies.
- `packages/ui/src/backend/CrudForm.tsx` derives the injected field subset from the current form values, wraps `onSubmit` in the body scope, and continues passing only schema-approved core values to the host callback.
- `packages/shared/src/lib/crud/factory.ts` removes the reserved sidecar from the entity input after interceptors have observed it. The original `InterceptorRequest` remains the source of truth for the sidecar.
- Existing event handler signatures, injection spot IDs, API routes, entity schemas, and event IDs remain unchanged.

## 📝 API Contracts

The request JSON may contain the additive reserved property:

```ts
{
  name: 'New person',
  __omWidgetPayload: {
    'customer_relations': {
      relatedPersonId: 'person-id',
      relationType: 'father'
    }
  }
}
```

The property is for the request lifecycle only. API interceptors read it from `request.body?.__omWidgetPayload`; entity mapping and persistence never receive it. The exact namespace key is the injecting module/widget's stable module identifier, and values are constrained to JSON-compatible primitives, arrays, and objects. Existing requests without the property are byte-for-byte behavior-compatible.

## 📝 Edge Cases & Failure Scenarios

- No injected fields or no values produces no sidecar and no additional request property.
- Hidden or disabled injected fields are excluded using the same active-field set used by CrudForm validation.
- A malformed/non-JSON value is omitted from the sidecar rather than breaking the entity save; normal form validation remains responsible for user-facing errors.
- If a host performs multiple CRUD calls during one submit, each call receives the same scoped sidecar, enabling a create interceptor to use the created ID from its response while keeping the related write transactional where the host route supports it.
- Nested request scopes restore the previous sidecar on completion, including rejected promises.
- Direct `apiCall` calls outside a CrudForm are unchanged.

## 📝 Risks & Impact Review

This is a public additive request-shape and helper contract. The reserved property must be documented and stripped before entity validation/persistence. No migration or dependency is required. The main risk is accidental sidecar leakage to unrelated nested calls; stack-based scoping and tests for restoration mitigate it. Existing `onBeforeSave` request headers remain supported for compatibility.

## 📋 Phasing

Phase 1 ships the shared scope, CrudForm wiring, server stripping, documentation, and regression tests together. It is independently usable by any injected widget and API interceptor.

## 📋 Implementation Plan

1. Add shared widget-payload constants and helpers, plus request-body scope support in `apiCall`; cover nesting, cleanup, JSON merging, and unchanged requests with unit tests.
2. Wire `CrudForm` to collect active injected values and scope them around the existing `onSubmit`; add component regression coverage proving the host receives core values while the request receives the sidecar.
3. Strip the reserved sidecar before CRUD entity mapping while preserving it for interceptor before/after hooks; add CRUD-factory coverage for create and update requests.
4. Document the supported injected-widget server-side pattern with a transactional relation-creation example and run package generation/build/type checks.
5. Exercise the existing backend customer create form with Playwright, confirming the form remains usable and the request path completes without exposing the sidecar as an entity field.

## Integration Coverage

- API: CRUD POST and PUT requests with an injected widget sidecar reach interceptor before/after hooks, while persisted entity input excludes the reserved key.
- UI: an existing CrudForm with injected fields submits successfully, retains normal validation, and does not render the reserved sidecar as a visible entity field.
