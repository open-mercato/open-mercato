# Reference Module Activation

**Date**: 2026-08-06
**Status**: Draft

> Shipped with the scaffold. This is the covering specification for turning on the two reference modules this app already contains in source: the canonical `example` module and the installed `design_system` gallery. Requests to enable the Todo demo, expose the design-system gallery, or build the first app capability on top of either one are covered here — amend this file instead of writing a second specification.

## TLDR

Every generated app ships `src/modules/example` in source and packs the installed design-system gallery, and registers neither. Activation is a deliberate, reversible app decision rather than a default, because an enabled reference module adds routes, navigation entries, migrations, seeds, ACL features, workers, and search indexes that a production app has not asked for. This specification owns that opt-in: what activation changes, who may see the activated surfaces, how the two modules stay independent of each other, and what has to be green before either one is enabled outside a development environment.

## Problem Statement

A new team reads `src/modules/example`, decides the Todo slice is close enough to the capability they need, and turns it on by adding it to `src/modules.ts`. Nothing warns them that the module was designed as a teaching reference: its ACL features grant a demo surface, its seeds create demo records, its migrations create tables the product will never use, and its navigation entries appear next to real ones. The design-system gallery has the same shape — it is genuinely useful to a design team and genuinely inappropriate as a customer-facing route. Without a written contract, each app rediscovers the consequences after the fact, usually in staging, and the resulting "turn it back off" work has to unpick migrations and seeded rows rather than a single registry line. This document exists so the decision is made once, with the consequences visible before the registry changes.

## Overview and Success Measures

- **Primary outcome:** a team can enable either reference module, or build on it, without discovering an unintended route, grant, or seeded record afterwards.
- **Leading indicators:** the activation checklist below is completed in the pull request that changes `src/modules.ts`.
- **Baseline:** both modules are source-present and runtime-absent in every preset shipped by `create-mercato-app`.
- **Market / product reference:** the Open Mercato monorepo runs the same two modules enabled, which is why their source is trustworthy as a reference and misleading as a default.

## Goals

- **REQ-001** — Enabling `example` is a single reviewable registry change whose runtime consequences are enumerated in advance.
- **REQ-002** — Enabling `design_system` exposes `/backend/design-system` only to holders of `design_system.view`, and never to an unauthenticated or customer-facing surface.
- **REQ-003** — Neither reference module gains a runtime dependency on the other, in either direction, when one or both are enabled.
- **REQ-004** — Deactivation is reversible: removing the registry entry removes every route, navigation entry, worker, and grant, leaving only the data the migrations created.

## Non-goals

- Copying either reference module into a new module ID. That is new-capability work: route it through `om-module-scaffold`, which reads this app's `src/modules/example` as read-only reference source.
- Editing anything inside `src/modules/example`. The tree is immutable reference context; app behavior belongs in an app-owned module.
- Shipping either module enabled by default in a preset. Presets stay source-present and runtime-absent.

## Proposed Solution

Activation is registration plus the generation and migration steps registration implies, in that order, followed by the grants that make the new surfaces reachable. The registry entry in `src/modules.ts` is the only switch; everything else is derived from it by `yarn generate`, so the review surface stays one line and the consequences stay mechanical. The two modules are registered independently: an app may want the gallery for its designers and no Todo demo at all, which is the common case, and the reverse holds while a team is learning the module contracts. Because activation creates database objects, the specification treats "enabled in development" and "enabled in a deployed environment" as two separate decisions with two separate exit gates.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Registration is the single switch | Keeps the reviewable surface to one line and lets generation derive everything else | An `OM_EXAMPLE_ENABLED` environment flag | A flag leaves the module registered, so routes and grants exist even when the flag is off |
| The two modules activate independently | A design team wants the gallery without the Todo demo far more often than both | One combined "reference modules" switch | Couples two unrelated decisions and creates a dependency edge the modules do not have |
| Deactivation leaves migrated tables in place | Dropping tables on a registry change would be an unreviewable data loss | Reverting migrations automatically | Destroys data on a change that reads as configuration |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| source-present | The module's files exist under `src/modules/` or in an installed package, and the module is not registered | the filesystem | no runtime effect of any kind |
| activated | The module ID appears in `src/modules.ts` and generation has run | `src/modules.ts` | routes, nav, ACL, workers and migrations become live |
| reference immutability | No app change may write under `src/modules/example` | this specification | the change belongs in an app-owned module instead |
| module independence | `example` and `design_system` never import each other at runtime | import graph | a dependency edge in either direction is a defect |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| developer | activate either module locally, read the example source | own workstation | none |
| administrator | grant the activated features to a role | organization | `example.view`, `example.manage` |
| designer | open the gallery once activated | organization | `design_system.view` |

Trusted `tenantId` and `organizationId` come from the authenticated session as they do for every other module; activation introduces no new scope derivation. No activated reference surface performs a system-scope operation.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Todo CRUD reference | reuse read-only | `example` | read the source, do not register it in production | it is a teaching surface, not a product capability |
| Component gallery | reuse as-is | `design_system` | activate behind `design_system.view` | it is genuinely useful internally and inappropriate publicly |
| First app capability | app-own | a new module | `om-module-scaffold` starting at `src/modules/example/README.md` | app behavior belongs to the app |

## Architecture and Data Flow

```text
src/modules.ts -> yarn generate -> generated registries -> routes, nav, ACL, workers
                                -> migrations           -> database objects
                                -> setup hooks          -> role features, defaults, opt-in examples
```

- **Module boundaries:** the two reference modules own separate invariants and share no entity, event, or import.
- **Extension points:** an app extends the activated example through the documented widget, enricher, and event seams rather than by editing it.
- **Alternatives considered:** shipping the modules unregistered but with their routes pre-generated; rejected because generated output would then contradict the registry.
- **Compatibility:** an app that never activates either module observes no behavior change from this specification.

## User Journeys

### Journey J-001 — Activate the gallery for the design team

1. A designer asks for the component gallery.
2. An administrator adds `design_system` to `src/modules.ts` and runs `yarn generate` and the migration step.
3. `/backend/design-system` becomes reachable and appears in navigation for roles holding `design_system.view`.
4. A user without the feature receives a permission denial rather than an empty page, and no navigation entry is rendered for them.

### Journey J-002 — Learn the module contracts from the activated example

1. A developer activates `example` on their workstation only.
2. The Todo list, create and edit surfaces, the bulk operation and its progress reporting become available.
3. The developer reads the capability-linked source files listed in `src/modules/example/references/surface-map.md`.
4. The developer removes the registry entry before opening a pull request, and the surfaces disappear on the next generation.

## UI and Interaction Contracts

Both activated surfaces are shipped surfaces, so this specification adds no new page. It records their contracts so that a review can check them rather than rediscover them.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/todos` | list, create, edit, bulk complete | `/api/example/todos` | the module itself | `Page`, `PageBody`, `DataTable`, `CrudForm` | loading, empty, error, conflict, success, permission denied | REQ-001 |
| `/backend/design-system` | browse component families and variants | packed gallery registry | the module itself | `Page`, `PageBody` | loading, empty, permission denied | REQ-002 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| administrator | Example → Todos | Todo summary widget when activated | login → Todos → create, two clicks |
| designer | Design → Design system | none | login → Design system, one click |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| `/backend/todos` | localized empty state offering create | table collapses to stacked rows | focus order follows the table, dialogs submit on Cmd/Ctrl+Enter and cancel on Escape |
| `/backend/design-system` | localized empty state when a family has no entry | grid reflows to one column | entries are reachable by keyboard and announce their family |

## Data Models

Activation creates the tables the reference modules' own migrations define; this specification introduces no entity of its own. The rule that matters for the decision is that those tables persist after deactivation.

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `tenant_id` / `organization_id` | UUID, required on every activated reference entity | composite scope indexes | no | trusted context only |
| `updated_at` | timestamp, required | optimistic-lock version | no | updated on every edit |

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/example/todos` | auth + `example.view` | list query | `{ items, totalCount }` | 400/401/403 | REQ-001 |
| `POST` | `/api/example/todos` | auth + `example.manage` | todo body | 201 + `example.todo.created` | 400/403/409 | REQ-001 |
| `GET` | `/backend/design-system` | auth + `design_system.view` | none | rendered gallery | 401/403 | REQ-002 |

Every activated route keeps its shipped contract; activation never changes a method, path, or gate. A route that is unreachable while the module is unregistered returns the framework's ordinary not-found response, which is the observable proof that registration is the switch.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `example.todo.created` | `example` | the module's own subscribers | index update, cache invalidation | idempotent, retried by the queue contract |
| bulk completion request | `example` | the module's dispatch and batch workers | progress job with a reported lifecycle | one logical execution per idempotency key |

While the module is unregistered none of these run, no subscriber is registered, and no worker is scheduled.

## Security, Privacy, and Compliance

- **Authorization:** both activated surfaces are feature-gated, never role-name gated.
- **Tenant isolation:** every activated reference read and write filters on the trusted scope and fails closed.
- **Sensitive data:** the example's encrypted fields stay encrypted at rest once activated, and the gallery holds no user data at all.
- **Abuse and failure modes:** the risk this specification actually controls is an unintended public surface, which is why activation and grants are separate steps.

## Integration Coverage

Tests must be self-contained and map to real API and UI paths.

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | a generated app with neither module registered | request both routes | both are absent, no navigation entry, no grant | REQ-001, REQ-002 |
| TEST-002 | integration | a generated app with `example` registered | run generation and exercise the Todo list and create paths | the surfaces work and stay scoped to the tenant | REQ-001 |
| TEST-003 | security | a generated app with `design_system` registered and a user lacking the feature | open the gallery route | permission denied, no navigation entry rendered | REQ-002 |
| TEST-004 | integration | a generated app with both registered | inspect the import graph | no edge in either direction between the two modules | REQ-003 |

## Implementation Phases

Phases are dependency ordered. Only the current phase may enter implementation.

### Phase 1 — Decide and activate in development only

- **Depends on:** none
- **Outcome:** the requested surfaces are reachable on a workstation and the consequences are recorded.
- **Why this order / value delivered:** the consequences of activation are observable before anything is deployed.
- **Deliverables:** the `src/modules.ts` entry, generated output, applied migrations, the completed activation checklist in the pull request.
- **Requirements closed:** REQ-001, REQ-003
- **Tests:** TEST-001, TEST-002, TEST-004
- **Validation:** `yarn generate`, `yarn typecheck`, the focused integration tests above
- **Exit gate:** the activated surfaces render in light and dark mode at narrow width, and deactivating restores the absent state.

### Phase 2 — Grant the features and deploy

- **Depends on:** Phase 1 exit gate
- **Outcome:** the intended roles, and only those roles, reach the activated surfaces in a deployed environment.
- **Why this order / value delivered:** grants are the step that makes a surface publicly consequential, so they follow a proven activation.
- **Deliverables:** the role-feature grants and the deployment migration run.
- **Requirements closed:** REQ-002, REQ-004
- **Tests:** TEST-003
- **Validation:** the configured validation gate
- **Exit gate:** a user without the feature is denied, a user with it succeeds, and removing the registry entry removes the surface again.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-002, `/backend/todos` | `/api/example/todos`, `example.todo.created` | Phase 1 | TEST-001, TEST-002 | AC-001 |
| REQ-002 | J-001, `/backend/design-system` | gallery route and `design_system.view` | Phase 2 | TEST-003 | AC-002 |
| REQ-003 | both surfaces | import graph | Phase 1 | TEST-004 | AC-003 |
| REQ-004 | both surfaces | registry entry | Phase 2 | TEST-001 | AC-004 |

## Rollout, Migration, and Rollback

Migrations are generated in the repository and applied by the deployment's own migration step, never by a developer running an ad-hoc apply against a shared database. Rollback is removal of the registry entry followed by generation; the tables the activated module created remain, and dropping them is a separate, deliberate data change.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| The example is mistaken for a product capability | demo surfaces reach real users | activation and grants are separate reviewed steps | a team may still grant deliberately |
| Migrations run in a deployed environment before the decision is final | unused tables persist | Phase 1 proves the decision on a workstation first | tables remain after deactivation, by design |
| A future app change edits the example in place | the reference stops matching the upstream tree | the tree is immutable context and reviews reject writes to it | none material |

## Acceptance Criteria

- [ ] **AC-001** — With `example` registered, an administrator creates and edits a Todo scoped to their organization; with it unregistered, the route is absent.
- [ ] **AC-002** — With `design_system` registered, a user holding `design_system.view` opens the gallery and a user without it is denied.
- [ ] **AC-003** — With both registered, no import edge exists between the two modules in either direction.
- [ ] **AC-004** — Removing either registry entry and regenerating removes its routes, navigation entries, workers, and grants.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/spec-delivery.md`, `.ai/skills/om-module-scaffold/SKILL.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | the traceability table above |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001 and J-002 each close in their own phase |
| Platform-native reuse and extension points were chosen before custom code | pass | the reuse map keeps app behavior in an app-owned module |
| UI contracts identify references, canonical components, and theme/state coverage | pass | the surface table above |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1 and Phase 2 |

Verdict: `Blocked — activation is an app decision this scaffold cannot make on the team's behalf`. Change the verdict and the status once the team has decided which modules to activate.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Which reference modules does this app activate, in which environments? | the app team | yes | pending |

## Changelog

| Date | Change |
|---|---|
| 2026-08-06 | Shipped with the scaffold as the covering specification for reference-module activation |
