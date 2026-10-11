# Workflows — registration seam for task entity ACL requirements and deep links

- **Status:** Implemented (PR #7193)
- **Issue:** #7180
- **Scope:** OSS, `packages/core/src/modules/workflows`
- **Builds on:** §6.4 "Permissions from business context" of `2026-07-26-workflows-ux-redesign.md`

## TLDR

A module registers, for an entity it owns, (a) the `view` features that make tasks bound to it
visible and (b) a record deep-link builder. The §6.4 entity gate consults the registration only
when the core `ENTITY_ACL_REQUIREMENTS` table has no entry; the Work Inbox and task detail receive
the resolved link as an additive `entityBindings[].href`. Unregistered entities keep failing closed.

## Problem

`resolveTaskEntityAccess` (`lib/task-entity-access.ts`) maps a bound entity type to required
features through `resolveEntityAclRequirement` (`entities/lib/entityAcl.ts`), whose table holds
core entities only. An app-owned ORM entity classifies as `system` with no requirement →
`{ kind: 'unavailable' }` → excluded from the `entity_types <@ ARRAY[…]` whitelist. A task bound
to an app-owned record is therefore visible to superadmins only, and the Work Inbox deep links
(`lib/work-inbox/entity-links.ts`) enumerate four core types. Apps cannot use
`userTaskConfig.entityBindings` for their own records.

## Design

### Registry (`lib/task-entity-registry.ts`, pure, zero imports)

```ts
registerTaskEntityAclRequirements([{ entityId: 'notary:notary_case', view: ['notary.cases.view'] }])
registerTaskEntityLinkBuilders([{ entityId: 'notary:notary_case', buildHref: (id) => `/backend/notary/cases/${id}` }])
```

- Keyed on the generated entity id, normalized (`trim`, lower case, `.` → `:`), validated as
  `module:entity`. Malformed entries throw `[internal]` at registration — a registration that
  silently degraded would leave its tasks hidden with nothing pointing at the cause.
- `view` must contain at least one non-empty feature (an empty list would make the type visible to
  every caller in scope).
- Re-registering replaces (HMR-safe). Same shape and call site as `registerWorkflowSafeCommands`:
  modules call it from their `workflows.ts`. No new auto-discovery file, no generator change.

### Entity gate (`lib/task-entity-access.ts`)

Only the `system` branch changes:

| Core entry | Registration | Decision |
|---|---|---|
| present, `platformOnly` | any | `unavailable` (unchanged) |
| present | any | core `view` (unchanged; registration ignored) |
| absent | present | `requires: registered view` |
| absent | absent | `unavailable` (unchanged) |

Custom entities, unknown types, normalization and superadmin short-circuit are untouched.
Normalization still requires the id to exist in the generated entity registry, so a registration
cannot vouch for a type the platform does not know (`unknown-entity-type`).

The registration is consulted by the workflows task gate only. `entityAcl.ts` (entities records
API, entity metadata reads) is deliberately unchanged — widening those is a separate decision.

### Deep links

- `resolveEntityRecordHref(entityType, entityId)` (`lib/work-inbox/entity-links.ts`): enumerated
  core link first, then the registered builder. Result accepted only when it is a same-origin path
  (`/…`, not `//…`, not `/\…`, no whitespace/control chars); a throwing builder yields `null`.
- Registrations live in the server process, so the href is resolved server-side and shipped as an
  additive field:
  - `GET /api/workflows/work-inbox` → `data[].entityBindings[].href` (OpenAPI updated);
  - `GET /api/workflows/tasks/[id]` → `data.entityBindings[].href`.
- Clients prefer `binding.href` and fall back to the pure `buildEntityRecordHref` for payloads that
  carry none (e.g. other inbox sources). The Work Inbox list now renders linked bindings.
- The pending-work widget needs nothing: it matches by `resourceKind` across spellings already.

## Security

- Additive and fail-closed: no existing decision changes; only a type with no core entry AND an
  explicit registration gains a requirement.
- Tenant/organization scoping is applied to the task row exactly as before; a registration adds no
  scope and removes none (tests: foreign tenant → `denied:tenant`, foreign org → `denied:organization`).
- Still entity TYPE access, not record-level (documented limit, unchanged).
- Portal visibility is untouched (it compares record ownership, not features).

## Backward compatibility

- New exports only (`task-entity-registry.ts`, `resolveEntityRecordHref`, `withEntityRecordHrefs`).
- Response changes are additive optional fields (`href`). No DB, event, ACL feature, or route change.

## Tests

- `lib/__tests__/task-entity-registration.test.ts` — registry validation, gate decisions, regression
  (unregistered → `unavailable`), core-wins, predicate + SQL whitelist, tenant/org scope.
- `lib/__tests__/work-inbox-entity-links.test.ts` — builder resolution, core-wins, href sanitizing.
- `lib/__tests__/work-inbox-provider.test.ts` — inbox rows carry `href`.
- `api/__tests__/taskDetail.route.test.ts` — feature holder 200 + href; without feature 404;
  registration removed → 404.

## Integration coverage

`packages/core/src/modules/workflows/__integration__/TC-WF-068.spec.ts`, self-contained (roles,
users, a Todo, four definitions and instances created through the API, all removed in `finally`).
Registrations come from the test-only `workflows_entity_probe` app module
(`apps/mercato/src/modules/workflows_entity_probe/workflows.ts`), which registers only when the
integration runner sets `OM_INTEGRATION_TEST=true` and is inert otherwise.

| Path | Assertion |
|---|---|
| `GET /api/workflows/work-inbox` | Feature holder sees the `example:todo` row with `href=/backend/todos/<id>/edit`; an off-origin builder yields `href: null`; the unregistered type and the non-holder get no row |
| `GET /api/workflows/tasks/[id]` | Feature holder: same `href`; non-holder and unregistered type: 404, body discloses no binding |
| `/backend/work-inbox` | `work-inbox-entity-link` carries the href and clicking it opens the Todo edit form |
| `/backend/tasks/[id]` | "About what" card (`task-context-records`) links to the record; no link for the off-origin builder; non-holder sees "Task not found" |

## Changelog

- 2026-10-11 — Initial design and implementation (#7180).
- 2026-10-11 — Detail OpenAPI types `entityBindings` with `workInboxEntityBindingSchema`; TC-WF-068 integration coverage.
