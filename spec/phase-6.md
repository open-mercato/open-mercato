# Phase 6: Build Pipeline & Local Testing with Verdaccio

**Goal:** Establish the build pipeline for packages and test publishing locally using Verdaccio before any public release.

**Verification:** Packages build correctly, can be published to local Verdaccio registry, and can be consumed from there.

---

## Prerequisites

- [ ] Phase 5 completed (.mercato generation working)
- [ ] All tests passing
- [ ] Clean git state

---

## Overview

This phase covers:
1. Package build configuration with esbuild
2. Local npm registry with Verdaccio
3. Testing packages in isolation
4. Validating the full workflow locally

---

## Tasks

### 6.1 Install Build Dependencies

```bash
# Add esbuild to root
yarn add -D esbuild -W

# Install Verdaccio globally
npm install -g verdaccio
```

---

### 6.2 Configure Package Builds with esbuild

Each package needs a build script using esbuild.

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
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "node build.mjs && tsc --emitDeclarationOnly --declaration --outDir dist",
    "dev": "node build.mjs --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  }
}
```

#### packages/shared/build.mjs

```javascript
import * as esbuild from 'esbuild'
import { glob } from 'glob'
import path from 'path'

const isWatch = process.argv.includes('--watch')

// Find all TypeScript entry points
const entryPoints = await glob('src/**/*.ts', {
  ignore: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**']
})

const buildOptions = {
  entryPoints,
  outdir: 'dist',
  bundle: false, // Don't bundle - preserve module structure
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  external: [
    'awilix',
    '@mikro-orm/core',
    '@mikro-orm/postgresql',
    'react',
    'react-dom',
    // Add other external deps
  ],
}

if (isWatch) {
  const ctx = await esbuild.context(buildOptions)
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await esbuild.build(buildOptions)
  console.log('Build complete')
}
```

#### Alternative: Simple build script without glob

```javascript
import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: [
    'src/index.ts',
    'src/lib/db/mikro.ts',
    'src/lib/di/container.ts',
    'src/lib/i18n/server.ts',
    'src/lib/query/engine.ts',
    'src/lib/encryption/entityIds.ts',
    'src/modules/registry.ts',
    'src/modules/dsl.ts',
  ],
  outdir: 'dist',
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
})

console.log('Build complete')
```

Apply similar configuration to all other packages (core, ui, cli, etc.).

---

### 6.3 Add glob Dependency (if using dynamic entry discovery)

```bash
yarn add -D glob -W
```

---

### 6.4 Add Build Scripts to Turbo

**turbo.json:**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"],
      "cache": true
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

---

### 6.5 Root Package Scripts

**package.json (root):**

```json
{
  "scripts": {
    "build": "turbo run build",
    "build:packages": "turbo run build --filter='./packages/*'",
    "dev": "turbo run dev --filter=@open-mercato/app",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean && rm -rf node_modules .turbo"
  }
}
```

---

### 6.6 Setup Verdaccio for Local Testing

#### Start Verdaccio

```bash
# Start the local registry (runs on http://localhost:4873)
verdaccio
```

Verdaccio will create config at `~/.config/verdaccio/config.yaml`.

#### Configure Verdaccio

**~/.config/verdaccio/config.yaml:**

```yaml
storage: ./storage
auth:
  htpasswd:
    file: ./htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '@open-mercato/*':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
  '**':
    access: $all
    publish: $authenticated
    proxy: npmjs
```

#### Create Verdaccio User

```bash
npm adduser --registry http://localhost:4873
# Enter username, password, email
```

---

### 6.7 Build All Packages

```bash
# Build all packages
yarn build:packages

# Verify dist folders exist
ls packages/shared/dist
ls packages/core/dist
ls packages/ui/dist
ls packages/cli/dist
```

---

### 6.8 Publish to Verdaccio

Create a script to publish all packages:

**scripts/publish-local.sh:**

```bash
#!/bin/bash
set -e

REGISTRY="http://localhost:4873"

packages=(
  "shared"
  "core"
  "ui"
  "cli"
  "example"
  "onboarding"
  "vector"
  "events"
  "queue"
  "cache"
  "content"
  "client"
)

for pkg in "${packages[@]}"; do
  echo "Publishing @open-mercato/$pkg..."
  cd "packages/$pkg"
  npm publish --registry "$REGISTRY"
  cd ../..
done

echo "All packages published to $REGISTRY"
```

Make executable and run:

```bash
chmod +x scripts/publish-local.sh
./scripts/publish-local.sh
```

---

### 6.9 Test Package Installation

Create a test project to verify packages work:

```bash
# Create test directory outside the monorepo
mkdir ~/mercato-test-project
cd ~/mercato-test-project

# Initialize project
npm init -y

# Install from local registry
npm install @open-mercato/shared --registry http://localhost:4873
npm install @open-mercato/core --registry http://localhost:4873
npm install @open-mercato/ui --registry http://localhost:4873
```

---

### 6.10 Verify Imports Work

Create a test file in the test project:

**test-imports.ts:**

```typescript
// Test @open-mercato/shared
import { registerOrmEntities } from '@open-mercato/shared/lib/db/mikro'
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

console.log('shared imports work:', {
  registerOrmEntities: typeof registerOrmEntities,
  registerModules: typeof registerModules,
  registerEntityIds: typeof registerEntityIds
})

console.log('All imports resolved successfully!')
```

Run it:

```bash
npx tsx test-imports.ts
```

---

### 6.11 Test Full App Workflow

Test that the mercato app can use packages from Verdaccio:

```bash
# In a fresh directory
mkdir ~/mercato-app-test
cd ~/mercato-app-test

# Copy app template
cp -r /path/to/open-mercato/apps/mercato/* .

# Install from local registry
npm install --registry http://localhost:4873

# Run generation
yarn modules:prepare

# Start dev server
yarn dev
```

---

### 6.12 Clean Up After Testing

```bash
# Stop Verdaccio (Ctrl+C)

# Clean Verdaccio storage if needed
rm -rf ~/.config/verdaccio/storage/@open-mercato

# Remove test projects
rm -rf ~/mercato-test-project
rm -rf ~/mercato-app-test
```

---

## Verification Checklist

```bash
# 1. Build all packages
yarn build:packages

# 2. Verify dist folders
for pkg in shared core ui cli; do
  echo "Checking packages/$pkg/dist..."
  ls "packages/$pkg/dist" || echo "MISSING!"
done

# 3. Start Verdaccio
verdaccio &

# 4. Publish to Verdaccio
./scripts/publish-local.sh

# 5. Verify packages in Verdaccio
curl http://localhost:4873/@open-mercato/shared

# 6. Create test project
mkdir -p /tmp/mercato-test && cd /tmp/mercato-test
npm init -y
npm install @open-mercato/shared --registry http://localhost:4873

# 7. Verify import
node -e "import('@open-mercato/shared').then(m => console.log('OK', Object.keys(m)))"

# 8. Clean up
kill %1  # Stop Verdaccio
rm -rf /tmp/mercato-test
```

---

## Package Configuration Checklist

For each package, verify:

- [ ] `package.json` has `name`, `version`, `main`, `types`, `exports`
- [ ] `package.json` has `files: ["dist"]`
- [ ] `build.mjs` exists with proper entry points
- [ ] `yarn build` creates `dist/` folder with .js and .d.ts files
- [ ] All internal imports use package names (not workspace paths)
- [ ] External dependencies are listed in esbuild `external` option

---

## Success Criteria

- [ ] All packages build with `yarn build:packages`
- [ ] Each package has `dist/` folder with .js and .d.ts files
- [ ] Verdaccio starts and accepts published packages
- [ ] Packages can be installed from Verdaccio in a test project
- [ ] Imports resolve correctly in test project
- [ ] No runtime errors when importing packages

---

## Common Issues

### "Package not found in registry"

- Ensure Verdaccio is running
- Ensure package was published: `npm publish --registry http://localhost:4873`
- Check Verdaccio logs for errors

### "Cannot find module '@open-mercato/...'"

- Ensure package was built before publishing
- Check `exports` field in package.json matches import paths
- Verify `files` field includes `dist`

### "Type declarations not found"

- Ensure tsc is run with `--emitDeclarationOnly`
- Check `types` field in package.json points to correct .d.ts file

### "Peer dependency issues"

- Install peer dependencies in test project
- Add `peerDependencies` to package.json for React, Next.js, etc.

---

## Directory Structure After Phase 6

```
open-mercato/
├── apps/
│   ├── mercato/
│   │   ├── .mercato/generated/
│   │   └── src/
│   └── docs/
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   ├── dist/           # Built output (JS + d.ts)
│   │   ├── package.json
│   │   └── build.mjs       # esbuild script
│   ├── core/
│   │   ├── dist/
│   │   └── ...
│   ├── ui/
│   ├── cli/
│   └── ...
├── scripts/
│   └── publish-local.sh
├── turbo.json
└── package.json
```

---

## Next Steps (Future)

When ready to publish publicly:

1. Set up npm account and tokens
2. Configure CI/CD for automated publishing
3. Add changesets for version management
4. Create release workflow

For now, local testing with Verdaccio validates the entire publishing workflow without public exposure.
