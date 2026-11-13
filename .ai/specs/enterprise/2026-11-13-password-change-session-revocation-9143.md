# Enterprise password change credential revocation (#9143)

Status: Implemented; validation and deployment pending.

## TLDR / Overview

Self-service password change retains the authenticated caller's session and atomically invalidates other sessions and outstanding reset tokens. This restores the credential-revocation protection missing from the enterprise replacement of core password change.

## Problem Statement

`PUT /api/security/profile/password` changed only the password hash. Other browsers could keep refreshing credentials, and an outstanding password-reset link could overwrite the new password.

## Proposed Solution / Architecture

The existing command forwards its verified `auth.sid` as an optional fourth `PasswordService.changePassword` argument. The service opens an existing MikroORM transaction, freshly reads and locks the user, validates the current and proposed passwords, writes the hash, deletes sessions belonging to that user except the caller's session, and consumes that user's unused reset tokens. Existing security events are emitted after commit. With no session binding, all user sessions are revoked.

Preserving the caller's existing session avoids changing its signed JWT or refresh cookie. No replacement credentials or new response fields are necessary. Request-body session identifiers are ignored. Queries affect only the resolved user's globally unique ID; unrelated users and their tenants retain their credentials. Core auth remains unchanged.

## Data Models / API Contracts

No database schema, migration, endpoint, request/response shape, event, ACL, configuration or startup change. Existing three-argument service calls remain valid and revoke all sessions. Password checks, error statuses and existing event payloads remain unchanged.

## Migration & Backward Compatibility

The optional trailing session argument is additive. The intended security correction invalidates other sessions and outstanding reset links after a successful password change. Existing caller cookies continue working. No operator migration, production dependency or configuration change is required. Automerge eligibility: startup, configuration and architecture are unchanged; review, CI and any required QA gates still apply.

## Integration Coverage

`TC-SEC-016-password-revocation.spec.ts` creates users and reset-token fixtures, signs in two independent browsers and an unrelated user, then exercises `PUT /api/security/profile/password`, `GET /api/auth/profile`, `POST /api/auth/session/refresh`, `POST /api/auth/reset/validate`, `POST /api/auth/reset/confirm` and `POST /api/auth/login`. It checks wrong-password non-mutation, caller continuity, other-session rejection, reset rejection, unrelated-user isolation and old/new password behavior. Fixtures are cleaned up. Unit regressions cover absent session bindings, request-body spoofing and mutation/commit failures without success events. `PasswordService.pg.integration.test.ts` runs against disposable PostgreSQL (`OM_PG_INTEGRATION=1`), exercising real core auth refresh/reset consumers, another tenant, forced database rollback after session deletion and concurrent old-password verification. Its three cases passed locally.

## Risks & Impact Review

- High: preserving a request-selected session could retain an attacker. Mitigation: only the trusted command auth context supplies the exclusion.
- High: partial writes could leave a changed password with live stolen credentials. Mitigation: one transaction for all credential mutations, with events after commit.
- Medium: concurrent password changes could validate stale hashes. Mitigation: freshly read the user under its existing PostgreSQL row-lock architecture.
- Residual: legacy sid-less JWT validity remains governed by existing core expiry rules. Concurrent core reset/login writers are not redesigned by this module-local correction.

## Final Compliance Report

Enterprise-only source changes. No core edits, new entity relationships, dependencies, generated-file edits or local migrations. Full validation results are recorded on the PR; an unavailable runtime or failing repository gate is not a pass.

## Changelog

- 2026-11-13: Implemented scoped transactional credential invalidation and caller session preservation for #9143, with unit and API integration regressions.
