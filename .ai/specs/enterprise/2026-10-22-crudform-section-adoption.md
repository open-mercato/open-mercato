# Enterprise CrudForm section adoption index

**Status:** Coordination index — non-implementing
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md`
**Scope:** Commercial `packages/enterprise` grouped forms only

## TLDR

Keep intentional enterprise inventory coverage in the commercial spec area while shipping each independently deployable form family through its own adopter spec. The initial work units are the user MFA-reset form and sudo-configuration create/edit form; they do not depend on each other and must not share an implementation PR merely because both live in the security module.

All implementation and review are restricted to Open Mercato core team members. This index coordinates inventory ownership only and authorizes no production change.

## Overview

The OSS inventory scanner sees enterprise sources when that package is present, but enterprise-only behavior cannot be specified or implemented from an OSS domain spec. Inventory records therefore point to this index and then to the exact commercial adopter:

| Renderer | Dedicated adopter spec | Inventory state before implementation |
|---|---|---|
| `SecurityUserForm.tsx` | `.ai/specs/enterprise/2026-10-22-security-user-mfa-reset-section-adoption.md` | `external`/`planned` |
| `SudoConfigCrudPage.tsx` locking prerequisite | `.ai/specs/enterprise/2026-10-22-sudo-config-optimistic-locking.md` | independent prerequisite; not an adoption record |
| `SudoConfigCrudPage.tsx` section adopter | `.ai/specs/enterprise/2026-10-22-sudo-config-section-adoption.md` | `external`/`planned` after locking prerequisite |

Future enterprise grouped forms require their own commercial adopter spec or a justified tightly coupled family spec before implementation.

## Problem Statement

MFA reset and sudo-config CRUD have different routes, schemas, security flows, action semantics, rollback, and tests. Sudo-config locking is also independently deployable and survives section-adopter rollback, so it has its own prerequisite spec. Combining these units would violate scope cohesion and force unrelated releases to move together. Conversely, omitting enterprise records from the OSS-generated inventory would make repository coverage false.

## Goals and Non-goals

### Goals

- Preserve intentional enterprise inventory references without moving commercial behavior into OSS.
- Map each enterprise invocation to one exact commercial owner spec/PR.
- Require independent readiness, tests, and rollback for each adopter.

### Non-goals

- Defining host ids, routes, capabilities, schemas, or UI behavior; dedicated specs own them.
- Marking all enterprise forms ready as one batch.
- Adding commercial behavior to `packages/shared`, `packages/ui`, or `packages/core`.

## Proposed Solution

Keep a commercial coordination record that maps each available enterprise invocation to its dedicated adopter spec and implementation evidence. The OSS inventory stores only scope/owner links; runtime facts and behavior stay in the named enterprise adopter.

## Coordination Contract

- The inventory owner synchronizes record state; adopter PRs supply facts but do not redefine the inventory schema.
- An enterprise record becomes `ready` only after its named adopter implementation PR merges with green exact gates.
- A missing enterprise checkout produces only a source-presence flag; it never creates guessed readiness.
- A configured-but-invalid policy follows the framework blocking-failure contract. No dedicated enterprise spec may restore actionable base controls on policy failure.
- Generic protected-header merging comes from the framework's immutable request-bound client. Enterprise adopters may add `x-sudo-token` as an ordinary required header but may not reimplement protected policy-header precedence.

## Architecture

This index changes no runtime architecture. Dedicated adopter specs own all behavior. OSS packages expose only the generic framework and inventory facts; security-specific providers/descriptors remain in `packages/enterprise`.

## Data Models

No database or runtime model. Coordination state lives in the separate generated inventory manifest.

## API Contracts

No HTTP, command, event, or import contract. Each commercial adopter spec owns its exact stable surfaces and compatibility obligations.

## UI/UX

No product UI. Configured enterprise forms inherit UI behavior only through their dedicated adopter specs.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Commercial behavior leaks into OSS | Critical | Commercial owner specs and package-boundary tests | None accepted |
| Independent adopters are shipped as one flag day | High | Separate specs/readiness/rollback rows | Coordinated release may still be chosen explicitly |
| Inventory claims readiness before implementation | High | Merged-PR and green-gate requirement | Optional source lanes need careful reporting |
| Policy failure restores destructive controls | Critical | Framework blocking-failure rule in every adopter | Operational policy removal deliberately returns no-policy behavior |

Rollback updates only the affected invocation from `ready` to a reviewed `planned`/`deferred` state and removes that host's eligibility. Other enterprise adopters remain unchanged.

## Migration & Backward Compatibility

This index publishes no runtime contract. Dedicated specs own stable ids and deprecation. Inventory state changes follow the versioned inventory schema.

## Phasing and Tracking Plan

1. Land framework and inventory prerequisites.
2. Review and implement MFA-reset adoption independently.
3. Review and implement sudo-config optimistic locking independently.
4. Review and implement sudo-config section adoption only after that prerequisite lands.
5. Update each inventory record only after its own implementation/evidence is complete.

## Verification and Evidence

For each enterprise record, the inventory report must resolve its dedicated spec, implementation PR, exact stable facts, named API/UI/security tests, and rollback note. A single module-wide “enterprise security ready” marker is invalid.

## Acceptance Criteria

1. Enterprise references remain present and point to the correct commercial owner when sources are available.
2. MFA-reset, sudo-config locking, and sudo-config adoption have separate specs, PR readiness, tests, and rollback.
3. No production change cites only this index as implementation authority.
4. Generic protected-header behavior remains framework-owned.
5. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report

| Area | Status | Evidence required before coordination completion |
|---|---|---|
| License boundary | Ready | Commercial behavior/specs remain enterprise-only |
| Scope cohesion | Ready | One deployable form capability per adopter spec |
| Inventory ownership | Ready | Per-invocation spec/PR/evidence links |
| Failure safety | Ready | Dedicated specs inherit blocking configured-policy failure |
| Ownership | Ready | Core-team-only implementation and review |

## Changelog

- **2026-10-22:** Converted the combined security implementation draft into a non-implementing enterprise index and split MFA-reset, sudo-config locking, and sudo-config section adoption into independent commercial specs while retaining intentional inventory coverage.
