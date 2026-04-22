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
# Start compact dev runtime (press `d` to toggle raw logs)
yarn dev

# Start dev runtime with full raw passthrough logs
yarn dev:verbose

# Start the backward-compatible raw runtime with no splash screen
yarn dev:classic

# Run standalone bootstrap + startup in backward-compatible raw mode
yarn setup:classic

# Build for production
yarn build

# Run production server
yarn start

# Type checking
yarn typecheck

# Linting
yarn lint

# Run unit tests
yarn test

# Run a single unit test
yarn test path/to/test.spec.ts

# Run integration tests (spins up fresh ephemeral app + DB, runs Playwright)
yarn test:integration:ephemeral

# Start ephemeral app only (for manual QA exploration)
mercato test ephemeral

# View HTML integration test report
mercato test coverage

# Generate code from modules
yarn generate

# Manually purge structural navigation/sidebar caches when needed
yarn mercato configs cache structural --all-tenants

# Database operations
yarn db:generate    # Generate migrations
yarn db:migrate     # Run migrations
yarn db:greenfield  # Reset and recreate database

# Initialize/reinstall project
yarn initialize
yarn reinstall
```

## Dev Splash Features

- `yarn dev` serves the compact splash screen on `http://localhost:4000` by default and auto-opens it on supported local runs.
- When enabled, the splash can launch detected coding tools from the `Start coding with AI` menu.
- In standalone apps, the splash can also create or publish a GitHub repository through `gh` once the app is ready.

## Recommended Local Tooling

- GitHub CLI (`gh`) is recommended for the splash GitHub publish flow: <https://cli.github.com/>
- Codex CLI is recommended for the OpenAI terminal workflow surfaced by the splash: <https://developers.openai.com/codex/cli>
- Claude Code is recommended for the Anthropic terminal workflow surfaced by the splash: <https://code.claude.com/docs/en/setup>
- Visual Studio Code is the recommended general-purpose editor: <https://code.visualstudio.com/Download>
- Cursor is a recommended AI-first editor: <https://cursor.com/download>

## Dev Splash Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OM_DEV_SPLASH_PORT` | `4000` | Override the splash port. Use `random` or `0` for an ephemeral free port. |
| `OM_DEV_AUTO_OPEN` | `1` | Set to `0` to disable browser auto-open for the splash. |
| `OM_DEV_CREATE_GIT_REPO_FLOW` | `true` | Set to `false` to hide the standalone GitHub publish panel from the splash. |
| `OM_ENABLE_CODING_FLOW_FROM_SPLASH` | `true` | Set to `false` to hide the coding tools menu from the splash. |
| `OM_DEV_SPLASH_VSCODE_PATH` | auto-detect | Optional path override for the VS Code CLI. |
| `OM_DEV_SPLASH_CURSOR_PATH` | auto-detect | Optional path override for the Cursor CLI. |
| `OM_DEV_SPLASH_CLAUDE_CODE_PATH` | auto-detect | Optional path override for the Claude Code CLI. |
| `OM_DEV_SPLASH_CODEX_PATH` | auto-detect | Optional path override for the Codex CLI. |
| `OM_DEV_AUTO_MIGRATE` | `1` | When set to `1` (default), `yarn dev` runs `yarn db:migrate` once at startup before Next.js boots. Set to `0` to disable. See "Single-shot Database Migrations" below. |

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
Install official package-backed modules with `yarn mercato module add @open-mercato/<package>`.

### API Route Files MUST Export `metadata`

Every `src/modules/<module>/api/**/route.ts` file that exports an HTTP handler (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) MUST also export a `metadata` object describing per-method auth requirements. Omitting it triggers the generator warning:

```
[generate] ⚠ Route file exports handlers but no metadata — auth will default to required: <file>
```

…and the generated registry falls back to "authentication required" for every method, which hides misconfigurations rather than surfacing them. Always be explicit.

Correct shape — per-method, with `requireAuth` and optional `requireFeatures`:

```ts
// src/modules/<module>/api/<path>/route.ts
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['mymodule.view'] },
  POST: { requireAuth: true, requireFeatures: ['mymodule.manage'] },
}

export async function GET(request: Request) { /* ... */ }
export async function POST(request: Request) { /* ... */ }
```

Public (unauthenticated) endpoints must opt out explicitly:

```ts
export const metadata = {
  GET: { requireAuth: false },
}
```

Legacy top-level `export const requireAuth` / `export const requireFeatures` exports are NOT recognized by the registry generator — migrate any stragglers to the `metadata` object shape above.

### Single-shot Database Migrations

`yarn dev` auto-applies pending migrations at startup by default (see `OM_DEV_AUTO_MIGRATE` in the environment variables table). That means once a migration file has been committed to `src/modules/<module>/migrations/` and picked up by the dev server, it has likely already been applied to your local database.

Practical consequences:

- Prefer writing migration files in **one shot** — generate them with `yarn db:generate`, review, commit, move on.
- Editing an already-applied migration is risky: the next `yarn dev` / `yarn db:migrate` will skip the file (it is already marked applied), so your edits will not land in the database. If iteration is truly unavoidable:
  1. Set `OM_DEV_AUTO_MIGRATE=0` in `.env.local` to stop auto-apply.
  2. Roll back the migration (`yarn db:migrate --down` or reset the dev DB).
  3. Edit the migration file.
  4. Re-apply (`yarn db:migrate`) and commit.
- Never hand-edit historical migrations that have shipped; add a **new** migration that performs the correction instead.

## Agent Automation / Auto-Skills

This project ships four auto-* Claude Code skills under `.ai/skills/` that let you delegate whole units of work to an autonomous agent. They work inside your own repository (any default branch name, optional pipeline labels, and a validation gate that probes `package.json` for available scripts).

| Skill | When to use | Invocation |
|-------|-------------|------------|
| `auto-create-pr` | Delegate an arbitrary task end-to-end and receive it as a PR against your default branch | `claude "/auto-create-pr <task description>"` |
| `auto-continue-pr` | Resume an in-progress agent PR that wasn't finished in one run | `claude "/auto-continue-pr <PR#>"` |
| `auto-review-pr` | Run a thorough automated code review on a PR (with optional autofix) | `claude "/auto-review-pr <PR#>"` |
| `auto-fix-github` | Fix a GitHub issue by number and open a PR linked to it | `claude "/auto-fix-github <issue#>"` |

Notes:

- The skills probe `gh repo view --json defaultBranchRef` for your repo's default branch; no assumption that it's `main` or `develop`.
- Pipeline labels (`review`, `qa`, `merge-queue`, etc.) are opt-in — the skills detect which labels exist in your repo via `gh label list` and skip gracefully when they're missing. If you want the full workflow, the skill README in each skill folder has a `gh label create` snippet you can paste in once.
- The validation gate runs `yarn typecheck`, `yarn test`, `yarn generate`, and `yarn build` only when the corresponding `package.json` script exists.

The standalone template enables the `configs` module from `@open-mercato/core`, so `yarn mercato configs cache ...` is available here after installation. After structural changes such as enabling or disabling modules, adding or removing backend/frontend pages, or changing sidebar/navigation injections, run `yarn generate`. The generator now performs a best-effort structural cache purge automatically after successful generation; if the cache command is unavailable, generation still succeeds.

### Path Aliases

- `@/*` → `./src/*`
- `@/.mercato/*` → `./.mercato/*`

### i18n

Translation files in `src/i18n/{locale}.json`. Supported locales: en, pl, es, de.

## Requirements

- Node.js >= 24
- Yarn (via corepack)
