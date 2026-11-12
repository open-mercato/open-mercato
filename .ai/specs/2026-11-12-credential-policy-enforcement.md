# Credential policy enforcement (#3821, PR #8582)

## TLDR
Enforce the configured shared password policy before storing supplied plaintext setup credentials and customer credentials. Preserve existing password hashes, login inputs, current-password verification, and trusted prehashed imports.

## Open Questions
Q1. Does a named maintainer approve an emergency security exception for the direct production `auth setup` bypass aliases and the six exported customer credential schemas, acknowledging the qualifying argument, client/operator migration and waiver of deprecation steps 1–3, or require a staged compatibility transition?

## Overview and Problem Statement
The existing setup service and customer credential schemas accept new passwords that fail the configured shared policy. A caller can create or replace a credential with a value prohibited by that policy. The existing PR closes those write paths; it does not rotate or invalidate stored credentials.

## Proposed Solution and Architecture
Use `buildPasswordSchema` before hashing or persistence in setup, validate explicit derived-account overrides, and use the shared schema for customer signup, invitation acceptance, password reset, password change, admin creation and admin reset. Keep the existing customer bounds of at least eight and at most 128 characters. Keep non-production disposable CLI demo bypasses and the trusted prehashed-import path. No data model, route name, ACL, event, dependency, or UI architecture changes.

## Migration & Backward Compatibility
**Decision pending; this document does not grant an exception.** The production-bootstrap exception in `2026-11-06-production-bootstrap-credentials.md` explicitly excludes direct `auth setup` and customer API contracts and cannot be reused here.

Protected surfaces are direct production `auth setup` flags `--skip-password-policy`, `--skipPasswordPolicy`, `--allow-weak-password`, and `--allowWeakPassword`; plaintext `setupInitialTenant` inputs; explicit derived-account password overrides; and exported `signupSchema`, `passwordResetConfirmSchema`, `invitationAcceptSchema`, `passwordChangeSchema`, `adminCreateUserSchema`, and `adminResetPasswordSchema`, including the HTTP requests they validate.

The proposed qualifying argument is that retaining acceptance of passwords prohibited by the configured policy retains the credential-policy bypass itself for the bridge window. Maintainer assessment must establish that this meets every emergency-exception condition; automation cannot supply that assessment. If accepted, add the required dated compatibility-contract entry and named approval record before merge. Otherwise choose a staged transition before modifying the security fix.

Clients must submit passwords satisfying the configured policy on signup, invitation acceptance, customer create/reset/change requests, and direct plaintext setup calls, and handle validation errors without retrying the rejected password. Operators must supply compliant primary and derived-account passwords, remove production reliance on bypass aliases, and handle primary CLI validation exit code 2. Existing hashes and login remain valid; operators should review credentials previously created through a bypass and rotate them through normal authorized flows when appropriate. No automatic migration or rotation is performed.

## Validation Plan
Retain the six-schema unit matrix, setup/alias/derived-account regressions and request-handler rejection-before-mutation checks. The executable customer regression covers weak admin creation/reset/change rejection, retained login and compliant reset/login. Current-head runtime coverage still needs signup, invitation acceptance, reset-confirm, compliant change, denied scope, retry, CLI setup, English/Polish and mobile evidence. Required CI and personal QA remain merge gates.

## Final Compliance Report
Source changes retain shared mechanisms and introduce no schema or dependency changes. Compatibility decision, exact-head validation and QA are pending. The spec remains a decision skeleton until Q1 is answered.

## Changelog
- 2026-11-12: Recorded the existing PR implementation, precise contract scope, proposed security-exception argument and pending maintainer decision.
