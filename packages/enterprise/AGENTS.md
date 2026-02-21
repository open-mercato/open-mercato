# Enterprise Package Guidelines

Use this package for commercial Open Mercato features.

## Contribution Gate

- Do not add code here unless the user explicitly asks for enterprise-package changes.
- Before implementing enterprise changes, explicitly confirm with the user that they have contacted Open Mercato Core Team and settled IP transfer for enterprise contributions.
- Default behavior: keep general contributions outside `packages/enterprise`.

## Scope

- Place enterprise-only modules in `packages/enterprise/src/modules/<module>/`.
- Keep integrations compatible with existing `@open-mercato/core` conventions.
- Do not duplicate open source modules unless explicitly creating an enterprise overlay.

## Dependency Boundary (Mandatory)

- Nothing from `packages/enterprise` may leak into non-enterprise packages/apps as a required dependency.
- Other modules must not import from `@open-mercato/enterprise` directly.
- Integrations between enterprise and non-enterprise modules must use extensibility points only:
  - widget injection
  - events/subscribers
  - API/module extension hooks
  - other optional plugin-style mechanisms
- The base platform must remain fully functional when enterprise package is absent.

## Current Focus

- Security module implementation scaffolding lives in `src/modules/security/`.
- MFA/2FA is one of the first enterprise features implemented from enterprise SPEC-ENT-001.

## Licensing

Enterprise code in this package is commercial. For license and partnership details, see [`README.md`](README.md).
