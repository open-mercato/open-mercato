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

- `index.ts` (metadata), `cli.ts`, `di.ts`, `acl.ts`, `setup.ts`, `ce.ts`
- `search.ts`, `events.ts`, `notifications.ts`, `ai-tools.ts`
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
npm run modules:prepare    # Same as generate (used in predev/prebuild)
```

## Database Migrations

Module-scoped migrations using MikroORM:

```bash
yarn db:generate   # Generate migrations for all modules (writes to src/modules/<module>/migrations/)
yarn db:migrate    # Apply all pending migrations (ordered, directory first)
```

**Never hand-write migration files.** Update ORM entities in `data/entities.ts`, then run `yarn db:generate` to emit SQL and keep snapshots in sync.

## Standalone App Considerations

In standalone apps, generators scan `node_modules/@open-mercato/*/dist/modules/` for compiled `.js` files (not `.ts` source). Ensure packages are built before publishing.

### Build Order

```bash
yarn build:packages   # Build packages first (CLI needs this)
yarn generate         # Run generators
yarn build:packages   # Rebuild with generated files
```

## Module Scaffolding

Each module has an optional `cli.ts` with a default export for module-specific CLI commands. These are auto-discovered and registered in `modules.cli.generated.ts`.

## Testing Generator Changes

After modifying generator logic, run the generator and verify the output files in `apps/mercato/.mercato/generated/`. Check that all expected modules, entities, and registrations appear correctly.
