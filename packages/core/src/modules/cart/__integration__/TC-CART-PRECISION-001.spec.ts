import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { decimalToString, multiplyDecimals, roundDecimal } from '@open-mercato/shared/lib/decimal';
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

const EXACT_NET = '10.123456789012345678';
const EXACT_GROSS = '12.123456789012345678';

type CartLineView = { id: string; unitPriceNet: string | null; unitPriceGross: string | null };
type CartView = {
  cart: {
    lines: CartLineView[];
    totals: { subtotalNetAmountExact?: string; subtotalGrossAmountExact?: string };
  };
};

async function readCatalogPrice(priceId: string): Promise<{ unit_price_net: string; unit_price_gross: string }> {
  return withClient(async (client) => {
    const result = await client.query<{ unit_price_net: string; unit_price_gross: string }>(
      `select unit_price_net::text as unit_price_net, unit_price_gross::text as unit_price_gross
         from catalog_product_variant_prices where id = $1`,
      [priceId],
    );
    return (result as unknown as { rows: Array<{ unit_price_net: string; unit_price_gross: string }> }).rows[0];
  });
}

/**
 * TC-CART-PRECISION-001 — a catalog price beyond float precision keeps every digit through
 * the buyer pricing service into the cart line snapshot; cart totals use the exact prices.
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
      unitPriceNet: EXACT_NET,
      unitPriceGross: EXACT_GROSS,
    });
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, token, product);
    await cleanupCartStorefrontFixture(request, token, store);
  });

  test('stores the exact unit price on the line and sums exact totals', async () => {
    const catalogPrice = await readCatalogPrice(product.priceId);
    expect(catalogPrice.unit_price_net).toBe(EXACT_NET);

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
    expect(line.unitPriceGross).toBe(catalogPrice.unit_price_gross);
    // EUR amounts round to max(4, 2) decimals in the sales calculation (spec D4).
    expect(view.cart.totals.subtotalNetAmountExact).toBe(decimalToString(roundDecimal(multiplyDecimals(EXACT_NET, 2), 4)));
    expect(view.cart.totals.subtotalGrossAmountExact).toBe(
      decimalToString(roundDecimal(multiplyDecimals(catalogPrice.unit_price_gross, 2), 4)),
    );

    const stored = await readCartLinePricing(line.id);
    expect(stored?.unitPriceNet).toBe(EXACT_NET);
  });
});
