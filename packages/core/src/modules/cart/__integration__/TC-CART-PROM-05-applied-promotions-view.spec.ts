import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  CART_LINES_PATH,
  CART_PROMOTIONS_PATH,
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

/**
 * TC-CART-PROM-05 (QA F10) — §10.1's `promotions: AppliedPromotionView[]` was hardcoded to
 * `[]` in `buildCartResponseEnvelope` (`lib/cartView.ts`): 2 real `cart_promotion_applications`
 * rows existed for a cart (an order-scope discount from an applied code, a line-scope
 * discount from an automatic promotion) but the API response showed `promotions: []`, so a
 * storefront client could not see which discounts applied nor read the `promotionId`
 * `DELETE /api/cart/current/promotions/{promotionId}` requires.
 *
 * Builds its OWN store/product/promotion/code fixtures (never reusing another spec file's
 * `beforeAll` fixtures) per `.ai/qa/AGENTS.md`'s self-containment rule — the same
 * promotion/code construction pattern `TC-CART-TOT-01-phase3-promotions-order-equivalence.spec.ts`
 * already uses raw `apiRequest` calls for, duplicated here rather than imported (no existing
 * cross-file helper for it, and that file's own comment documents the same judgment call for
 * itself: self-contained over a shared helper with no precedent).
 *
 * Source: .ai/runs/2026-10-14-ecommerce-release-4-write-side/PLAN.md Step 8.4;
 * .ai/specs/2026-08-14-cart-module.md §10.1, §4.3.
 */
const PROMOTIONS_PATH = '/api/promotions';
const CODES_PATH = '/api/promotions/codes';

function promotionTreePath(id: string): string {
  return `${PROMOTIONS_PATH}/${id}/tree`;
}

function cartPromotionPath(promotionId: string): string {
  return `${CART_PROMOTIONS_PATH}/${encodeURIComponent(promotionId)}`;
}

type PromotionFixture = { id: string; updatedAt: string; rootGroupId: string };

async function createActivePromotion(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown>,
): Promise<PromotionFixture> {
  const stamp = uniqueStamp();
  const createResponse = await apiRequest(request, 'POST', PROMOTIONS_PATH, {
    token,
    data: { name: `QA PROM Promo ${stamp}`, order: 0, active: true, eligibleCurrencies: ['EUR'], ...overrides },
  });
  expect(createResponse.status(), `promotion create should be 201 (${await createResponse.text()})`).toBe(201);
  const id = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'promotion create should return an id');

  const detailResponse = await apiRequest(request, 'GET', `${PROMOTIONS_PATH}/${id}`, { token });
  expect(detailResponse.status()).toBe(200);
  const detail = await readJsonSafe<{ updatedAt: string; ruleGroupTree: { id: string } | null }>(detailResponse);
  const rootGroupId = detail?.ruleGroupTree?.id;
  expect(typeof rootGroupId === 'string' && rootGroupId.length > 0, 'promotion must have an auto-created root rule group').toBe(true);

  return { id, updatedAt: detail!.updatedAt, rootGroupId: rootGroupId as string };
}

async function putPromotionTree(
  request: APIRequestContext,
  token: string,
  promotion: PromotionFixture,
  root: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', promotionTreePath(promotion.id), {
    token,
    data: { updatedAt: promotion.updatedAt, root: { id: promotion.rootGroupId, operator: 'and', sortOrder: 0, children: [], ...root } },
  });
  expect(response.status(), `tree PUT should succeed (${await response.text()})`).toBe(200);
}

async function deletePromotionIfExists(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  await apiRequest(request, 'DELETE', `${PROMOTIONS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined);
}

type CodeFixture = { id: string; code: string };

async function createStaticCode(request: APIRequestContext, token: string): Promise<CodeFixture> {
  const stamp = uniqueStamp();
  const code = `QA-PROM-${stamp}`.toUpperCase();
  const response = await apiRequest(request, 'POST', CODES_PATH, {
    token,
    data: { name: `QA PROM Code ${stamp}`, type: 'static', code, usage: 'single', active: true },
  });
  expect(response.status(), `code create should be 201 (${await response.text()})`).toBe(201);
  const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'code create should return an id');
  return { id, code };
}

async function deleteCodeIfExists(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  await apiRequest(request, 'DELETE', `${CODES_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined);
}

type AppliedPromotionBody = {
  promotionId: string;
  promotionName: string;
  code: string | null;
  scope: 'order' | 'line';
  cartLineId: string | null;
  amountNet: string | null;
  amountGross: string | null;
};

test.describe('TC-CART-PROM-05 (QA F10): cart.promotions lists applied promotions, and DELETE by promotionId succeeds', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let product: CartProductFixture;
  let adminToken: string;
  let automaticPromotionId: string | null = null;
  let codePromotionId: string | null = null;
  let codeId: string | null = null;
  let codeString = '';

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    store = await createCartStorefrontFixture(request, adminToken, {});
    product = await createCartProductFixture(request, adminToken, { stamp, label: 'prom', salesChannelId: store.salesChannelId });

    // Automatic promotion: matches the cart's own composition (order value >= 5 EUR) with no
    // code — produces an order-scope CART_DISCOUNT application.
    const automatic = await createActivePromotion(request, adminToken, { name: `QA PROM Automatic ${stamp}` });
    automaticPromotionId = automatic.id;
    await putPromotionTree(request, adminToken, automatic, {
      rules: [{ ruleType: 'order_value', config: { value: '5.00', operator: 'gte', taxInclusive: false, limitToCategory: null } }],
      benefits: [{ benefitType: 'cart_discount', appliesTo: 'order', config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: '10% off' } } }],
    });

    // Code-based promotion: a line-scope LINE_DISCOUNT effect targeting the fixture product,
    // unlocked by a `ruleType: 'code'` rule naming the Code fixture's id.
    const code = await createStaticCode(request, adminToken);
    codeId = code.id;
    codeString = code.code;
    const coded = await createActivePromotion(request, adminToken, { name: `QA PROM Coded ${stamp}` });
    codePromotionId = coded.id;
    await putPromotionTree(request, adminToken, coded, {
      rules: [{ ruleType: 'code', config: { codeId } }],
      benefits: [
        {
          benefitType: 'product_discount',
          appliesTo: 'line',
          config: {
            productId: product.productId,
            limitToCategoryId: null,
            discountType: 'fixed',
            value: '1.00',
            maxDiscount: null,
            maxQuantity: null,
            maxLines: null,
            quantityStep: null,
            selector: 'all',
            nthPosition: null,
            labels: { en: 'Product discount' },
          },
        },
      ],
    });
  });

  test.afterAll(async ({ request }) => {
    await deletePromotionIfExists(request, adminToken, automaticPromotionId);
    await deletePromotionIfExists(request, adminToken, codePromotionId);
    await deleteCodeIfExists(request, adminToken, codeId);
    await cleanupCartProductFixture(request, adminToken, product);
    await cleanupCartStorefrontFixture(request, adminToken, store);
  });

  test('applying a code lists both the code promotion and the automatic one, and DELETE by the listed promotionId removes it', async () => {
    const cart = await createStorefrontCart(store.hostname);

    const addLine = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '2' },
    });
    expect(addLine.status, addLine.text).toBe(201);

    // Applying the code dispatches `cart.reprice` internally, which evaluates BOTH the
    // automatic promotion (already active, matches by order value) and the newly-applied
    // code together — exactly the live QA F10 repro's shape.
    const applyCodeResponse = await cartStorefrontRequest(store.hostname, CART_PROMOTIONS_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { codeString },
    });
    expect(applyCodeResponse.status, applyCodeResponse.text).toBe(200);
    const applyBody = applyCodeResponse.body as { cart: { promotions: AppliedPromotionBody[] } };

    const promotions = applyBody.cart.promotions;
    expect(promotions.length, `expected 2 applied promotions, got ${JSON.stringify(promotions)}`).toBe(2);

    const orderEntry = promotions.find((entry) => entry.promotionId === automaticPromotionId);
    expect(orderEntry, 'the automatic promotion must be listed').toBeTruthy();
    expect(orderEntry?.scope).toBe('order');
    expect(orderEntry?.code).toBeNull();
    expect(orderEntry?.cartLineId).toBeNull();
    expect(orderEntry?.promotionName.length).toBeGreaterThan(0);
    expect(orderEntry?.amountNet).not.toBeNull();

    const lineEntry = promotions.find((entry) => entry.promotionId === codePromotionId);
    expect(lineEntry, 'the code-applied promotion must be listed').toBeTruthy();
    expect(lineEntry?.scope).toBe('line');
    expect(lineEntry?.code).toBe(codeString);
    expect(lineEntry?.cartLineId).not.toBeNull();
    expect(lineEntry?.promotionName.length).toBeGreaterThan(0);
    expect(lineEntry?.amountNet).not.toBeNull();

    const deleteResponse = await cartStorefrontRequest(store.hostname, cartPromotionPath(lineEntry!.promotionId), {
      method: 'DELETE',
      cartToken: cart.token,
    });
    expect(deleteResponse.status, deleteResponse.text).toBe(200);
    const deleteBody = deleteResponse.body as { cart: { promotions: AppliedPromotionBody[] } };
    expect(deleteBody.cart.promotions.find((entry) => entry.promotionId === codePromotionId)).toBeUndefined();
    expect(deleteBody.cart.promotions.find((entry) => entry.promotionId === automaticPromotionId)).toBeTruthy();
  });
});
