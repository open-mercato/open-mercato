import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness';
import {
  PRICES_PATH,
  PRICE_KINDS_PATH,
  createOmnibusProductFixture,
  createPriceFixture,
  createPriceKindFixture,
  deleteEntityIfExists,
  fetchPriceHistory,
  uniqueStamp,
  type PriceHistoryItem,
} from './omnibusHelpers';

/**
 * TC-CAT-OMNI-001: Omnibus price history is captured by the real price API.
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` — Phase 1 (history capture wired into
 * price create/update/delete and undo) and `GET /api/catalog/prices/history` (keyset cursor,
 * `includeTotal`, filters, `recorded_at DESC, id DESC` order, 4-decimal money strings).
 *
 * Self-contained: every price lives on a fresh product + price kind, so the history assertions only
 * ever see rows this test wrote. History rows are immutable (DB trigger), so they are left behind
 * with the deleted product; prices, products and price kinds are deleted in `finally`.
 */
test.describe('TC-CAT-OMNI-001: price history capture via the price API', () => {
  test.describe.configure({ timeout: 120_000 });

  test('create, update and delete each record one history entry, newest first', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let priceId: string | null = null;
    try {
      productId = await createOmnibusProductFixture(request, token, stamp);
      priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'hist' });
      priceId = await createPriceFixture(request, token, {
        productId,
        priceKindId,
        unitPriceNet: 100,
        unitPriceGross: 123,
      });

      const startsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const update = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: {
          id: priceId,
          productId,
          priceKindId,
          currencyCode: 'EUR',
          unitPriceNet: 80,
          unitPriceGross: 98.4,
          startsAt,
        },
      });
      expect(update.status(), `price update should succeed (${await update.text()})`).toBe(200);

      const remove = await apiRequest(request, 'DELETE', `${PRICES_PATH}?id=${encodeURIComponent(priceId)}`, { token });
      expect(remove.status(), `price delete should succeed (${await remove.text()})`).toBe(200);
      priceId = null;

      const history = await fetchPriceHistory(request, token, { productId, includeTotal: 'true' });
      expect(history.status).toBe(200);
      const items = history.body?.items ?? [];
      expect(history.body?.total).toBe(3);
      expect(items.map((item) => item.changeType)).toEqual(['delete', 'update', 'create']);
      const recordedAt = items.map((item) => new Date(item.recordedAt).getTime());
      expect(recordedAt[0]).toBeGreaterThanOrEqual(recordedAt[1]);
      expect(recordedAt[1]).toBeGreaterThanOrEqual(recordedAt[2]);

      const [deleted, updated, created] = items as [PriceHistoryItem, PriceHistoryItem, PriceHistoryItem];
      for (const item of items) {
        expect(item.productId).toBe(productId);
        expect(item.priceKindId).toBe(priceKindId);
        expect(item.currencyCode).toBe('EUR');
        expect(item.source).toBe('api');
        expect(item.priceId).toBe(created.priceId);
      }
      expect(created.unitPriceNet).toBe('100.0000');
      expect(created.unitPriceGross).toBe('123.0000');
      expect(created.taxRate).toBe('23.0000');
      expect(created.isAnnounced).toBe(false);
      expect(created.startsAt).toBeNull();

      expect(updated.unitPriceNet).toBe('80.0000');
      expect(updated.unitPriceGross).toBe('98.4000');
      expect(updated.startsAt).toBe(startsAt);
      expect(updated.isAnnounced, 'a price with a validity start is an announced reduction').toBe(true);

      expect(deleted.unitPriceGross).toBe('98.4000');
    } finally {
      await deleteEntityIfExists(request, token, PRICES_PATH, priceId);
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
    }
  });

  test('history route filters by price kind, paginates with a keyset cursor and validates its query', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let productId: string | null = null;
    const priceKindIds: string[] = [];
    const priceIds: string[] = [];
    try {
      productId = await createOmnibusProductFixture(request, token, stamp);
      const regularKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'reg' });
      priceKindIds.push(regularKindId);
      const otherKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'oth' });
      priceKindIds.push(otherKindId);
      for (const gross of [110, 120, 130]) {
        priceIds.push(
          await createPriceFixture(request, token, {
            productId,
            priceKindId: regularKindId,
            unitPriceNet: gross / 2,
            unitPriceGross: gross,
            currencyCode: gross === 130 ? 'PLN' : 'EUR',
          }),
        );
      }
      priceIds.push(
        await createPriceFixture(request, token, {
          productId,
          priceKindId: otherKindId,
          unitPriceNet: 50,
          unitPriceGross: 61.5,
        }),
      );

      const byKind = await fetchPriceHistory(request, token, { productId, priceKindId: regularKindId, includeTotal: 'true' });
      expect(byKind.status).toBe(200);
      expect(byKind.body?.total).toBe(3);
      expect((byKind.body?.items ?? []).every((item) => item.priceKindId === regularKindId)).toBe(true);

      const byCurrency = await fetchPriceHistory(request, token, { productId, currencyCode: 'pln' });
      expect(byCurrency.status).toBe(200);
      const plnItems = byCurrency.body?.items ?? [];
      expect(plnItems).toHaveLength(1);
      expect(plnItems[0].currencyCode).toBe('PLN');
      expect(plnItems[0].unitPriceNet).toBe('65.0000');

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 6; page += 1) {
        const query: Record<string, string> = { productId, pageSize: '1' };
        if (cursor) query.cursor = cursor;
        const result = await fetchPriceHistory(request, token, query);
        expect(result.status).toBe(200);
        const items = result.body?.items ?? [];
        expect(items.length).toBeLessThanOrEqual(1);
        seen.push(...items.map((item) => item.id));
        cursor = result.body?.nextCursor ?? null;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
      const fullPage = await fetchPriceHistory(request, token, { productId, pageSize: '10' });
      expect(fullPage.body?.items.map((item) => item.id)).toEqual(seen);
      expect(fullPage.body?.nextCursor).toBeNull();

      const invalidCursor = await fetchPriceHistory(request, token, { productId, cursor: 'not-a-cursor' });
      expect(invalidCursor.status, 'an invalid cursor falls back to the first page').toBe(200);
      expect(invalidCursor.body?.items.map((item) => item.id)).toEqual(seen);

      const tooLarge = await apiRequest(request, 'GET', `/api/catalog/prices/history?productId=${productId}&pageSize=1000`, {
        token,
      });
      expect(tooLarge.status()).toBe(400);
      expect((await readJsonSafe<{ error?: string }>(tooLarge))?.error).toBe('Invalid query');

      const unknownParam = await apiRequest(request, 'GET', `/api/catalog/prices/history?productId=${productId}&bogus=1`, {
        token,
      });
      expect(unknownParam.status()).toBe(400);
    } finally {
      for (const id of priceIds) await deleteEntityIfExists(request, token, PRICES_PATH, id);
      await deleteCatalogProductIfExists(request, token, productId);
      for (const id of priceKindIds) await deleteEntityIfExists(request, token, PRICE_KINDS_PATH, id);
    }
  });

  test('undoing a price update records an undo entry restoring the previous amount', async ({ request }) => {
    skipIfUndoTestsDisabled();
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let priceId: string | null = null;
    try {
      productId = await createOmnibusProductFixture(request, token, stamp);
      priceKindId = await createPriceKindFixture(request, token, { stamp, suffix: 'undo' });
      priceId = await createPriceFixture(request, token, {
        productId,
        priceKindId,
        unitPriceNet: 100,
        unitPriceGross: 123,
      });
      const update = await apiRequest(request, 'PUT', PRICES_PATH, {
        token,
        data: { id: priceId, productId, priceKindId, currencyCode: 'EUR', unitPriceNet: 90, unitPriceGross: 110.7 },
      });
      expect(update.status(), `price update should succeed (${await update.text()})`).toBe(200);
      const operation = expectOperation(update, 'catalog price update');
      await undoOk(request, token, operation.undoToken, 'catalog price update');

      const history = await fetchPriceHistory(request, token, { productId });
      expect(history.status).toBe(200);
      const items = history.body?.items ?? [];
      expect(items.map((item) => item.changeType)).toEqual(['undo', 'update', 'create']);
      expect(items[0].unitPriceGross, 'the undo entry snapshots the restored price').toBe('123.0000');
      expect(items[1].unitPriceGross).toBe('110.7000');
    } finally {
      await deleteEntityIfExists(request, token, PRICES_PATH, priceId);
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
    }
  });
});
