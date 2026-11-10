import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_CURRENT_PATH,
  CART_LINES_BULK_PATH,
  CART_LINES_PATH,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  cleanupCartVariantPriceFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createCartVariantPriceFixture,
  createStorefrontCart,
  deleteCartRowIfExists,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
  type CartVariantPriceFixture,
} from './helpers';

test('TC-CART-SEC-01: bulk add rejects a variant from another product and persists only valid pairs', async ({ request }) => {
  test.setTimeout(120_000);
  const token = await getAuthToken(request, 'admin');
  let store: CartStorefrontFixture | null = null;
  let otherProduct: CartProductFixture | null = null;
  let variantProduct: CartVariantPriceFixture | null = null;
  let cartId: string | null = null;

  try {
    const stamp = uniqueStamp();
    store = await createCartStorefrontFixture(request, token);
    otherProduct = await createCartProductFixture(request, token, { stamp, label: 'sec-parent', salesChannelId: store.salesChannelId });
    variantProduct = await createCartVariantPriceFixture(request, token, { stamp, label: 'sec-variant' });
    const cart = await createStorefrontCart(store.hostname);
    cartId = cart.cartId;
    const mismatched = { productId: otherProduct.productId, variantId: variantProduct.variantAId, quantity: '1' };

    const single = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST', cartToken: cart.token, body: mismatched,
    });
    expect(single.status, single.text).toBe(200);
    expect(single.body).toMatchObject({ cart: { lineCount: 0 }, warnings: [{ code: 'product_unavailable' }] });

    const bulk = await cartStorefrontRequest(store.hostname, CART_LINES_BULK_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { lines: [
        { productId: variantProduct.productId, variantId: variantProduct.variantAId, quantity: '1' },
        mismatched,
      ] },
    });
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body).toMatchObject({ outcome: {
      addedCount: 1,
      rejectedCount: 1,
      results: [
        { index: 0, status: 'added' },
        { index: 1, status: 'rejected', reason: 'product_unavailable' },
      ],
    } });

    const persisted = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET', cartToken: cart.token });
    expect(persisted.status, persisted.text).toBe(200);
    const body = persisted.body as { cart: { lines: Array<{ productId: string; variantId: string | null; unitPriceNet: string }> } };
    expect(body.cart.lines).toHaveLength(1);
    expect(body.cart.lines[0]).toMatchObject({ productId: variantProduct.productId, variantId: variantProduct.variantAId });
    expect(Number(body.cart.lines[0].unitPriceNet)).toBe(variantProduct.unitPriceNetForVariantA);
  } finally {
    if (cartId) await deleteCartRowIfExists(cartId);
    await cleanupCartVariantPriceFixture(request, token, variantProduct);
    await cleanupCartProductFixture(request, token, otherProduct);
    await cleanupCartStorefrontFixture(request, token, store);
  }
});
