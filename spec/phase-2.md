# Phase 2: Turborepo Setup & Directory Restructure

**Goal:** Restructure the codebase to use Turborepo with apps and packages directories, moving the Next.js app to `apps/mercato/`.

**Verification:** `yarn dev` works, `yarn build` works, all existing functionality preserved.

---

## Prerequisites

- [ ] Phase 1 completed (CLI commands working)
- [ ] All tests passing
- [ ] Clean git state (commit Phase 1 changes first)

---

## Overview

This phase restructures the repository from:
```
open-mercato/
├── src/              # Next.js app
├── generated/        # Generated files
├── packages/         # Packages
├── docs/             # Docs
└── package.json      # Workspaces: packages/*
```

To:
```
open-mercato/
├── apps/
│   ├── mercato/      # Next.js app (moved from root)
│   │   ├── src/
│   │   ├── generated/
│   │   └── package.json
│   └── docs/         # Documentation
├── packages/         # Packages (unchanged)
├── turbo.json        # Turborepo config
└── package.json      # Workspaces: apps/*, packages/*
```

---

## Tasks

### 2.1 Create turbo.json

**File:** `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "generate": {
      "cache": false,
      "outputs": ["generated/**"]
    },
    "db:generate": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    }
  }
}
```

---

### 2.2 Create apps/mercato Directory Structure

```bash
# Create the apps/mercato directory
mkdir -p apps/mercato
```

---

### 2.3 Move Next.js App Files

Move the following from root to `apps/mercato/`:

```bash
# Core app files
mv src apps/mercato/
mv generated apps/mercato/
mv public apps/mercato/
mv next.config.ts apps/mercato/
mv next-env.d.ts apps/mercato/
mv postcss.config.cjs apps/mercato/
mv tailwind.config.ts apps/mercato/
mv tsconfig.json apps/mercato/  # Will be modified
mv .env apps/mercato/.env
mv .env.* apps/mercato/.env.*

# Keep at root (shared):
# - turbo.json (new)
# - package.json (modified)
# - jest.config.cjs
# - eslint.config.mjs
```

---

### 2.4 Create apps/mercato/package.json

**File:** `apps/mercato/package.json`

```json
{
  "name": "@open-mercato/app",
  "version": "0.3.12",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "generate": "mercato generate"
  },
  "dependencies": {
    "@open-mercato/core": "workspace:*",
    "@open-mercato/shared": "workspace:*",
    "@open-mercato/ui": "workspace:*",
    "@open-mercato/cli": "workspace:*",
    "@open-mercato/client": "workspace:*",
    "@open-mercato/example": "workspace:*",
    "@open-mercato/onboarding": "workspace:*",
    "@open-mercato/vector": "workspace:*",
    "@open-mercato/events": "workspace:*",
    "@open-mercato/queue": "workspace:*",
    "@open-mercato/cache": "workspace:*",
    "@open-mercato/content": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.2"
  }
}
```

---

### 2.5 Update apps/mercato/tsconfig.json

**File:** `apps/mercato/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "plugins": [
      { "name": "next" }
    ],
    "paths": {
      "@/*": ["./src/*"],
      "@/generated/*": ["./generated/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

Note: The `@open-mercato/*` paths are REMOVED - packages are now dependencies.

---

### 2.6 Create Root tsconfig.base.json

**File:** `tsconfig.base.json` (root)

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

### 2.7 Update Root package.json

**File:** `package.json` (root)

```json
{
  "name": "open-mercato",
  "version": "0.3.12",
  "private": true,
  "packageManager": "yarn@4.5.3",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev --filter=@open-mercato/app",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "generate": "turbo run generate --filter=@open-mercato/app",
    "build:packages": "turbo run build --filter=@open-mercato/core --filter=@open-mercato/shared --filter=@open-mercato/cli",
    "db:generate": "mercato db generate",
    "db:migrate": "mercato generate && mercato db migrate",
    "mercato": "mercato"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  }
}
```

---

### 2.8 Move docs Directory

```bash
# Move if not already in apps/
mv docs apps/docs 2>/dev/null || echo "docs already in apps/"
```

Update `apps/docs/package.json` if needed to have proper name:
```json
{
  "name": "@open-mercato/docs",
  "private": true
}
```

---

### 2.9 Update Environment Variables

If `.env` files are at root, symlink them to `apps/mercato/`:

```bash
cd apps/mercato
ln -s ../../.env .env
ln -s ../../.env.local .env.local 2>/dev/null
```

Or use Turborepo's `globalEnv` in `turbo.json`:
```json
{
  "globalEnv": [
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "..."
  ]
}
```

---

## Verification Steps

```bash
# 1. Install dependencies
yarn install

# 2. Generate files
mercato generate

# 3. TypeScript check
yarn typecheck

# 4. Build
yarn build

# 5. Run tests
yarn test

# 6. Dev mode
yarn dev
# Verify app works at http://localhost:3000

# 7. CLI
mercato --help
```

---

## Directory Reference

After this phase:

```
open-mercato/
├── apps/
│   ├── mercato/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── modules/
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   ├── bootstrap.ts
│   │   │   ├── modules.ts
│   │   │   └── ...
│   │   ├── generated/
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── docs/
│       └── package.json
├── packages/
│   ├── core/
│   ├── shared/
│   ├── ui/
│   └── ...
├── turbo.json
├── tsconfig.base.json
├── package.json
└── .env
```

---

## Troubleshooting

### "Cannot find module '@open-mercato/...' "
- Ensure `yarn install` was run after updating workspaces
- Check that all packages have proper `name` in package.json

### "Cannot find module '@/...' "
- The `@/` alias should only work within `apps/mercato/`
- Packages should NOT use `@/` - they should use relative imports or package imports

### Turbo not finding tasks
- Ensure `turbo.json` is at root
- Check task names match script names in package.json files

---

## Success Criteria

- [ ] `turbo.json` created at root
- [ ] Next.js app moved to `apps/mercato/`
- [ ] Root workspaces includes `apps/*`
- [ ] `yarn dev` starts the app successfully
- [ ] `yarn build` completes without errors
- [ ] `yarn typecheck` passes
- [ ] `yarn test` passes
- [ ] No `@open-mercato/*` paths in tsconfig (packages are dependencies)

---

## Next Phase

Once Phase 2 is complete, proceed to [Phase 3: Package Independence](./phase-3.md).
