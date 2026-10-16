import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { cleanupStorefrontFixture, createStorefrontFixture, storefrontGet, type StorefrontFixture } from './helpers';
import { STOREFRONT_CATEGORIES_PATH, STOREFRONT_SEARCH_SUGGEST_PATH } from './storefrontCatalogHelpers';

/**
 * TC-ECOM-017: storefront rate limits — the default posture.
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §9 (per-IP-per-store limits) and
 * the Step 6.5 decision: the key is `<clientIp>:<storeId>`, and a request whose client IP cannot be
 * derived (`RATE_LIMIT_TRUST_PROXY_DEPTH` unset or `0`, the default) is served uncounted rather
 * than charged to one shared bucket for the whole store.
 *
 * The ephemeral integration environment runs with that default (and with `OM_INTEGRATION_TEST`,
 * which disables the platform limiter), so a burst past `/categories`' 120 requests per minute —
 * spoofed `X-Forwarded-For` included — must all be served. The `429` path itself (body, headers,
 * `Cache-Control: no-store`, `ip:storeId` keying) needs a trusted proxy depth and is covered by the
 * route unit tests (`storefrontRateLimit.test.ts` and each route's OpenAPI contract block).
 */

const CATEGORIES_LIMIT_PER_MINUTE = 120;
const BURST_SIZE = CATEGORIES_LIMIT_PER_MINUTE + 10;
const BATCH_SIZE = 10;

test.describe('TC-ECOM-017: storefront rate limit default posture', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a burst past the per-minute limit is served when no client IP can be trusted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let store: StorefrontFixture | null = null;
    try {
      store = await createStorefrontFixture(request, token);
      const host = store.hostname;
      const statuses: number[] = [];
      for (let start = 0; start < BURST_SIZE; start += BATCH_SIZE) {
        const indexes: number[] = [];
        for (let index = start; index < Math.min(start + BATCH_SIZE, BURST_SIZE); index += 1) indexes.push(index);
        const batch = await Promise.all(
          indexes.map((index) =>
            storefrontGet(host, STOREFRONT_CATEGORIES_PATH, {
              headers: { 'X-Forwarded-For': `203.0.113.${index % 2}` },
            }),
          ),
        );
        for (const response of batch) {
          statuses.push(response.status);
          expect(response.headers['retry-after'], 'no limiter verdict reaches the client').toBeUndefined();
        }
      }
      expect(statuses.length).toBe(BURST_SIZE);
      expect(statuses.filter((status) => status !== 200), 'every request is served').toEqual([]);

      const suggest = await storefrontGet(host, STOREFRONT_SEARCH_SUGGEST_PATH, { query: { q: 'qa' } });
      expect(suggest.status, suggest.text).toBe(200);
    } finally {
      await cleanupStorefrontFixture(request, token, store);
    }
  });
});
