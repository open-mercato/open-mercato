# Onboarding Package — Agent Guidelines

Use `@open-mercato/onboarding` for setup wizards and guided flows during new tenant provisioning.

## Always

1. **MUST keep wizard steps idempotent** — re-running a step MUST NOT create duplicate data
2. **MUST persist state per tenant/organization** — use the ORM entities in `data/`
3. **MUST use shared email utilities** from `@open-mercato/shared/lib/email` for welcome/invitation emails
4. Keep all wizard copy in `i18n/<locale>.json`.

## Ask First

- Ask before changing tenant-creation ordering, default seeded data, or welcome/invitation email semantics.
- Ask before adding a wizard step that depends on external credentials or paid services.

## Never

- Never hard-code user-facing wizard or email strings.
- Never make a step accessible before its predecessor is complete.
- Never create duplicate tenant data when a step is retried.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/onboarding build
```

## Rules for Wizard Steps

- Each step MUST have a GET endpoint (fetch current state) and POST endpoint (save & advance)
- Steps are ordered — a step MUST NOT be accessible until its predecessor is complete
- Step validation logic lives in `lib/` — keep API handlers thin
- Frontend components in `frontend/` render each step's UI

## Adding a New Onboarding Step

1. Create step logic in `lib/<step-name>.ts` with validation and save functions
2. Add GET endpoint in `api/<step-name>/get/route.ts` to fetch current state
3. Add POST endpoint in `api/<step-name>/post/route.ts` to save and advance
4. Create frontend component in `frontend/<step-name>/page.tsx`
5. Add translations to `i18n/<locale>.json`
6. Register the step in the wizard step ordering configuration
7. Run `yarn generate`

## Module Setup Integration

Onboarding invokes module `setup.ts` hooks during tenant creation. Follow these rules:

| Hook | When it runs | MUST rules |
|------|-------------|------------|
| `onTenantCreated` | After tenant/org is created | MUST be idempotent — settings rows, sequences |
| `seedDefaults` | During init/onboarding | MUST seed structural/reference data (dictionaries, statuses) |
| `seedExamples` | During init/onboarding | MUST skip when `--no-examples` is set |

See `packages/core/AGENTS.md` → Module Setup for the full `setup.ts` contract.

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

## When Modifying Email Templates

- Templates live in `emails/` — use the shared email utilities from `@open-mercato/shared/lib/email`
- Keep email content translatable — reference i18n keys, not hardcoded strings
- Test email rendering before committing
