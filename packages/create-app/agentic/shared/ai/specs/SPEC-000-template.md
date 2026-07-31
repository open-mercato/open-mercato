# {Title}

**Date**: {YYYY-MM-DD}
**Status**: Draft

> Use `om-spec-writing` for every new application, multi-module feature, or other non-trivial business slice. Keep every section below; write `N/A — {reason}` when a section does not apply. Change the status to `Ready for implementation` only after every blocking open question is resolved and the traceability table covers every requirement.

## TLDR

{What is being built, who benefits, which existing Open Mercato capabilities are reused, and the smallest coherent outcome.}

## Problem Statement

{Current workflow, concrete pain, evidence, affected users, and why existing behavior is insufficient.}

## Goals

- **REQ-001** — {Observable business outcome.}
- **REQ-002** — {Observable business outcome.}

## Non-goals

- {Explicitly excluded behavior, module, integration, or migration.}

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

## User Journeys

### Journey J-001 — {Name}

1. {Actor starts from a named page or API.}
2. {Primary action and system response.}
3. {Success state and downstream side effects.}
4. {Recoverable failure, permission denial, conflict, and retry behavior.}

## UI and Interaction Contracts

List every new or changed page before implementation. Tabular admin data uses `DataTable`; CRUD create/edit surfaces use `CrudForm`. Any exception needs an explicit rationale and approval in this section.

| Surface / route | Purpose and primary actions | Data source / mutations | Canonical components | Required states | Requirement IDs |
|---|---|---|---|---|---|
| `/backend/{route}` | {list/create/edit/etc.} | `{API paths / command IDs}` | `Page`, `DataTable`, `CrudForm`, {others} | loading, empty, error, conflict, success, permission denied | REQ-001 |

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
- **Deliverables:** {specific entities, commands, routes, pages, subscribers, migrations}
- **Requirements closed:** REQ-001
- **Tests:** TEST-001, TEST-002
- **Validation:** `yarn generate`, {focused typecheck/tests/integration paths}
- **Exit gate:** {observable criteria proving this phase works end to end}

### Phase 2 — {Next complete vertical slice}

- **Depends on:** Phase 1 exit gate
- **Outcome:** {result}
- **Deliverables:** {specific files/seams}
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

## Acceptance Criteria

- [ ] **AC-001** — {Measurable end-to-end result, including actor and scope.}
- [ ] **AC-002** — {Measurable failure/safety result.}
- [ ] Every listed backend surface uses the canonical component from its UI contract, including complete loading, empty, error, conflict, keyboard, and accessibility states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Open Questions

Blocking questions must be resolved before setting `Status: Ready for implementation`.

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | {question} | {owner} | yes/no | {pending or decision} |

## Changelog

| Date | Change |
|---|---|
| {date} | Initial draft |
