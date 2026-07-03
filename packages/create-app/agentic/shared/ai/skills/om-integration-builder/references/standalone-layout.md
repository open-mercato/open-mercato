# Standalone layout — where an integration provider lives and how it builds

This app was scaffolded by `create-mercato-app`. It is a **standalone app**, not the Open
Mercato monorepo: there is no `packages/` workspace and no `apps/mercato/`. The framework is
installed from npm under `node_modules/@open-mercato/*` and your code lives under
`src/modules/`. The rules below are native to how this skill runs here — read them first, then
follow the workflow steps for the provider contract itself.

## 1. Where the provider lives

Build the provider as a regular module under `src/modules/<provider>/` — for example
`src/modules/gateway_stripe/` — following the same module anatomy `om-module-scaffold` uses.
This is the recommended path for an app-specific integration; there is no workspace to add a
`packages/<prefix><provider>/` package to.

- **Module folder** `src/modules/<prefix>_<provider>/` (snake_case, e.g. `gateway_stripe`, `carrier_dhl`, `sync_medusa`).
- If you want to reuse the provider across several apps, develop it instead as its own published npm package in a separate repo and `yarn add` it — maintaining that package is outside the scope of a standalone app, and the marketplace `packages/<provider>` layout only applies inside the monorepo.

The canonical reference implementation `packages/gateway-stripe/` is **not present** on disk in a
standalone app. Read it on GitHub (`open-mercato/open-mercato` → `packages/gateway-stripe/`) or
in <https://docs.open-mercato.dev>; do not expect to `ls` or grep it locally.

## 2. Module registration

Register the provider module in the **app-root registry** `src/modules.ts` (there is no
`apps/mercato/`). If your provider is a local `src/modules/<provider>/` module that
auto-discovery picks up, running the generator wires it; otherwise add it to the registry
explicitly. Do not reference `apps/mercato/src/modules.ts`.

## 3. Build / validation commands — probe first

A standalone app has no workspace packages, so monorepo-only scripts such as `build:packages`
usually do not exist. Probe `package.json` before running any gate command:

```bash
has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }
run_if_present() {
  local name="$1"; shift
  if has_script "$name"; then yarn "$name" "$@"; else echo "[gate] Skipping '$name' — no such package.json script"; fi
}
```

Run the subset that exists — typically `generate`, `typecheck`, `test`, and `build`. Skip and
**log** monorepo-only scripts (`build:packages`) rather than failing the run.

## 4. Framework source is read-only

The Open Mercato framework lives under `node_modules/@open-mercato/*/dist/` as compiled
JavaScript and is **read-only** — never edit it. Read it for reference only. If you need to
change framework behaviour (e.g. a hub adapter contract), eject the relevant module
(`yarn mercato eject <module>`) or report the gap upstream. Never patch a generator or hub in
`node_modules` in place.

## 5. Everything else is the standard provider contract

The provider contract itself — adapter shape, credentials/encryption, widget injection,
webhook processing, health checks, i18n, tests — is identical to the monorepo. Only the
*location* (`src/modules/<provider>/`) and *build* (script-probed) differ. Follow the
`workflow/step-*.md` files for the contract and `references/adapter-contracts.md` for the exact
types.
