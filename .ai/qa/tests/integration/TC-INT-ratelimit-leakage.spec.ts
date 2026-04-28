import { expect, test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Reproduction spec for per-route rate-limit leakage under `OM_INTEGRATION_TEST`.
 *
 * These tests are expected to FAIL on current `develop`. That failure is the
 * whole point — it proves the built-in rate limiting makes integration tests
 * fragile even though the runner already sets `OM_INTEGRATION_TEST=true`.
 *
 * Background:
 * - `packages/shared/src/lib/ratelimit/config.ts` `readRateLimitConfig()` only checks
 *   `RATE_LIMIT_ENABLED` (defaults to `true`). There is no `OM_INTEGRATION_TEST`
 *   / `OM_TEST_MODE` override on `develop` (the fix proposed in
 *   open-mercato#1673 was closed pending a better repro — this is that repro).
 * - `apps/mercato/src/app/api/[...slug]/route.ts` enforces per-route
 *   `metadata.rateLimit` via `checkRateLimit()` using only that global config.
 * - `packages/cli/src/lib/testing/integration.ts` exports `OM_INTEGRATION_TEST=true`,
 *   `OM_TEST_MODE=1`, `OM_TEST_AUTH_RATE_LIMIT_MODE=opt-in`. These are honored
 *   *only* by `checkAuthRateLimit()` in the auth module, not by the generic
 *   per-route / per-handler rate limiting.
 *
 * Why this matters for parallel test runs (the real pain point):
 * The open-mercato repo itself runs its integration suite serially, so the
 * per-route points budget is rarely exhausted for any single endpoint. In
 * downstream apps that run Playwright with `workers > 1`, every worker shares
 * the same client IP against the app server — the points budget is consumed
 * collectively, and flakiness scales with worker count. See edube-monorepo#161
 * for the 18-file boilerplate workaround that was required there. The
 * reproduction below is deliberately serial (points=3, 5 requests) so the
 * leakage is unambiguous even without concurrency.
 */
test.describe('per-route rate limits leak into OM_INTEGRATION_TEST runs', () => {
  test('metadata.rateLimit path (apps/mercato root handler): 4th POST to /api/ratelimit_probe/ping 429s with points=3', async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await request.post(`${BASE_URL}/api/ratelimit_probe/ping`, {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });
      statuses.push(res.status());
    }
    // Expected (post-fix): all 5 allowed → [200, 200, 200, 200, 200]
    // Actual (current develop): rate limiter still fires → [200, 200, 200, 429, 429]
    expect(statuses, 'OM_INTEGRATION_TEST should bypass metadata.rateLimit').toEqual([200, 200, 200, 200, 200]);
  });

  test('manual checkRateLimit path (sales/quotes/accept): 11th POST 429s with points=10', async ({ request }) => {
    // The rate limiter runs before token validation at sales/api/quotes/accept/route.ts:50-59,
    // so an obviously invalid token still consumes points.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await request.post(`${BASE_URL}/api/sales/quotes/fake-token-for-rate-limit-probe/accept`, {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });
      statuses.push(res.status());
    }
    // Expected (post-fix): zero 429s (invalid token → 400/404, but never 429).
    // Actual (current develop): 429 from the 11th call onward.
    expect(statuses.filter((s) => s === 429), 'OM_INTEGRATION_TEST should bypass per-handler checkRateLimit').toEqual([]);
  });
});
