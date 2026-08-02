# {Title}

**Date**: {YYYY-MM-DD}
**Status**: Draft

> Use `om-spec-writing` for every new application, multi-module feature, or other non-trivial business slice. Keep every section below; write `N/A — {reason}` when a section does not apply. Change the status to `Ready for implementation` only after every blocking open question is resolved and the traceability table covers every requirement.

## TLDR

{What is being built, who benefits, which existing Open Mercato capabilities are reused, and the smallest coherent outcome.}

## Problem Statement

{Current workflow, concrete pain, evidence, affected users, and why existing behavior is insufficient.}

## Overview and Success Measures

- **Primary outcome:** {Measurable business result and target.}
- **Leading indicators:** {Signals available before the final outcome.}
- **Baseline:** {Current measurable state or `unknown — measurement plan`.}
- **Market / product reference:** {Comparable product or workflow studied; what is adopted, rejected, and why.}

## Goals

- **REQ-001** — {Observable business outcome.}
- **REQ-002** — {Observable business outcome.}

## Non-goals

- {Explicitly excluded behavior, module, integration, or migration.}

## Proposed Solution

{Describe the product and technical approach, how it closes each stated problem, and why it is the smallest platform-native solution that can deliver the goals.}

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| {choice} | {why it fits the requirements and platform} | {alternative} | {tradeoff} |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| {term} | {one unambiguous meaning, formula, lifecycle, or constraint} | {module/entity/provider} | {reject/degrade/retry/audit} |

Define fields, states, transitions, calculations, ownership, and invariants precisely enough that implementation does not need to invent domain behavior.

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| {actor} | {view/create/update/etc.} | {own/team/organization/system} | `{module}.view`, `{module}.manage` |

Document how trusted `tenantId` and `organizationId` are derived. Describe any legitimate system-scope operation and the installed contract that authorizes it.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| {capability} | {reuse/UMES/app-owned} | `{module}` | {ID/snapshot/event/enricher/extension/optional DI} | {decision} |

Name the installed records that remain the source of truth. Do not duplicate CRM, auth, directory, notification, workflow, or other installed capabilities in app-owned entities.

## Architecture and Data Flow

```text
{actor/surface} -> {API/command} -> {owning entity}
                                  -> {event/subscriber/integration}
```

- **Module boundaries:** {Why each new module owns a distinct invariant; merge modules that must remain transactionally consistent.}
- **Extension points:** {Installed page/menu/widget/enricher/interceptor/event seams used instead of modifying installed code.}
- **Alternatives considered:** {Simpler platform-native alternative and why it was not selected.}
- **Compatibility:** {Existing API/data/UI behavior that must remain stable.}

## User Journeys

### Journey J-001 — {Name}

1. {Actor starts from a named page or API.}
2. {Primary action and system response.}
3. {Success state and downstream side effects.}
4. {Recoverable failure, permission denial, conflict, and retry behavior.}

## UI and Interaction Contracts

List every new or changed page before implementation. Inspect the closest existing Open Mercato page and `.ai/guides/backend-ui.md`; record that reference below. Tabular admin data uses `DataTable`, CRUD create/edit surfaces use `CrudForm`, and backend reads use the shared API helpers. Any custom page or component exception needs an explicit rationale and approval in this section.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/{route}` | {list/create/edit/etc.} | `{API paths / command IDs}` | `{module/path or component family}` | `Page`, `PageBody`, `DataTable`, `CrudForm`, {others} | loading, empty, error, conflict, success, permission denied | REQ-001 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| {role} | {group → item} | {widget, host, click-through} | {page → action → result; target ≤3 clicks} |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| {surface} | {localized explanation + next action} | {narrow/mobile layout} | {focus order, submit/cancel, announcements} |

### `/backend/{route}` — {Page name}

```text
┌────────────────────────────────────────────────────────────┐
│ {Page title}                               [{Primary action}]│
│ {Filters / summary / navigation}                           │
├────────────────────────────────────────────────────────────┤
│ {DataTable, CrudForm groups, calendar, or detail sections} │
├────────────────────────────────────────────────────────────┤
│ {Pagination / save-delete actions / status feedback}       │
└────────────────────────────────────────────────────────────┘
```

- **Behavior:** {sorting/filtering/pagination, validation, keyboard behavior, navigation, destructive confirmation, optimistic-lock conflict recovery.}
- **Responsive and accessibility:** {focus order, labels, screen-reader status, small-screen behavior.}
- **Localization:** {translation namespaces and dynamic values.}
- **Design-system and theming:** {semantic tokens and shared primitives; verify light and dark mode, contrast, reduced motion, and no hard-coded palette/status colors.}

For backend UI, implementation must invoke `om-backend-ui-design` and follow `.ai/guides/backend-ui.md`. Raw `<table>`, raw admin `<form>`, raw `fetch`, copied component families, arbitrary Tailwind values, hard-coded light-only colors, and manual `dark:` patches fail readiness unless the approved contract explains why the platform primitive cannot support the interaction. A custom calendar, board, or clinical workspace may be justified, but its surrounding shell, controls, status treatment, dialogs, states, and tokens remain platform-native.

## Data Models

### `{Entity}`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | composite scope indexes | no | trusted context only |
| `updated_at` | timestamp, required | optimistic-lock version | no | updated on every edit |

Document entity ownership, soft-delete or append-only rules, cross-module IDs/snapshots, uniqueness, transactions, encryption maps, retention, migrations, and compatibility impact.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/{path}` | auth + `{module}.view` | {query schema} | `{ items, totalCount }` | 400/401/403 | REQ-001 |
| `POST` | `/api/{path}` | auth + `{module}.manage` | {body schema} | 201 + `{module}.{entity}.created` | 400/403/409 | REQ-002 |

State whether each route uses `makeCrudRoute` or a custom guarded command route. Include per-method `metadata`, OpenAPI schemas, scope derivation, idempotency, optimistic locking, and stable public-contract implications.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `{module}.{entity}.{action}` | `{module}` | `{subscriber}` | {result} | {contract} |

Describe scheduled work, progress, cache invalidation, failure recovery, and optional-module behavior where applicable.

## Security, Privacy, and Compliance

- **Authorization:** {feature gates and record-level scope; never role-name checks.}
- **Tenant isolation:** {read/write filters and fail-closed behavior.}
- **Sensitive data:** {encryption map, safe reads, redaction, retention, audit policy.}
- **Abuse and failure modes:** {enumeration, injection, replay, concurrency, destructive action, secret exposure.}

## Integration Coverage

Tests must be self-contained and map to real API and UI paths.

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | {tenant/org/users/records} | {API or browser flow} | {success + persisted state + event} | REQ-001 |
| TEST-002 | security | {second tenant / insufficient feature} | {forbidden read/write} | {fail closed; no data leak} | REQ-001 |
| TEST-003 | UI | {records and permissions} | {loading/empty/error/conflict/keyboard flow} | {observable result} | REQ-002 |

## Implementation Phases

Phases are dependency ordered. Only the current phase may enter implementation; parallel work is limited to independent slices inside that phase. Each phase must leave a working app and close with its own evidence before the next phase starts.

### Phase 1 — {Foundation or first complete vertical slice}

- **Depends on:** none
- **Outcome:** {user-visible or independently verifiable result}
- **Why this order / value delivered:** {dependency and measurable business value available at phase completion}
- **Deliverables:** {specific entities, commands, routes, pages, subscribers, migrations}
- **Independent slices / estimated commits:** {bounded work that may run in parallel inside this phase only}
- **Requirements closed:** REQ-001
- **Tests:** TEST-001, TEST-002
- **Validation:** `yarn generate`, {focused typecheck/tests/integration paths}
- **Exit gate:** {observable criteria proving this phase works end to end, including affected UI in light/dark and narrow-width states}

### Phase 2 — {Next complete vertical slice}

- **Depends on:** Phase 1 exit gate
- **Outcome:** {result}
- **Why this order / value delivered:** {dependency and measurable business value}
- **Deliverables:** {specific files/seams}
- **Independent slices / estimated commits:** {bounded work inside this phase}
- **Requirements closed:** REQ-002
- **Tests:** TEST-003
- **Validation:** {focused commands}
- **Exit gate:** {observable criteria}

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/{route}` | `{entity}`, `GET /api/{path}` | Phase 1 | TEST-001, TEST-002 | AC-001 |

Every requirement must map to a phase, at least one test oracle, and a measurable acceptance criterion. No phase may be a catch-all “integration and polish” bucket for behavior required by earlier slices.

## Rollout, Migration, and Rollback

{Migration generation/application boundary, seed/setup work, feature flags, compatibility bridge, observability, rollout order, and reversible rollback steps.}

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| {risk} | {impact} | {test/metric/guard} | {accepted remainder} |

Cover data integrity and concurrency, cascading/event failures, tenant isolation and privacy, migration/rollback, external-service degradation, scale/storage, and operational detection. Do not use “standard risks” as a substitute for concrete failure scenarios.

## Acceptance Criteria

- [ ] **AC-001** — {Measurable end-to-end result, including actor and scope.}
- [ ] **AC-002** — {Measurable failure/safety result.}
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass/fail | {paths} |
| Data models, APIs, events, UI, and tests are internally consistent | pass/fail | {traceability rows} |
| Every workflow completes end to end without a catch-all integration phase | pass/fail | {journeys/phases} |
| Platform-native reuse and extension points were chosen before custom code | pass/fail | {reuse decisions} |
| UI contracts identify references, canonical components, and theme/state coverage | pass/fail | {surfaces} |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass/fail | {phases} |

Verdict must be exactly `Ready for implementation` or `Blocked — {unresolved items}`. The document status may change to ready only when every row passes.

## Open Questions

Blocking questions must be resolved before setting `Status: Ready for implementation`.

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | {question} | {owner} | yes/no | {pending or decision} |

## Changelog

| Date | Change |
|---|---|
| {date} | Initial draft |
