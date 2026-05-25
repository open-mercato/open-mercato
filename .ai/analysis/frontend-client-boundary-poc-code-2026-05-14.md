# Frontend client boundary PoC code delivery

This branch adds runnable PoC code for the frontend client-boundary benchmark work so reviewers can validate it in CI and manually, not only inspect static benchmark artifacts.

## Scope

The PoC implements the first two low-risk breadth reducers from the benchmark conclusions:

1. **Lazy app-level client bootstrap registries**
   - `apps/mercato/src/components/ClientBootstrap.tsx`
   - `packages/create-app/template/src/components/ClientBootstrap.tsx`
   - Generated registry imports are moved out of the app root static client graph and loaded inside the client bootstrap effect.
   - This targets the measured runtime RSS win from removing app-global generated registry imports.

2. **Direct message component imports in message object modules**
   - `packages/core/src/modules/{catalog,currencies,customers,resources,sales,staff}/message-objects.ts`
   - Replaces root/barrel message UI imports with direct `MessageObjectDetail` / `MessageObjectPreview` imports.
   - This targets the static graph reduction measured in `.ai/analysis/frontend-client-boundary-messages-client-direct-components-poc-2026-05-14.json`.

## Validation commands

From repo root:

```bash
yarn install --immutable
yarn build:packages
yarn generate
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

Manual smoke path:

```bash
yarn dev
```

Then verify:

- app boots without client compile errors;
- backend shell loads;
- dashboard/injection widgets still register after hydration;
- message object previews/details still render for sales, catalog, customers, resources, staff, and currencies;
- payment and message client surfaces still load after hydration.

## Known limitations

- This is a PoC branch, not the full production refactor.
- `ClientBootstrapProvider` no longer performs synchronous first-render bootstrap. Registry consumers that require values before hydration may need a small readiness boundary or surface-local bootstrap.
- The large route-shell/page-island refactors are intentionally not included here; those should follow after the global/generated graph is reduced and re-benchmarked.
- CI should run full app/core typecheck and at least targeted smoke/manual checks before promoting this beyond PoC.

## Local validation performed

- `yarn install --immutable` — passed
- `yarn build:packages` — passed
- `yarn generate` — passed
- `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app` — passed
