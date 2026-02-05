# Standalone Open Mercato Application

This is a **standalone application** that consumes Open Mercato packages from the npm registry. Unlike the monorepo development environment, packages here are pre-compiled and installed as dependencies.

## Package Source Files

To explore or understand the Open Mercato framework code:

- **Location**: `node_modules/@open-mercato/*/dist/` contains compiled JavaScript
- **Source exploration**: Search `node_modules/@open-mercato/` for module implementations
- **Key packages**:
  - `@open-mercato/core` - Core business modules (auth, customers, catalog, sales, etc.)
  - `@open-mercato/shared` - Shared utilities, types, DSL helpers, i18n
  - `@open-mercato/ui` - UI components and primitives
  - `@open-mercato/cli` - CLI tooling (mercato command)
  - `@open-mercato/search` - Search module (fulltext, vector, tokens)

**Note**: When debugging or extending functionality, reference the compiled code in `node_modules/@open-mercato/` to understand the framework's implementation details.

## Development Commands

```bash
# Start development server
yarn dev

# Build for production
yarn build

# Run production server
yarn start

# Type checking
yarn typecheck

# Linting
yarn lint

# Run tests
yarn test

# Run a single test
yarn test path/to/test.spec.ts

# Generate code from modules
yarn generate

# Database operations
yarn db:generate    # Generate migrations
yarn db:migrate     # Run migrations
yarn db:greenfield  # Reset and recreate database

# Initialize/reinstall project
yarn initialize
yarn reinstall
```

## Infrastructure

Start required services via Docker Compose:
```bash
docker compose up -d
```

Services: PostgreSQL (pgvector), Redis, Meilisearch

## Architecture

### Open Mercato Framework

This is a Next.js 16 application built on the **Open Mercato** modular ERP framework. The framework provides:

- **Module system**: Business modules (auth, customers, catalog, sales, etc.) from `@open-mercato/*` packages
- **Entity system**: MikroORM entities with code generation
- **DI container**: Awilix-based dependency injection
- **RBAC**: Role-based access control with feature flags

### Key Files

- `src/modules.ts` - Declares enabled modules and their sources (`@open-mercato/core`, `@open-mercato/*`, or `@app`)
- `src/di.ts` - App-level DI overrides (runs after core/module registrations)
- `src/bootstrap.ts` - Application initialization (imports generated files, registers i18n)
- `.mercato/generated/` - Auto-generated files from `yarn generate` (do not edit manually)

### Routing Structure

- `/backend/*` - Admin panel routes (AppShell with sidebar navigation)
- `/(frontend)/*` - Public-facing routes
- `/api/*` - API routes with automatic module routing via `findApi()`

### Module Development

Custom modules go in `src/modules/`. Each module can define:
- Entities (MikroORM)
- API routes
- Backend/frontend pages
- DI registrations
- Navigation entries

Add new modules to `src/modules.ts` with `from: '@app'`.

### Path Aliases

- `@/*` → `./src/*`
- `@/.mercato/*` → `./.mercato/*`

### i18n

Translation files in `src/i18n/{locale}.json`. Supported locales: en, pl, es, de.

## Requirements

- Node.js >= 24
- Yarn (via corepack)
