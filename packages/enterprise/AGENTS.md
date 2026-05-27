# Enterprise Package Guidelines

Use this package for commercial Open Mercato features.

## Always

- Place enterprise-only modules in `packages/enterprise/src/modules/<module>/`.
- Keep integrations compatible with existing `@open-mercato/core` conventions.
- Keep any published `@types/*` packages required by exported enterprise sources in `dependencies`, not `devDependencies`, so standalone apps can typecheck installed packages.

## Ask First

- Ask before changing enterprise licensing boundaries, moving OSS code into enterprise-only modules, or exposing enterprise APIs as public contracts.
- Ask before duplicating an open source module as an enterprise overlay.

## Never

- Never duplicate open source modules unless explicitly creating an enterprise overlay.
- Never put commercial-only behavior into an OSS package as part of enterprise work.

## Validation Commands

```bash
yarn workspace @open-mercato/enterprise build
```

## Scope

- Enterprise-only modules live in `packages/enterprise/src/modules/<module>/`.
- Enterprise overlays must remain explicit and easy to distinguish from OSS modules.

## Current Focus

- Security module implementation scaffolding lives in `src/modules/security/`.
- MFA/2FA is one of the first enterprise features implemented from enterprise SPEC-ENT-001.

## Licensing

Enterprise code in this package is commercial. For license and partnership details, see [`README.md`](README.md).
