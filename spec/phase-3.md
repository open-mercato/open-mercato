# Phase 3: Package Independence - Remove Path Mappings

**Goal:** Make each package fully independent by removing tsconfig path mappings and ensuring packages reference each other via proper npm dependencies.

**Verification:** Build succeeds, all imports resolve correctly without path aliases.

---

## Prerequisites

- [ ] Phase 2 completed (directory restructure done)
- [ ] All tests passing
- [ ] Clean git state

---

## Overview

Currently packages rely on tsconfig path mappings like:
```json
{
  "paths": {
    "@open-mercato/core/*": ["./packages/core/src/*"],
    "@open-mercato/shared/*": ["./packages/shared/src/*"]
  }
}
```

This prevents packages from being published because:
1. Path mappings only work in the monorepo
2. Published packages can't resolve these paths
3. Consumers won't have access to source files

This phase configures packages with proper `exports` fields and dependencies.

---

## Tasks

### 3.1 Update Each Package's package.json

Each package needs proper npm package configuration.

#### Template for Publishable Package

```json
{
  "name": "@open-mercato/shared",
  "version": "0.3.12",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./lib/*": {
      "types": "./dist/lib/*.d.ts",
      "import": "./dist/lib/*.js"
    },
    "./modules/*": {
      "types": "./dist/modules/*.d.ts",
      "import": "./dist/modules/*.js"
    }
  },
  "files": [
    "dist",
    "generated"
  ],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "dev": "tsup --watch"
  },
  "dependencies": {
    // Inter-package dependencies
  },
  "peerDependencies": {
    // Peer dependencies (react, next, etc.)
  }
}
```

---

### 3.2 Configure Each Package

#### packages/shared/package.json

```json
{
  "name": "@open-mercato/shared",
  "version": "0.3.12",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./lib/*": {
      "types": "./dist/lib/*.d.ts",
      "import": "./dist/lib/*.js"
    },
    "./modules/*": {
      "types": "./dist/modules/*.d.ts",
      "import": "./dist/modules/*.js"
    },
    "./types/*": {
      "types": "./dist/types/*.d.ts",
      "import": "./dist/types/*.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts src/lib/**/*.ts src/modules/**/*.ts src/types/**/*.ts --format esm --dts",
    "typecheck": "tsc --noEmit",
    "dev": "tsup --watch"
  }
}
```

#### packages/core/package.json

```json
{
  "name": "@open-mercato/core",
  "version": "0.3.12",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./modules/*": {
      "types": "./dist/modules/*.d.ts",
      "import": "./dist/modules/*.js"
    },
    "./generated/*": {
      "types": "./generated/*.d.ts",
      "import": "./generated/*.js"
    }
  },
  "files": ["dist", "generated"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@open-mercato/shared": "workspace:*"
  }
}
```

#### packages/ui/package.json

```json
{
  "name": "@open-mercato/ui",
  "version": "0.3.12",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./backend/*": {
      "types": "./dist/backend/*.d.ts",
      "import": "./dist/backend/*.js"
    },
    "./components/*": {
      "types": "./dist/components/*.d.ts",
      "import": "./dist/components/*.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@open-mercato/shared": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

#### packages/cli/package.json

```json
{
  "name": "@open-mercato/cli",
  "version": "0.3.12",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "mercato": "./dist/bin/mercato.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts src/mercato.ts --format esm --dts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@open-mercato/shared": "workspace:*",
    "@open-mercato/core": "workspace:*"
  }
}
```

---

### 3.3 Add tsup Configuration

Each package needs a `tsup.config.ts`:

**packages/shared/tsup.config.ts:**
```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/lib/**/*.ts',
    'src/modules/**/*.ts',
    'src/types/**/*.ts'
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    // External dependencies
    'awilix',
    '@mikro-orm/core',
    '@mikro-orm/postgresql'
  ]
})
```

**packages/core/tsup.config.ts:**
```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/modules/**/*.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    '@open-mercato/shared',
    'awilix',
    '@mikro-orm/core'
  ]
})
```

---

### 3.4 Add tsup as Dev Dependency

```bash
yarn add -D tsup -W
```

Or add to each package:
```bash
cd packages/shared && yarn add -D tsup
cd packages/core && yarn add -D tsup
# etc.
```

---

### 3.5 Update Package tsconfig.json Files

Each package's tsconfig should extend from root but NOT have path mappings.

**packages/shared/tsconfig.json:**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

---

### 3.6 Remove Path Mappings from Root

The root `tsconfig.base.json` should NOT have any `@open-mercato/*` paths.

Any remaining `@/*` paths should only exist in `apps/mercato/tsconfig.json` for app-specific aliases.

---

### 3.7 Update Import Statements

Some imports may need updating if they relied on path mappings.

**Before:**
```typescript
import { something } from '@open-mercato/shared/lib/utils'
```

**After (same, but resolved via exports):**
```typescript
import { something } from '@open-mercato/shared/lib/utils'
```

The import syntax stays the same, but now resolves via the `exports` field instead of path mappings.

---

### 3.8 Handle Internal Package Imports

Within a package, use relative imports:

**Before (packages/core/src/modules/auth/service.ts):**
```typescript
import { helpers } from '@open-mercato/core/modules/common/helpers'
```

**After:**
```typescript
import { helpers } from '../common/helpers'
```

---

### 3.9 Update Turbo Build Pipeline

Ensure packages build in dependency order:

**turbo.json:**
```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

This ensures `@open-mercato/shared` builds before `@open-mercato/core` (which depends on it).

---

## Verification Steps

```bash
# 1. Install dependencies
yarn install

# 2. Build all packages
yarn build

# 3. Verify dist folders created
ls packages/shared/dist
ls packages/core/dist
ls packages/ui/dist

# 4. TypeScript check (should find no path mapping errors)
yarn typecheck

# 5. Test imports work
# Create a test file that imports from packages
node -e "import('@open-mercato/shared').then(m => console.log('shared OK'))"

# 6. Run tests
yarn test

# 7. Dev mode
yarn dev
```

---

## Common Issues

### "Cannot find module '@open-mercato/...' "

Check:
1. Package has proper `exports` field
2. Package has been built (`yarn build`)
3. Dependency is listed in consuming package's `package.json`

### "Module not found: Can't resolve './lib/something'"

The `exports` field may need wildcards:
```json
{
  "exports": {
    "./lib/*": {
      "types": "./dist/lib/*.d.ts",
      "import": "./dist/lib/*.js"
    }
  }
}
```

### Circular Dependencies

If Package A imports from Package B, and B imports from A:
1. Extract shared code to a common package
2. Or restructure to break the cycle

---

## Success Criteria

- [ ] All `@open-mercato/*` path mappings removed from tsconfig files
- [ ] Each package has `exports` field in package.json
- [ ] Each package has tsup configuration
- [ ] `yarn build` creates dist folders for all packages
- [ ] All imports resolve correctly
- [ ] `yarn typecheck` passes
- [ ] `yarn test` passes
- [ ] `yarn dev` works

---

## Next Phase

Once Phase 3 is complete, proceed to [Phase 4: Package Publishability](./phase-4.md).
