# Enterprise Specifications

This directory contains specifications for Open Mercato Enterprise Edition features.

These features are commercial and are not released under the open source license used by the main Open Mercato repository.

For licensing, permissions, and partnership details, see [`packages/enterprise/README.md`](../../../packages/enterprise/README.md).

## Naming

New enterprise specifications use `{YYYY-MM-DD}-{slug}.md`. The `enterprise/` directory defines the scope, so filename prefixes such as `SPEC-ENT-*` are no longer used for new files. Legacy numbered filenames may remain until they are intentionally normalized.

## Pending Specifications

Specs awaiting implementation or in design phase.

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [Health Endpoints](SPEC-ENT-002-2026-02-17-mercato-health-endpoints.md) | 2026-02-17 | Enterprise Health Endpoints | Liveness (`/api/health/live`) and readiness (`/api/health/ready`) endpoints for deployment orchestration |
| [DevCloud](DevCloud.md) | — | Developer's Cloud | Managed infrastructure service offering for Open Mercato clients |
| [Password Change](CONSIDERATION-password-change-integration-2026-03-05.md) | 2026-03-05 | Password Change Integration (Consideration) | Design decision for enterprise password change flow without modifying core |

## Implemented Specifications

Fully implemented and deployed. Canonical files live in [`implemented/`](implemented/).

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-ENT-001](implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md) | 2026-02-17 | Security Module (Enterprise MFA) | Pluggable MFA providers (TOTP, WebAuthn, OTP email), enforcement policies, and sudo challenge flows |
| [SPEC-ENT-002](implemented/SPEC-ENT-002-2026-02-19-sso-directory-sync.md) | 2026-02-19 | SSO & Directory Sync | OIDC/SAML 2.0 federated authentication with SCIM directory synchronization |
| [SPEC-ENT-003](implemented/SPEC-ENT-003-2026-01-23-record-locking-module.md) | 2026-01-23 | Enterprise Record Locking Module | Optimistic/pessimistic mutation protection with participant presence and conflict resolution |
| [SPEC-ENT-004](implemented/SPEC-ENT-004-2026-02-19-sso-directory-sync.md) | 2026-02-19 | SSO & Directory Sync (Alt) | Alternative SSO/SCIM architecture specification |
| [SPEC-ENT-005](implemented/SPEC-ENT-005-2026-02-20-enterprise-record-lock-extensibility.md) | 2026-02-20 | Enterprise Record Lock Extensibility (Moved) | Historical pointer; canonical mutation guard spec moved to OSS: [`SPEC-035`](../implemented/SPEC-035-2026-02-22-mutation-guard-mechanism.md) |
| [SPEC-ENT-006](implemented/SPEC-ENT-006-2026-03-01-qa-preview-deployment-dokploy.md) | 2026-03-01 | QA Preview Deployment (Dokploy) | GitHub Actions workflows for QA slot lifecycle with Docker preview images and Dokploy API |
| [SPEC-ENT-007](implemented/SPEC-ENT-007-2026-03-06-auth-login-interceptors-extension.md) | 2026-03-06 | Auth Login Interceptors Extension | MFA login gating via UMES/API extension points with zero core modifications |
| [SPEC-ENT-008](implemented/SPEC-ENT-008-2026-03-08-mfa-challenge-ui-component-registry.md) | 2026-03-08 | MFA Challenge UI Component Registry | Provider-specific MFA challenge UI with registry-based component resolution |
| [SPEC-ENT-009](implemented/SPEC-ENT-009-2026-03-08-mfa-enrollment-redirect-popup.md) | 2026-03-08 | MFA Enrollment Redirect Notice | Non-blocking notice bar for MFA enrollment redirect on profile security page |
