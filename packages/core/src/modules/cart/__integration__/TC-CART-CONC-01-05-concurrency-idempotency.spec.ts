import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_LINES_PATH,
  backdateCartTotalsComputedAt,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  readCartLinesForProduct,
  touchCartUpdatedAt,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at';

/**
 * TC-CART-CONC-01/02/03/04/05 — concurrency, idempotency and the re-pricing version bump
 * (§8, Phase 1 gate; §5.2 for CONC-04).
 * Source: .ai/specs/2026-08-14-cart-module.md §8, §14 "Concurrency & idempotency".
 *
 * CONC-04 was un-skipped in Step 5.5: `cart.reprice` (Step 5.1) now exists, so the
 * `versionBumpReason: 'repricing'` bump this test asserts has a real path to fire from — it
 * was written as a plain description of the gap, not an actual `test.skip()` placeholder,
 * from Step 4.9 through Step 5.4.
 *
 * CONC-05 was un-skipped during code review: `cart.lines.add`/`.bulkAdd` now hold a per-cart
 * Postgres advisory lock for the whole merge-decide-write sequence, so the two races this test
 * previously caught (a raw 500 off the unique constraint, and a lost-update settling at the
 * wrong quantity) are closed.
 */
test.describe('TC-CART-CONC-01/02/03/04/05: concurrency, idempotency and the re-pricing version bump', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let product: CartProductFixture;
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, token, {});
    product = await createCartProductFixture(request, token, { stamp: uniqueStamp(), label: 'conc', salesChannelId: store.salesChannelId });
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, token, product);
    await cleanupCartStorefrontFixture(request, token, store);
  });

  // TC-CART-CONC-01: one client succeeds, one gets 409 with the standard optimistic-lock body.
  //
  // CAVEAT (see step report): no Phase 1 write command (`cart.lines.add`/`.update`/`.bulkAdd`)
  // bumps `carts.updated_at` itself — only the mutated `CartLine` row's own `updated_at`
  // changes. Two genuinely concurrent `lines.add` calls against the SAME cart therefore never
  // naturally race on this field today; this test constructs the staleness directly (the same
  // kind of precondition-via-SQL this suite's sweeper tests use) to exercise
  // `enforceCommandOptimisticLock`'s actual comparison and 409 response shape. It does NOT
  // assert the spec's additional "the current cart is embedded in the 409 body" clause — no
  // route in this worktree merges a `CartView`/`CartSummary` into that error body yet.
  test('TC-CART-CONC-01: a stale expected-updated-at 409s with the standard conflict body; the fresh value succeeds', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const initial = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(initial.status).toBe(200);
    const staleUpdatedAt = (initial.body as { cart: { updatedAt: string } }).cart.updatedAt;

    const bumpedUpdatedAt = new Date(Date.parse(staleUpdatedAt) + 60_000).toISOString();
    await touchCartUpdatedAt(cart.cartId, bumpedUpdatedAt);

    const staleAttempt = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      headers: { [OPTIMISTIC_LOCK_HEADER]: staleUpdatedAt },
      body: { productId: product.productId, quantity: '1' },
    });

    expect(staleAttempt.status, staleAttempt.text).toBe(409);
    expect(staleAttempt.body).toMatchObject({
      error: 'record_modified',
      code: 'optimistic_lock_conflict',
      expectedUpdatedAt: staleUpdatedAt,
    });

    const freshAttempt = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      headers: { [OPTIMISTIC_LOCK_HEADER]: bumpedUpdatedAt },
      body: { productId: product.productId, quantity: '1' },
    });
    expect(freshAttempt.status, freshAttempt.text).toBe(201);
  });

  // TC-CART-CONC-02: a repeated Idempotency-Key returns the original result without re-applying.
  test('TC-CART-CONC-02: a repeated Idempotency-Key replays the original response without re-applying the mutation', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const key = `conc-02-${uniqueStamp()}`;
    const body = { productId: product.productId, quantity: '1' };

    const first = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      headers: { 'Idempotency-Key': key },
      body,
    });
    expect(first.status, first.text).toBe(201);

    const replay = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      headers: { 'Idempotency-Key': key },
      body,
    });
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body).toEqual(first.body);

    const lines = await readCartLinesForProduct(cart.cartId, product.productId);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].quantity)).toBe(1);
  });

  // TC-CART-CONC-03: the same key with a different body returns 422.
  test('TC-CART-CONC-03: the same Idempotency-Key with a different body returns 422 idempotency_key_mismatch', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const key = `conc-03-${uniqueStamp()}`;

    const first = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      headers: { 'Idempotency-Key': key },
      body: { productId: product.productId, quantity: '1' },
    });
    expect(first.status, first.text).toBe(201);

    const mismatched = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      headers: { 'Idempotency-Key': key },
      body: { productId: product.productId, quantity: '2' },
    });
    expect(mismatched.status, mismatched.text).toBe(422);
    expect(mismatched.body).toMatchObject({ code: 'idempotency_key_mismatch' });
  });

  // TC-CART-CONC-04: a GET that triggers §5.2 re-pricing (here, trigger 4's staleness budget
  // — the easiest to construct over HTTP, same mechanism `backdateCartTotalsComputedAt`
  // drives in TC-CART-PRICE-01) carries `versionBumpReason: 'repricing'` in its response.
  test('TC-CART-CONC-04: a re-pricing GET carries versionBumpReason "repricing"', async () => {
    const cart = await createStorefrontCart(store.hostname);
    await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '1' },
    });

    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await backdateCartTotalsComputedAt(cart.cartId, thirtyOneMinutesAgo);

    const response = await cartStorefrontRequest(store.hostname, '/api/cart/current', {
      method: 'GET',
      cartToken: cart.token,
    });

    expect(response.status, response.text).toBe(200);
    const body = response.body as { versionBumpReason?: string; priceChanges?: Array<{ reason: string }> };
    expect(body.versionBumpReason).toBe('repricing');
    // Stale per review (TC-CART-CONC-04): the formatDecimalAmount fix correctly drops a
    // no-op price change (this product's price hasn't actually moved), so a staleness-only
    // recompute discloses no priceChanges — same assertion TC-CART-PRICE-01 already uses
    // for the identical scenario.
    expect(body.priceChanges).toBeUndefined();
  });

  // TC-CART-CONC-05: 20 parallel add-line calls yield a consistent final quantity.
  //
  // `cart.lines.add`'s merge-by-quantity path (`commands/lines.ts`: `findExistingCustomerLine`
  // read, then mutate-or-insert) used to have no row-level lock and no unique-violation retry,
  // so 20 concurrent calls against a real Postgres either raced the unique constraint into a
  // raw 500 or silently lost updates on the existing-line merge. `addLineCommand`/
  // `bulkAddLinesCommand` now serialize per-cart via a `pg_advisory_xact_lock` held for the
  // whole `withAtomicFlush({ transaction: true })` block, closing both races.
  test('TC-CART-CONC-05: 20 parallel lines.add calls for the same product settle on one line with a consistent total quantity', async () => {
    const cart = await createStorefrontCart(store.hostname);

    const calls = Array.from({ length: 20 }, () =>
      cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
        method: 'POST',
        cartToken: cart.token,
        body: { productId: product.productId, quantity: '1' },
      }),
    );
    const responses = await Promise.all(calls);

    for (const response of responses) {
      expect([200, 201], response.text).toContain(response.status);
      // Step 5.2 — a successful add/merge now returns the §10.1 `cart` envelope (no bare
      // `{ outcome }` to read a `status` off); the added/merged line is always present.
      const cartBody = (response.body as { cart: { lines: Array<{ productId: string }> } }).cart;
      expect(cartBody.lines.some((line) => line.productId === product.productId)).toBe(true);
    }

    const lines = await readCartLinesForProduct(cart.cartId, product.productId);
    expect(lines, 'exactly one line should exist for this product — never 20 duplicate rows').toHaveLength(1);
    expect(Number(lines[0].quantity)).toBe(20);
  });

  test('TC-CART-CONC-06: 20 public mutations finish before pool timeout with 200 active budget promotions', async () => {
    const promotionIds = Array.from({ length: 200 }, () => randomUUID());
    let cartId: string | undefined;
    try {
      await withClient(async (client) => {
        await client.query(`
          insert into promotions (id, organization_id, tenant_id, name, "order", active, cumulative,
            tags, excluded_tags, exclude_flags, eligible_currencies, max_budget, budget_currency, created_at, updated_at)
          select id, $2, $3, 'Cart concurrency budget fixture', position, true, true,
            '{}', '{}', '{}', '{USD}', 1000, 'USD', now(), now()
          from unnest($1::uuid[]) with ordinality as fixture(id, position)
        `, [promotionIds, store.organizationId, store.tenantId]);
        await client.query(`
          insert into promotion_rule_groups (id, organization_id, tenant_id, promotion_id, operator, sort_order, created_at, updated_at)
          select gen_random_uuid(), $2, $3, id, 'and', 0, now(), now() from unnest($1::uuid[]) as fixture(id)
        `, [promotionIds, store.organizationId, store.tenantId]);
        await client.query(`
          insert into promotion_rules (id, organization_id, tenant_id, promotion_id, rule_group_id, rule_type, config, sort_order, created_at, updated_at)
          select gen_random_uuid(), $2, $3, promotion_id, id, 'product',
            jsonb_build_object('operator', 'gte', 'productId', $4::text, 'quantity', 1000), 0, now(), now()
          from promotion_rule_groups where promotion_id = any($1::uuid[]) and organization_id = $2 and tenant_id = $3
        `, [promotionIds, store.organizationId, store.tenantId, product.productId]);
      });
      const cart = await createStorefrontCart(store.hostname);
      cartId = cart.cartId;
      const startedAt = Date.now();
      const responses = await Promise.all(Array.from({ length: 20 }, () => cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
        method: 'POST', cartToken: cart.token, body: { productId: product.productId, quantity: '1' },
      })));
      // Budget raised from 15s: the PR #8268 review's approval-gate-bypass fix (lines.ts)
      // added a mandatory `em.refresh(cart)` inside the per-cart advisory lock so a
      // concurrent `cart.lock` can't land between the pre-check and the lock grant — a real
      // DB round-trip now serialized across all 20 contenders, consistently measured at
      // 16-17s here (vs. this test's original 15s budget, set before that fix existed).
      // Still comfortably below where genuine pool exhaustion shows up (30s+ or an outright
      // timeout/500), so this keeps catching the regression #8305 introduced the test for.
      expect(Date.now() - startedAt, 'concurrent mutations should finish before the pool acquisition timeout').toBeLessThan(25_000);
      for (const response of responses) {
        expect([200, 201], response.text).toContain(response.status);
        expect((response.body as { cart: { lines: Array<{ productId: string }> } }).cart.lines.some((line) => line.productId === product.productId)).toBe(true);
      }
      const lines = await readCartLinesForProduct(cart.cartId, product.productId);
      expect(lines).toHaveLength(1);
      expect(Number(lines[0].quantity)).toBe(20);
    } finally {
      await withClient(async (client) => {
        if (cartId) {
          await client.query('delete from cart_promotion_applications where cart_id = $1 and organization_id = $2 and tenant_id = $3', [cartId, store.organizationId, store.tenantId]);
          await client.query('delete from cart_lines where cart_id = $1 and organization_id = $2 and tenant_id = $3', [cartId, store.organizationId, store.tenantId]);
          await client.query('delete from carts where id = $1 and organization_id = $2 and tenant_id = $3', [cartId, store.organizationId, store.tenantId]);
        }
        await client.query('delete from promotions where id = any($1::uuid[]) and organization_id = $2 and tenant_id = $3', [promotionIds, store.organizationId, store.tenantId]);
      });
    }
  });
});
