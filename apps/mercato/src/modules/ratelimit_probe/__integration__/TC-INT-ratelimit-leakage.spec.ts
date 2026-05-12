import { expect, test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Regression guard: `OM_INTEGRATION_TEST=true` must keep both the metadata-driven
 * and the per-handler rate-limit paths bypassed.
 *
 * `readRateLimitConfig()` flips `RATE_LIMIT_ENABLED=false` whenever
 * `OM_INTEGRATION_TEST=true`, which the integration runner exports via
 * `packages/cli/src/lib/testing/integration.ts`. Without that bypass every
 * Playwright run shares a single client IP across workers and burns through
 * per-route point budgets — flakiness that scales with worker count.
 *
 * The metadata-path case depends on the dev-only `ratelimit_probe` module at
 * `apps/mercato/src/modules/ratelimit_probe/`. That module ships only with
 * the open-mercato monorepo and is intentionally absent from
 * `create-mercato-app` scaffolds, so the metadata path self-skips when
 * `/api/ratelimit_probe/ping` responds with 404.
 */
test.describe('per-route rate limits leak into OM_INTEGRATION_TEST runs', () => {
  test('metadata.rateLimit path (apps/mercato root handler): 5 POSTs to /api/ratelimit_probe/ping all return 200 with points=3', async ({ request }) => {
    const probe = await request.post(`${BASE_URL}/api/ratelimit_probe/ping`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    test.skip(
      probe.status() === 404,
      'ratelimit_probe module not registered (expected for create-mercato-app scaffolds)',
    );

    const statuses: number[] = [probe.status()];
    for (let i = 0; i < 4; i += 1) {
      const res = await request.post(`${BASE_URL}/api/ratelimit_probe/ping`, {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });
      statuses.push(res.status());
    }
    // With the OM_INTEGRATION_TEST bypass: all 5 calls return 200.
    // Without it: rate limiter fires on the 4th call → [200, 200, 200, 429, 429].
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
    // With the OM_INTEGRATION_TEST bypass: zero 429s (invalid token → 400/404, but never 429).
    // Without it: 429 from the 11th call onward.
    expect(statuses.filter((s) => s === 429), 'OM_INTEGRATION_TEST should bypass per-handler checkRateLimit').toEqual([]);
  });
});
