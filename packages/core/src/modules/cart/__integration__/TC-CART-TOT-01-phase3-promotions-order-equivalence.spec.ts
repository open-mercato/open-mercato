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
  readCartPromotionApplications,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

/**
 * TC-CART-TOT-01 (Phase 3 cut, WITH promotions) — §3.2's release invariant: "the same
 * `SalesLineSnapshot[]` plus the same `SalesAdjustmentDraft[]` produce equal
 * `SalesDocumentAmounts` for `documentKind: 'quote'` and `documentKind: 'order'`, compared
 * as 4-decimal-place numerics per key." Step 5.4's own property test already proved this
 * WITHOUT promotions, calling `salesCalculationService.calculateDocumentTotals` directly for
 * both document kinds — a pure, no-DB jest test. §3.2/§15's own text draws a hard line for
 * the Phase 3 cut: it must be built "via the existing `sales` create command against an
 * order from the cart's own lines — never a parallel order-creation stub," which needs a
 * real Postgres-backed order (order numbering, dictionaries) impractical to fake at the jest
 * level — hence a live-stack Playwright spec, the same pattern Steps 4.9/5.5/6.8 already used.
 *
 * Builds a cart with two lines, applies ONE automatic promotion (an `order_value` rule +
 * `cart_discount` benefit, matching the cart's own composition without any code) AND one
 * code-based promotion (a `code` rule + `product_discount` benefit targeting one line),
 * mixing `CART_DISCOUNT` (order-scope adjustment) and `LINE_DISCOUNT` (line-scope
 * `discountTotalNet`) effects so both of §3.2's mapping paths are exercised in the same
 * cart. Captures the cart's own `quote`-side totals, then creates a REAL `SalesOrder` via
 * `sales.orders.create` (`POST /api/sales/orders`) built from the cart's own `CartLine[]`
 * (mapped onto `orderLineCreateSchema`'s shape) and the cart's own order-scope
 * `CartPromotionApplication` rows (mapped onto `orderAdjustmentCreateSchema`'s shape), and
 * asserts the two `SalesDocumentAmounts` agree at 4 decimal places per key.
 *
 * Judgment call: the promotion/code fixtures are created with raw `apiRequest` calls here
 * rather than importing `promotions/__integration__/helpers.ts` — keeping this spec
 * self-contained per `.ai/qa/AGENTS.md` ("Integration tests MUST be self-contained") rather
 * than introducing a cross-module `__integration__` import with no existing precedent.
 *
 * Source: .ai/specs/2026-08-14-cart-module.md §3.2, §14 "Totals correctness
 * (`TC-CART-TOT-*`, ... Phase 3 gate with promotions)", §15 Phase 3 gate text.
 */
const PROMOTIONS_PATH = '/api/promotions';
const CODES_PATH = '/api/promotions/codes';
const ORDERS_PATH = '/api/sales/orders';

function promotionTreePath(id: string): string {
  return `${PROMOTIONS_PATH}/${id}/tree`;
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
    data: { name: `QA TOT Promo ${stamp}`, order: 0, active: true, eligibleCurrencies: ['EUR'], ...overrides },
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
  const code = `QA-TOT-${stamp}`.toUpperCase();
  const response = await apiRequest(request, 'POST', CODES_PATH, {
    token,
    data: { name: `QA TOT Code ${stamp}`, type: 'static', code, usage: 'single', active: true },
  });
  expect(response.status(), `code create should be 201 (${await response.text()})`).toBe(201);
  const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'code create should return an id');
  return { id, code };
}

async function deleteCodeIfExists(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  await apiRequest(request, 'DELETE', `${CODES_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined);
}

async function deleteOrderIfExists(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  await apiRequest(request, 'DELETE', `${ORDERS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined);
}

type SalesDocumentAmountsLike = Record<string, unknown>;

const TOTALS_KEYS = [
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'discountTotalAmount',
  'taxTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
] as const;

/** §3.2's own comparison rule: 4-decimal-place numerics per key, never byte-for-byte. */
function diffAt4dp(quote: SalesDocumentAmountsLike, order: SalesDocumentAmountsLike): string[] {
  const diffs: string[] = [];
  for (const key of TOTALS_KEYS) {
    const qv = Math.round((Number(quote[key] ?? 0) + Number.EPSILON) * 1e4) / 1e4;
    const ov = Math.round((Number(order[key] ?? 0) + Number.EPSILON) * 1e4) / 1e4;
    if (qv !== ov) diffs.push(`${key}: quote=${qv} order=${ov}`);
  }
  return diffs;
}

type CartLineBody = {
  id: string;
  productId: string;
  name: string;
  quantity: string;
  unitPriceNet: string | null;
  unitPriceGross: string | null;
  taxRate: string | null;
  discountTotalNet: string | null;
  origin: string;
};

/** §3.2 rule 1 (D-R4-9): the resolved effect's net line-total discount, taken AS-IS — never
 * divided by quantity. Mirrors `lib/reprice.ts`'s own `toCartTotalsLineSnapshot` mapping,
 * through `orderLineCreateSchema`'s field names (identical to `SalesLineSnapshot`'s). */
function mapCartLineToOrderLine(line: CartLineBody, currencyCode: string): Record<string, unknown> {
  const discountAmount = line.discountTotalNet !== null ? Math.abs(Number(line.discountTotalNet)) : null;
  return {
    kind: 'product',
    productId: line.productId,
    name: line.name,
    currencyCode,
    quantity: line.quantity,
    ...(line.unitPriceNet !== null ? { unitPriceNet: Number(line.unitPriceNet) } : {}),
    ...(line.unitPriceGross !== null ? { unitPriceGross: Number(line.unitPriceGross) } : {}),
    ...(line.taxRate !== null ? { taxRate: Number(line.taxRate) } : {}),
    ...(discountAmount !== null ? { discountAmount, discountAmountBasis: 'line' as const } : {}),
  };
}

function mapApplicationToOrderAdjustment(
  application: { promotionId: string; amountNet: string | null; amountGross: string | null },
  currencyCode: string,
): Record<string, unknown> {
  return {
    scope: 'order' as const,
    kind: 'discount',
    promotionId: application.promotionId,
    amountNet: application.amountNet !== null ? Number(application.amountNet) : 0,
    amountGross: application.amountGross !== null ? Number(application.amountGross) : 0,
    currencyCode,
  };
}

test.describe('TC-CART-TOT-01 (Phase 3): cart quote totals equal a real SalesOrder\'s totals, with promotions', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let productA: CartProductFixture;
  let productB: CartProductFixture;
  let adminToken: string;
  let automaticPromotionId: string | null = null;
  let codePromotionId: string | null = null;
  let codeId: string | null = null;
  let codeString = '';
  let orderId: string | null = null;

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    store = await createCartStorefrontFixture(request, adminToken, {});
    productA = await createCartProductFixture(request, adminToken, { stamp, label: 'tot-a', salesChannelId: store.salesChannelId });
    productB = await createCartProductFixture(request, adminToken, { stamp, label: 'tot-b', salesChannelId: store.salesChannelId });

    // Automatic promotion: matches the cart's own composition (order value >= 5 EUR) with no
    // code — a CART_DISCOUNT (order-scope adjustment) effect.
    const automatic = await createActivePromotion(request, adminToken, { name: `QA TOT Automatic ${stamp}` });
    automaticPromotionId = automatic.id;
    await putPromotionTree(request, adminToken, automatic, {
      rules: [{ ruleType: 'order_value', config: { value: '5.00', operator: 'gte', taxInclusive: false, limitToCategory: null } }],
      benefits: [{ benefitType: 'cart_discount', appliesTo: 'order', config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: '10% off' } } }],
    });

    // Code-based promotion: a LINE_DISCOUNT effect targeting productB only, unlocked by a
    // `ruleType: 'code'` rule naming the Code fixture's id — the only linkage mechanism
    // `cart.promotions.apply` resolves against (`commands/promotions.ts`'s own
    // `resolvePromotionIdsForCode`).
    const code = await createStaticCode(request, adminToken);
    codeId = code.id;
    codeString = code.code;
    const coded = await createActivePromotion(request, adminToken, { name: `QA TOT Coded ${stamp}` });
    codePromotionId = coded.id;
    await putPromotionTree(request, adminToken, coded, {
      rules: [{ ruleType: 'code', config: { codeId } }],
      benefits: [
        {
          benefitType: 'product_discount',
          appliesTo: 'line',
          config: {
            productId: productB.productId,
            limitToCategoryId: null,
            discountType: 'fixed',
            value: '1.00',
            maxDiscount: null,
            maxQuantity: null,
            maxLines: null,
            quantityStep: null,
            selector: 'all',
            nthPosition: null,
            labels: { en: 'Product B discount' },
          },
        },
      ],
    });
  });

  test.afterAll(async ({ request }) => {
    await deleteOrderIfExists(request, adminToken, orderId);
    await deletePromotionIfExists(request, adminToken, automaticPromotionId);
    await deletePromotionIfExists(request, adminToken, codePromotionId);
    await deleteCodeIfExists(request, adminToken, codeId);
    await cleanupCartProductFixture(request, adminToken, productA);
    await cleanupCartProductFixture(request, adminToken, productB);
    await cleanupCartStorefrontFixture(request, adminToken, store);
  });

  test('a cart with an automatic CART_DISCOUNT and a code-applied LINE_DISCOUNT reproduces identical totals through sales.orders.create', async ({ request }) => {
    const cart = await createStorefrontCart(store.hostname);

    const addA = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: productA.productId, quantity: '2' },
    });
    expect(addA.status, addA.text).toBe(201);

    const addB = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: productB.productId, quantity: '3' },
    });
    expect(addB.status, addB.text).toBe(201);

    // Applying the code dispatches `cart.reprice` internally (`trigger:'promotion_applied'`),
    // which runs `buildPromotionsEffectsPhase` — evaluating BOTH the automatic promotion
    // (already active, matches by order value) and the newly-applied code together.
    const applyCodeResponse = await cartStorefrontRequest(store.hostname, CART_PROMOTIONS_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { codeString },
    });
    expect(applyCodeResponse.status, applyCodeResponse.text).toBe(200);

    const currentResponse = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(currentResponse.status, currentResponse.text).toBe(200);
    const currentBody = currentResponse.body as { cart: { currencyCode: string; totals: SalesDocumentAmountsLike; lines: CartLineBody[] } };

    const quoteTotals = currentBody.cart.totals;
    const currencyCode = currentBody.cart.currencyCode;
    const lines = currentBody.cart.lines.filter((line) => line.origin !== 'promotion');
    expect(lines.length).toBe(2);
    const discountedLine = lines.find((line) => line.productId === productB.productId);
    expect(discountedLine?.discountTotalNet, 'the code-applied LINE_DISCOUNT must have written discountTotalNet').not.toBeNull();

    const orderScopeApplications = await readCartPromotionApplications(cart.cartId, 'order');
    expect(orderScopeApplications.length, 'the automatic promotion must have produced an order-scope CART_DISCOUNT application').toBeGreaterThan(0);

    const orderLines = lines.map((line) => mapCartLineToOrderLine(line, currencyCode));
    const orderAdjustments = orderScopeApplications.map((application) => mapApplicationToOrderAdjustment(application, currencyCode));

    const createOrderResponse = await apiRequest(request, 'POST', ORDERS_PATH, {
      token: adminToken,
      data: { currencyCode, lines: orderLines, adjustments: orderAdjustments },
    });
    expect(createOrderResponse.status(), `order create should be 201 (${await createOrderResponse.text()})`).toBe(201);
    orderId = expectId((await readJsonSafe<{ id?: string }>(createOrderResponse))?.id, 'order create should return an id');

    const orderDetailResponse = await apiRequest(request, 'GET', `${ORDERS_PATH}?id=${orderId}`, { token: adminToken });
    expect(orderDetailResponse.status()).toBe(200);
    const orderDetailBody = await readJsonSafe<{ items?: SalesDocumentAmountsLike[] }>(orderDetailResponse);
    const orderTotals = orderDetailBody?.items?.[0] as SalesDocumentAmountsLike;
    expect(orderTotals, 'order detail response should include the created order').toBeTruthy();

    const diffs = diffAt4dp(quoteTotals, orderTotals);
    expect(diffs, `totals must agree at 4dp per key: ${diffs.join('; ')}`).toEqual([]);
  });
});
