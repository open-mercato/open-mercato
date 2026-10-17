import { expect, test } from '@playwright/test';
import { createQueue } from '@open-mercato/queue';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue';
import {
  cleanupCartStorefrontFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  backdateCartExpiresAt,
  backdateCartLastActivity,
  deleteCartMergeLog,
  forceCartLocked,
  forceCartResolved,
  insertCartMergeLogReference,
  cartStorefrontRequest,
  readCartRow,
  resolveCartQueueBaseDir,
  type CartStorefrontFixture,
} from './helpers';

/**
 * TC-CART-SWEEP-01..04 — integration coverage for the four Step 4.8 sweepers
 * (`sweepAbandonedCarts`/`sweepExpiredCarts`/`releaseStaleCartLocks`/`purgeExpiredCarts`,
 * `packages/core/src/modules/cart/lib/sweepers.ts`). Step 4.8 only unit-tested these against a
 * fake `EntityManager` (`cart/lib/__tests__/sweepers.test.ts`); this suite exercises the real
 * SQL translation against a live Postgres by creating a cart through the API, backdating its
 * `last_activity_at`/`expires_at`/`lock_expires_at`/`resolved_at` via direct SQL, enqueuing one
 * tick on the sweeper's own queue (mirroring the production scheduler path, same `{ tenantId }`
 * payload shape each worker expects), draining it through `drainIntegrationQueue` (the same
 * pattern `TC-PUSH-008` uses for a reaper sweep), and asserting the transition through a
 * follow-up `/api/cart/current` call — in particular the FK `deleteRule: 'restrict'` behavior
 * `purgeExpiredCarts` relies on to never hard-delete a cart a `CartMergeLog` still references.
 * Source: .ai/specs/2026-08-14-cart-module.md §12; Step 4.9 of the run plan.
 */

const CART_MARK_ABANDONED_QUEUE = 'cart:mark-abandoned';
const CART_EXPIRE_QUEUE = 'cart:expire';
const CART_RELEASE_STALE_LOCKS_QUEUE = 'cart:release-stale-locks';
const CART_PURGE_EXPIRED_QUEUE = 'cart:purge-expired';

type SweepTickPayload = { tenantId: string };

async function enqueueSweepTick(queueName: string, tenantId: string): Promise<void> {
  const queue = createQueue<SweepTickPayload>(queueName, 'local', { baseDir: resolveCartQueueBaseDir() });
  try {
    await queue.enqueue({ tenantId });
  } finally {
    await queue.close();
  }
}

async function getCartStatus(hostname: string, token: string): Promise<{ status: number; cart: Record<string, unknown> | null }> {
  const response = await cartStorefrontRequest(hostname, '/api/cart/current', { method: 'GET', cartToken: token });
  const body = response.body as { cart?: Record<string, unknown> } | null;
  return { status: response.status, cart: body?.cart ?? null };
}

test.describe('TC-CART-SWEEP-01/02/03/04: cart sweeper integration coverage', () => {
  test.describe.configure({ timeout: 180_000 });

  let store: CartStorefrontFixture;
  let adminToken: string;

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, adminToken, {});
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartStorefrontFixture(request, adminToken, store);
  });

  test('TC-CART-SWEEP-01: mark-abandoned-carts transitions an inactive active cart to abandoned', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await backdateCartLastActivity(cart.cartId, twentyFiveHoursAgo);

    await enqueueSweepTick(CART_MARK_ABANDONED_QUEUE, store.tenantId);
    await drainIntegrationQueue(CART_MARK_ABANDONED_QUEUE);

    const after = await getCartStatus(store.hostname, cart.token);
    expect(after.status).toBe(200);
    expect(after.cart?.status).toBe('abandoned');
  });

  test('TC-CART-SWEEP-02: expire-carts transitions a cart past expiresAt to expired', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await backdateCartExpiresAt(cart.cartId, oneDayAgo);

    await enqueueSweepTick(CART_EXPIRE_QUEUE, store.tenantId);
    await drainIntegrationQueue(CART_EXPIRE_QUEUE);

    const after = await getCartStatus(store.hostname, cart.token);
    expect(after.status).toBe(200);
    expect(after.cart?.status).toBe('expired');
  });

  test('TC-CART-SWEEP-03: release-stale-locks returns a timed-out locked cart to active and clears the lock fields', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await forceCartLocked(cart.cartId, fiveMinutesAgo);

    const locked = await getCartStatus(store.hostname, cart.token);
    expect(locked.cart?.status).toBe('locked');

    await enqueueSweepTick(CART_RELEASE_STALE_LOCKS_QUEUE, store.tenantId);
    await drainIntegrationQueue(CART_RELEASE_STALE_LOCKS_QUEUE);

    const after = await getCartStatus(store.hostname, cart.token);
    expect(after.status).toBe(200);
    expect(after.cart?.status).toBe('active');

    // Step 5.2 — the §10.1 `CartView` envelope has no `lockedAt`/`lockExpiresAt`/
    // `checkoutSessionId` fields at all; read them via the DB directly instead.
    const row = await readCartRow(cart.cartId);
    expect(row?.lockedAt).toBeNull();
    expect(row?.lockExpiresAt).toBeNull();
    expect(row?.checkoutSessionId).toBeNull();
  });

  test('TC-CART-SWEEP-04: purge-expired-carts hard-deletes an unreferenced resolved cart, but excludes one a CartMergeLog still references until that reference is gone', async () => {
    const purgeable = await createStorefrontCart(store.hostname);
    const referenced = await createStorefrontCart(store.hostname);
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    await forceCartResolved(purgeable.cartId, 'expired', ninetyOneDaysAgo);
    await forceCartResolved(referenced.cartId, 'expired', ninetyOneDaysAgo);

    const mergeLogId = await insertCartMergeLogReference({
      tenantId: store.tenantId,
      organizationId: store.organizationId,
      sourceCartId: referenced.cartId,
      targetCartId: referenced.cartId,
    });

    try {
      await enqueueSweepTick(CART_PURGE_EXPIRED_QUEUE, store.tenantId);
      await drainIntegrationQueue(CART_PURGE_EXPIRED_QUEUE);

      // Unreferenced and past retention: hard-deleted. `cart.get`'s no-oracle lookup answers
      // a purged id the same way it answers any other nonexistent token: 404.
      const afterPurgeable = await cartStorefrontRequest(store.hostname, '/api/cart/current', {
        method: 'GET',
        cartToken: purgeable.token,
      });
      expect(afterPurgeable.status).toBe(404);

      // Still referenced by the CartMergeLog's FK (`deleteRule: 'restrict'`): excluded from
      // this tick, still resolvable.
      const afterReferenced = await getCartStatus(store.hostname, referenced.token);
      expect(afterReferenced.status).toBe(200);
      expect(afterReferenced.cart?.status).toBe('expired');
    } finally {
      await deleteCartMergeLog(mergeLogId);
    }

    // With the reference gone, the same cart purges on the next tick.
    await enqueueSweepTick(CART_PURGE_EXPIRED_QUEUE, store.tenantId);
    await drainIntegrationQueue(CART_PURGE_EXPIRED_QUEUE);

    const afterSecondTick = await cartStorefrontRequest(store.hostname, '/api/cart/current', {
      method: 'GET',
      cartToken: referenced.token,
    });
    expect(afterSecondTick.status).toBe(404);
  });
});
