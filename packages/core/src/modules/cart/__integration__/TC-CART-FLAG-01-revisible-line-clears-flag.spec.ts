import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_CURRENT_PATH,
  CART_LINES_PATH,
  cartLinePath,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  deleteCartRowIfExists,
  setCatalogPriceAmounts,
  updateChannelBindingAssortmentScope,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

type CartEnvelope = {
  cart: { lines: Array<{ id: string; quantity: string }>; itemCount: number; totals: { grandTotalGrossAmount?: number | string } | null };
  warnings?: Array<{ code: string; lineId?: string }>;
  priceChanges?: Array<{ lineId: string; oldUnitPriceGross: string; newUnitPriceGross: string; reason: string }>;
  versionBumpReason?: string;
};

function unavailableLineIds(body: unknown): string[] {
  return ((body as CartEnvelope).warnings ?? [])
    .filter((warning) => warning.code === 'product_unavailable' && warning.lineId)
    .map((warning) => warning.lineId as string);
}

async function addLine(hostname: string, cartToken: string, productId: string, quantity: string) {
  return cartStorefrontRequest(hostname, CART_LINES_PATH, { method: 'POST', cartToken, body: { productId, quantity } });
}

/**
 * TC-CART-FLAG-01 — a line flagged `product_unavailable` by the whole-cart re-visibility pass
 * must not stay flagged once `lines.update` / a merging `lines.add` accept it as visible again,
 * otherwise it is counted in `itemCount` but left out of `cart.totals`.
 */
test.describe('TC-CART-FLAG-01: a re-visible flagged line is cleared by lines.update and merge-add', () => {
  test.describe.configure({ timeout: 180_000 });

  test('update and merge-add restore the line at the current price, and update discloses the change', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let store: CartStorefrontFixture | null = null;
    let product: CartProductFixture | null = null;
    let otherProduct: CartProductFixture | null = null;
    const cartIds: string[] = [];
    try {
      store = await createCartStorefrontFixture(request, token, {});
      product = await createCartProductFixture(request, token, { stamp, label: 'flag', salesChannelId: store.salesChannelId, taxRate: 20 });
      otherProduct = await createCartProductFixture(request, token, { stamp, label: 'flag-other', salesChannelId: store.salesChannelId });
      await updateChannelBindingAssortmentScope(request, token, store.channelBindingId, { categoryIds: [product.categoryId] });

      const updateCart = await createStorefrontCart(store.hostname);
      cartIds.push(updateCart.cartId);
      const mergeCart = await createStorefrontCart(store.hostname);
      cartIds.push(mergeCart.cartId);
      const updateAdd = await addLine(store.hostname, updateCart.token, product.productId, '1');
      expect(updateAdd.status, updateAdd.text).toBe(201);
      const updateLineId = (updateAdd.body as CartEnvelope).cart.lines[0].id;
      const mergeAdd = await addLine(store.hostname, mergeCart.token, product.productId, '1');
      expect(mergeAdd.status, mergeAdd.text).toBe(201);
      const mergeLineId = (mergeAdd.body as CartEnvelope).cart.lines[0].id;

      await updateChannelBindingAssortmentScope(request, token, store.channelBindingId, { categoryIds: [otherProduct.categoryId] });
      for (const [cart, lineId] of [[updateCart, updateLineId], [mergeCart, mergeLineId]] as const) {
        const flagged = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET', cartToken: cart.token });
        expect(flagged.status, flagged.text).toBe(200);
        expect(unavailableLineIds(flagged.body)).toEqual([lineId]);
      }

      await setCatalogPriceAmounts(product.priceId, '15', '18');
      const recategorize = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: product.productId, categoryIds: [product.categoryId, otherProduct.categoryId] },
      });
      expect(recategorize.status(), await recategorize.text()).toBe(200);

      const updated = await cartStorefrontRequest(store.hostname, cartLinePath(updateLineId), {
        method: 'PATCH',
        cartToken: updateCart.token,
        body: { quantity: '2' },
      });
      expect(updated.status, updated.text).toBe(200);
      expect(unavailableLineIds(updated.body)).toEqual([]);
      const updatedBody = updated.body as CartEnvelope;
      expect(updatedBody.cart.itemCount).toBe(2);
      expect(Number(updatedBody.cart.totals?.grandTotalGrossAmount)).toBe(36);
      expect(updatedBody.versionBumpReason).toBe('repricing');
      expect(updatedBody.priceChanges).toEqual([expect.objectContaining({ lineId: updateLineId, reason: 'stale_snapshot' })]);
      expect(Number(updatedBody.priceChanges?.[0]?.oldUnitPriceGross)).toBe(12);
      expect(Number(updatedBody.priceChanges?.[0]?.newUnitPriceGross)).toBe(18);

      const merged = await addLine(store.hostname, mergeCart.token, product.productId, '1');
      expect(merged.status, merged.text).toBe(200);
      const mergedBody = merged.body as CartEnvelope;
      expect(mergedBody.cart.lines.map((line) => line.id)).toEqual([mergeLineId]);
      expect(unavailableLineIds(mergedBody)).toEqual([]);
      expect(mergedBody.cart.itemCount).toBe(2);
      expect(Number(mergedBody.cart.totals?.grandTotalGrossAmount)).toBe(36);
    } finally {
      for (const cartId of cartIds) await deleteCartRowIfExists(cartId);
      await cleanupCartProductFixture(request, token, product);
      await cleanupCartProductFixture(request, token, otherProduct);
      if (store) await cleanupCartStorefrontFixture(request, token, store);
    }
  });
});
