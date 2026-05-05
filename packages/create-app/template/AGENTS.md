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
yarn db:generate    # Generate/probe migrations; keep or write only scoped SQL and update the touched snapshot
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

### Data Entities

- Define module entities in `src/modules/<module>/data/entities.ts`.
- Import entity decorators from `@mikro-orm/decorators/legacy`, not `@mikro-orm/core`.
- Treat `yarn db:generate` as a schema-diff probe. Default to the generated SQL, but if it emits unrelated churn, keep or write only the scoped SQL for the module you are changing and update `src/modules/<module>/migrations/.snapshot-open-mercato.json` in the same change.

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
- Treat `yarn db:generate` as a schema-diff probe. If it creates migrations for unrelated modules, delete that unrelated output and fix the stale snapshot instead of committing noise.
- Manual SQL is allowed when it is the only clean way to avoid unrelated churn, but the touched module's `.snapshot-open-mercato.json` MUST be updated to the post-change schema in the same change.
- For the specific entity change you are making, keep or write only the intended SQL migration and update `src/modules/<module>/migrations/.snapshot-open-mercato.json` to the post-change schema in the same change.
- Do not run `yarn db:migrate` unless the user explicitly asks you to apply migrations. A code change should carry migration files and snapshots; applying them is local database state.
- Editing an already-applied migration is risky: the next `yarn dev` / `yarn db:migrate` will skip the file (it is already marked applied), so your edits will not land in the database. If iteration is truly unavoidable:
  1. Set `OM_DEV_AUTO_MIGRATE=0` in `.env.local` to stop auto-apply.
  2. Roll back the migration (`yarn db:migrate --down` or reset the dev DB).
  3. Edit the migration file.
  4. Re-apply (`yarn db:migrate`) and commit.
- Never hand-edit historical migrations that have shipped; add a **new** migration that performs the correction instead.

## Disabling the Dashboards Module: Update /backend

The default `/backend` page (`src/app/(backend)/backend/page.tsx`) renders `<DashboardScreen />` from `@open-mercato/ui/backend/dashboard`. That component's data flow depends on the `dashboards` module being enabled — widgets, layouts, and the dashboard API routes all live there.

If you or the `trim-unused-modules` skill removes `dashboards` from `src/modules.ts`, you MUST also update `src/app/(backend)/backend/page.tsx` so it no longer renders `<DashboardScreen />`. Replace the body with a `redirect(...)` to the first backend page the current user can see — pick from the main sidebar group, fall back to `/backend/profile` when nothing else is enabled. Example:

```tsx
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { redirect } from 'next/navigation'

export default async function BackendIndex() {
  const auth = await getAuthFromCookies()
  if (!auth) redirect('/api/auth/session/refresh?redirect=/backend')
  // dashboards disabled — pick the first enabled backend page the user can reach
  redirect('/backend/customers/people') // replace with your project's landing page
}
```

Do this in the same change where you disable the module — otherwise `/backend` will crash at request time because `DashboardScreen` will be missing from the bundle (or, worse, will render but fail to load widgets).

## Feature Grants: New Features MUST Be Visible Immediately

Every time you add a new feature ID (e.g. `my_module.view`, `my_module.manage`) to `src/modules/<module>/acl.ts`, you MUST also:

1. **Add it to `defaultRoleFeatures`** in the same module's `setup.ts` so admin and superadmin roles receive it on every new tenant setup:

   ```ts
   // src/modules/<module>/setup.ts
   export const setup = {
     defaultRoleFeatures: {
       admin:      ['my_module.view', 'my_module.manage'],
       superadmin: ['my_module.view', 'my_module.manage'],
     },
     // ...
   }
   ```

2. **Reconcile existing tenants** by running the ACL sync command so existing installs pick up the new feature without a reinstall:

   ```bash
   yarn mercato auth sync-role-acls --all-tenants
   ```

Do this automatically unless the user has explicitly said otherwise. If the current user is an admin or superadmin, they should see the feature you just built — not stare at a blank admin because their role is missing the grant.

Feature IDs are FROZEN once shipped (they are stored in the DB as `role_features.feature_id`). If a rename is required, add the new ID, grant it, and keep the old one alongside as a deprecated alias until downstream data can be migrated.

## Design System (Strict — applies to every UI change)

All UI added or edited in `src/modules/<module>/backend/**` or `src/modules/<module>/frontend/**` MUST follow the Open Mercato design system. Non-compliant code will be blocked in `auto-review-pr`.

**Colors.** NEVER hardcode Tailwind status colors (`text-red-500`, `bg-green-100`, `text-amber-*`, `text-emerald-*`, `bg-blue-*`). Use semantic tokens: `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`, `text-status-info-icon`. For destructive actions (buttons) use the `destructive` token (`text-destructive`, `bg-destructive`). All status tokens have dedicated dark-mode values — no `dark:` overrides needed.

**Typography.** NEVER use arbitrary text sizes (`text-[11px]`, `text-[13px]`, `text-[15px]`). Use the Tailwind scale: `text-xs` (12), `text-sm` (14), `text-base` (16), `text-lg` (18), `text-xl` (20), `text-2xl` (24). For 11px uppercase labels use the `text-overline` token.

**Components to use instead of raw HTML.**

| I need to… | Use |
|---|---|
| Show inline error / success / warning / info | `<Alert variant="destructive\|success\|warning\|info">` |
| Show a toast | `flash('message', 'success\|error\|warning\|info')` |
| Confirm a destructive action | `useConfirmDialog()` |
| Display entity status (active / draft / archived) | `<StatusBadge variant={statusMap[status]} dot>` |
| Wrap a form input with label + error | `<FormField label="…" error={…}>` |
| Section header with count + action | `<SectionHeader title="…" count={n} action={…}>` |
| Collapsible section | `<CollapsibleSection title="…">…</CollapsibleSection>` |
| Loading state | `<LoadingMessage />`, `<Spinner />`, or `<DataLoader />` |
| Empty state | `<EmptyState>` (or `emptyState` prop on `DataTable`) |

**Icons (page body).** Use `lucide-react` for every icon inside page body UI (`Page`, `DataTable`, `CrudForm`, cards, buttons, etc.) — never inline `<svg>`. Sizes: `size-3`, `size-4` (default), `size-5`, `size-6`. Do not override `strokeWidth` per-instance. Icon-only buttons MUST have `aria-label`.

**Icons (`page.meta.ts`).** In `src/modules/<module>/backend/**/page.meta.ts` files, the `icon` field has a stricter contract — it is consumed by the sidebar renderer and must be a plain `React.createElement('svg', …)` tree, NOT a direct `lucide-react` import. After the lucide-react major upgrade, importing `{ IconName } from 'lucide-react'` inside a meta file can break page-metadata serialization and cause the sidebar to drop the icon. Use this pattern — which is the one currently used by `customers/people/page.meta.ts` and every other shipping module:

```ts
import React from 'react'

const myIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['my_module.view'],
  pageTitle: 'My Page',
  pageTitleKey: 'my_module.nav.title',
  icon: myIcon,
  // ...
}
```

Grab the `d="..."` path values from the lucide icon you want — for example by searching `lucide.dev/icons/<name>` — and inline them via `React.createElement('path', { d: '…' })`. This keeps the meta file free of runtime imports while preserving a consistent visual language.

**Dialogs.** Every dialog MUST submit on `Cmd/Ctrl+Enter` and cancel on `Escape`.

**Boy Scout rule.** When modifying a file that still has hardcoded status colors or arbitrary text sizes, migrate at minimum the lines you touched to semantic tokens.

## Agent Automation / Auto-Skills

This project ships four auto-* Claude Code skills under `.ai/skills/` that let you delegate whole units of work to an autonomous agent. They work inside your own repository (any default branch name, optional pipeline labels, and a validation gate that probes `package.json` for available scripts).

| Skill | When to use | Invocation |
|-------|-------------|------------|
| `auto-create-pr` | Delegate an arbitrary task end-to-end and receive it as a PR against your default branch | `claude "/auto-create-pr <task description>"` |
| `auto-continue-pr` | Resume an in-progress agent PR that wasn't finished in one run | `claude "/auto-continue-pr <PR#>"` |
| `auto-review-pr` | Run a thorough automated code review on a PR (with optional autofix) | `claude "/auto-review-pr <PR#>"` |
| `auto-fix-github` | Fix a GitHub issue by number and open a PR linked to it | `claude "/auto-fix-github <issue#>"` |
| `trim-unused-modules` | Propose disabling built-in modules you don't use (classic-mode slimdown after adding your own module) | `claude "/trim-unused-modules"` |

Notes:

- The skills probe `gh repo view --json defaultBranchRef` for your repo's default branch; no assumption that it's `main` or `develop`.
- Pipeline labels (`review`, `qa`, `merge-queue`, etc.) are opt-in — the skills detect which labels exist in your repo via `gh label list` and skip gracefully when they're missing. If you want the full workflow, the skill README in each skill folder has a `gh label create` snippet you can paste in once.
- The validation gate runs `yarn typecheck`, `yarn test`, `yarn generate`, and `yarn build` only when the corresponding `package.json` script exists.

The standalone template enables the `configs` module from `@open-mercato/core`, so `yarn mercato configs cache ...` is available here after installation. After structural changes such as enabling or disabling modules, adding or removing backend/frontend pages, or changing sidebar/navigation injections, run `yarn generate`. The generator now performs a best-effort structural cache purge automatically after successful generation; if the cache command is unavailable, generation still succeeds.

Detail/read-model APIs that expose `customFields` must return bare field keys via `normalizeCustomFieldResponse()` (for example `{ priority: 3 }`). Keep `cf_` / `cf:` prefixes for request payloads, filters, and form field IDs only.

### Path Aliases

- `@/*` → `./src/*`
- `@/.mercato/*` → `./.mercato/*`

### i18n

Translation files in `src/i18n/{locale}.json`. Supported locales: en, pl, es, de.

## Requirements

- Node.js >= 24
- Yarn (via corepack)
