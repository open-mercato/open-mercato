import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createCodeFixture, deleteCodeIfExists, CODES_USE_PATH, uniqueStamp } from './helpers';
import { readCodeRow, countCodeUsageRowsInDb } from './helpers/db';

/**
 * TC-PROM-022 (real-concurrency variant, Release 4 PLAN.md Step 6.8). SPEC-055
 * §Implementation Plan Phase 3 step 22: "Concurrent reservation race for the last code
 * (one succeeds)." `lib/__tests__/code-service.test.ts` already proves the SEQUENTIAL
 * decision logic against a fake `EntityManager` and documents, in its own header
 * comment, that a genuine concurrent race needs a live Postgres connection it does not
 * have. This spec is that live proof: N real HTTP requests fired concurrently at
 * `POST /api/promotions/codes/use` for the SAME single-use static code, each its own
 * connection/transaction (no ambient transaction is shared across requests), relying on
 * `code-service.ts`'s `PESSIMISTIC_WRITE` lock on the `Code` row (inside
 * `withAtomicFlush({ transaction: true })`) to serialize them correctly.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation Plan
 * Phase 3 step 22 + §Code Lifecycle `codes/use`.
 */
const CONCURRENT_ATTEMPTS = 8;

test.describe('TC-PROM-022b: concurrent codes/use race for a single-use code', () => {
  test('exactly one of N concurrent uses succeeds; the code is used exactly once', async ({ request }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let codeId: string | null = null;
    const codeString = `QA-PROM-022B-${stamp}`.toUpperCase();

    try {
      const fixture = await createCodeFixture(request, token, {
        name: `QA PROM 022B ${stamp}`,
        type: 'static',
        code: codeString,
        usage: 'single',
        active: true,
      });
      codeId = fixture.id;

      const attempts = Array.from({ length: CONCURRENT_ATTEMPTS }, () =>
        apiRequest(request, 'POST', CODES_USE_PATH, {
          token,
          data: {
            codeId,
            codeString,
            cartId: randomUUID(),
            customerId: null,
            type: 'static',
          },
        }),
      );

      const responses = await Promise.all(attempts);
      const statuses = await Promise.all(
        responses.map(async (response) => ({ status: response.status(), body: await readJsonSafe<Record<string, unknown>>(response) })),
      );

      const succeeded = statuses.filter((entry) => entry.status === 200);
      const rejected = statuses.filter((entry) => entry.status === 422);

      expect(succeeded, `exactly one of ${CONCURRENT_ATTEMPTS} concurrent uses must succeed`).toHaveLength(1);
      expect(succeeded[0].body).toEqual({ ok: true });
      expect(rejected, 'every other attempt must be rejected with the uniform code_invalid reason').toHaveLength(
        CONCURRENT_ATTEMPTS - 1,
      );
      for (const entry of rejected) {
        expect(entry.body).toEqual({ error: 'code_invalid' });
      }

      // Authoritative DB proof: the race never double-redeemed the code.
      const codeRow = await readCodeRow(codeId);
      expect(codeRow?.used).toBe(1);
      expect(codeRow?.active).toBe(false);
      const usageCount = await countCodeUsageRowsInDb(codeId);
      expect(usageCount, 'exactly one CodeUsage row must have been written').toBe(1);
    } finally {
      await deleteCodeIfExists(request, token, codeId);
    }
  });
});
