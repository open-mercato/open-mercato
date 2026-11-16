import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_LINES_BULK_PATH,
  CART_LINES_PATH,
  cartLinePath,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  readCartLineRow,
  updateChannelBindingAssortmentScope,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

/**
 * TC-CART-R1-01, R1-04, R1-05, R1-09 — the per-line assortment-visibility enforcement points
 * built into `cart.lines.add`/`.update`/`.bulkAdd` (§6a.1c), exercised through the real
 * `/api/cart/current/*` HTTP routes (Steps 4.3-4.7).
 * Source: .ai/specs/2026-08-14-cart-module.md §6a, §14 "Assortment visibility (R11/R12
 * regression suite, §6a)".
 *
 * Fixture: one storefront store whose channel binding is restricted, after setup, to one
 * product's category only (`visibleProduct`) — `restrictedProduct` lives in a different
 * category and is therefore `product_unavailable` for every write this suite exercises.
 */
test.describe('TC-CART-R1-01/04/05/09: assortment-visibility enforcement on lines.add/update/bulkAdd', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let visibleProduct: CartProductFixture;
  let restrictedProduct: CartProductFixture;
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    store = await createCartStorefrontFixture(request, token, {});
    visibleProduct = await createCartProductFixture(request, token, { stamp, label: 'visible', salesChannelId: store.salesChannelId });
    restrictedProduct = await createCartProductFixture(request, token, { stamp, label: 'restricted', salesChannelId: store.salesChannelId });
    // Restrict the channel AFTER both products exist, so only `visibleProduct`'s own category
    // is admitted — `restrictedProduct` is outside it by construction from here on.
    await updateChannelBindingAssortmentScope(request, token, store.channelBindingId, { categoryIds: [visibleProduct.categoryId] });
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, token, visibleProduct);
    await cleanupCartProductFixture(request, token, restrictedProduct);
    await cleanupCartStorefrontFixture(request, token, store);
  });

  test('TC-CART-R1-01: lines.add rejects a restricted product with product_unavailable; totals unaffected', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const before = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(before.status).toBe(200);
    const beforeTotals = (before.body as { cart: { totals: Record<string, unknown> } }).cart.totals;

    const response = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: restrictedProduct.productId, quantity: '1' },
    });

    expect(response.status, response.text).toBe(200);
    // Step 5.2 — a visibility-rejected add is a 200 warning under the §10.1 envelope now,
    // not the bare `{ outcome }` shape: nothing was added, so `cart.lineCount` stays 0 and
    // the rejection surfaces as a lineless top-level warning instead.
    const rejectedBody = response.body as { cart: { lineCount: number }; warnings?: Array<{ code: string; lineId?: string }> };
    expect(rejectedBody.cart.lineCount).toBe(0);
    expect(rejectedBody.warnings).toEqual([{ code: 'product_unavailable', message: expect.any(String) }]);

    const after = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(after.status).toBe(200);
    expect((after.body as { cart: { totals: Record<string, unknown> } }).cart.totals).toEqual(beforeTotals);
  });

  test('TC-CART-R1-04: lines.bulkAdd mixing visible and restricted products adds the visible one and reports the restricted one per-line, no whole-batch failure', async () => {
    const cart = await createStorefrontCart(store.hostname);

    const response = await cartStorefrontRequest(store.hostname, CART_LINES_BULK_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: {
        lines: [
          { productId: visibleProduct.productId, quantity: '1' },
          { productId: restrictedProduct.productId, quantity: '1' },
        ],
      },
    });

    expect(response.status, response.text).toBe(200);
    const body = response.body as {
      outcome: { addedCount: number; rejectedCount: number; results: Array<{ index: number; status: string; reason?: string }> };
    };
    expect(body.outcome.addedCount).toBe(1);
    expect(body.outcome.rejectedCount).toBe(1);
    expect(body.outcome.results[0]).toMatchObject({ index: 0, status: 'added' });
    expect(body.outcome.results[1]).toMatchObject({ index: 1, status: 'rejected', reason: 'product_unavailable' });
  });

  test('TC-CART-R1-05: updating a line whose product has since become restricted is rejected, leaves the line untouched (not deleted)', async ({ request }) => {
    const cart = await createStorefrontCart(store.hostname);
    const addResponse = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: visibleProduct.productId, quantity: '1' },
    });
    expect(addResponse.status, addResponse.text).toBe(201);
    // Step 5.2 — a successful add now returns the full §10.1 `cart` envelope, not a bare
    // `{ outcome }`; the just-added line is the only one in a fresh cart's `lines` array.
    const lineId = (addResponse.body as { cart: { lines: Array<{ id: string }> } }).cart.lines[0].id;

    // Narrow the channel's assortment scope so `visibleProduct` no longer matches, then restore
    // it in `finally` so later tests in this file keep seeing the fixture's original scope.
    await updateChannelBindingAssortmentScope(request, token, store.channelBindingId, { categoryIds: [restrictedProduct.categoryId] });
    try {
      const updateResponse = await cartStorefrontRequest(store.hostname, cartLinePath(lineId), {
        method: 'PATCH',
        cartToken: cart.token,
        body: { quantity: '2' },
      });

      expect(updateResponse.status, updateResponse.text).toBe(200);
      // Step 5.2 — the rejected line still exists, so its rejection is a lineId-attached
      // top-level warning rather than the old bare `{ outcome }` shape.
      //
      // Step 7.4 (§6a.2) changed this response from one warning to two, legitimately: the
      // `PATCH` handler's own `resolveCurrentCart` call resolves a FRESH `StoreContext`
      // whose `digest` embeds the channel's assortment-scope hash
      // (`ecommerce/lib/buyerContext.ts`'s `computeStoreContextDigest`) — narrowing the
      // scope just above changes that digest, so `cart.get` detects `buyer_context_changed`
      // and dispatches `cart.reprice`, which now (since Step 7.4) runs the §6a.2 whole-cart
      // revisibility pass and PERSISTS `flag_state = 'product_unavailable'` on this exact
      // line before the `update` command's own, separate per-field rejection check even
      // runs. `buildCartResponseEnvelope`'s `buildFlaggedLineWarnings` then surfaces that
      // persisted flag on top of the route's own explicit rejection warning (`route.ts`'s
      // own literal message, byte-identical to `buildFlaggedLineWarnings`'s) — two entries,
      // not a duplicate bug, and exactly the whole-cart pass R1-08 requires ("a membership
      // change mid-session... runs the same whole-cart pass without waiting for checkout").
      const rejectedBody = updateResponse.body as { warnings?: Array<{ code: string; lineId?: string }> };
      expect(rejectedBody.warnings).toEqual([
        { code: 'product_unavailable', lineId, message: expect.any(String) },
        { code: 'product_unavailable', lineId, message: expect.any(String) },
      ]);

      const row = await readCartLineRow(lineId);
      expect(row, 'line should still exist').toBeTruthy();
      expect(row?.deletedAt).toBeNull();
      expect(Number(row?.quantity)).toBe(1);
    } finally {
      await updateChannelBindingAssortmentScope(request, token, store.channelBindingId, { categoryIds: [visibleProduct.categoryId] });
    }
  });

  test('TC-CART-R1-09: a restricted product and a nonexistent product id produce identical lines.add responses in body (and comparable timing)', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const nonexistentProductId = randomUUID();

    const restrictedSamples: number[] = [];
    const nonexistentSamples: number[] = [];
    let restrictedBody: unknown;
    let nonexistentBody: unknown;
    let restrictedStatus = 0;
    let nonexistentStatus = 0;

    for (let i = 0; i < 5; i += 1) {
      const startRestricted = Date.now();
      const restrictedResponse = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
        method: 'POST',
        cartToken: cart.token,
        body: { productId: restrictedProduct.productId, quantity: '1' },
      });
      restrictedSamples.push(Date.now() - startRestricted);
      restrictedStatus = restrictedResponse.status;
      restrictedBody = restrictedResponse.body;

      const startNonexistent = Date.now();
      const nonexistentResponse = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
        method: 'POST',
        cartToken: cart.token,
        body: { productId: nonexistentProductId, quantity: '1' },
      });
      nonexistentSamples.push(Date.now() - startNonexistent);
      nonexistentStatus = nonexistentResponse.status;
      nonexistentBody = nonexistentResponse.body;
    }

    // Body parity (§6a.3) is the hard, deterministic assertion — restricted and nonexistent
    // collapse to the byte-identical response.
    expect(restrictedStatus).toBe(200);
    expect(nonexistentStatus).toBe(200);
    // Step 5.2 — both collapse to the identical §10.1 envelope + lineless top-level warning.
    expect((restrictedBody as { warnings?: Array<{ code: string }> }).warnings).toEqual([
      { code: 'product_unavailable', message: expect.any(String) },
    ]);
    expect(nonexistentBody).toEqual(restrictedBody);

    // Timing parity is best-effort over HTTP (network/DB jitter dwarfs a single extra indexed
    // lookup locally) — median difference across 5 trials stays within a generous tolerance.
    // NOTE: the restricted path does one MORE DB round trip than the nonexistent path (a
    // successful product lookup plus a `catalogScopedProductService.loadScopedProducts` call,
    // vs. a single failed product lookup for a nonexistent id) — this suite does not assert
    // sub-millisecond constant-time parity; see the step report for this caveat.
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const restrictedMedian = median(restrictedSamples);
    const nonexistentMedian = median(nonexistentSamples);
    expect(Math.abs(restrictedMedian - nonexistentMedian)).toBeLessThan(200);
  });
});
