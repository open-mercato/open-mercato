# CLI Package — Agent Guidelines

`@open-mercato/cli` provides CLI tooling, module generators, and database migration commands.

## Always

1. Keep generator output deterministic and derived from module source files.
2. Run `yarn generate` after changing generator discovery or output.
3. Keep `.snapshot-open-mercato.json` in sync with intended module entity changes.
4. Keep standalone app generator contracts aligned across `packages/create-app`, template package scripts, and CLI testing paths.

## Ask First

- Ask before changing generated file locations, auto-discovery conventions, migration ordering, or CLI command contracts.
- Ask before applying migrations locally with `yarn db:migrate`; PRs normally include migration files and snapshots, not local DB state.

## Never

- Never commit unrelated generated migrations caused by stale snapshots in other modules.
- Never make generator post-steps fail generation when optional cache tooling is unavailable.
- Never use runtime imports in `generators.ts` plugin files.

## Validation Commands

```bash
yarn generate
yarn db:generate
yarn workspace @open-mercato/cli test
yarn workspace @open-mercato/cli build
```

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
- `api-routes.generated.ts`, `backend-routes.generated.ts` — public compatibility manifests; runtime registration uses full metadata facades whose `load()` resolves through private request-prefix shards
- `api-route-metadata.generated.ts`, `backend-route-metadata.generated.ts` — loader-free route metadata for shell/start-page consumers
- `dev-supervisor.generated.json` — primitive worker descriptors and scheduler availability used by `mercato server dev`
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

`yarn generate` performs a best-effort post-step structural invalidation when the app enables `configs`. The automatic path MUST remain bootstrap-free: it scans the configured stock cache backend's tenant metadata directly and refreshes generated artifacts without loading the generated CLI registry, ORM, request containers, or the application DI graph. This post-step must never break generation; unavailable cache tooling must be treated as a skip.

The structural invalidation does two things:

1. Deletes cache keys matching `nav:*` plus the admin/portal navigation CRUD cache shapes across all stored tenant scopes, so navigation/sidebar caches are rebuilt next render.
2. Touches every `*.generated.ts` and `*.generated.checksum` file in the current app's `.mercato/generated/` directory by rewriting them with identical bytes. This advances mtime without changing content, which forces Turbopack's filesystem watcher to invalidate the import graph and recompile leaf files that imported a barrel. Without this, Turbopack can keep serving a cached compile error against a since-fixed module file until the dev server is restarted.

The explicit `yarn mercato configs cache structural --all-tenants` command remains the DI-aware operator path. Use it when an app overrides the stock cache service through DI; the lightweight automatic path intentionally reads only the backend selected by the standard cache environment variables.

The dev escape hatch is `yarn dev:reset`, which clears the configured Next dev cache (`.mercato/next/dev`) plus legacy `.next` cache directories for the rare case where Turbopack's internal cache stays stuck after a structural purge.

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
Skills install into the canonical cross-agent directory `.agents/skills/`; only agents that cannot read it (Claude Code) get their own `.claude/skills/` symlinks, so `generateCodex`/`generateCursor` MUST NOT seed a skills directory. `packages/create-app/src/setup/tools/{claude-code,codex,cursor}.ts` and the `agentic-setup.ts` mirror are guarded by `packages/create-app/src/lib/agentic-skills-standalone-overlays.test.ts`.
The standalone QA config contract is `.ai/qa/tests/playwright.config.ts`; keep that path aligned across `packages/create-app/agentic/shared/`, `packages/create-app/template/package.json.template`, and `packages/cli/src/lib/testing/integration.ts`.
