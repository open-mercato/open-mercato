# Enterprise Package Guidelines

Use this package for commercial Open Mercato features.

## Scope

- Place enterprise-only modules in `packages/enterprise/src/modules/<module>/`.
- Keep integrations compatible with existing `@open-mercato/core` conventions.
- Do not duplicate open source modules unless explicitly creating an enterprise overlay.

## Current Focus

- Security module implementation scaffolding lives in `src/modules/security/`.
- MFA/2FA is one of the first enterprise features implemented from enterprise SPEC-019.

## Licensing

Enterprise code in this package is commercial. For license and partnership details, see [`README.md`](README.md).
