# Create App Package — Agent Guidelines

Use `packages/create-app` to scaffold standalone Open Mercato applications via `npx create-mercato-app my-app`.

## MUST Rules

1. **MUST test both environments** — verify changes work in monorepo (`yarn dev`) AND standalone app (via Verdaccio)
2. **MUST keep `@types/*` in `dependencies`** (not `devDependencies`) — standalone apps need type declarations at runtime
3. **MUST follow build order** — `yarn build:packages` → `yarn generate` → `yarn build:packages`
4. **MUST build before publishing** — generators scan `node_modules/@open-mercato/*/dist/modules/` for `.js` files
5. **MUST NOT break the standalone app template** — it's the user's first experience with Open Mercato

## Standalone App vs Monorepo

| Aspect | Monorepo | Standalone App |
|--------|----------|----------------|
| Package source | Local workspace (`packages/`) | npm registry or Verdaccio |
| Package format | TypeScript source (`src/`) | Compiled JavaScript (`dist/`) |
| Generators read from | `src/modules/*.ts` | `dist/modules/*.js` |
| Module location | `apps/mercato/src/modules/` | `src/modules/` (app root) |

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
# 1. Start Verdaccio
docker compose up -d verdaccio

# 2. Create registry user
yarn registry:setup-user

# 3. Build and publish all packages
yarn registry:publish

# 4. Create and test standalone app
npx --registry http://localhost:4873 create-mercato-app@latest my-test-app
cd my-test-app
docker compose up -d
yarn install
yarn initialize
yarn dev
```

### When Publishing Changes

1. Make changes in monorepo packages
2. Run `yarn registry:publish` to republish to Verdaccio
3. In standalone app: `rm -rf node_modules .next && yarn install && yarn dev`
4. Verify the app starts and affected features work
5. Test `yarn generate` produces correct output from compiled files

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
