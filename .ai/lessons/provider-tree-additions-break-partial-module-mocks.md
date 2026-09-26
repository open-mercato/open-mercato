---
title: "A component added to an always-mounted provider tree breaks partial module mocks"
modules: ["platform","ui"]
areas: ["testing","backend-ui"]
topics: ["testing","template-sync"]
---

# A component added to an always-mounted provider tree breaks partial module mocks

**Context**: Adding `DocumentDirection` to `AppProviders` — the provider tree every page mounts — was validated with the layout test and the new component's own test. The app suite then failed in `AppProviders.test.tsx`, whose `jest.mock('@open-mercato/shared/lib/i18n/context', ...)` factory returns only `I18nProvider`; the newly imported `useDirection` was therefore `undefined` and the tree threw on render.

**Rule**: Treat a new module-level import in an always-mounted component as a contract on every test that mocks that module with a partial factory, and run the owning package's *full* suite — not just the tests adjacent to the change. A partial `jest.mock` factory is a seam TypeScript cannot check, so nothing fails until a consumer renders the tree. The same applies to the mirrored copy under `packages/create-app/template/src`, which `yarn template:sync` keeps byte-identical.

**Applies to**: `apps/mercato/src/components/AppProviders.tsx` and its template mirror, the root layout, and any shared module (`@open-mercato/shared/lib/i18n/context`, `@open-mercato/ui/theme/*`) whose consumers mock it partially in tests.
