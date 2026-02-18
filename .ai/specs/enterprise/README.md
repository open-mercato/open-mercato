# Enterprise Specifications

This directory contains specifications for Open Mercato Enterprise Edition features.

These features are commercial and are not released under the open source license used by the main Open Mercato repository.

For licensing, permissions, and partnership details, see [`packages/enterprise/README.md`](../../../packages/enterprise/README.md).

## Numbering

Enterprise specifications are numbered independently from OSS specs and use the `SPEC-ENT-{number}` format, starting from `SPEC-ENT-001` in this folder.

## Specification Directory

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-ENT-001](SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md) | 2026-02-17 | Security Module (Enterprise MFA, Sudo, Enforcement) | Enterprise security module with pluggable MFA providers, enforcement policies, and sudo challenge flows |
| [SPEC-ENT-002](SPEC-ENT-002-2026-02-17-mercato-health-endpoints.md) | 2026-02-17 | Mercato Health Endpoints (`live`, `ready`) | Enterprise-only liveness/readiness probe endpoints with required and optional dependency checks |
