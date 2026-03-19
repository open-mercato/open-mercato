# Enterprise Specifications

This directory contains specifications for Open Mercato Enterprise Edition features.

These features are commercial and are not released under the open source license used by the main Open Mercato repository.

For licensing, permissions, and partnership details, see [`packages/enterprise/README.md`](../../../packages/enterprise/README.md).

## Naming

New enterprise specifications use `{YYYY-MM-DD}-{slug}.md`. The `enterprise/` directory defines the scope, so filename prefixes such as `SPEC-ENT-*` are no longer used for new files. Legacy numbered filenames may remain until they are intentionally normalized.

## Specification Directory

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-ENT-001](SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md) | 2026-02-17 | Security Module (Enterprise MFA, Sudo, Enforcement) | Enterprise security module with pluggable MFA providers, enforcement policies, and sudo challenge flows |
| [SPEC-ENT-002](SPEC-ENT-005-2026-02-20-enterprise-record-lock-extensibility.md) | 2026-02-20 | Enterprise Record Lock Extensibility (Moved) | Historical pointer. Canonical mutation guard spec moved to OSS: [`SPEC-035`](../SPEC-035-2026-02-22-mutation-guard-mechanism.md) |
| [SPEC-ENT-003](SPEC-ENT-003-2026-01-23-record-locking-module.md) | 2026-01-23 | Enterprise Record Locking Module | Current implementation-accurate record locking specification |
| [SPEC-ENT-004](SPEC-ENT-004-2026-02-19-sso-directory-sync.md) | 2026-02-19 | SSO & Directory Sync Module | Enterprise SSO (OIDC/SAML) and SCIM directory sync architecture specification |
| [SPEC-ENT-008](SPEC-ENT-008-2026-03-08-mfa-challenge-ui-component-registry.md) | 2026-03-08 | MFA Challenge UI Component Registry | Provider-specific MFA challenge UI registry with generic fallback component resolution |
