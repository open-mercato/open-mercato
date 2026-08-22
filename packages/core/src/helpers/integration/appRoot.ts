import path from 'node:path'

/**
 * The app root an integration test targets: `OM_TEST_APP_ROOT` when a standalone app is under test,
 * else the monorepo's `apps/mercato` (the Playwright process runs from the repo root, so its `cwd` is
 * not the app root).
 *
 * Single source for what was previously re-derived in `queue.ts`, `dbFixtures.ts`, and `pushFake.ts`.
 */
export function resolveAppRoot(input?: string): string {
  const explicit = input?.trim() || process.env.OM_TEST_APP_ROOT?.trim()
  return explicit ? path.resolve(explicit) : path.resolve(process.cwd(), 'apps/mercato')
}
