import { test, expect } from '@playwright/test'

// Sentinel placeholder spec.
//
// `.ai/qa/tests/playwright.config.ts` falls back to
// `.ai/qa/tests/__no_tests__/*.spec.ts` when `OM_INTEGRATION_MODULES`
// narrows discovery to a module that has no integration tests
// (for example `configs`, which only ships unit tests). Without a
// matching file in this directory Playwright would exit with
// "No tests found" and fail the CI integration shard for those PRs.
//
// This spec exists solely to keep the affected-modules shard green
// for module changes that have no integration coverage. It must
// stay trivially passing — do not extend it.

test('integration shard runs even when affected modules ship no specs', () => {
  expect(true).toBe(true)
})
