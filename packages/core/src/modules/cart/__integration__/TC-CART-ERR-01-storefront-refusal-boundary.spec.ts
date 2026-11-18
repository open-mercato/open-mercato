import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures';
import {
  CART_CURRENT_PATH,
  CART_LINES_PATH,
  cartStorefrontHostname,
  cartStorefrontRequest,
  cleanupCartStorefrontFixture,
  cleanupSecondTenantCartActor,
  createCartStorefrontFixture,
  createSecondTenantCartActor,
  createStorefrontCart,
  deleteCartRowIfExists,
  readCartRow,
  uniqueStamp,
  type CartStorefrontFixture,
  type SecondTenantCartActor,
} from './helpers';

const STORES_PATH = '/api/ecommerce/stores';
const CHANNEL_BINDINGS_PATH = '/api/ecommerce/store-channel-bindings';

type StorefrontResponse = Awaited<ReturnType<typeof cartStorefrontRequest>>;

async function updateStoreStatus(
  request: APIRequestContext,
  token: string,
  storeId: string,
  status: 'draft' | 'active' | 'archived',
): Promise<void> {
  const response = await apiRequest(request, 'PUT', STORES_PATH, { token, data: { id: storeId, status } });
  expect(response.status(), `store status update should be 200 (${await response.text()})`).toBe(200);
}

async function deleteDefaultChannelBinding(
  request: APIRequestContext,
  token: string,
  channelBindingId: string,
): Promise<void> {
  const response = await apiRequest(request, 'DELETE', `${CHANNEL_BINDINGS_PATH}?id=${encodeURIComponent(channelBindingId)}`, {
    token,
  });
  expect(response.status(), `channel binding delete should be 200 (${await response.text()})`).toBe(200);
}

async function countCartLines(cartId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count from cart_lines where cart_id = $1 and deleted_at is null`,
      [cartId],
    );
    return Number((result as unknown as { rows: Array<{ count: string }> }).rows[0]?.count ?? '0');
  });
}

function expectRefusal(response: StorefrontResponse, status: number, code: string): void {
  expect(response.status, `${code} should answer ${status} (${response.text})`).toBe(status);
  expect(response.body).toEqual({ error: code });
  expect(response.headers['cache-control']).toBe('no-store');
}

/**
 * TC-CART-ERR-01 — the real HTTP refusal boundary at `/api/cart/current/*`.
 *
 * The unit suites (`api/current/__tests__/storefront-refusals.test.ts`,
 * `lib/__tests__/currentCartRoute.error-mapping.test.ts`) prove the error mapper and that every
 * handler maps a thrown `StorefrontResolutionError`; they replace DI and the route context, so
 * they cannot prove that actual store/domain resolution failures reach that mapper through the
 * built app. This spec drives the real request path against real store/domain/binding fixtures:
 * unknown host, draft store, archived store, store without a default channel binding and a
 * portal session issued by another tenant. On the pre-fix base these resolution errors are
 * unhandled and answer `500`; the mapping under review is what turns them into the documented
 * status/code pairs.
 *
 * `portal_session_invalid` stays unit-covered only: it is raised when the JWT session is live
 * but the customer user row is already gone (a fail-closed torn read). Deleting or deactivating
 * the user also revokes the session, so a real HTTP fixture cannot deterministically reach that
 * branch without forging a session token.
 *
 * Source: .ai/specs/2026-08-14-cart-module.md §6a.1a, §15a.
 */
test.describe('TC-CART-ERR-01: storefront resolution refusals at the current-cart HTTP edge', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an unmapped hostname answers 404 store_not_found for read and create', async () => {
    const hostname = cartStorefrontHostname(uniqueStamp());

    const read = await cartStorefrontRequest(hostname, CART_CURRENT_PATH, { method: 'GET' });
    expectRefusal(read, 404, 'store_not_found');

    const create = await cartStorefrontRequest(hostname, CART_CURRENT_PATH, { method: 'POST', body: {} });
    expectRefusal(create, 404, 'store_not_found');
  });

  test('a draft store is hidden as 404 store_not_found in ordinary mode', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let store: CartStorefrontFixture | null = null;
    try {
      store = await createCartStorefrontFixture(request, token, {});
      await updateStoreStatus(request, token, store.storeId, 'draft');

      const read = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET' });
      expectRefusal(read, 404, 'store_not_found');

      const create = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'POST', body: {} });
      expectRefusal(create, 404, 'store_not_found');
    } finally {
      await cleanupCartStorefrontFixture(request, token, store);
    }
  });

  test('an archived store answers 410 store_archived and leaves the cart untouched', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let store: CartStorefrontFixture | null = null;
    let cartId: string | null = null;
    try {
      store = await createCartStorefrontFixture(request, token, {});
      const cart = await createStorefrontCart(store.hostname);
      cartId = cart.cartId;

      const before = await readCartRow(cart.cartId);
      expect(before, 'cart row should exist before the refusal').not.toBeNull();
      expect(await countCartLines(cart.cartId)).toBe(0);

      await updateStoreStatus(request, token, store.storeId, 'archived');

      const read = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, {
        method: 'GET',
        cartToken: cart.token,
      });
      expectRefusal(read, 410, 'store_archived');

      const mutate = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
        method: 'POST',
        cartToken: cart.token,
        body: { productId: '00000000-0000-4000-8000-000000000000', quantity: '1' },
      });
      expectRefusal(mutate, 410, 'store_archived');

      const after = await readCartRow(cart.cartId);
      expect(after).toEqual(before);
      expect(await countCartLines(cart.cartId)).toBe(0);
    } finally {
      if (cartId) await deleteCartRowIfExists(cartId);
      await cleanupCartStorefrontFixture(request, token, store);
    }
  });

  test('a store without a default channel binding answers 503 store_misconfigured', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let store: CartStorefrontFixture | null = null;
    try {
      store = await createCartStorefrontFixture(request, token, {});
      await deleteDefaultChannelBinding(request, token, store.channelBindingId);

      const read = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET' });
      expectRefusal(read, 503, 'store_misconfigured');
    } finally {
      await cleanupCartStorefrontFixture(request, token, store);
    }
  });

  test('a portal session issued by another tenant answers 401 portal_session_scope_mismatch', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let store: CartStorefrontFixture | null = null;
    let actor: SecondTenantCartActor | null = null;
    let foreignCustomerUserId: string | null = null;
    try {
      store = await createCartStorefrontFixture(request, token, {});
      actor = await createSecondTenantCartActor(request, superadminToken, stamp);
      const foreignUser = await createCustomerUserFixture(request, actor.token, {
        displayName: `QA Cart Foreign Buyer ${stamp}`,
      });
      foreignCustomerUserId = foreignUser.id;
      const session = await portalLogin(request, {
        email: foreignUser.email,
        password: foreignUser.password,
        tenantId: actor.tenantId,
      });

      const withForeignSession = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, {
        method: 'GET',
        headers: portalCookieHeaders(session),
      });
      expectRefusal(withForeignSession, 401, 'portal_session_scope_mismatch');
      expect(withForeignSession.text).not.toContain(store.storeId);

      const anonymous = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, { method: 'GET' });
      expect(anonymous.status, `the store still resolves for a guest (${anonymous.text})`).toBe(404);
    } finally {
      if (actor) await deleteCustomerUserFixture(request, actor.token, foreignCustomerUserId);
      await cleanupSecondTenantCartActor(request, superadminToken, actor);
      await cleanupCartStorefrontFixture(request, token, store);
    }
  });
});
