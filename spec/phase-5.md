# Phase 5: App-Level Generation (.mercato)

**Goal:** Implement the `.mercato/` folder for app-level generation, with generators scanning installed packages from `node_modules`.

**Verification:** Dev mode works with `.mercato/` generation, generators scan packages correctly.

---

## Prerequisites

- [ ] Phase 4 completed (packages are publishable)
- [ ] All tests passing
- [ ] Clean git state

---

## Overview

This phase changes where generated files live and how generators discover modules:

**Current (before Phase 5):**
- Generated files: `apps/mercato/generated/`
- Module discovery: Scans local `packages/*/src/modules/`
- Import alias: `@/generated/*`

**Target (after Phase 5):**
- Generated files: `apps/mercato/.mercato/generated/`
- Module discovery: Scans `node_modules/@open-mercato/*/modules/`
- Import alias: `@/.mercato/generated/*` or `~mercato/*`

---

## Tasks

### 5.1 Create .mercato Directory Structure

```bash
mkdir -p apps/mercato/.mercato
```

Directory structure:
```
apps/mercato/.mercato/
├── generated/
│   ├── modules.generated.ts
│   ├── entities.generated.ts
│   ├── entities.ids.generated.ts
│   ├── di.generated.ts
│   ├── dashboard-widgets.generated.ts
│   ├── injection-widgets.generated.ts
│   ├── injection-tables.generated.ts
│   ├── vector.generated.ts
│   └── entities/
│       ├── customer/
│       │   └── index.ts
│       └── ...
└── cache/
    └── checksums.json
```

---

### 5.2 Update CLI Generate Command

The `mercato generate` command (from Phase 1) already has the resolver logic. This phase updates it to output to `.mercato/` in production mode.

The resolver from Phase 1 (`packages/cli/src/lib/resolver.ts`) determines:
- **Monorepo mode**: Output to `./generated/`
- **Production mode**: Output to `./.mercato/`

---

### 5.3 Update apps/mercato/tsconfig.json

Add path alias for .mercato:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@/.mercato/*": ["./.mercato/*"],
      "~mercato/*": ["./.mercato/*"]
    }
  }
}
```

---

### 5.4 Update Bootstrap Imports

**apps/mercato/src/bootstrap.ts:**

```typescript
// Change from:
// import { modules } from '@/generated/modules.generated'

// To:
import { modules } from '@/.mercato/generated/modules.generated'
import { entities } from '@/.mercato/generated/entities.generated'
import { diRegistrars } from '@/.mercato/generated/di.generated'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { dashboardWidgetEntries } from '@/.mercato/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'
import { vectorModuleConfigs } from '@/.mercato/generated/vector.generated'
```

---

### 5.5 Update Other Generated File Imports

Search and replace all `@/generated/` imports:

```bash
# Find all imports
grep -r "@/generated/" apps/mercato/src --include="*.ts" --include="*.tsx"

# Replace with
@/.mercato/generated/
```

Files to update:
- `src/app/api/[...slug]/route.ts`
- `src/app/(frontend)/[...slug]/page.tsx`
- `src/app/(backend)/backend/[...slug]/page.tsx`
- Any other files importing from generated/

---

### 5.6 Add .mercato to .gitignore

**apps/mercato/.gitignore:**

```gitignore
# Mercato generated files
.mercato/
```

Generated files should not be committed - they're rebuilt on `yarn dev` or `yarn build`.

---

### 5.7 Update Package Scripts

**apps/mercato/package.json:**

```json
{
  "scripts": {
    "predev": "mercato generate",
    "prebuild": "mercato generate",
    "dev": "next dev --turbopack",
    "build": "next build"
  }
}
```

---

### 5.8 Handle Dev Watch Mode

For hot reload during development, generators should watch for changes.

**Option A: File watcher in generators**

Add watch mode to generators:
```bash
mercato generate --watch
```

**Option B: Use nodemon/chokidar**

```json
{
  "scripts": {
    "modules:watch": "nodemon --watch node_modules/@open-mercato --ext ts,tsx -x 'mercato generate'"
  }
}
```

**Option C: Run generation before each dev start (simplest)**

The `predev` script handles this - regeneration happens on each `yarn dev`.

---

### 5.9 Scanning Built Packages vs Source

When scanning `node_modules/@open-mercato/*/dist/modules/`, the generators need to:

1. Read the built `.js` files for runtime behavior
2. Read `.d.ts` files for type information
3. Parse metadata from the compiled output

**Important**: Package builds must preserve enough information for generators:
- Export metadata objects
- Preserve file structure in dist/

---

### 5.10 Package Metadata Export

Packages should export metadata that generators can read:

**packages/core/src/modules/auth/index.ts:**
```typescript
export const metadata = {
  id: 'auth',
  name: 'Authentication',
  description: 'User authentication and authorization'
}
```

This gets compiled to `dist/modules/auth/index.js` and is readable by generators.

---

## Verification Steps

```bash
# 1. Clean old generated files
rm -rf apps/mercato/generated

# 2. Build all packages (so node_modules has dist/)
yarn build

# 3. Run generation
mercato generate

# 4. Verify .mercato exists
ls -la apps/mercato/.mercato/generated/

# 5. TypeScript check
yarn typecheck

# 6. Dev mode
yarn dev
# Verify app works at http://localhost:3000

# 7. Full build
yarn build

# 8. Test CLI
mercato --help
```

---

## Directory Structure After Phase 5

```
apps/mercato/
├── .mercato/                      # NEW - generated files
│   └── generated/
│       ├── modules.generated.ts
│       ├── entities.generated.ts
│       ├── entities.ids.generated.ts
│       ├── di.generated.ts
│       ├── dashboard-widgets.generated.ts
│       ├── injection-widgets.generated.ts
│       ├── injection-tables.generated.ts
│       ├── vector.generated.ts
│       └── entities/
├── src/
│   ├── app/
│   ├── modules/                   # App overrides only
│   ├── bootstrap.ts               # Updated imports
│   └── modules.ts                 # Module configuration
├── package.json
└── tsconfig.json
```

---

## Success Criteria

- [ ] Generators scan `node_modules/@open-mercato/*/dist/modules/`
- [ ] Generated files output to `.mercato/generated/`
- [ ] All imports updated to use `@/.mercato/generated/`
- [ ] `.mercato/` is gitignored
- [ ] `yarn dev` works with .mercato generation
- [ ] `yarn build` works
- [ ] Hot reload works (optional - depends on implementation)

---

## Next Phase

Once Phase 5 is complete, proceed to [Phase 6: Build Pipeline & Local Testing](./phase-6.md).
