import path from 'node:path';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader';
import {
  CART_LINES_PATH,
  CART_MERGE_PATH,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT.trim())
  : path.resolve(process.cwd(), 'apps/mercato');

const PRODUCTS_PATH = '/api/catalog/products';

/**
 * TC-CART-F15/F13 — Step 8.5's own two QA findings, exercised against real Postgres + real
 * HTTP, matching this run's "individual build steps get Jest proof, Phase-gate/QA-fix steps
 * get live proof" precedent (`TC-CART-R13-01`'s own header comment).
 *
 * F15: a WRITE presenting a non-active cart's token (here, the SOURCE token after
 * `cart.merge` rotates it and flips the source cart to `status: 'merged'`) now returns a
 * distinguishable `409 cart_not_active` carrying the real `status`, not the generic `404`
 * `cart.mdx` never documented for this case.
 *
 * F13: a storefront-facing `warnings[].message` (here, `quantity_capped` from
 * `POST /current/lines`) is real, translated copy — never the raw `[internal]` developer
 * placeholder this module used to return straight to an anonymous buyer.
 *
 * Source: `.ai/specs/2026-08-14-cart-module.md` §15a (error-code catalogue, `cart_not_active`)
 * and root `AGENTS.md`'s `[internal]` i18n contract.
 */
test.describe('TC-CART-F15-F13-01: non-active-cart writes 409, warning messages are translated', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let product: CartProductFixture;
  let adminToken: string;

  test.beforeAll(async ({ request }) => {
    await bootstrapFromAppRoot(APP_ROOT);
    adminToken = await getAuthToken(request, 'admin');

    const stamp = uniqueStamp();
    store = await createCartStorefrontFixture(request, adminToken, {});
    product = await createCartProductFixture(request, adminToken, { stamp, label: 'f15-f13', salesChannelId: store.salesChannelId });
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, adminToken, product);
    await cleanupCartStorefrontFixture(request, adminToken, store);
  });

  test('a write with a merged cart\'s old token returns 409 cart_not_active carrying the real status', async () => {
    const target = await createStorefrontCart(store.hostname);
    const source = await createStorefrontCart(store.hostname);

    const mergeResponse = await cartStorefrontRequest(store.hostname, CART_MERGE_PATH, {
      method: 'POST',
      cartToken: target.token,
      body: { sourceToken: source.token },
    });
    expect(mergeResponse.status, mergeResponse.text).toBe(200);

    // The SOURCE cart is now `status: 'merged'` and its OLD token is still the only
    // credential a stale client (a second browser tab, a slow retry) could still be
    // holding — this is the live repro of the bug this step fixes.
    const staleWriteResponse = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: source.token,
      body: { productId: product.productId, quantity: '1' },
    });

    expect(staleWriteResponse.status, staleWriteResponse.text).toBe(409);
    const body = staleWriteResponse.body as { code?: string; status?: string };
    expect(body).toMatchObject({ code: 'cart_not_active', status: 'merged' });
  });

  test('a quantity_capped warning on /current/lines is real translated text, not [internal]', async ({ request }) => {
    const updateResponse = await apiRequest(request, 'PUT', PRODUCTS_PATH, {
      token: adminToken,
      data: { id: product.productId, maxOrderQty: 1 },
    });
    expect(updateResponse.status(), await updateResponse.text()).toBe(200);

    const cart = await createStorefrontCart(store.hostname);
    const addResponse = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '5' },
    });

    expect(addResponse.status, addResponse.text).toBe(201);
    const body = addResponse.body as { warnings?: Array<{ code: string; message: string }> };
    const warning = body.warnings?.find((entry) => entry.code === 'quantity_capped');
    expect(warning, `expected a quantity_capped warning in ${JSON.stringify(body.warnings)}`).toBeDefined();
    expect(warning?.message).not.toContain('[internal]');
    expect(warning?.message).toBe('The requested quantity was capped at the maximum allowed');
  });
});
