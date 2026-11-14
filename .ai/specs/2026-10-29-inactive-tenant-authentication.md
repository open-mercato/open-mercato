# Inactive tenant authentication

## TLDR

Issue #7813: an identity assigned to a tenant may authenticate only while that tenant exists, is active, and is not soft-deleted. Enforce this for staff and portal sign-in, session renewal and validation, and API keys, including successful cache hits.

## Overview

Tenant suspension is an authentication boundary. Reactivation restores eligibility without changing stored user credentials or session records. Tenantless staff identities and API keys retain their existing behavior. Portal identities always require a tenant. Staff validation checks the actor's owning tenant before any super-admin selection override.

## Problem Statement

Most authentication paths validate the user and session but omit the tenant. The existing unbound API-key check does not protect user-bound keys or cached successful authentication.

## Proposed Solution

Read the owning tenant through the existing encryption-aware data helpers with `id`, `isActive: true`, and `deletedAt: null`. Missing rows fail closed. Preserve each caller's existing generic authentication rejection. Do not change tenant resolution globally because registration and recovery routes also consume it.

## Architecture

Keep tenant checks at existing authentication boundaries. Staff session validation, credential login, session issuance, and refresh enforce tenant eligibility. Portal JWT validation covers API and server-rendered pages; password login, magic-link login, invitation acceptance, and refresh enforce the same eligibility. API-key authentication checks every key's tenant and rechecks positive cache hits before accepting a principal. Cache misses retain existing behavior; transient database errors remain authentication-resolution failures.

## Data Models

Use the existing directory Tenant fields. No migrations, entity changes, ORM relationships, or credential/session deletion are required.

## API Contracts

Existing URLs, methods, response shapes, and generic authentication messages remain unchanged. Suspended, deleted, and missing tenants cannot obtain or renew authenticated access. No tenant-state details are disclosed to unauthenticated clients.

## Migration & Backward Compatibility

No public signatures, token formats, ACL identifiers, or database contracts change. Deploying the fix makes tenant suspension effective on the next authentication check. Existing tenantless staff and key behavior and actor/effective super-admin scope handling are preserved.

## Implementation Plan

1. Add focused regression tests and tenant checks to staff authentication, portal authentication, and API-key validation.
2. Exercise active, inactive, soft-deleted, and missing tenants, including already-issued sessions and warm API-key caches. Add self-contained API integration coverage for the suspension lifecycle.
3. Run targeted tests and the configured validation gate, review the complete diff, publish one PR, and run the review workflow. Record unavailable validation explicitly.

## Risks & Impact Review

| Failure scenario | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| An alternate sign-in path omits the check | High | Cover magic links, invitations, staff session issuance, and refresh as well as password login | Downstream custom authenticators must enforce equivalent eligibility |
| Positive API-key cache permits access after suspension | High | Recheck live tenant status on successful cache hits | One additional small read per authenticated key request |
| Tenantless staff or super-admin selection behavior changes | Medium | Preserve null-tenant behavior and validate the actor tenant | Intentional cross-tenant administrative selection remains available |
| A database outage is mistaken for invalid credentials | Medium | Preserve existing fail-closed and transient error handling | Authentication remains unavailable while the database is unavailable |

## Validation

Unit coverage exercises staff login/autologin, session integrity and refresh/issuance; portal API and SSR user validation, login, magic link, invitations and refresh; and bound/unbound/cached API keys. The staff suite covers an unavailable actor tenant even when a super-admin has selected another tenant. The portal suite verifies that rejected magic links and invitations remain unused.

`packages/core/src/modules/auth/__integration__/TC-AUTH-070-inactive-tenant-authentication.spec.ts` creates its own tenant, organization, role, staff user, portal user, and API key, establishes authentication while active, then deactivates or soft-deletes the tenant. Both cases reject staff and portal login, session use and refresh, plus an already-cached API key. Cleanup uses a separate administrator. Playwright discovery confirms both cases; live execution requires an application and database. No UI-rendering changes are included.

## Final Compliance Report

Implemented the authentication checks with existing encryption-aware lookups and unchanged public signatures, token formats, ACLs, response shapes, and database schema. Independent review found no actionable code or compatibility issues. The staff, portal, and shared authentication subsets passed 1,806 distinct tests, with obsolete isolated fixtures updated and their failed suites rerun successfully. Runner: local, because Docker is unavailable.

Both package builds, generation, translation sync/usage checks, typechecking, application build, template parity and diff checks passed. The full workspace test command remains blocked on native Windows: the create-app suite reported 744 passed, 39 failed and 143 skipped, with failures including unavailable symlink privileges, POSIX path assumptions, and npm/Yarn subprocess execution. Its files are unchanged by this fix. An earlier docs Git ownership failure was resolved by rerunning outside the sandbox; all 23 docs tests then passed. Live API integration execution remains unverified because no application/database environment is running. Full validation requires a provisioned Linux runner.

## Changelog

- 2026-10-29: Defined the tenant suspension authentication contract and implementation/validation plan for #7813.
- 2026-10-29: Implemented staff, portal, and cached API-key checks, added regression and integration coverage, and completed independent code review.
