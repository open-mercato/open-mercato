# Staff identity boundaries

## TLDR

Keep organization-limited administrative privileges scoped to their organization. Require a verified current password before a staff user changes their sign-in email. Bound staff login request bodies and raise the default minimum for new passwords.

## Overview

These changes cover permission projection, interactive staff profile updates, login request handling, and the default policy for new passwords. They apply to OSS staff authentication and continue to work with the enterprise MFA interceptor.

## Problem Statement

Global privileges must reflect the scope of the grant that confers them. Staff credential changes need fresh verification and an explicit end to previous sessions. Login needs a cheap bound before it parses a request, and new passwords need a stronger default.

## Proposed Solution

- Project platform administrator status only from unrestricted ACLs in the user's home tenant. A finite ACL can grant wildcard features inside an authorized organization. Apply the same distinction to canonical staff authentication, transaction-bound feature checks, and the allowed-organization projection.
- Verify the exact current password for a change of sign-in email or password. Check the verified password hash against the locked user row within the existing user update transaction. Revoke existing sessions for either change and unused password-reset links for an email change. After success, clear browser credentials and require a fresh sign-in.
- Check the trusted-address rate limit before reading the login body and cap the read at 16 KiB. Retain the existing identifier-scoped checks after parsing, including the fallback when no trusted address is available.
- Apply a 12-character default minimum and enforce bcrypt's 72 UTF-8 byte maximum when issuing a new staff password. Keep existing credentials valid.

## Architecture

The staff session resolver and RBAC service share scope predicates. A new cache namespace bypasses projections created by older code. The profile route passes server-side password verification proof through the command context, outside request data and command inputs. The existing user command holds the credential lock and owns the write and revocation. Password sign-in checks the verified credential snapshot while holding that same user row lock before inserting a session. Reset link issuance checks the sign-in email while holding the lock. Reset confirmation consumes the valid token, changes the password, and revokes sessions in one transaction under that lock. Federated SSO retains its provider authority and provenance checks. Login uses the shared bounded body reader for both URL-encoded and multipart forms.

## Data Models

The implementation uses the existing user, ACL, session, and password-reset models. It requires no database migration.

## API Contracts

`PUT /api/auth/profile` accepts the same request fields and returns the same success body. The existing field-level validation response now applies to missing or incorrect `currentPassword` on an email change. A successful email or password change expires both authentication cookies. `POST /api/auth/login` returns its standard error shape with HTTP 413 for oversized forms.

## Migration & Backward Compatibility

- Profile clients must supply the existing `currentPassword` field when changing the sign-in email or password and direct the user to sign in again after success. Passwordless SSO users should use their operator-managed identity update flow. An email change also expires unused reset links.
- Organization-scoped roles and overrides retain elevated feature access in their allowed scope. Tenant-wide administrative clients need a genuinely unrestricted administrative principal. Roll all application instances forward together so earlier permission projections do not continue answering requests.
- Login continues to accept multipart and URL-encoded forms. Integrations sending oversized forms should remove extraneous fields and handle HTTP 413. An explicitly chosen minimum still overrides the default. The byte ceiling applies to newly assigned passwords, and validators can return the new `maxBytes` requirement.

## Risks & Impact Review

Older profile clients may need to add their current-password prompt. Existing fixture or onboarding inputs with passwords below the new default need to use stronger values. A rate-limit deployment without a trustworthy client address still relies on the body cap and identifier-based limiting.

## Verification

Unit coverage checks canonical staff identity, scoped feature authorization, profile verification and cookie expiry, credential drift observed during session issuance, reset token consistency, pre-body login limiting, and password policy. `TC-AUTH-019` covers email update, revocation of existing access and refresh credentials, and fresh sign-in. The SSO session issuance suite covers the password proof and the unchanged provider-backed flow.

## Final Compliance Report

The changes preserve ACL shapes, token formats, request fields, response bodies, and database schemas. Authentication uses the existing localization and error handling. The profile mutation uses the normal command bus and credential writes remain transactional.

## Changelog

- 2026-11-24 — Define staff authorization scope, email-change verification, login payload limits, and the new default password minimum.
