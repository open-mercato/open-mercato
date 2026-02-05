# Onboarding Package — Agent Guidelines

`@open-mercato/onboarding` provides setup wizards and guided flows for new tenant provisioning.

## Structure

```
packages/onboarding/src/modules/onboarding/
├── api/          # Wizard step endpoints (GET/POST per step)
├── data/         # ORM entities for onboarding state
├── emails/       # Email templates (welcome, invitations)
├── frontend/     # Wizard UI components
├── i18n/         # Locale files
├── lib/          # Step logic, validation
└── migrations/   # Database migrations
```

## Wizard Architecture

Onboarding follows a multi-step wizard pattern:
- Each step has a GET endpoint (fetch current state) and POST endpoint (save & advance)
- Steps are ordered and may depend on previous step completion
- State is persisted per tenant/organization

## Integration with Module Setup

Onboarding invokes module `setup.ts` hooks during tenant creation:
1. `onTenantCreated` — after tenant/org is created
2. `seedDefaults` — structural/reference data
3. `seedExamples` — demo data (unless `--no-examples`)

See `packages/core/AGENTS.md` → Module Setup for the full `setup.ts` contract.

## i18n

All wizard copy lives in `i18n/<locale>.json`. Follow the standard i18n patterns — never hard-code user-facing strings.

## Email Templates

Welcome and invitation emails are in `emails/`. Use the shared email utilities from `@open-mercato/shared/lib/email`.
