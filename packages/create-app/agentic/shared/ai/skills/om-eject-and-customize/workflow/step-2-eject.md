# Step 2 — Perform the Ejection

Once you have confirmed UMES cannot solve the problem and documented the reason, run the eject
command and verify the module is re-registered as local `@app` code.

## Run the eject command

```bash
yarn mercato module eject <module-id>
```

This copies the module from `node_modules/@open-mercato/core/dist/modules/<module-id>/` to
`src/modules/<module-id>/`.

The legacy alias `yarn mercato eject <module-id>` remains supported.

## Post-ejection steps

```bash
# 1. The module is automatically re-registered as '@app' source
# Verify in src/modules.ts:
grep '<module-id>' src/modules.ts
# Should show: { id: '<module-id>', from: '@app' }

# 2. Regenerate discovery files
yarn generate

# 3. Verify the app starts
yarn dev

# 4. Verify module functionality
# Test CRUD operations in the admin panel
```

## What gets ejected

The eject command copies **all module files** to your `src/modules/` directory:

```
src/modules/<module-id>/
├── index.ts           # Module metadata
├── acl.ts             # ACL features
├── setup.ts           # Tenant init, role defaults
├── di.ts              # DI registrations
├── events.ts          # Event declarations
├── entities/          # MikroORM entities
├── data/
│   ├── validators.ts  # Zod schemas
│   ├── enrichers.ts   # Response enrichers (if any)
│   └── extensions.ts  # Entity extensions (if any)
├── api/               # API route handlers
├── backend/           # Admin UI pages
├── frontend/          # Public pages (if any)
├── subscribers/       # Event handlers
├── workers/           # Background jobs
├── widgets/           # UI widgets
├── commands/          # Command pattern implementations
└── migrations/        # Database migrations
```

**Important**: After ejection, the npm package version of this module is no longer used. Your
local copy in `src/modules/` takes precedence. The original under
`node_modules/@open-mercato/core/dist/modules/` stays as a read-only reference for future upgrade
diffs (see Step 4) — never edit it; edit only your `src/modules/<module-id>/` copy.
