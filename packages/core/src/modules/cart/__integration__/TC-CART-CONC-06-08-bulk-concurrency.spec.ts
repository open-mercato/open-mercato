import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import type { CartResponseEnvelope } from '../lib/cartView';
import {
  CART_CURRENT_PATH,
  CART_LINES_BULK_PATH,
  CART_LINES_PATH,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  deleteCartRowIfExists,
  readCartLinesForProduct,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

test.describe('TC-CART-CONC-06/07/08: concurrent bulk and single additions', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let product: CartProductFixture;
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, token);
    product = await createCartProductFixture(request, token, {
      stamp: uniqueStamp(), label: 'bulk-conc', salesChannelId: store.salesChannelId,
    });
    const priceUpdate = await apiRequest(request, 'PUT', '/api/catalog/prices', {
      token,
      data: { id: product.priceId, unitPriceNet: 10, taxRate: 20 },
    });
    expect(priceUpdate.status(), await priceUpdate.text()).toBe(200);
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, token ?? null, product ?? null);
    await cleanupCartStorefrontFixture(request, token ?? null, store ?? null);
  });

  for (const scenario of [
    { id: '06', name: 'empty cart with five bulk adds', initialQuantity: 0, singleAdds: 0, expectedQuantity: 10 },
    { id: '07', name: 'populated cart with five bulk adds', initialQuantity: 1, singleAdds: 0, expectedQuantity: 11 },
    { id: '08', name: 'populated cart with five bulk and five single adds', initialQuantity: 1, singleAdds: 5, expectedQuantity: 16 },
  ]) {
    test(`TC-CART-CONC-${scenario.id}: ${scenario.name}`, async () => {
      const cart = await createStorefrontCart(store.hostname);
      try {
        if (scenario.initialQuantity) {
          const initial = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
            method: 'POST', cartToken: cart.token,
            body: { productId: product.productId, quantity: String(scenario.initialQuantity) },
          });
          expect([200, 201], initial.text).toContain(initial.status);
        }

        const responses = await Promise.all([
          ...Array.from({ length: 5 }, () => cartStorefrontRequest(store.hostname, CART_LINES_BULK_PATH, {
            method: 'POST', cartToken: cart.token,
            body: { lines: [{ productId: product.productId, quantity: '2' }] },
          })),
          ...Array.from({ length: scenario.singleAdds }, () => cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
            method: 'POST', cartToken: cart.token,
            body: { productId: product.productId, quantity: '1' },
          })),
        ]);

        for (const response of responses) {
          expect([200, 201], response.text).toContain(response.status);
        }
        for (const response of responses.slice(0, 5)) {
          expect(response.body).toMatchObject({ outcome: { rejectedCount: 0 } });
        }

        const persisted = await readCartLinesForProduct(cart.cartId, product.productId);
        expect(persisted).toHaveLength(1);
        expect(Number(persisted[0].quantity)).toBe(scenario.expectedQuantity);

        const current = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET', cartToken: cart.token });
        expect(current.status, current.text).toBe(200);
        const view = (current.body as CartResponseEnvelope).cart;
        expect(view.lines).toHaveLength(1);
        expect(Number(view.lines[0].quantity)).toBe(scenario.expectedQuantity);
        expect(Number(view.totals.grandTotalGrossAmount)).toBe(scenario.expectedQuantity * 12);
      } finally {
        await deleteCartRowIfExists(cart.cartId);
      }
    });
  }
});
