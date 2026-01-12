# Phase 1: Scripts to CLI Migration

**Goal:** Migrate all generation scripts from `scripts/` into the CLI package as proper commands, with a resolution mechanism that supports both monorepo development and production (npm-installed packages).

**Verification:** `mercato generate` and `mercato db` commands work identically to the old scripts.

---

## Prerequisites

- [ ] Phase 0 completed (DI registration pattern implemented)
- [ ] All tests passing
- [ ] Clean git state

---

## Overview

This phase consolidates all generation scripts into the CLI package:

**Current state:**
- Generation scripts in `scripts/generate-*.ts`
- Database scripts in `scripts/mikro-modules.ts`
- Scripts reference packages via relative paths from root

**Target state:**
- Single `mercato generate` command for all generation
- `mercato db generate/migrate/greenfield` for database operations
- Package resolver that works in both monorepo and production modes
- `scripts/` directory cleaned up (only `typecheck.sh` remains)

---

## Tasks

### 1.1 Create Package Resolver

**File:** `packages/cli/src/lib/resolver.ts`

The resolver enables the CLI to work in both development (monorepo) and production (npm packages) modes:

```typescript
import path from 'node:path'
import fs from 'node:fs'

export type ModuleEntry = {
  id: string
  from?: '@app' | string
}

export type PackageInfo = {
  name: string
  path: string
  modulesPath: string
}

export type ModuleInfo = {
  id: string
  from: string
  appBase: string   // Filesystem path to app override
  pkgBase: string   // Filesystem path to package module
  appImport: string // Import path for app override
  pkgImport: string // Import path for package
}

export interface PackageResolver {
  isMonorepo(): boolean
  getRootDir(): string
  getOutputDir(): string
  discoverPackages(): PackageInfo[]
  loadEnabledModules(): ModuleEntry[]
  getModulePaths(entry: ModuleEntry): ModuleInfo
}

class MonorepoResolver implements PackageResolver {
  // Reads from ./packages/ directory
  // Outputs to ./generated/
}

class NodeModulesResolver implements PackageResolver {
  // Reads from node_modules/@open-mercato/*
  // Outputs to ./.mercato/
}

export function createResolver(options?: { rootDir?: string }): PackageResolver {
  const rootDir = options?.rootDir ?? process.cwd()
  const isMonorepo = fs.existsSync(path.join(rootDir, 'packages'))

  if (isMonorepo) {
    return new MonorepoResolver(rootDir)
  } else {
    return new NodeModulesResolver(rootDir)
  }
}
```

---

### 1.2 Create Generator Modules

Move generation logic from scripts into reusable modules:

**Files to create:**
- `packages/cli/src/lib/generators/entity-ids.ts`
- `packages/cli/src/lib/generators/module-registry.ts`
- `packages/cli/src/lib/generators/module-entities.ts`
- `packages/cli/src/lib/generators/module-di.ts`
- `packages/cli/src/lib/generators/api-client.ts`

Each generator:
1. Uses the resolver to discover packages and modules
2. Scans filesystem for relevant files
3. Generates output to the resolver's output directory

---

### 1.3 Create `mercato generate` Command

**File:** `packages/cli/src/commands/generate.ts`

Single command that runs all generation steps in order:

```typescript
import { createResolver } from '../lib/resolver'
import { generateEntityIds } from '../lib/generators/entity-ids'
import { generateModuleRegistry } from '../lib/generators/module-registry'
import { generateModuleEntities } from '../lib/generators/module-entities'
import { generateModuleDi } from '../lib/generators/module-di'
import { generateApiClient } from '../lib/generators/api-client'

export async function handleGenerateCommand(args: string[]) {
  const resolver = createResolver()
  const outputDir = resolver.getOutputDir()

  console.log(`Generating files to ${outputDir}...`)

  // Run generators in order
  await generateEntityIds(resolver)
  await generateModuleRegistry(resolver)
  await generateModuleEntities(resolver)
  await generateModuleDi(resolver)
  await generateApiClient(resolver)

  console.log('Generation complete!')
}
```

---

### 1.4 Create `mercato db` Command Group

**File:** `packages/cli/src/commands/db.ts`

Database command group with subcommands:

```typescript
export async function handleDbCommand(subcommand: string, args: string[]) {
  switch (subcommand) {
    case 'generate':
      // Generate migrations for schema changes
      await generateMigrations()
      break
    case 'migrate':
      // Apply pending migrations
      await applyMigrations()
      break
    case 'greenfield':
      // Reset database and migrations
      const confirmed = args.includes('--yes') || await confirmReset()
      if (confirmed) {
        await resetDatabase()
      }
      break
    default:
      console.error(`Unknown db subcommand: ${subcommand}`)
      process.exit(1)
  }
}
```

---

### 1.5 Wire Up Commands in Entry Point

**Update:** `packages/cli/src/mercato.ts`

```typescript
import { handleGenerateCommand } from './commands/generate'
import { handleDbCommand } from './commands/db'

// In the command dispatch section:
if (mod === 'generate') {
  return handleGenerateCommand(rest)
}

if (mod === 'db') {
  const [subcommand, ...subArgs] = rest
  return handleDbCommand(subcommand, subArgs)
}
```

---

### 1.6 Update package.json Scripts

**Update:** `package.json` (root)

```json
{
  "scripts": {
    "modules:prepare": "mercato generate",
    "db:generate": "mercato db generate",
    "db:migrate": "mercato generate && mercato db migrate",
    "db:greenfield": "mercato db greenfield"
  }
}
```

---

### 1.7 Add Dependencies to CLI Package

**Update:** `packages/cli/package.json`

```json
{
  "dependencies": {
    "openapi-typescript": "^7.0.0",
    "typescript": "^5.7.0",
    "fast-glob": "^3.3.0"
  }
}
```

---

### 1.8 Clean Up scripts/ Directory

After migration is verified, remove:
- `scripts/generate-entity-ids.ts`
- `scripts/generate-module-registry.ts`
- `scripts/generate-module-entities.ts`
- `scripts/generate-module-di.ts`
- `scripts/generate-api-client.ts`
- `scripts/mikro-modules.ts`
- `scripts/shared/` directory
- `scripts/test-client.ts`

Keep:
- `scripts/typecheck.sh` (shell script, not suitable for Node CLI)

---

## Verification Steps

```bash
# 1. Test generate command
mercato generate

# 2. Verify generated files exist
ls generated/

# 3. Test database commands
mercato db generate
mercato db migrate

# 4. Verify npm script aliases still work
yarn modules:prepare
yarn db:migrate

# 5. Compare output with old scripts
# (backup before migration, compare after)

# 6. Run full test suite
yarn test
yarn typecheck

# 7. Test dev mode
yarn dev
```

---

## Package Resolution Strategy

The resolver auto-detects mode by checking for `./packages/` directory:

### Monorepo Mode (Development)
- Scan `./packages/*/src/modules/` for package modules
- Read app modules from `./src/modules/`
- Write generated files to `./generated/`

### Production Mode (Installed Packages)
- Scan `node_modules/@open-mercato/*/dist/modules/`
- Read app modules from `./src/modules/`
- Write generated files to `./.mercato/` (or `./generated/`)

This enables the same CLI to work both during development and when packages are installed from npm.

---

## Success Criteria

- [ ] `mercato generate` produces identical output to old scripts
- [ ] `mercato db generate` works
- [ ] `mercato db migrate` works
- [ ] `mercato db greenfield` works with confirmation
- [ ] npm script aliases work (`yarn modules:prepare`, etc.)
- [ ] TypeScript passes
- [ ] Tests pass
- [ ] Dev mode works
- [ ] `scripts/` cleaned up (only `typecheck.sh` remains)

---

## Next Phase

Once Phase 1 is complete, proceed to [Phase 2: Turborepo Setup & Directory Restructure](./phase-2.md).
