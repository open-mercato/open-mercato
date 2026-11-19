---
title: "Keep standalone template module lists aligned with template package dependencies"
modules: ["create_app","cli","sync_shopify"]
areas: ["architecture"]
topics: ["generated-files","package-runtime","template-sync"]
---

# Keep standalone template module lists aligned with template package dependencies

**Context**: The standalone app template enabled `{ id: 'webhooks', from: '@open-mercato/webhooks' }` in `packages/create-app/template/src/modules.ts`, but `packages/create-app/template/package.json.template` did not install `@open-mercato/webhooks`.

**Problem**: `yarn install` succeeded, but `mercato generate` failed later because the generator resolved a package-backed module that was never installed in the standalone app.

**Rule**: Any time a package-backed module is added or kept enabled in `packages/create-app/template/src/modules.ts`, verify the matching npm package exists in `packages/create-app/template/package.json.template`. Review the template lockfile in the same change whenever dependency shape changes.

**Applies to**: `packages/create-app/template/src/modules.ts`, `packages/create-app/template/package.json.template`, template lockfiles, and standalone app smoke tests.

**Shopify template sync (2026-11-06)**: The pre-commit sync copied the monorepo-only `sync_shopify` registration into the template without its package dependency. When standalone defaults must stay unchanged, omit that registration through `TEMPLATE_DISABLED_MODULE_IDS` in the sync source and rerun the sync command. Removing only the template line is insufficient: the next hook adds it again. Verify both template parity and the existing module-transform tests.
