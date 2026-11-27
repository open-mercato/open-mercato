# Final gate — catalog AI categorization, spec Phases 1-4 (2026-11-02)

Runner: local (no Docker), Node 24, branch rebased onto `main` after 159 new upstream commits.

| Command | Result |
|---|---|
| yarn install --immutable | exit 0 |
| yarn build:packages (x2), yarn generate | exit 0 |
| yarn i18n:check-sync | exit 0 |
| yarn typecheck | exit 0 |
| yarn build:app | exit 0 |
| `modules/catalog/` jest (core) | 150 suites, 1559 tests, exit 0 |
| `packages/cli` module-facts BC guard | 334/334 after raising the size caps (see below) |
| yarn i18n:check-usage | NOT RUN — hangs on the authoring machine after "Found 34299 translation keys"; new keys were checked by script |
| yarn test --continue | exit 1, failures outside this diff (below) |

## Test failures not caused by this diff

- `packages/core` `warranty_claims/__tests__/quantity.test.ts`: expects "2.5", gets "2,5" under a Polish locale.
- `create-mercato-app`: 81 failures — live-adapter/harness cases and the checked-in `source-link-inventory.json` files reported stale/missing. This diff touches nothing under `packages/create-app`; not verified against a clean `main` checkout.

## Test edits outside catalog

- `module-facts.bc-guard.test.ts`, v1-vs-v2 extraction case: it used the catalog bulk-actions slot as its "single-object form" example. That slot became an array when the AI widget joined it, so the example now uses the string-form `crud-form:catalog.catalog_product` slot. The guard's intent is unchanged.
- Same file, size caps: the four generated-facts measures sat 0.2-0.3% over their caps (complete 5,563,080 · legacy delta 2,434,614 · markdown 2,106,153 · directory markdown 2,295,468), uniformly, as one additive module produces. Caps raised with ~2.5% headroom, as the file's own notes prescribe.

## Not run

- Integration tests TC-CAT-043..050: the fixture decision adapter needs `NODE_ENV != production`; the ephemeral harness always runs production. Written, typechecked and linted, traced by hand only.
- No browser verification of the review page, bulk actions, settings controls, on-create switch or product-page card after the final fixes.
