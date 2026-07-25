# Standalone portability overrides — `om-integration-builder`

This skill was authored inside the Open Mercato monorepo, where every integration provider is its own npm **workspace** package under `packages/<provider-package>/`. A standalone app scaffolded via `create-mercato-app` has **no `packages/` workspace and no `apps/mercato/`** — the framework is installed from npm under `node_modules/@open-mercato/*` and your code lives under `src/modules/`. The following overrides apply **before** any rule in `SKILL.md`.

## 1. Where the provider lives

SKILL.md says: create the package under `packages/<prefix><provider>/`, read `packages/gateway-stripe/` as the reference, and never touch `packages/core/src/modules/`. In a standalone app there is no workspace to add a package to. Choose one of:

- **Local module (default, simplest):** build the provider as a regular module under `src/modules/<provider>/` (e.g. `src/modules/gateway_stripe/`), following the same module anatomy `om-module-scaffold` uses. This is the recommended path for an app-specific integration.
- **External npm package:** if you want to reuse the provider across apps, develop it as its own published package in a separate repo and `yarn add` it. Maintaining that package is outside the scope of a standalone app; the marketplace `packages/<provider>` layout from SKILL.md only applies inside the monorepo.

The canonical reference implementation (`packages/gateway-stripe/`) is **not present** in a standalone app. Read it on GitHub (`open-mercato/open-mercato` → `packages/gateway-stripe/`) or in <https://docs.open-mercato.dev>; do not expect it on disk.

## 2. Module registration

SKILL.md says "Add the package to `apps/mercato/src/modules.ts`". In a standalone app the registry is at the app root: `src/modules.ts`. Register your provider module there (or via the generator if your provider is a local `src/modules/<provider>/` module that auto-discovery picks up). There is no `apps/mercato/` directory.

## 3. Build / validation commands

SKILL.md runs `yarn build:packages` to compile workspace packages. A standalone app has no workspace packages to build — that script usually does not exist. Probe `package.json` before running any gate command:

```bash
has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }
```

Run the subset that exists — typically `yarn generate`, `yarn typecheck`, `yarn test`, and `yarn build`. Skip and log monorepo-only scripts (`build:packages`) rather than failing.

## 4. Framework source is read-only

The monorepo lets you read `packages/core/`, `packages/ui/`, `packages/shared/` for reference. In a standalone app those live under `node_modules/@open-mercato/*/dist/` as compiled JavaScript and are **read-only** — never edit them. If you need to change framework behavior, eject the relevant module (`yarn mercato eject <module>`) or report the gap upstream.

## 5. Everything else is unchanged

The provider contract itself — adapter shape, credentials/encryption, widget injection, webhook processing, health checks, i18n, tests — is identical to the monorepo. Only the *location* and *build* differ. Follow SKILL.md for the contract; follow this file for where the files go and how they build.
