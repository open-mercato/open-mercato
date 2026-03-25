# Enterprise Specifications

This directory contains specifications for Open Mercato Enterprise Edition features.

These features are commercial and are not released under the open source license used by the main Open Mercato repository.

For licensing, permissions, and partnership details, see [`packages/enterprise/README.md`](../../../packages/enterprise/README.md).

## Naming

New enterprise specifications use `{YYYY-MM-DD}-{slug}.md`. The `enterprise/` directory defines the scope, so filename prefixes such as `SPEC-ENT-*` are no longer used for new files. Legacy numbered filenames may remain until they are intentionally normalized.

## Specification Directory

### Pending Specifications

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-ENT-002](SPEC-ENT-002-2026-02-17-mercato-health-endpoints.md) | 2026-02-17 | Mercato Health Endpoints | Health check and status endpoint specification for enterprise deployments |

### Implemented Specifications

Fully implemented. Canonical files live in [`implemented/`](implemented/).

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-ENT-001](implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md) | 2026-02-17 | Security Module (Enterprise MFA, Sudo, Enforcement) | Enterprise security module with pluggable MFA providers, enforcement policies, and sudo challenge flows |
| [SPEC-ENT-002](implemented/SPEC-ENT-002-2026-02-19-sso-directory-sync.md) | 2026-02-19 | SSO & Directory Sync Module | Enterprise SSO (OIDC/SAML) and SCIM directory sync architecture specification |
| [SPEC-ENT-003](implemented/SPEC-ENT-003-2026-01-23-record-locking-module.md) | 2026-01-23 | Enterprise Record Locking Module | Current implementation-accurate record locking specification |
| [SPEC-ENT-004](implemented/SPEC-ENT-004-2026-02-19-sso-directory-sync.md) | 2026-02-19 | SSO & Directory Sync Module (v2) | Enterprise SSO (OIDC/SAML) and SCIM directory sync architecture specification |
| [SPEC-ENT-005](implemented/SPEC-ENT-005-2026-02-20-enterprise-record-lock-extensibility.md) | 2026-02-20 | Enterprise Record Lock Extensibility | Historical pointer. Canonical mutation guard spec moved to OSS: [`SPEC-035`](../implemented/SPEC-035-2026-02-22-mutation-guard-mechanism.md) |
| [SPEC-ENT-006](implemented/SPEC-ENT-006-2026-03-01-qa-preview-deployment-dokploy.md) | 2026-03-01 | QA Preview Deployment (Dokploy) | Preview deployment infrastructure for QA using Dokploy |
| [SPEC-ENT-007](implemented/SPEC-ENT-007-2026-03-06-auth-login-interceptors-extension.md) | 2026-03-06 | Auth Login Interceptors Extension | Enterprise auth login interceptor extension points |
| [SPEC-ENT-008](implemented/SPEC-ENT-008-2026-03-08-mfa-challenge-ui-component-registry.md) | 2026-03-08 | MFA Challenge UI Component Registry | Provider-specific MFA challenge UI registry with generic fallback component resolution |
| [SPEC-ENT-009](implemented/SPEC-ENT-009-2026-03-08-mfa-enrollment-redirect-popup.md) | 2026-03-08 | MFA Enrollment Redirect & Popup | MFA enrollment redirect flow and popup UI for enterprise auth |
