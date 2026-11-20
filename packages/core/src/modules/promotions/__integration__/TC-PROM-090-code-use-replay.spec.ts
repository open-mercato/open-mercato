import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createCodeFixture, deleteCodeIfExists, CODES_USE_PATH, uniqueStamp } from './helpers';
import { readCodeRow, countCodeUsageRowsInDb } from './helpers/db';

/**
 * TC-PROM-090 (SPEC-055 §Release 5 acceptance RA1, step PR1a). `POST
 * /api/promotions/codes/use` is idempotent per `(codeId, cartId, orderId ?? null)`: a
 * repeat call while an unreverted `CodeUsage` exists for that tuple returns `{ ok: true }`
 * and consumes nothing, and concurrent repeats write one usage row (the replay check runs
 * again under the `Code` row lock). A different `orderId` on the same cart is a new use.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §API Contracts `codes/use`
 * "Replay" + §Code Lifecycle "Replay key".
 */
const CONCURRENT_REPLAYS = 6;

test.describe('TC-PROM-090: codes/use replay is idempotent', () => {
  test('a repeat use of the same (codeId, cartId, orderId) consumes the code once', async ({ request }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let codeId: string | null = null;
    const codeString = `QA-PROM-090-${stamp}`.toUpperCase();

    try {
      const fixture = await createCodeFixture(request, token, {
        name: `QA PROM 090 ${stamp}`,
        type: 'static',
        code: codeString,
        usage: 'multiple',
        usageAmount: 5,
        active: true,
      });
      codeId = fixture.id;
      const cartId = randomUUID();
      const useBody = (orderId: string) => ({ codeId, codeString, cartId, orderId, customerId: null, type: 'static' });

      const first = await apiRequest(request, 'POST', CODES_USE_PATH, { token, data: useBody('order-090-a') });
      expect(first.status()).toBe(200);
      expect(await readJsonSafe(first)).toEqual({ ok: true });

      const replay = await apiRequest(request, 'POST', CODES_USE_PATH, { token, data: useBody('order-090-a') });
      expect(replay.status(), 'a replay must succeed without consuming the code').toBe(200);
      expect(await readJsonSafe(replay)).toEqual({ ok: true });
      expect((await readCodeRow(codeId))?.used).toBe(1);
      expect(await countCodeUsageRowsInDb(codeId)).toBe(1);

      const concurrent = await Promise.all(
        Array.from({ length: CONCURRENT_REPLAYS }, () =>
          apiRequest(request, 'POST', CODES_USE_PATH, { token, data: useBody('order-090-b') }),
        ),
      );
      for (const response of concurrent) {
        expect(response.status(), 'every concurrent replay must succeed').toBe(200);
      }
      expect((await readCodeRow(codeId))?.used, 'concurrent replays of one tuple count as one use').toBe(2);
      expect(await countCodeUsageRowsInDb(codeId), 'concurrent replays of one tuple write one usage row').toBe(2);
    } finally {
      await deleteCodeIfExists(request, token, codeId);
    }
  });

  test('a replay on an exhausted single-use code returns ok instead of 422', async ({ request }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let codeId: string | null = null;
    const codeString = `QA-PROM-090S-${stamp}`.toUpperCase();

    try {
      const fixture = await createCodeFixture(request, token, {
        name: `QA PROM 090S ${stamp}`,
        type: 'static',
        code: codeString,
        usage: 'single',
        active: true,
      });
      codeId = fixture.id;
      const body = { codeId, codeString, cartId: randomUUID(), orderId: 'order-090-s', customerId: null, type: 'static' };

      const first = await apiRequest(request, 'POST', CODES_USE_PATH, { token, data: body });
      expect(first.status()).toBe(200);
      const replay = await apiRequest(request, 'POST', CODES_USE_PATH, { token, data: body });
      expect(replay.status(), 'the replay of a committed use must not fail on the now-exhausted code').toBe(200);
      expect(await readJsonSafe(replay)).toEqual({ ok: true });

      const otherOrder = await apiRequest(request, 'POST', CODES_USE_PATH, {
        token,
        data: { ...body, orderId: 'order-090-t' },
      });
      expect(otherOrder.status(), 'a different orderId is a new use of the exhausted code').toBe(422);

      const codeRow = await readCodeRow(codeId);
      expect(codeRow?.used).toBe(1);
      expect(codeRow?.active).toBe(false);
      expect(await countCodeUsageRowsInDb(codeId)).toBe(1);
    } finally {
      await deleteCodeIfExists(request, token, codeId);
    }
  });
});
