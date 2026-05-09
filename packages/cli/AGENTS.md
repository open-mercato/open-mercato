# CLI Package — Agent Guidelines

`@open-mercato/cli` provides CLI tooling, module generators, and database migration commands.

## Structure

```
packages/cli/src/
├── lib/          # Generator logic, module discovery, file scanning
└── __tests__/    # Tests for generator output
```

## Generator System

The CLI auto-discovers module files across all packages and `apps/mercato/src/modules/`. It scans for:

- `index.ts` (metadata), `cli.ts`, `di.ts`, `acl.ts`, `setup.ts`, `encryption.ts`, `ce.ts`
- `search.ts`, `events.ts`, `notifications.ts`, `ai-tools.ts`
- `generators.ts` — module-level generator plugin declarations (see below)
- `data/entities.ts`, `data/extensions.ts`
- `api/`, `subscribers/`, `workers/`, `widgets/`

Generated output goes to `apps/mercato/.mercato/generated/`.

### Key Generated Files

- `modules.generated.ts` — routes, APIs, subscribers, workers, CLI
- `entities.generated.ts` — MikroORM entity registry
- `di.generated.ts` — DI registrars
- `entities.ids.generated.ts` — entity ID constants
- `search.generated.ts` — search configurations
- `dashboard-widgets.generated.ts`, `injection-widgets.generated.ts`, `injection-tables.generated.ts`
- `ai-tools.generated.ts` — AI tool definitions

### Running Generators

```bash
yarn generate              # Run all generators
```

`yarn generate` now performs a best-effort post-step structural cache purge by invoking `yarn mercato configs cache structural --all-tenants` when the generated app exposes the `configs` cache CLI. This post-step must never break generation; unavailable cache tooling must be treated as a skip.

The structural cache purge does two things:

1. Deletes Redis cache keys matching `nav:*` so navigation/sidebar caches are rebuilt next render.
2. Touches every `*.generated.ts` and `*.generated.checksum` file in the current app's `.mercato/generated/` directory by rewriting them with identical bytes. This advances mtime without changing content, which forces Turbopack's filesystem watcher to invalidate the import graph and recompile leaf files that imported a barrel. Without this, Turbopack can keep serving a cached compile error against a since-fixed module file until the dev server is restarted.

The dev escape hatch is `yarn dev:reset`, which clears `.next/cache/turbopack` and `.next/cache/webpack` for the rare case where Turbopack's internal cache stays stuck after a structural purge.

## Database Migrations

Module-scoped migrations using MikroORM:

```bash
yarn db:generate   # Generate migrations for all modules (writes to src/modules/<module>/migrations/)
yarn db:migrate    # Apply all pending migrations (ordered, directory first)
```

Default workflow: update ORM entities in `data/entities.ts`, then run `yarn db:generate` to emit SQL and keep `.snapshot-open-mercato.json` in sync.

Coding-agent exception: if `yarn db:generate` emits unrelated migrations because another module's snapshot is stale, do not commit the noise. Delete unrelated generated files, keep or write only the SQL for the intended entity change, and update the affected module's `migrations/.snapshot-open-mercato.json` to the post-change schema. The snapshot update is mandatory; without it, standalone apps will regenerate already-committed migrations.

Do not run `yarn db:migrate` as part of generation unless the user explicitly asks to apply migrations. A PR should normally include the migration file plus snapshot, not depend on local DB state.

## Standalone App Considerations

In standalone apps, generators scan `node_modules/@open-mercato/*/dist/modules/` for compiled `.js` files (not `.ts` source). Ensure packages are built before publishing.

### Build Order

```bash
yarn build:packages   # Build packages first (CLI needs this)
yarn generate         # Run generators
yarn build:packages   # Rebuild with generated files
```

## Scriptable Tenant Provisioning (`mercato test:bootstrap-tenant`)

Mints a fully-provisioned tenant — Tenant + Organization + admin User + role
ACLs + every module's `onTenantCreated` lifecycle hook — against an existing
OM instance, without sitting in front of the interactive `mercato init` prompts.

```bash
mercato test:bootstrap-tenant \
  --slug <slug> \
  --org-name <name> \
  --admin-email <email> \
  --admin-password <password> \
  [--admin-display-name <name>] \
  [--with-examples]
```

Outputs a single JSON object on stdout:

```json
{ "tenantId": "...", "organizationId": "...", "adminUserId": "...", "adminEmail": "..." }
```

All four flagged values are required — there are no test-friendly defaults so
production callers (customer onboarding, disaster recovery, staging seeding,
sales-engineering demo provisioning) are forced to pass real, deliberate
values. Slug collisions exit non-zero with `TENANT_SLUG_EXISTS` and never
silently overwrite or merge into an existing tenant. Banner / progress output
goes to stderr (or is suppressed via `OM_CLI_QUIET=1`) so consumers can pipe
the JSON directly into `jq` or downstream scripts.

The subcommand is a thin wrapper around the same internal `setupInitialTenant`
helper used by `mercato init` and `mercato auth setup`; behaviour parity is
guaranteed by construction.

## Module Scaffolding

Each module has an optional `cli.ts` with a default export for module-specific CLI commands. These are auto-discovered and registered in `modules.cli.generated.ts`.

## Generator Plugins (`generators.ts`)

Modules can declare additional aggregated output files by exporting `generatorPlugins: GeneratorPlugin[]` from a `generators.ts` file at the module root. The CLI discovers these at generation time via dynamic import and drives the extra output files without any hardcoded knowledge in the CLI package.

```typescript
// src/modules/<module>/generators.ts
import type { GeneratorPlugin } from '@open-mercato/shared/modules/generators'

function buildMyOutput({ importSection, entriesLiteral }: { importSection: string; entriesLiteral: string }): string {
  return `// AUTO-GENERATED by mercato generate registry
${importSection ? `${importSection}\n` : ''}export const myItemEntries = [
${entriesLiteral ? `  ${entriesLiteral}\n` : ''}]
`
}

export const generatorPlugins: GeneratorPlugin[] = [
  {
    id: 'mymodule.my-registry',           // unique ID — first declaration wins
    conventionFile: 'mymodule.items.ts',  // file to look for in every module
    importPrefix: 'MYMODULE_ITEMS',
    configExpr: (importName: string, moduleId: string) =>
      `{ moduleId: '${moduleId}', items: (${importName}.default ?? ${importName}.myItems ?? []) }`,
    outputFileName: 'mymodule-items.generated.ts',
    buildOutput: buildMyOutput,
  },
]
```

Rules:
- MUST only use `import type` (no runtime imports) so the file is safe to execute at generation time
- The `id` is deduped across modules; the first registered definition wins
- If a module is disabled, its `generators.ts` is never loaded, so its output files are not written

## Testing Generator Changes

After modifying generator logic, run the generator and verify the output files in `apps/mercato/.mercato/generated/`. Check that all expected modules, entities, and registrations appear correctly.

When `packages/create-app/agentic/` or standalone guide discovery changes, keep `packages/cli/src/lib/agentic-setup.ts` and `packages/cli/build.mjs` in sync so `yarn mercato agentic:init` matches newly scaffolded standalone apps.
The standalone QA config contract is `.ai/qa/tests/playwright.config.ts`; keep that path aligned across `packages/create-app/agentic/shared/`, `packages/create-app/template/package.json.template`, and `packages/cli/src/lib/testing/integration.ts`.
