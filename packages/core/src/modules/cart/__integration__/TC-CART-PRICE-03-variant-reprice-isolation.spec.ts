import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_LINES_PATH,
  backdateCartTotalsComputedAt,
  cartStorefrontRequest,
  cleanupCartStorefrontFixture,
  cleanupCartVariantPriceFixture,
  createCartStorefrontFixture,
  createCartVariantPriceFixture,
  createStorefrontCart,
  readCartLinePricing,
  uniqueStamp,
  type CartStorefrontFixture,
  type CartVariantPriceFixture,
} from './helpers';

/**
 * TC-CART-PRICE-03 — QA manual-finding F14 (High severity, found live against real Postgres):
 * `lib/reprice.ts`'s `fetchLinePriceRows` builds `{ $or: [{ product: productId }, { variant:
 * variantId }] }`. Every `CatalogProductPrice` row scoped to a variant ALSO carries its
 * parent `product_id` (`catalog/commands/prices.ts`'s `createPriceCommand` resolves and
 * stores it even when the caller supplies only `variantId`) — so the `{ product: productId }`
 * arm of that `$or` returns every sibling variant's price rows too, not just the target
 * variant's. Nothing downstream narrowed the result back down, so a whole-cart re-price
 * (`cart.reprice`, the single choke point behind merge, promotion apply/remove, staleness,
 * and buyer-context-drift triggers — §5.2) could land a line on a SIBLING variant's price
 * row. Fixed by applying the shared `filterRowsForVariant` (moved from `cart/commands/
 * lines.ts`, which already applied it correctly after its own equally-wide
 * `fetchPriceRowsBatch`, into `catalog/lib/pricing.ts`) to `fetchLinePriceRows`'s result
 * before it is returned.
 *
 * This spec adds the line for each variant first (via `cart.lines.add`, which ALREADY
 * narrows correctly through `commands/lines.ts`'s own `filterRowsForVariant` call — so the
 * initial price is always right, bug or not) and only then forces a whole-cart re-price via
 * trigger 4 (staleness, same `backdateCartTotalsComputedAt` + GET technique as TC-CART-
 * PRICE-01) — isolating the ONE code path (`fetchLinePriceRows`) this fix touches.
 *
 * Source: .ai/runs/2026-10-14-ecommerce-release-4-write-side/PLAN.md Step 8.1 (QA finding F14).
 */
test.describe('TC-CART-PRICE-03: a whole-cart re-price keeps each line on its OWN variant price row', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let variantProduct: CartVariantPriceFixture;
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, token, {});
    variantProduct = await createCartVariantPriceFixture(request, token, { stamp: uniqueStamp(), label: 'f14' });
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartVariantPriceFixture(request, token, variantProduct);
    await cleanupCartStorefrontFixture(request, token, store);
  });

  test('TC-CART-PRICE-03: trigger 4 re-prices two sibling-variant lines without swapping their price rows', async () => {
    const cart = await createStorefrontCart(store.hostname);

    const addLineForVariant = async (variantId: string): Promise<string> => {
      const response = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
        method: 'POST',
        cartToken: cart.token,
        body: { productId: variantProduct.productId, variantId, quantity: '1' },
      });
      expect(response.status, `add line for variant ${variantId} should be 201 (${response.text})`).toBe(201);
      // §10.1 envelope since Step 5.2 — a successful add/merge returns `{ cart: CartView }`,
      // never a bare `{ outcome }` (that shape is reserved for a hard-stop rejection).
      const body = response.body as { cart: { lines: Array<{ id: string; variantId: string | null }> } };
      const line = body.cart.lines.find((candidate) => candidate.variantId === variantId);
      if (!line) throw new Error(`[internal] no line found for variant ${variantId} in the cart response`);
      return line.id;
    };

    const lineIdForVariantA = await addLineForVariant(variantProduct.variantAId);
    const lineIdForVariantB = await addLineForVariant(variantProduct.variantBId);

    const beforeRepriceA = await readCartLinePricing(lineIdForVariantA);
    const beforeRepriceB = await readCartLinePricing(lineIdForVariantB);
    expect(Number(beforeRepriceA?.unitPriceNet)).toBe(variantProduct.unitPriceNetForVariantA);
    expect(Number(beforeRepriceB?.unitPriceNet)).toBe(variantProduct.unitPriceNetForVariantB);

    // Push the snapshot 31 minutes stale — past the default 30-minute
    // `CART_PRICE_STALENESS_MINUTES` budget — forcing `cart.reprice` through
    // `fetchLinePriceRows` for BOTH lines on the very next GET (trigger 4, §5.2).
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await backdateCartTotalsComputedAt(cart.cartId, thirtyOneMinutesAgo);

    const response = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(response.status, response.text).toBe(200);
    const body = response.body as { versionBumpReason?: string; priceChanges?: Array<{ reason: string }> };
    expect(body.versionBumpReason).toBe('repricing');

    const afterRepriceA = await readCartLinePricing(lineIdForVariantA);
    const afterRepriceB = await readCartLinePricing(lineIdForVariantB);

    // The bug-proving assertions: each line must stay on its OWN variant's price row and
    // amount — never swapped onto the sibling variant's row by the whole-cart re-price.
    expect(afterRepriceA?.priceRowId, 'variant A line keeps its own price row after reprice').toBe(variantProduct.priceIdForVariantA);
    expect(Number(afterRepriceA?.unitPriceNet), 'variant A line keeps its own unitPriceNet after reprice').toBe(
      variantProduct.unitPriceNetForVariantA,
    );
    expect(afterRepriceB?.priceRowId, 'variant B line keeps its own price row after reprice').toBe(variantProduct.priceIdForVariantB);
    expect(Number(afterRepriceB?.unitPriceNet), 'variant B line keeps its own unitPriceNet after reprice').toBe(
      variantProduct.unitPriceNetForVariantB,
    );
  });
});
