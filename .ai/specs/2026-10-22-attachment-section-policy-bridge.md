# Attachment section-policy bridge

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`, issue #6686

## TLDR

Extract the existing attachment create/delete behavior into shared server operations and expose additive, mandatory-policy façade routes. This gives section-policy adopters an exact attachment mutation capability without coupling a generic framework or a catalog adopter to attachment handler internals. Legacy attachment routes keep their current behavior.

## Overview

`POST /api/attachments` and `DELETE /api/attachments?id=:id` currently own authentication, `attachments.manage`, tenant/organization scope, validation, multipart limits, quota accounting, storage/cache cleanup, and CRUD side effects inside their route flow. A policy-enabled form cannot safely call those permissive legacy routes and cannot reuse them by invoking one HTTP handler from another.

The bridge extracts domain operations, keeps both legacy routes as adapters, and adds two façades that require an accepted section-policy token and resource binding before delegating to the same operations.

## Problem Statement

Bundling this extraction into the catalog product adopter would create an independently deployable shared API/security change inside a catalog-only spec. Duplicating the handler logic would also let the legacy and policy paths drift on ACL, quotas, cleanup, or events. The shared bridge must land first and publish stable facts that any eligible adopter can reference.

## Goals and Non-goals

### Goals

- Extract one create operation and one delete operation without changing observable legacy behavior.
- Add exact mandatory-policy façade routes and stable capability ids.
- Preserve authentication, `attachments.manage`, tenant/organization/resource scoping, multipart/size validation, quota recovery, storage/cache cleanup, events, and audit behavior.
- Reject policy, operation, resource, or surface mismatches before storage or database mutation.

### Non-goals

- Changing attachment storage, schemas, quotas, image processing, or URLs.
- Making legacy attachment routes require a section policy.
- Adding catalog-specific knowledge to the attachments module.
- Adding optimistic-lock tokens to attachment rows; absence of an entity-version lock does not weaken auth or policy checks.

## Proposed Solution

### Shared operations

Extract request-independent operations behind existing DI seams:

- `createAttachment(input, context)` accepts the validated multipart payload plus authenticated tenant/organization/resource scope and returns the current legacy result.
- `deleteAttachment(input, context)` accepts the validated attachment id plus authenticated tenant/organization/resource scope and returns the current legacy result.

Both operations own quota bookkeeping, storage/cache cleanup, persistence, events, and audit. Route adapters own HTTP parsing and response serialization. No route imports or calls another route handler.

### Stable policy surfaces

| Mutation surface id | Capability id | Method and route | Request operation | Mutation target |
|---|---|---|---|---|
| adopter-declared create surface | `attachments.section-policy.create/v1` | `POST /api/attachments/section-policy` | `attachment.create` | `attachments.attachment`, id absent |
| adopter-declared delete surface | `attachments.section-policy.delete/v1` | `DELETE /api/attachments/section-policy?id=:id` | `attachment.delete` | `attachments.attachment/<attachmentId>` |

The framework carrier asserts host, variant, form operation, contribution, and resolver-selected host resource; each request separately binds mutation surface, request operation, and the exact attachment target above. On create, validated multipart owner kind/id must equal the independently authorized host resource. On delete, the scoped attachment's stored owner kind/id must equal that reauthorized host and its id must equal the mutation target id. The attachment provider capability declares the two ids above and accepts an adopter surface only when those facts match exactly. The client rejects a custom protected-header collision before I/O, while the façade independently recomputes and reauthorizes received facts and never trusts header provenance.

### Failure contract

- Missing, stale, wrong-operation, wrong-resource, or undeclared policy identity: HTTP `409` with `{ "error": "extension_policy_mismatch", "code": "extension_policy_mismatch" }`; no storage/database mutation and no registry internals echoed.
- Unauthenticated/unauthorized: unchanged auth/feature response from the legacy path.
- Invalid multipart, size, entity, record, or id input: unchanged validation response from the legacy path.
- Scoped attachment not found: unchanged non-leaking not-found response.
- Storage/quota/provider failure: unchanged cleanup and error mapping.

## Architecture

| Area | Responsibility |
|---|---|
| attachments service/command layer | Extract create/delete operations and preserve all side effects |
| legacy attachment routes | Parse legacy HTTP input and call the shared operations unchanged |
| section-policy façade routes | Require exact policy/resource binding, then call the same operations |
| attachment extension facts | Publish the two versioned capabilities without adopter-specific ids |
| framework registry | Match adopter-declared mutation surfaces to provider capabilities |

No catalog import is permitted in the attachments module. Adopters own their mutation surface ids; attachments owns only the provider capability ids and request-operation names.

## Data Models

No entity, column, relation, index, or migration changes. The policy token and binding are request-local and never persisted in attachment metadata.

## API Contracts

The two façade routes are additive. Existing `/api/attachments` URLs, methods, request/response bodies, permissions, and side effects stay stable. Successful façade responses are structurally identical to their legacy counterpart so controls can switch transports without result translation.

The new façade routes require the framework's protected policy headers. They do not accept a policy in query/body data and do not treat a token as authentication. Existing auth, ACL, tenant/organization scope, and resource checks run independently.

## UI/UX

This spec adds no component or visible workflow. A policy-enabled adopter binds its existing upload/delete controls through `runSectionMutation`; a non-policy control continues using the legacy route.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Valid policy, missing `attachments.manage` | Permission denial; operation not called |
| Valid token for another resource | Exact policy mismatch 409 before I/O |
| Create surface used on delete route | Exact policy mismatch 409 before I/O |
| Quota reservation followed by storage failure | Existing quota recovery runs once |
| Delete cleanup fails | Existing error/cleanup behavior remains; no façade-specific branch |
| Legacy caller has no policy token | Legacy route remains unchanged |
| Adopter contribution is disabled | Provider remains registered but no accepted adopter surface is exposed |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Auth/scope regression during extraction | Critical | Golden legacy route tests plus cross-tenant integration tests | Future operation changes must test both adapters |
| Duplicate side effects | High | One shared operation, delegated exactly once | None accepted |
| Policy token treated as auth | High | Independent auth/feature/scope checks and denial tests | None accepted |
| Cleanup/quota drift | High | Failure-injection parity tests against legacy behavior | Provider-specific failures remain possible |
| Public route/id drift | Medium | Stable ids and deprecation protocol | Future evolution needs a versioned capability |

Before first publication the façade may be removed. After publication, operational rollback disables provider capability advertisement while preserving routes/types; removal follows the repository deprecation protocol.

## Migration & Backward Compatibility

The change is additive. No legacy route or response is narrowed. The create/delete operations are internal refactors whose tests must prove identical observable legacy behavior. The façade routes, capability ids, request-operation names, and documented imports become stable after release and require a deprecated bridge plus `UPGRADE_NOTES.md` before removal or rename.

## Phasing

1. Extract operations and pin legacy parity.
2. Add provider capabilities and mandatory-policy façades.
3. Add integration/security/failure coverage and documentation.

Each phase keeps the legacy routes operational. No adopter may declare the attachment capabilities until phase 2 is deployed.

## Implementation Plan

1. Capture golden create/delete responses, events, audit facts, quota calls, storage/cache calls, and error mappings for the legacy routes.
2. Extract the two operations through the attachments module's existing DI boundaries; update legacy routes to delegate exactly once.
3. Publish `attachments.section-policy.create/v1` and `attachments.section-policy.delete/v1` provider facts.
4. Add the two exact façade routes and validate auth/feature/scope first, then policy, operation, mutation surface, reauthorized host resource, and attachment target resource before delegation.
5. Add failure-injection tests for multipart rejection, quota rejection/recovery, storage failure, cache cleanup failure, missing attachment, permission denial, wrong tenant/org/resource, and provider call count.
6. Document adopter binding and run focused attachment tests/build, `yarn check:client-boundaries`, `git diff --check`, and the configured validation gate, recording every command and exit status.

## Integration Coverage

- Legacy `POST`/`DELETE`: golden request/response, events/audit, quota, storage/cache, and errors before versus after extraction.
- Policy façade `POST`/`DELETE`: valid binding, missing/stale/wrong surface/operation/resource token, exact mismatch body, delegated operation once.
- Security: unauthenticated, missing `attachments.manage`, wrong tenant/organization/record, and non-leaking not-found.
- Failure cleanup: quota/storage/cache injection proves the same recovery behavior on both adapters.

## Acceptance Criteria

1. Legacy attachment create/delete behavior remains observably identical for pinned inputs and failures.
2. Both façade routes reject every policy mismatch before I/O with the exact non-leaking 409 body.
3. Policy success still independently requires auth, `attachments.manage`, and correct tenant/organization/resource scope.
4. Legacy and façade routes call the same operation exactly once; no handler-to-handler call or duplicated domain logic exists.
5. No catalog/domain adopter import enters the attachments module.
6. Focused unit/integration/security/failure tests and the named validation gates pass.

## Final Compliance Report

| Area | Status | Evidence required before implementation PR approval |
|---|---|---|
| Scope cohesion | Ready | One shared attachment policy bridge; no adopter |
| Security/scoping | Ready | Independent auth/feature/tenant/org/resource gates |
| Compatibility | Ready | Additive façades; golden legacy parity |
| Failure safety | Ready | Quota/storage/cache injection and exact mismatch tests |
| Ownership | Ready | Implementation restricted to Open Mercato core team members |

## Changelog

- **2026-10-22:** Split the shared attachment operation extraction and mandatory-policy façades from the catalog product adopter, with exact ids, routes, security invariants, legacy parity, and failure coverage.
