# Create App Package — Agent Guidelines

`packages/create-app` provides the `create-mercato-app` CLI scaffolding tool and the template for standalone applications.

## What is a Standalone App?

A standalone app is a separate Next.js application created outside the monorepo that uses Open Mercato packages installed from npm (or Verdaccio). Users run `npx create-mercato-app my-app` to scaffold a new project.

### Key Differences from Monorepo

| Aspect | Monorepo | Standalone App |
|--------|----------|----------------|
| Package source | Local workspace (`packages/`) | npm registry or Verdaccio |
| Package format | TypeScript source (`src/`) | Compiled JavaScript (`dist/`) |
| Generators read from | `src/modules/*.ts` | `dist/modules/*.js` |
| Module location | `apps/mercato/src/modules/` | `src/modules/` (app root) |

### Standalone App Structure

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

Verdaccio is a lightweight local npm registry for testing package publishing before releasing.

### Setup

```bash
# 1. Start Verdaccio
docker compose up -d verdaccio
# Configuration at config/verdaccio/config.yaml

# 2. Create registry user
yarn registry:setup-user

# 3. Build and publish all packages
yarn registry:publish
# Handles: verify Verdaccio, unpublish existing, build, publish in dependency order

# 4. Create and test standalone app
npx --registry http://localhost:4873 create-mercato-app@latest my-test-app
cd my-test-app
docker compose up -d
yarn install
yarn initialize
yarn dev
```

### Testing Workflow

When making changes to packages:

```bash
# 1. Make changes in monorepo packages
# 2. Republish to Verdaccio
yarn registry:publish
# 3. In standalone app, reinstall and test
cd /path/to/my-test-app
rm -rf node_modules .next
yarn install
yarn dev
```

### Canary Releases

```bash
./scripts/release-canary.sh
# Creates version like: 0.4.2-canary-abc1234567
npx create-mercato-app@0.4.2-canary-abc1234567 my-test-app
```

### Cleanup

```bash
npm config delete @open-mercato:registry
docker stop verdaccio && docker rm verdaccio
```

## Important Considerations

1. **Type declarations**: Packages export types from `src/` but runtime code from `dist/`. Ensure `@types/*` dependencies are in `dependencies` (not `devDependencies`).
2. **Generators read compiled files**: In standalone apps, generators scan `node_modules/@open-mercato/*/dist/modules/` for `.js` files. Build before publishing.
3. **Test both environments**: Always test in both monorepo (`yarn dev`) and standalone app (via Verdaccio).
4. **Build order matters**:
   ```bash
   yarn build:packages   # Build packages first
   yarn generate         # Run generators
   yarn build:packages   # Rebuild with generated files
   ```
