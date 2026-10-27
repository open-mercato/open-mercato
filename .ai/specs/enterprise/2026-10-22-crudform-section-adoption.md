# Enterprise CrudForm section adoption index

**Status:** Coordination index — non-implementing
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md`, `.ai/specs/2026-10-27-crudform-section-adoption-link-verification.md`
**Scope:** Commercial `packages/enterprise` grouped forms only

## TLDR

Keep intentional enterprise inventory coverage in the commercial spec area while shipping each independently deployable alternative through its own adopter spec. The initial work units are user MFA reset, sudo-config create, and sudo-config edit/delete; they must not share an implementation PR merely because they live in the security module or reuse one renderer.

All implementation and review are restricted to Open Mercato core team members. This index coordinates inventory ownership only and authorizes no production change.

This index uses the framework's dependency semantics: only `Depends on` is a directed implementation/readiness edge. `Related` is non-ordering discoverability metadata, excluded from DAG validation, and cannot substitute for a hard prerequisite.

## Overview

The enterprise owner runs the shared scanner with an explicit enterprise scope/root/output; the OSS scanner never reads enterprise source topology. The OSS completion report carries only a link to this commercial owner index, while enterprise-owned alternative work units point directly to the exact commercial adopter:

| Renderer | Dedicated adopter spec | Inventory state before implementation |
|---|---|---|
| MFA reset command/service prerequisite | `.ai/specs/enterprise/2026-10-27-security-user-mfa-reset-transaction-boundary.md` | independent prerequisite; not an adoption work unit |
| `SecurityUserForm.tsx` | `.ai/specs/enterprise/2026-10-22-security-user-mfa-reset-section-adoption.md` | `planned` after framework runtime, inventory governance, and transaction-boundary prerequisites |
| `SudoConfigCrudPage.tsx` `create` alternative | `.ai/specs/enterprise/2026-10-27-sudo-config-create-section-adoption.md` | `planned` after framework runtime and inventory governance prerequisites |
| `SudoConfigCrudPage.tsx` locking prerequisite | `.ai/specs/enterprise/2026-10-22-sudo-config-optimistic-locking.md` | independent prerequisite; not an adoption work unit |
| `SudoConfigCrudPage.tsx` `edit` alternative | `.ai/specs/enterprise/2026-10-22-sudo-config-section-adoption.md` | `planned` after framework runtime, inventory governance, and locking prerequisites |

Future enterprise grouped forms require their own commercial adopter spec or a justified tightly coupled family spec before implementation.

## Problem Statement

MFA reset and sudo-config CRUD have different routes, schemas, security flows, action semantics, rollback, and tests. Within the reusable sudo renderer, create has no version/locking dependency while edit/delete do, so those finite alternatives are independent work units. MFA command transaction hardening and sudo-config locking are also independently deployable and survive their section-adopter rollbacks, so each has its own prerequisite spec. Combining these units would violate scope cohesion and force unrelated releases to move together. Conversely, omitting alternative work units from the enterprise-owned manifest would make commercial coverage false; copying them into OSS artifacts would violate the ownership boundary.

## Goals and Non-goals

### Goals

- Preserve intentional enterprise inventory references without moving commercial behavior into OSS.
- Map each enterprise finite alternative to one exact commercial owner spec/PR.
- Require independent readiness, tests, and rollback for each adopter.

### Non-goals

- Defining host ids, routes, capabilities, schemas, or UI behavior; dedicated specs own them.
- Marking all enterprise forms ready as one batch.
- Adding commercial behavior to `packages/shared`, `packages/ui`, or `packages/core`.

## Proposed Solution

Keep a commercial coordination record that maps each available enterprise finite alternative to its dedicated adopter spec and implementation evidence. The OSS inventory stores only scope/owner links; runtime facts and behavior stay in the named enterprise adopter.

## Coordination Contract

- The enterprise owner runs the shared scanner with an explicit enterprise scope/root/output and owns the resulting manifest; adopter PRs supply facts but do not redefine the schema.
- An enterprise alternative work unit becomes `ready` only in the enterprise-owned artifact after exact-head design approval and its named adopter implementation PR merges with green exact gates; readiness never propagates to a sibling alternative from the same invocation.
- The OSS artifacts contain only stable enterprise repository/owner/spec-or-issue links. They never contain enterprise invocation topology and remain byte-identical when enterprise sources are absent or present.
- A configured-but-invalid policy follows the framework blocking-failure contract. No dedicated enterprise spec may restore actionable base controls on policy failure.
- Generic protected-header merging comes from the framework's immutable request-bound client. Enterprise adopters may add `x-sudo-token` as an ordinary required header but may not reimplement protected policy-header precedence.

## Architecture

This index changes no runtime architecture. Dedicated adopter specs own all behavior. OSS packages expose only the generic framework, OSS inventory schema/static tooling, tracker-backed link verifier, and link-only external coordination; enterprise manifests and security-specific providers/descriptors remain enterprise-owned.

## Data Models

No database or runtime model. Source-derived coordination state lives in the enterprise-owned manifest; the committed OSS completion artifact carries only repository/owner/evidence references, while remote validity exists only in the verifier's ephemeral report.

## API Contracts

No HTTP, command, event, or import contract. Each commercial adopter spec owns its exact stable surfaces and compatibility obligations.

## UI/UX

No product UI. Configured enterprise forms inherit UI behavior only through their dedicated adopter specs.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Commercial behavior leaks into OSS | Critical | Commercial owner specs and package-boundary tests | None accepted |
| Independent adopters are shipped as one flag day | High | Separate specs/readiness/rollback rows | Coordinated release may still be chosen explicitly |
| Inventory claims readiness before implementation | High | Static evidence shape plus tracker-verified merged-PR and green-gate requirement in the owner-scoped lane | Cross-repository portfolio reporting still depends on links |
| Policy failure restores destructive controls | Critical | Framework blocking-failure rule in every adopter | Operational policy removal deliberately returns no-policy behavior |

Rollback updates only the affected alternative work unit from `ready` to a reviewed `planned`/`deferred` state and removes that alternative's eligibility. Sibling alternatives and other enterprise adopters remain unchanged.

## Migration & Backward Compatibility

This index publishes no runtime contract. Dedicated specs own stable ids and deprecation. Inventory state changes follow the versioned inventory schema.

## Phasing and Tracking Plan

1. Land framework, static inventory, and link-verification prerequisites in dependency order.
2. Review and implement MFA-reset transaction hardening independently.
3. Review and implement MFA-reset section adoption only after the framework runtime, inventory governance, and transaction-boundary prerequisites land.
4. Review and implement sudo-config create adoption after the framework runtime and inventory governance prerequisites land.
5. Review and implement sudo-config optimistic locking independently.
6. Review and implement sudo-config edit/delete adoption only after the framework runtime, inventory governance, and locking prerequisites land.
7. Update each alternative work unit only after its own implementation/evidence is complete.

## Verification and Evidence

For each enterprise alternative work unit, the enterprise-owned static report must name its exact-head design review, dedicated spec, implementation PR, exact stable facts, named API/UI/security tests, and rollback note; the tracker-backed verifier must resolve the remote evidence. The OSS static report retains only enterprise owner/repository/evidence references and the ephemeral verifier resolves those links. A renderer-wide or module-wide “ready” marker is invalid.

## Acceptance Criteria

1. OSS enterprise references remain link-only, resolve through the verifier to the correct commercial owner, and stay stable regardless of source checkout presence; source-derived facts remain in the enterprise-owned artifact.
2. MFA-reset transaction hardening, MFA-reset adoption, sudo-config create adoption, sudo-config locking, and sudo-config edit/delete adoption have separate specs, PR readiness, tests, and rollback.
3. No production change cites only this index as implementation authority.
4. Generic protected-header behavior remains framework-owned.
5. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root + enterprise guides | Keep commercial behavior and source-derived facts enterprise-owned | Compliant | OSS carries only owner/repository/evidence links; descriptors, manifests, and runtime behavior remain enterprise-owned |
| `.ai/specs/AGENTS.md` | Do not combine independently deployable enterprise capabilities | Compliant | This is a non-implementing index; MFA transaction/adoption, sudo create, sudo locking, and sudo edit/delete have separate specs |
| root PR workflow | Readiness requires exact review, implementation, test, and rollback evidence | Compliant | Enterprise-owned alternative work units require exact-head design approval and per-adopter merged PR/gates |
| `BACKWARD_COMPATIBILITY.md` | Runtime ids/contracts remain in implementing specs | Compliant | This index publishes no runtime contract |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | N/A | Coordination only |
| API contracts match UI/UX section | N/A | Dedicated adopter specs own behavior |
| Risks cover all coordinated units | Pass | License leakage, flag-day delivery, false readiness, and fail-open policy behavior are covered |
| Commands defined for all mutations | N/A | This index authorizes no implementation |
| Repository ownership is deterministic | Pass | Optional source presence cannot alter OSS artifacts; enterprise artifacts stay owner-local |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — valid as a non-implementing enterprise coordination index.

## Changelog

- **2026-10-27:** Added the independent link-verification prerequisite, moved source-derived enterprise inventory into an owner-scoped artifact, restricted OSS coordination to stable links, split MFA transaction hardening from its adopter, split sudo create from edit/delete at the finite-alternative work-unit boundary, and completed the mandatory compliance report.
- **2026-10-22:** Converted the combined security implementation draft into a non-implementing enterprise index and split MFA-reset, sudo-config locking, and sudo-config section adoption into independent commercial specs while retaining intentional inventory coverage.
