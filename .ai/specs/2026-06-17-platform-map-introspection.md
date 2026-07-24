# Platform Map — Module Introspection for Developers

> Status: **DRAFT — ready for review** (Open Questions gate cleared 2026-06-17)
> Scope: OSS — developer tooling (DX), no business behavior
> Date: 2026-06-17

## TLDR

OpenMercato already aggregates almost every extension surface into committed generated
registries under `apps/mercato/.mercato/generated/*.generated.ts` (~25 of them: modules,
events, subscribers, ACL features, widget injection spots/tables, API routes, search configs,
nav, notifications, enrichers, interceptors, command-interceptors, workflows, AI tools,
component overrides, guards, analytics, message types, dashboard widgets, …). There is **no
single place** for a developer to see "what is registered in this app and how is it wired" —
they grep across modules.

This spec introduces a **Platform Map**: one isomorphic **introspection core** with an
extensible **surface-provider registry** that builds a typed `PlatformMap` from the bootstrapped
module registry (Tier 1, static), the runtime DI container (Tier 2, DI keys), and optionally a
tenant-scoped DB read (Tier 3, live ACL grants + user-created custom fields). It ships first as
a `mercato inspect` CLI (all ~25 surfaces, `--json` for machines, derived views for event flow
and the ACL feature×role matrix), with a dev-gated backoffice page as a later phase.

### Decisions locked at the gate

| # | Decision |
|---|---|
| Q1 | **CLI first.** `mercato inspect` is v1; the backoffice UI is a later phase. |
| Q2 | **Tier 1+2+3.** Static registries + DI-key enumeration + opt-in tenant-scoped DB read (`--tenant`/`--org`). |
| Q3 | **Dev-only by default, opt-in prod.** UI route 404s in production unless an env flag exposes it behind a new `platform.inspect.view` ACL feature. |
| Q4 | **All ~25 surfaces**, via an extensible provider registry (adding one later = one provider entry). |
| Q5 | JSON output is **internal/unstable** for now, carries a `schemaVersion` field so we can promote it to a stable contract later. |

---

## Problem Statement

OpenMercato is an extensible, module-based platform whose value proposition includes stable
APIs for third-party module authors (`BACKWARD_COMPATIBILITY.md` enumerates 13 contract-surface
categories). Yet the platform cannot **observe its own composition**:

- A developer extending the app cannot quickly answer: which events exist and who listens?
  what widget spot IDs can I inject into? what DI keys can I resolve? what ACL features gate
  module X? what API routes does it expose? what is indexed for search?
- The data exists, but only as ~25 generated TypeScript files read by hand.
- Onboarding, debugging a missing subscriber, and auditing the extension surface all reduce to
  cross-file grepping. There is no machine-readable view for CI checks either (e.g. "fail the
  build if a subscriber references an event ID that no module declares").

**Non-goals.** This is read-only introspection. No mutation of registries, no business logic,
no replacement for OpenAPI docs (it complements them), no exposure of secrets or PII values.

## Research — how comparable platforms expose introspection

The "debug/inspect the wired application" command is a well-established framework pattern; we
deliberately follow it rather than invent a bespoke shape:

- **Symfony** — `debug:container` (services/DI), `debug:event-dispatcher` (listeners per event),
  `debug:router` (routes+methods), `debug:autowiring`. Each is a focused subcommand over one
  surface; all support a machine format. This validates **one surface per subcommand + `--json`**.
- **Laravel** — `route:list`, `event:list`, and `about` (an aggregated environment/surface
  summary). Validates an **aggregated top-level view** plus per-surface drill-down.
- **Magento 2** — `bin/magento` `module:status`, `setup:di:info`, events via plugin listings.
  Validates that a modular commerce platform treats introspection as first-class tooling.
- **Medusa / NestJS** — module/loader registries and devtools graphs. Validates a **typed
  registry** as the single source feeding multiple consumers (CLI + UI).

**Takeaways applied:** (1) a single typed map feeding multiple consumers; (2) per-surface
subcommands plus an aggregate; (3) machine output as a first-class citizen; (4) derived
relationship views (event flow) are the highest-value differentiator over raw listings.

## Proposed Solution

### Architecture overview

```
                         ┌────────────────────────────────────────┐
                         │  Introspection core (packages/shared)   │
   bootstrapped          │                                         │
   module registry  ───► │  SurfaceProvider registry               │
   (Tier 1)              │   ├─ modules, events, subscribers, acl, │
   DI container     ───► │   │  widgets, routes, search, nav, …    │  ──► PlatformMap
   (Tier 2)              │   │  (one provider per surface, ~25)    │      (typed object,
   em + tenant/org  ───► │   ├─ derived: event-flow, acl-matrix    │       schemaVersion)
   (Tier 3, opt-in)      │   └─ collectPlatformMap(ctx, opts)      │
                         └────────────────────────────────────────┘
                                   ▲                        ▲
                                   │                        │
                    ┌──────────────┴───────┐   ┌────────────┴───────────────┐
                    │  mercato inspect CLI │   │  dev-gated backoffice page  │
                    │  (Phase 1–2)         │   │  + GET /api/platform/...    │
                    │  human + --json      │   │  (Phase 3)                  │
                    └──────────────────────┘   └─────────────────────────────┘
```

The core is **isomorphic** and takes its inputs by injection — it never imports
`apps/mercato/.mercato/generated/*` directly (that path is app-specific and off-limits to a
package). Consumers supply a `IntrospectionContext`:

- **CLI**: bootstraps the app registry exactly like the existing `seed:defaults` command does
  (`bootstrapFromAppRoot` + `createRequestContainer`), then passes `{ modules, container, em? }`.
- **UI/API (Phase 3)**: runs inside the app where the registry + container already exist at
  runtime; the API handler passes the live container + request-scoped `em`/tenant.

This mirrors the **canonical mechanism** already used for cross-module CLI work and avoids a
second module-discovery path.

### The surface-provider contract (extensibility — Q4)

```ts
// packages/shared/src/lib/introspection/types.ts
export type SurfaceTier = 1 | 2 | 3

export type IntrospectionContext = {
  modules: ModuleInfo[]                 // bootstrapped registry (Tier 1)
  container?: AwilixContainer           // for Tier 2 (DI keys)
  em?: EntityManager                    // for Tier 3 (tenant-scoped DB)
  tenantId?: string | null              // Tier 3 scope (mandatory when em present)
  organizationId?: string | null
}

export type SurfaceRow = Record<string, string | number | boolean | string[] | null>

export type SurfaceProvider = {
  id: string                            // singular, e.g. 'event', 'widget-spot', 'di-key'
  title: string
  tier: SurfaceTier
  describe(): { columns: string[] }     // for human table rendering
  collect(ctx: IntrospectionContext): Promise<SurfaceRow[]> | SurfaceRow[]
}

export type PlatformMap = {
  schemaVersion: number                 // Q5 — bump when shape changes
  generatedAt: string                   // stamped by the consumer, not the core
  scope: { tenantId: string | null; organizationId: string | null } | null
  surfaces: Record<string, { tier: SurfaceTier; rows: SurfaceRow[] }>
}
```

Adding a new surface (incl. the long tail of the ~25 registries) = register one
`SurfaceProvider`. Third-party modules MAY register providers via a future
`introspection.ts` module file; for v1 the registry is internal and populated by core.

### Surfaces & tiers (v1 coverage = all ~25)

| Tier | Surfaces (provider id) |
|---|---|
| **1 — static** (bootstrapped registry only) | `module`, `event`, `subscriber`, `acl-feature`, `widget-spot`, `widget`, `api-route`, `search-entity`, `nav-item`, `custom-entity` (static specs), `notification`, `notification-handler`, `enricher`, `interceptor`, `command-interceptor`, `workflow`, `ai-tool`, `component-override`, `guard`, `analytics`, `message-type`, `dashboard-widget` |
| **2 — runtime** (needs container) | `di-key` (from `container.registrations`) |
| **3 — tenant-scoped** (needs `em` + tenant) | `acl-role-grant` (live `role_acl`), `custom-field` (user-created `entity_definition`/`entity_field`) |
| **derived** (no new data) | `event-flow` (join `event` ↔ `subscriber` on event id; flags unmatched subscribers + dead events), `acl-matrix` (features × roles, static + live grants) |

### CLI surface (Phase 1–2)

```
mercato inspect [surface]            # aggregate, or one surface (e.g. mercato inspect event)
  --json                             # machine output (PlatformMap)
  --tier 1|2|3                       # cap data collection at a tier (default: 1+2)
  --tenant <id> [--org <id>]         # enable Tier 3 (DB), scoped — required for tenant data
  --surface <id>[,<id>...]           # explicit subset
```

Default human output: per-surface tables (reuse a simple column renderer; columns come from
`describe()`). `--json` emits the `PlatformMap`. Registered as a global command in
`packages/cli/src/mercato.ts` following the **exact `seed:defaults` dispatch pattern**
(bootstrap → build context → run → typed exit codes).

### UI surface (Phase 3 — later)

A new core module **`platform`** (`packages/core/src/modules/platform/`) provides:

- Backend page `/backend/platform/map` rendering the surfaces with `DataTable`, plus the two
  derived views (event-flow graph/list, ACL matrix). DS primitives only (`DataTable`,
  `StatusBadge`, `SectionHeader`, `EmptyState`, `LoadingMessage`).
- `GET /api/platform/inspect` (`makeCrudRoute` is not a fit — this is a read-only report
  endpoint) returning the `PlatformMap`; client fetches via `apiCall`.
- **Gating (Q3):** page metadata guards with `requireFeatures(['platform.inspect.view'])`; the
  route + API additionally hard-gate on `NODE_ENV !== 'production'` **unless**
  `OM_PLATFORM_MAP_ENABLED=true` is set, in which case the ACL feature alone governs access.
  Feature declared in `platform/acl.ts`; granted to `admin` by default via `setup.ts`
  `defaultRoleFeatures`.

## Security & tenant isolation

- **Tier 3 is the only data path that touches the DB.** Every Tier-3 provider MUST filter by
  `tenantId` (and `organizationId` where applicable); cross-tenant reads are forbidden. The CLI
  requires an explicit `--tenant` to enable Tier 3 (no implicit "all tenants" dump).
- **No secrets, no PII values.** Providers expose *shapes*, not values: custom-field
  *definitions* (name/type), never field *values*; DI *keys*, never resolved instances;
  integration providers by id, never credentials. No `encryption.ts` map is required because no
  sensitive/GDPR column is read — this is asserted explicitly to satisfy the encryption gate.
- **Prod exposure is opt-in and ACL-gated** (Q3). Default posture: invisible in production.
- The API response is scoped to the **caller's** tenant only; it never accepts a tenant
  parameter that widens scope beyond the authenticated context.

## Phasing

Each phase leaves a working app and is independently shippable.

### Phase 1 — Introspection core + Tier-1 CLI (the "v1" backbone)
1. `packages/shared/src/lib/introspection/`: `types.ts`, `registry.ts`
   (`registerSurfaceProvider`, `collectPlatformMap`), and Tier-1 providers for **all ~25 static
   surfaces**. Each provider is small and mechanical (map a registry array → rows).
2. `mercato inspect` global command in `packages/cli/src/mercato.ts` (bootstrap like
   `seed:defaults`), human tables + `--json`, `--surface`, per-surface invocation.
3. Unit tests: each provider against a fixture module registry; CLI arg parsing; `PlatformMap`
   shape + `schemaVersion`.

### Phase 2 — Tier 2 + Tier 3 + derived views (completes CLI v1 per Q2)
4. `di-key` provider via `container.registrations` (Tier 2).
5. `acl-role-grant` + `custom-field` providers (Tier 3), tenant-scoped; CLI `--tenant/--org`
   wiring with isolation tests (no cross-tenant leakage).
6. Derived providers `event-flow` (dead-event / orphan-subscriber detection) and `acl-matrix`.
7. Unit tests for tiers 2–3 and derived joins, incl. a tenant-isolation test.

### Phase 3 — dev-gated backoffice UI (post-v1, per Q1)
8. `platform` core module: `acl.ts` (`platform.inspect.view`), `setup.ts`
   (`defaultRoleFeatures`), `GET /api/platform/inspect`, backend page + derived-view components.
9. Gating per Q3 (dev-only default + `OM_PLATFORM_MAP_ENABLED` opt-in + ACL feature).
10. Frontend Architecture Contract (below) + DS compliance + integration tests.

## Implementation notes & canonical mechanisms

- **No new module-discovery path** — reuse `bootstrapFromAppRoot`/`createRequestContainer`
  (the `seed:defaults` template).
- **Singular naming** for provider ids, the future `introspection.ts` file, and the
  `platform.inspect.view` feature.
- **No cross-module ORM** — Tier-3 providers read `role_acl` / `entity_definition` via the
  generic data engine the same way the owning modules do; the introspection core declares no ORM
  relationships.
- **HTTP** via `apiCall` (UI); **CRUD/report endpoint** is read-only (no `makeCrudRoute`).
- **i18n**: UI strings via `useT()` / `resolveTranslations()`; CLI output is dev tooling and may
  remain English, with internal `console`/error strings prefixed `[internal]`.

## Frontend Architecture Contract (Phase 3 only)

- **Server/Client boundary:** page shell + data fetch server-side; only the interactive
  surface/derived-view components are client (`"use client"`), each justified in a ledger.
- **No client blob:** the `PlatformMap` can be large — fetch on demand per surface via the API
  (paginated/lazy), never inline the full map into the initial HTML/client bundle.
- **Budgets:** route bundle + RAM budget recorded; the page is dev-tooling and must not regress
  the backoffice shell's baseline.
- **Tests:** hydration/interactivity test for the surface switcher and the event-flow view.

## Backward Compatibility

- **Additive only.** New shared lib (`introspection/*`), new global CLI command (`inspect`), new
  core module (`platform`), new ACL feature, new API route, new env flag. No FROZEN/STABLE
  surface is modified. Per `BACKWARD_COMPATIBILITY.md` this is a non-breaking addition.
- **`PlatformMap` JSON is explicitly internal/unstable for v1** (Q5) and carries
  `schemaVersion: 1`. If/when external tooling is allowed to depend on it, promote it to a
  documented contract with the deprecation protocol; the version field makes that migration
  clean. Until then, RELEASE_NOTES.md states the shape may change.
- The `SurfaceProvider` type becomes a (future) extension point; v1 keeps it internal so we are
  free to refine it before third-party modules rely on it.

## Integration & test coverage

- **CLI:** integration test asserting `mercato inspect --json` returns a `PlatformMap` with the
  expected surfaces against the ephemeral env; `mercato inspect event` human output smoke test;
  `--tenant` Tier-3 path returns only that tenant's grants.
- **API (Phase 3):** `GET /api/platform/inspect` — 200 + scoped payload for an authorized user;
  403 without `platform.inspect.view`; 404 in production without `OM_PLATFORM_MAP_ENABLED`.
- **UI (Phase 3):** key path — open `/backend/platform/map`, switch surfaces, open event-flow,
  confirm an orphan subscriber is flagged. `needs-qa` for the UI phase; Phases 1–2 are
  CLI/test-only and can be `skip-qa`.
- Tests are self-contained (create any fixture role/custom-field via API in setup, clean up in
  teardown); no reliance on seeded demo data.

## Risks & mitigations

- **Registry drift** (a generated file changes shape) → providers depend on typed registry
  symbols, not file layout; a provider unit test per surface catches breaks at build.
- **Large output** → `--surface` scoping in CLI; lazy per-surface fetch in UI.
- **Accidental prod exposure** → default 404 in prod + ACL feature + explicit env opt-in (Q3);
  covered by an API gating test.
- **Scope creep into a "god dashboard"** → strictly read-only; no actions, no mutations.

## Open Questions

None blocking. (Q5 promotion to a stable contract deferred; revisit if external tooling demand
appears.)

## Memory & RSS (review follow-up — PR #3141)

Platform Map introspection must not inflate steady-state dev RSS when unused.

| Requirement | Implementation |
|---|---|
| Lazy provider loading | `registry.ts` dynamically imports `./providers`; each provider dynamically imports its registry getters inside `collect()` |
| Scoped bootstrap (CLI) | `resolveBootstrapFilesForSurfaces()` + `loadIntrospectionBootstrapData({ requiredFiles })` compile only the generated dictionaries needed for the requested surface(s) |
| Runtime API path | `buildRuntimeIntrospectionContext()` reads live in-memory registries (`getModules()`, DI container); no `bootstrapForIntrospection()` re-import |
| Snapshot fields on demand | `registerIntrospectionSnapshotLoader()` in `apps/mercato/src/bootstrap.ts` lazy-imports `notifications.generated` / `ai-tools.generated` only when those surfaces are requested |
| UI off idle path | Client leaf imports `surface-catalog` + types only; map fetched per surface via API |
| Dev gating unchanged | `isPlatformMapEnabled()` + `platform.inspect.view` |

Verification: `yarn dev:profile --label platform-map-idle` (do not open `/backend/platform/map`); compare peak RSS with baseline via `yarn dev:profile:report`.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Introspection core + Tier-1 CLI | Done | 2026-06-29 | `packages/shared/src/lib/introspection/*`, `mercato inspect`, unit tests |
| Phase 2 — Tier 2 + Tier 3 + derived views | Done | 2026-06-29 | DI keys, tenant-scoped grants/custom fields, event-flow + acl-matrix |
| Phase 3 — dev-gated backoffice UI | Done | 2026-06-29 | `platform` module, `/backend/platform/map`, `GET /api/platform/inspect` |

### Phase 1 — Detailed Progress
- [x] Step 1: Introspection core (`types`, `registry`, `providers`, `render`, `surface-catalog`)
- [x] Step 2: `mercato inspect` CLI (`--json`, `--tier`, `--tenant`, `--org`, `--surface`)
- [x] Step 3: Unit tests (registry shape, catalog sync, args parsing)

### Phase 2 — Detailed Progress
- [x] Step 4: `di-key` provider (Tier 2)
- [x] Step 5: `acl-role-grant` + `custom-field` providers with tenant isolation tests
- [x] Step 6: Derived `event-flow` + `acl-matrix` providers
- [x] Step 7: Tier 2–3 unit coverage

### Phase 3 — Detailed Progress
- [x] Step 8: `platform` module (`acl`, `setup`, API route, bootstrap helper)
- [x] Step 9: Dev-only gating (`NODE_ENV` + `OM_PLATFORM_MAP_ENABLED`) + ACL feature
- [x] Step 10: Backend page + `PlatformMapScreen` client leaf, i18n, component test scaffold

### Verification
- `yarn workspace @open-mercato/shared build` — pass
- `yarn workspace @open-mercato/cli build` — pass
- `yarn workspace @open-mercato/core build` — pass
- `yarn workspace @open-mercato/app generate` — pass (403 API routes incl. `/api/platform/inspect`)
- Jest unit tests — blocked locally by `TS5103: Invalid value for '--ignoreDeprecations'` (pre-existing env/tooling)
- Integration tests added: `TC-PLAT-001` (API), `TC-PLAT-002-cli` (CLI JSON smoke)
