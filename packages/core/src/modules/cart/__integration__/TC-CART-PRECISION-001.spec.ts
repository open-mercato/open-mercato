import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_CURRENT_PATH,
  CART_LINES_PATH,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  readCartLinePricing,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

const PRICES_PATH = '/api/catalog/prices';
const EXACT_NET = '10.123456789012345678';
const EXACT_GROSS = '12.123456789012345678';

type CartLineView = { id: string; unitPriceNet: string | null; unitPriceGross: string | null };
type CartView = {
  cart: {
    lines: CartLineView[];
    totals: { subtotalNetAmountExact?: string; subtotalGrossAmountExact?: string };
  };
};

/**
 * TC-CART-PRECISION-001 — a catalog price beyond float precision keeps every digit through
 * the buyer pricing service into the cart line snapshot and the cart totals.
 *
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md (Integration Coverage).
 */
test.describe('TC-CART-PRECISION-001: cart prices beyond float precision', () => {
  test.describe.configure({ timeout: 120_000 });

  let token: string;
  let store: CartStorefrontFixture;
  let product: CartProductFixture;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, token, {});
    product = await createCartProductFixture(request, token, {
      stamp: uniqueStamp(),
      label: 'precision',
      salesChannelId: store.salesChannelId,
    });
    const update = await apiRequest(request, 'PUT', PRICES_PATH, {
      token,
      data: { id: product.priceId, unitPriceNet: EXACT_NET, unitPriceGross: EXACT_GROSS },
    });
    expect(update.status(), await update.text()).toBe(200);
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, token, product);
    await cleanupCartStorefrontFixture(request, token, store);
  });

  test('stores the exact unit price on the line and sums exact totals', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const added = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '2' },
    });
    expect(added.status, added.text).toBeLessThan(300);

    const current = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET', cartToken: cart.token });
    expect(current.status, current.text).toBe(200);
    const view = current.body as CartView;
    expect(view.cart.lines).toHaveLength(1);
    const [line] = view.cart.lines;
    expect(line.unitPriceNet).toBe(EXACT_NET);
    expect(line.unitPriceGross).toBe(EXACT_GROSS);
    expect(view.cart.totals.subtotalNetAmountExact).toBe('20.246913578024691356');
    expect(view.cart.totals.subtotalGrossAmountExact).toBe('24.246913578024691356');

    const stored = await readCartLinePricing(line.id);
    expect(stored?.unitPriceNet).toBe(EXACT_NET);
  });
});
