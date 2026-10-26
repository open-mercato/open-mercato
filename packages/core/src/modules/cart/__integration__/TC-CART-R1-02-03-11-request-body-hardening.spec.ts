import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_CURRENT_PATH,
  CART_LINES_BULK_PATH,
  CART_LINES_PATH,
  cartLinePath,
  cartStorefrontRequest,
  cleanupCartStorefrontFixture,
  countCartsForTenant,
  createCartStorefrontFixture,
  createStorefrontCart,
  readCartRow,
  type CartStorefrontFixture,
} from './helpers';

/**
 * TC-CART-R1-02, R1-03, R1-11 — the route-edge body-hardening regression tests (§6a.1a,
 * F1/F2). None of these touch product visibility; they prove the server-derived
 * `ResolvedCartRouteContext` can never be substituted, overridden, or even influenced by a
 * value an anonymous caller puts on the wire.
 * Source: .ai/specs/2026-08-14-cart-module.md §6a.1a, §6a.4, §14.
 */
test.describe('TC-CART-R1-02/03/11: request-body hardening against scope/channel/store overrides', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, token, {});
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartStorefrontFixture(request, token, store);
  });

  test('TC-CART-R1-03: POST /current with channel: "api" in the body is 400, and the cart is never persisted', async () => {
    const before = await countCartsForTenant(store.tenantId);

    const response = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, {
      method: 'POST',
      body: { channel: 'api' },
    });

    expect(response.status, response.text).toBe(400);
    expect(response.body).toMatchObject({ error: expect.any(String), issues: expect.any(Array) });

    const after = await countCartsForTenant(store.tenantId);
    expect(after).toBe(before);
  });

  test('TC-CART-R1-03b: POST /current with no overrides still creates a storefront cart (sanity baseline)', async () => {
    const cart = await createStorefrontCart(store.hostname);
    expect(cart.cartId).toBeTruthy();
    expect(cart.token).toBeTruthy();
  });

  for (const field of ['assortmentScope', 'channel', 'storeId', 'salesChannelId'] as const) {
    test(`TC-CART-R1-02: lines.add rejects a body carrying "${field}" with 400 before the command ever runs`, async () => {
      const cart = await createStorefrontCart(store.hostname);
      const payload: Record<string, unknown> = {
        productId: '00000000-0000-0000-0000-000000000000',
        quantity: '1',
        [field]: field === 'assortmentScope' ? null : 'anything',
      };

      const response = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
        method: 'POST',
        cartToken: cart.token,
        body: payload,
      });

      expect(response.status, response.text).toBe(400);
      const body = response.body as { issues?: Array<{ code: string; keys: string[] }> };
      expect(body.issues?.[0]?.code).toBe('unrecognized_keys');
      expect(body.issues?.[0]?.keys).toContain(field);
    });
  }

  test('TC-CART-R1-11: an anonymous caller with a valid token cannot mutate channel/store/scope on ANY cart route', async () => {
    const cart = await createStorefrontCart(store.hostname);

    const attempts: Array<{ label: string; method: 'POST' | 'PATCH'; path: string; body: Record<string, unknown> }> = [
      { label: 'POST /current', method: 'POST', path: CART_CURRENT_PATH, body: { channel: 'pos' } },
      {
        label: 'POST /current/lines',
        method: 'POST',
        path: CART_LINES_PATH,
        body: { productId: '00000000-0000-0000-0000-000000000000', quantity: '1', storeId: 'x' },
      },
      {
        label: 'PATCH /current/lines/:lineId',
        method: 'PATCH',
        path: cartLinePath('00000000-0000-0000-0000-000000000000'),
        body: { quantity: '1', channel: 'agent' },
      },
      {
        label: 'POST /current/lines/bulk',
        method: 'POST',
        path: CART_LINES_BULK_PATH,
        body: { lines: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: '1', assortmentScope: [] }] },
      },
    ];

    for (const attempt of attempts) {
      const response = await cartStorefrontRequest(store.hostname, attempt.path, {
        method: attempt.method,
        cartToken: cart.token,
        body: attempt.body,
      });
      expect(response.status, `${attempt.label}: ${response.text}`).toBe(400);
      const body = response.body as { issues?: Array<{ code: string }> };
      expect(body.issues?.[0]?.code, attempt.label).toBe('unrecognized_keys');
    }

    // The cart's channel is unaffected by any of the above — still `storefront`. Read via the
    // DB directly (Step 5.2): the §10.1 `CartView` envelope has no `channel` field.
    const row = await readCartRow(cart.cartId);
    expect(row?.channel).toBe('storefront');
  });

  test('TC-CART-R1-11b: cart.create called with channel "api" and no authenticated principal is rejected before any cart is persisted', async () => {
    // Mirrors R1-03 but asserts the companion half of F2 explicitly: there is no body field on
    // ANY public route that reaches the authenticated, feature-gated §6a.4 path — an anonymous
    // caller hitting the one public create route with a non-storefront channel always 400s at
    // the `.strict()` boundary, never at a 403 for a "missing feature" (which would imply the
    // command itself ran and only then rejected it).
    const before = await countCartsForTenant(store.tenantId);
    const response = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, {
      method: 'POST',
      body: { channel: 'api', storeId: store.storeId, salesChannelId: store.salesChannelId },
    });
    expect(response.status, response.text).toBe(400);
    expect(await countCartsForTenant(store.tenantId)).toBe(before);
  });
});
