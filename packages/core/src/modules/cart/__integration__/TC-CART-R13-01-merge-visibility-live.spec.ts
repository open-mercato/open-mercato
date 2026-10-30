import path from 'node:path';
import { expect, test } from '@playwright/test';
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader';
import { createRequestContainer } from '@open-mercato/shared/lib/di/container';
import type { CommandBus } from '@open-mercato/shared/lib/commands';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  CART_LINES_PATH,
  CART_MERGE_PATH,
  CART_UNDO_MERGE_PATH,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  readLatestCartMergeLog,
  updateChannelBindingAssortmentScope,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT.trim())
  : path.resolve(process.cwd(), 'apps/mercato');

/**
 * TC-CART-R13-01 (+ R13-02/R13-03 adjacent assertions) — the Phase 3 release gate's LIVE-STACK
 * proof of §6a.5's merge-time re-visibility pass: "a restricted line merged from an
 * exempt-channel cart is rejected, disclosed and recoverable, never silently admitted and
 * never silently dropped."
 *
 * Step 7.4 built and jest-unit-tested the mechanism (`commands/__tests__/merge.test.ts`'s own
 * `TC-CART-R13-01`, against a fully mocked `em`/`container`). This spec is the Phase-gate
 * counterpart against real Postgres + real HTTP, matching this run's own established
 * "individual build steps get Jest proof, Phase-gate steps get live proof" pattern (Steps
 * 2.8/4.9/5.5/6.8).
 *
 * §6a.4 exempts a channel that resolves no `StoreContext` (today `agent`/`api`) from the
 * assortment-visibility check at add-time — there is no public HTTP route that creates a
 * non-storefront cart (§6a.4: "created only by a command from an authenticated principal
 * holding a channel-specific feature"), so the exempt-channel SOURCE cart is provisioned by
 * calling `cart.create`/`cart.lines.add` directly via `commandBus.execute(...)` in this test
 * process — the same in-process-command pattern
 * `phone_calls/__integration__/TC-PHONE-HUB-006-calls-list-cache.spec.ts` already established
 * for exercising a command with no HTTP surface of its own. The admin test principal already
 * holds `cart.*` (hence `cart.channel.agent`) via `setup.ts`'s `defaultRoleFeatures`.
 *
 * Source: .ai/specs/2026-08-14-cart-module.md §6a.5, §14 "Merge visibility (R13 regression
 * suite, §6a.5)".
 */
test.describe('TC-CART-R13-01: a restricted line merged from an exempt-channel cart is rejected, disclosed and recoverable', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let visibleProduct: CartProductFixture;
  let restrictedProduct: CartProductFixture;
  let adminToken: string;
  let adminScope: { tenantId: string; organizationId: string; userId: string };

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin');
    adminScope = getTokenScope(adminToken);

    const stamp = uniqueStamp();
    store = await createCartStorefrontFixture(request, adminToken, {});
    visibleProduct = await createCartProductFixture(request, adminToken, { stamp, label: 'r13-visible', salesChannelId: store.salesChannelId });
    restrictedProduct = await createCartProductFixture(request, adminToken, { stamp, label: 'r13-restricted', salesChannelId: store.salesChannelId });
    // Restrict the channel to ONLY `visibleProduct`'s category — `restrictedProduct` is
    // outside the target's assortment scope from here on, by construction.
    await updateChannelBindingAssortmentScope(request, adminToken, store.channelBindingId, { categoryIds: [visibleProduct.categoryId] });
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, adminToken, visibleProduct);
    await cleanupCartProductFixture(request, adminToken, restrictedProduct);
    await cleanupCartStorefrontFixture(request, adminToken, store);
  });

  async function execCommand<TInput, TResult>(commandId: string, input: TInput): Promise<TResult> {
    const container = await createRequestContainer();
    const bus = container.resolve('commandBus') as CommandBus;
    const executed = await bus.execute<TInput, TResult>(commandId, {
      input,
      ctx: {
        container,
        auth: {
          sub: adminScope.userId,
          tenantId: adminScope.tenantId,
          orgId: adminScope.organizationId,
          isSuperAdmin: false,
        },
        organizationScope: {
          selectedId: adminScope.organizationId,
          filterIds: [adminScope.organizationId],
          allowedIds: [adminScope.organizationId],
          tenantId: adminScope.tenantId,
        },
        selectedOrganizationId: adminScope.organizationId,
        organizationIds: [adminScope.organizationId],
      },
    });
    return executed.result;
  }

  /** Provisions an `agent`-channel cart (the §6a.4 exempt-channel source) holding one
   * `restrictedProduct` line and one `visibleProduct` line — both added with NO visibility
   * check at all (§6a.4's exemption: a trusted, non-storefront `cart.lines.add` call with no
   * `routeContext`/`assortmentScope` never enforces one), proving the premise this test
   * exists to close: a restricted line CAN sit unchecked in an exempt-channel cart. */
  async function createAgentCartWithLines(): Promise<{ cartId: string; token: string; restrictedLineId: string; visibleLineId: string }> {
    const created = await execCommand<Record<string, unknown>, { cartId: string; token: string }>('cart.create', {
      channel: 'agent',
      storeId: store.storeId,
      salesChannelId: store.salesChannelId,
      currencyCode: 'EUR',
      locale: 'en-US',
      taxMode: 'net',
      customerId: null,
      customerUserId: null,
      email: null,
    });

    const restrictedAdd = await execCommand<Record<string, unknown>, { status: string; line?: { id: string } }>('cart.lines.add', {
      cartId: created.cartId,
      tenantId: adminScope.tenantId,
      organizationId: adminScope.organizationId,
      productId: restrictedProduct.productId,
      quantity: '1',
      addedByActorType: 'ai_agent',
    });
    expect(restrictedAdd.status, 'the restricted product must be admitted into the exempt-channel cart unchecked (§6a.4)').toBe('added');

    const visibleAdd = await execCommand<Record<string, unknown>, { status: string; line?: { id: string } }>('cart.lines.add', {
      cartId: created.cartId,
      tenantId: adminScope.tenantId,
      organizationId: adminScope.organizationId,
      productId: visibleProduct.productId,
      quantity: '1',
      addedByActorType: 'ai_agent',
    });
    expect(visibleAdd.status).toBe('added');

    return {
      cartId: created.cartId,
      token: created.token,
      restrictedLineId: restrictedAdd.line!.id,
      visibleLineId: visibleAdd.line!.id,
    };
  }

  test('merging an exempt-channel cart rejects the restricted line and recovers via undo-merge', async () => {
    await bootstrapFromAppRoot(APP_ROOT);
    const source = await createAgentCartWithLines();
    const target = await createStorefrontCart(store.hostname);
    // §7.1's merge policy resolves to ADOPT (row 1, `strategy: 'replace'`) whenever the
    // TARGET is empty — a different code path that never calls `buildMergeOutcome` at all
    // (merge.ts's own header comment: "no line is newly admitted into a DIFFERENT cart by
    // either of those rows"). This test's whole premise (§6a.5's REJECTION mechanism) only
    // exercises rows 3-5, so the target needs a pre-existing customer line of its own —
    // `visibleProduct` again, so the source's own `visibleLineId` SUMS into it rather than
    // creating a brand-new target line.
    const targetSeed = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: target.token,
      body: { productId: visibleProduct.productId, quantity: '1' },
    });
    expect(targetSeed.status, targetSeed.text).toBe(201);

    const mergeResponse = await cartStorefrontRequest(store.hostname, CART_MERGE_PATH, {
      method: 'POST',
      cartToken: target.token,
      body: { sourceToken: source.token },
    });
    expect(mergeResponse.status, mergeResponse.text).toBe(200);

    const mergeBody = mergeResponse.body as {
      cart: { token: string; lines: Array<{ id: string; productId: string }> };
      mergeSummary: {
        counts: { merged: number; summed: number; capped: number; declined: number; rejected: number };
        lines: Array<{ sourceLineId: string; targetLineId: string | null; disposition: string; reason?: string }>;
      };
    };

    // 1) Absent from the target cart's actual lines.
    const targetProductIds = mergeBody.cart.lines.map((line) => line.productId);
    expect(targetProductIds).not.toContain(restrictedProduct.productId);
    expect(targetProductIds).toContain(visibleProduct.productId);

    // 2) Present in `mergeSummary` with `disposition: 'rejected'` — and the partial rejection
    //    never fails the whole merge (R13-02): the visible line still sums into the target's
    //    own pre-existing line of the same product.
    expect(mergeBody.mergeSummary.counts).toMatchObject({ summed: 1, rejected: 1 });
    const rejectedEntry = mergeBody.mergeSummary.lines.find((entry) => entry.sourceLineId === source.restrictedLineId);
    expect(rejectedEntry).toMatchObject({ targetLineId: null, disposition: 'rejected', reason: 'product_unavailable' });
    const summedEntry = mergeBody.mergeSummary.lines.find((entry) => entry.sourceLineId === source.visibleLineId);
    expect(summedEntry).toMatchObject({ disposition: 'summed' });
    // Every incoming line appears under exactly one disposition (R13-04).
    expect(mergeBody.mergeSummary.lines).toHaveLength(2);

    // 3) Present in the persisted `CartMergeLog.outcome` — a DB read, not just the response.
    const mergeLog = await readLatestCartMergeLog(target.cartId);
    expect(mergeLog, 'a CartMergeLog row must exist for this merge').not.toBeNull();
    const loggedRejected = mergeLog!.outcome.find((entry) => entry.sourceLineId === source.restrictedLineId);
    expect(loggedRejected).toMatchObject({ targetLineId: null, disposition: 'rejected', reason: 'product_unavailable' });

    // 4) Still present in `source_snapshot` — never silently dropped.
    const snapshotLineIds = (mergeLog!.sourceSnapshot.lines ?? []).map((line) => line.id);
    expect(snapshotLineIds).toContain(source.restrictedLineId);

    // 5) `cart.line.visibility_rejected` fires with `triggeredBy: 'merge'` — already covered
    //    at the jest level (`commands/__tests__/merge.test.ts`'s own TC-CART-R13-01/R13-06);
    //    the rejected count above (`counts.rejected === 1`) is this live stack's own proof
    //    the same code path actually ran against real Postgres, not just a mock.

    // Recoverable (R13-03): `undo-merge` within the window restores the pre-merge target —
    // the rotated token the merge response returned is the one that must be presented.
    const undoResponse = await cartStorefrontRequest(store.hostname, CART_UNDO_MERGE_PATH, {
      method: 'POST',
      cartToken: mergeBody.cart.token,
      body: {},
    });
    expect(undoResponse.status, undoResponse.text).toBe(200);
    const undoBody = undoResponse.body as { cart: { lines: Array<{ productId: string; quantity: string }> } };
    // The target started with exactly one `visibleProduct` line at quantity 1 — undo must
    // restore exactly that (the summed quantity reverted, not a second line created).
    expect(undoBody.cart.lines).toHaveLength(1);
    expect(undoBody.cart.lines[0].productId).toBe(visibleProduct.productId);
    expect(Number(undoBody.cart.lines[0].quantity)).toBe(1);
  });
});
