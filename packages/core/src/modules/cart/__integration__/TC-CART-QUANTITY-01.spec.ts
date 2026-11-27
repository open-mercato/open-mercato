import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_CURRENT_PATH,
  CART_LINES_BULK_PATH,
  CART_LINES_PATH,
  cartLinePath,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  deleteCartRowIfExists,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

export const integrationMeta = {
  dependsOnModules: ['catalog', 'customer_accounts', 'ecommerce', 'sales'],
};

test('TC-CART-QUANTITY-01: add, update and bulk add reject excess decimal precision without changing the cart', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin');
  let store: CartStorefrontFixture | null = null;
  let product: CartProductFixture | null = null;
  let cartId: string | null = null;

  try {
    store = await createCartStorefrontFixture(request, adminToken);
    product = await createCartProductFixture(request, adminToken, {
      stamp: uniqueStamp(),
      label: 'quantity',
      salesChannelId: store.salesChannelId,
    });
    const cart = await createStorefrontCart(store.hostname);
    cartId = cart.cartId;

    const added = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '1' },
    });
    expect(added.status, added.text).toBe(201);
    const { cart: { lines } } = added.body as { cart: { lines: Array<{ id: string; quantity: string }> } };
    expect(lines).toHaveLength(1);
    const [originalLine] = lines;
    expect(Number(originalLine.quantity)).toBe(1);

    const linePath = cartLinePath(originalLine.id);
    for (const quantity of ['1.23456', '1000000000000']) {
      const lineInput = { productId: product.productId, quantity };
      const requests = [
        { method: 'POST', path: CART_LINES_PATH, body: lineInput, issuePath: ['quantity'] },
        { method: 'PATCH', path: linePath, body: { quantity }, issuePath: ['quantity'] },
        { method: 'POST', path: CART_LINES_BULK_PATH, body: { lines: [
          { productId: product.productId, quantity: '2' },
          lineInput,
        ] }, issuePath: ['lines', 1, 'quantity'] },
      ] as const;
      for (const { path, method, body, issuePath } of requests) {
        const response = await cartStorefrontRequest(store.hostname, path, { method, body, cartToken: cart.token });
        expect(response.status, `${method} ${path}: ${response.text}`).toBe(400);
        expect(response.body).toMatchObject({ issues: [expect.objectContaining({ path: issuePath })] });
      }
    }

    const current = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET', cartToken: cart.token });
    expect(current.status, current.text).toBe(200);
    expect(current.body).toMatchObject({ cart: { lines: [{ id: originalLine.id, quantity: originalLine.quantity }] } });

    const updated = await cartStorefrontRequest(store.hostname, linePath, {
      method: 'PATCH', cartToken: cart.token, body: { quantity: '999999999999.9996' },
    });
    expect(updated.status, updated.text).toBe(200);

    const bulk = await cartStorefrontRequest(store.hostname, CART_LINES_BULK_PATH, {
      method: 'POST', cartToken: cart.token, body: { lines: [{ productId: product.productId, quantity: '0.0001' }] },
    });
    expect(bulk.status, bulk.text).toBe(200);
    const afterBulk = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET', cartToken: cart.token });
    expect(afterBulk.status, afterBulk.text).toBe(200);
    expect(afterBulk.body).toMatchObject({ cart: { lines: [{ id: originalLine.id, quantity: '999999999999.9997' }] } });
  } finally {
    if (cartId) await deleteCartRowIfExists(cartId);
    await cleanupCartProductFixture(request, adminToken, product);
    await cleanupCartStorefrontFixture(request, adminToken, store);
  }
});
