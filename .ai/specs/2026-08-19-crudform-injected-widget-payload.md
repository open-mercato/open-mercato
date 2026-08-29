# CrudForm injected extension payload

## Goal

Allow an injected CrudForm field to provide module-scoped values to a CRUD API
interceptor during the same create or update request, without adding those
values to the host entity schema or changing `CrudForm` callback signatures.

## Design

`CrudForm` collects visible injected field values by contributing module id and
scopes them around the host submit callback. `apiCall` serializes that sidecar
under the private `__om_ext_v1` transport field. `makeCrudRoute` removes the
transport field before both direct CRUD and command action schemas parse the
entity body, then exposes the sanitized payload as optional
`InterceptorContext.extensionPayload` to both before and after hooks.

The client scope covers one request, not a time window. `apiCall` injects the
payload into the first `POST`/`PUT`/`PATCH` carrying a JSON content-type and a
JSON-object body, then spends the scope, so a secondary write inside the same
`onSubmit`, a background refetch, or a concurrent autosave never carries another
module's field values. `CrudForm` cannot name its submit URL — `onSubmit` is
caller-supplied and the component has no endpoint prop — so two residuals
remain, narrowed rather than eliminated: a concurrent write racing the submit
inside that one-request window, and two forms submitting at the same time. In
the latter case the payloads are withheld until only one scope remains, rather
than allowing either request to receive another form's values. Both are why a form submitting
to a hand-written route (instead of a `makeCrudRoute` one) is documented as
responsible for stripping the transport field itself. A submit that does not
declare a JSON content-type carries no payload at all.

The server treats this channel exactly like any browser-supplied data. An
interceptor that uses it must validate its module payload with Zod, enforce the
module feature server-side, and derive tenant and organization scope from the
interceptor context. Payload sanitation drops prototype keys at every level of
the payload, module ids included, builds its accumulators with a null prototype
so a missed key can never re-parent the result, and bounds nesting depth plus a
shared budget spent by both object keys and array elements.

## Coverage

- Shared CRUD factory tests cover direct and command `POST`, including a strict
  command schema, before/after context visibility, and absence from entity and
  `mapInput` bodies.
- UI tests prove the most recently edited injected value is scoped for submit.
- `apiCall` tests cover nested request scopes, the private transport shape, the
  one-request scope, and the read/non-JSON/non-object cases it must not touch.
- `sanitizeExtensionPayload` tests pin the prototype-key guard at module and
  nested level and the shared object/array budget.
- `TC-CUST-EXTPAYLOAD-001` (`packages/core/src/modules/customers/__integration__`)
  drives the transport field through a live `makeCrudRoute` `POST`/`PUT` on
  `customers/people`, asserting the entity schema accepts it, the stored record
  never carries it, and a prototype-poisoned payload is sanitized rather than
  faulting the request.

## Migration & Backward Compatibility

This is additive. `InterceptorContext.extensionPayload` is optional; existing
interceptors and CRUD callers keep their current behavior. The browser transport
is private to `CrudForm` and `apiCall`, is not part of entity or command request
schemas, and must not be consumed directly by application modules. No existing
route, callback, event, or response contract changes.
