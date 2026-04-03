# Create App Package — Agent Guidelines

Use `packages/create-app` to scaffold standalone Open Mercato applications via `npx create-mercato-app my-app`.

## MUST Rules

1. **MUST test both environments** — verify changes work in monorepo (`yarn dev` / `yarn dev:verbose` when relevant) AND standalone app (via Verdaccio)
2. **MUST keep `@types/*` in `dependencies`** (not `devDependencies`) — standalone apps need type declarations at runtime
3. **MUST follow build order** — `yarn build:packages` → `yarn generate` → `yarn build:packages`
4. **MUST build before publishing** — generators scan `node_modules/@open-mercato/*/dist/modules/` for `.js` files
5. **MUST NOT break the standalone app template** — it's the user's first experience with Open Mercato
6. **MUST sync template equivalents when app shell/layout files change** — when touching `apps/mercato/src/app/**` bootstrap/layout/provider wiring, update matching files in `packages/create-app/template/src/app/**` (and required template components) in the same task
7. **MUST keep template module registrations and package dependencies aligned** — if `packages/create-app/template/src/modules.ts` enables a package-backed module (for example `@open-mercato/webhooks`), `packages/create-app/template/package.json.template` must install that package in the same change, and the template lockfile must be reviewed when dependency shape changes

## Standalone App vs Monorepo

| Aspect | Monorepo | Standalone App |
|--------|----------|----------------|
| Package source | Local workspace (`packages/`) | npm registry or Verdaccio |
| Package format | TypeScript source (`src/`) | Compiled JavaScript (`dist/`) |
| Generators read from | `src/modules/*.ts` | `dist/modules/*.js` |
| Module location | `apps/mercato/src/modules/` | `src/modules/` (app root) |

## Template Sync Checklist

When changes affect app shell behavior, verify all relevant template files are reviewed and updated:

1. `apps/mercato/src/app/layout.tsx` ↔ `packages/create-app/template/src/app/layout.tsx`
2. `apps/mercato/src/app/(backend)/backend/layout.tsx` ↔ `packages/create-app/template/src/app/(backend)/backend/layout.tsx`
3. `apps/mercato/src/components/*` wrappers used by layouts ↔ `packages/create-app/template/src/components/*`
4. `apps/mercato/scripts/dev.mjs` ↔ `packages/create-app/template/scripts/dev.mjs`

## Dev Runtime Expectations

- `yarn dev` is the compact runtime. It folds routine startup logs and lets the user press `d` to show or hide raw logs.
- `yarn dev:verbose` is the raw passthrough variant and MUST stay available for debugging.
- When changing dev DX, verify both monorepo and standalone runtimes still expose the same debugging escape hatches and startup states.

## Standalone App Structure

```
my-app/
├── src/
│   └── modules/           # User's custom modules (.ts files)
├── node_modules/
│   └── @open-mercato/     # Installed packages (compiled .js)
├── .mercato/
│   └── generated/         # Generated files from CLI
└── package.json
```

## Testing with Verdaccio

### Initial Setup

```bash
# Optional: create a registry user once if you want npm auth stored for Verdaccio
yarn registry:setup-user
```

### Fast Path via Root Scripts

```bash
# Smoke-test the standalone scaffold against Verdaccio
yarn test:create-app

# Run the standalone integration parity flow against Verdaccio
yarn test:create-app:integration
```

### Manual Verdaccio Workflow

```bash
docker compose up -d verdaccio
yarn registry:publish
node packages/create-app/dist/index.js /tmp/my-test-app --verdaccio
cd /tmp/my-test-app
yarn install
yarn setup
```

### When Publishing Changes

1. Make changes in monorepo packages
2. Use `yarn test:create-app` for the fast shell workflow, `yarn test:create-app:integration` for parity coverage, or the manual Verdaccio workflow when you want to keep a standalone app around
3. If you already have a standalone app checked out, rerun `yarn registry:publish`, then in that app run `rm -rf node_modules .mercato/next && yarn install && yarn dev`
4. Verify the app starts and affected features work
5. Test `yarn generate` produces correct output from compiled files

### Canary Releases

```bash
./scripts/release-snapshot.sh canary
# Creates version like: 0.4.9-canary.1523.abc1234567
npx create-mercato-app@0.4.9-canary.1523.abc1234567 my-test-app
```

### Cleanup

```bash
npm config delete @open-mercato:registry
docker stop verdaccio && docker rm verdaccio
```

## Agentic Setup Maintenance

The `agentic/` directory contains standalone-app-specific AI coding tool configurations. This content is **purpose-built for standalone apps** — it is NOT a copy of the monorepo's `.ai/` folder.

### Directory Structure

```
packages/create-app/agentic/
├── shared/                      # Always generated (AGENTS.md, .ai/ structure)
│   ├── AGENTS.md.template       # {{PROJECT_NAME}} placeholder substitution
│   └── ai/specs/                # Spec templates for standalone apps
├── claude-code/                 # Claude Code tool config
│   ├── CLAUDE.md.template       # {{PROJECT_NAME}} placeholder substitution
│   ├── settings.json            # PostToolUse hook registration
│   ├── hooks/entity-migration-check.ts  # TypeScript hook (requires tsx)
│   └── mcp.json.example
├── codex/                       # Codex tool config
│   ├── enforcement-rules.md     # Prepended to AGENTS.md with marker comments
│   └── mcp.json.example
└── cursor/                      # Cursor tool config
    ├── rules/*.mdc              # Glob-scoped rules (alwaysApply + entity/generated guards)
    ├── hooks.json               # afterFileEdit hook registration
    ├── hooks/entity-migration-check.mjs  # Plain ESM (no tsx dependency)
    └── mcp.json.example
```

### When to Update `agentic/`

- When module conventions change (entity lifecycle, migration workflow, `yarn generate` behavior)
- When adding new auto-discovery paths or module files
- When changing CLI commands that standalone apps use
- When the entity-migration hook logic needs adjustment

### Key Constraints

- `agentic/` files are static assets copied to `dist/agentic/` by `build.mjs` — they are NOT bundled by esbuild
- Generator code lives in `src/setup/tools/` — each tool has its own generator
- The Codex generator patches `AGENTS.md` (created by shared generator) — ordering matters
- `{{PROJECT_NAME}}` is the only placeholder; resolved from `path.basename(targetDir)`
- Cursor hook is `.mjs` (no tsx dep); Claude Code hook is `.ts` (needs tsx in devDependencies)
