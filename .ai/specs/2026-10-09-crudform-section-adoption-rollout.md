# CrudForm section adoption program index

**Status:** Program index — non-implementing
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md`
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`, `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md`

## TLDR

Track adoption of the generic section-override framework without using one specification to implement unrelated domain hosts. Every production grouped `CrudForm` invocation is classified by the generated inventory, but each module or genuinely coupled host family ships through its own reviewed adopter spec, PR, tests, and rollback. This document defines the dependency graph and aggregate status only; no production code may be implemented from it.

Enterprise and official-module references are intentional. Their external owner/spec/PR links must be valid, but their delivery does not block OSS technical completion. All implementation and cross-repository coordination remain restricted to Open Mercato core team members.

## Overview

The generic framework can ship without enabling a domain host. Catalog product edit is the first complex adopter. The remaining repository surface spans unrelated modules, APIs, schemas, side effects, security boundaries, and repositories, so it is a program rather than one deployable feature.

The historical snapshot at source SHA `7187041c2` found 139 production `CrudForm` JSX invocations in 131 files, including 102 grouped invocations across 98 files. Those counts are review context only. The versioned merge-head inventory contract is defined by `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md` and is the sole source of current records.

## Problem Statement

A repository-wide implementation spec would bundle independently deployable catalog, auth, customer, sales, workflow, example, template, enterprise, and official-module work. It would also mix platform inventory tooling with domain adapters. That violates the spec cohesion rule and makes review, rollback, and completion ambiguous.

This index separates:

1. generic runtime framework;
2. inventory/CI governance;
3. one adopter spec per module or tightly coupled host family;
4. sample/template/standalone-harness knowledge work;
5. enterprise and official-module delivery in their owning repositories/spec areas.

## Goals and Non-goals

### Goals

- Maintain an exact dependency/status index for all adoption workstreams.
- Require every OSS production grouped invocation to link to a reviewed adopter spec or a time-bounded deferral issue.
- Define OSS completion independently of enterprise and official-module release timing.
- Make each implementation unit independently testable, reviewable, deployable, and reversible.

### Non-goals

- Defining runtime types, generator behavior, domain descriptors, routes, or schemas.
- Authorizing implementation for any host without a dedicated adopter spec.
- Editing enterprise or official-module code from an OSS adopter PR.
- Combining examples/templates/harness knowledge with production module adoption.

## Proposed Solution

Keep this file as a dependency/status index. The inventory supplies exact records and state; each production, sample, enterprise, or external work unit supplies its own implementation spec and PR. Aggregate reports consume those links without defining runtime behavior here.

## Program Contract

### Work-unit states

Each inventory record points to exactly one work unit with one state:

```ts
type AdoptionWorkUnitState =
  | { state: 'ready'; adopterSpec: string; implementationPr: string }
  | { state: 'planned'; adopterSpec: string; specPr: string }
  | { state: 'deferred'; issue: string; owner: string; revisitBy: string }
  | { state: 'compatibility-only'; rationale: string }
  | { state: 'external'; repository: string; specOrIssue: string }
```

- `adopterSpec` is a repository path under the correct OSS/enterprise spec directory with all mandatory spec sections and an approved spec review.
- `implementationPr` satisfies the inventory's current-PR-or-merged causal evidence rule and names the exact record ids.
- `specPr` is an open approved-design or merged spec PR, not free text.
- `deferred.issue` is an open tracker URL with an assignee, explicit host ids, blocking reason, and ISO `revisitBy` date.
- `external` is sufficient for OSS completion when repository and owner link resolve; it does not claim the external work shipped.
- `compatibility-only` is valid only for ungrouped forms or an explicit `hostId: null` path with no addressable topology.

### Deployable-unit rule

A dedicated adopter spec may cover multiple invocations only when they share one runtime/domain capability and must ship together. Sharing a package, wave, renderer primitive, or inventory batch is not sufficient. Every adopter spec must list its exact hosts, API/command paths, key UI test names, stable ids, dependencies, security/locking behavior, no-policy baseline, and per-host rollback.

### OSS technical completion

The OSS production program is technically complete when:

- every OSS production grouped record is `ready`;
- every OSS compatibility-only record satisfies the inventory rule;
- there are zero OSS production `planned` or `deferred` records;
- every external record has a valid repository plus owning spec/issue link;
- all ready adopter implementation PRs and inventory gates are green.

Enterprise/official implementation status is reported separately and does not block this OSS gate. Overall portfolio completion may be reported only when those external owners separately report ready.

## Workstream Index

| Workstream | Boundary | Required dedicated spec/status |
|---|---|---|
| Platform framework | Shared override/runtime/server capability contract | `.ai/specs/2026-10-22-crudform-section-overrides-framework.md` — proposed |
| Inventory and CI | Per-invocation scanner, state validation, drift report | `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md` — proposed |
| Catalog product edit | One product-edit section-policy adapter | `.ai/specs/2026-09-30-catalog-product-form-section-policy.md` — proposed |
| Remaining catalog | Category, price, variant, compound product-create families split by runtime dependency | Dedicated adopter specs required before implementation |
| Simple OSS CRUD | Module-scoped adopters for API keys, currencies, devices, directory, toggles, scheduler, webhooks, etc. | One reviewed spec per module/tightly coupled family |
| Custom OSS adapters | Attachments, auth, customer accounts, planner, staff, warranty | One reviewed spec per module/tightly coupled family |
| Customers and sales | Customer page/dialog shapes and sales document/subresource families | Separate customer and sales adopter specs; split further when independently deployable |
| High-variance editors | Checkout, business rules, entity editors, EUDR, warranty claims, workflows | One reviewed spec per module/tightly coupled family |
| Samples/templates/harness | Todo/UMES/app examples, template mirror, agent knowledge/evaluation | Separate non-production/harness spec and PR |
| Enterprise | Commercial security and later enterprise hosts | `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md` coordination index plus named adopter specs |
| Official modules | External-repository adopters | External repository issue/spec/PR; core records `external` only |

No row above authorizes implementation where it says a dedicated spec is required.

## Cross-Repository Delivery

Official-module work follows this order:

1. merge and publish compatible core framework/adopter contracts;
2. create a branch inside `external/official-modules`, update the core peer range/prerelease as required, implement and test its dedicated adopter spec, and add its changeset;
3. open a separate PR against `open-mercato/official-modules`;
4. update activation or submodule state only when explicitly requested.

No core PR commits `external/official-modules` or its pointer. The OSS inventory requires a resolving external owner link, not a completed external release.

## Architecture

This program index adds no runtime component. It relates the framework, generated inventory, dedicated adopter specs, and external owners. Any PR that cites only this index as implementation authority must fail review.

## Data Models

No runtime or persisted data model. Work-unit state is build/review metadata validated by the separate inventory capability.

## API Contracts

No HTTP, command, event, or import contract. Dedicated adopter specs own all API effects.

## UI/UX

No product UI. The only output is the generated program status report owned by the inventory spec.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Index used as a flag-day implementation spec | Critical | Explicit non-implementing status and dedicated-spec gate | Program spans multiple releases |
| OSS completion waits on external repositories | High | External link validity, not external delivery, gates OSS | Portfolio remains incomplete until external owners finish |
| Deferrals become permanent | High | Owner plus ISO revisit date; inventory rejects stale dates | Replanning still requires review |
| Host families are grouped by convenience | High | Runtime dependency test for multi-host specs | Some boundaries require module-owner judgment |
| Samples/harness distort production gate | Medium | Separate workstream and completion report | Knowledge delivery may lag production readiness |

Rollback occurs only in the affected adopter work unit. Removing eligibility returns that record to `planned` or `deferred` with a new reviewed link/date and makes OSS completion false; it does not roll back unrelated ready hosts.

## Migration & Backward Compatibility

This index publishes no runtime contract. Dedicated adopter specs own every stable id and deprecation obligation. The inventory owns state-schema compatibility. Cross-repository work follows the core-first compatibility order above.

## Phasing and Tracking Plan

1. Land the generic framework and inventory/CI specs independently.
2. Regenerate the inventory and create/review dedicated adopter specs for each work unit before implementation.
3. Implement one work unit per PR (or a deliberately coupled set justified in its spec), update only its inventory records, and run its exact gates.
4. Deliver samples/templates/harness knowledge in its own PR.
5. Report OSS technical completion using the exact state query above; report enterprise and official-module portfolio status separately.

## Verification and Evidence

Each ready adopter work unit supplies:

- exact host/variant/operation/section/ownership/action/dependency/caller facts;
- named route/command integration tests for every affected mutation;
- named browser test cases for each create/update/delete/action path it changes;
- pinned no-policy payload, endpoint, ordered side-effect trace, lock headers, events, and audit evidence;
- focused commands with exit status and artifact paths;
- merged implementation PR and per-host rollback note.

The program report is generated from inventory records and emits exact record ids grouped by state. Terms such as “key UI path,” “approved follow-up,” and “completed coordinated work” are not accepted without the concrete evidence fields defined above.

## Acceptance Criteria

1. This index is never used as implementation authority for a domain host or tooling change.
2. Framework, inventory/CI, production adopters, samples/harness, enterprise, and official modules have separate owners/specs/PRs.
3. Every multi-host adopter spec proves a runtime/deployment dependency rather than package proximity.
4. OSS technical completion uses the exact state query and does not depend on enterprise/official release timing.
5. Every external record has a resolving repository and owner spec/issue link.
6. Every ready OSS record links to its reviewed spec, merged green implementation PR, named API/UI tests, and rollback evidence.

## Final Compliance Report

| Area | Status | Evidence required before OSS program completion |
|---|---|---|
| Scope cohesion | Ready | One deployable capability per dedicated adopter spec |
| Inventory | Dependency | Versioned inventory spec and green state query |
| OSS completion | Defined | Zero planned/deferred OSS production grouped records |
| External scope | Defined | Valid owner links; separately reported delivery |
| Samples/harness | Separated | Independent spec/PR and status |
| Ownership | Ready | Core-team-only implementation and coordination |

## Changelog

- **2026-10-22:** Converted the repository-wide implementation draft into a non-implementing program index. Split inventory/CI into its own prerequisite, required module/tightly coupled adopter specs, separated samples/harness, and made OSS completion independent of intentional enterprise/official-module delivery.
- **2026-10-09:** Initial repository-wide adoption follow-up draft.
