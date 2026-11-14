import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import {
  cleanupSecondTenantActor,
  createPromotionFixture,
  createSecondTenantActor,
  deletePromotionIfExists,
  PROMOTIONS_FEATURES,
  promotionTreePath,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-PROM-081: cross-tenant isolation for the four Step 2.7 cart-facing routes
 * (`POST /api/promotions/evaluate`, `POST /api/promotions/product-page`,
 * `GET /api/promotions/dynamic-labels`, `POST /api/promotions/free-products`).
 * `TC-PROM-004` already covers the Phase-1 admin CRUD routes; this spec is the
 * missing cart-facing counterpart (Step 2.8).
 *
 * Two promotions are created under tenant A:
 *  - a "no-rule" promotion (empty root group — vacuously matches ANY cart under
 *    ANY tenant if tenant scoping were broken) carrying a `cart_discount` AND a
 *    `free_product` benefit, exercising `evaluate` and `free-products`.
 *  - a `product`-rule promotion targeting a tenant-A-only product, exercising
 *    `product-page` and `dynamic-labels`.
 *
 * Tenant B (a freshly provisioned, unrelated tenant/org/role/user, same pattern
 * as `TC-PROM-004`) must never see either promotion through any of the four
 * routes, even though its own request payload is deliberately shaped to match
 * the no-rule promotion's benefits exactly (an empty rule tree matches
 * everything if the tenant/organization scoping on the promotion cache or the
 * route's auth-derived scope resolution ever regresses).
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Cart-Facing
 * Endpoints + §API Contracts intro paragraph (tenant/organization ownership
 * check before use) + §Implementation Plan Phase 2 step 8.
 */
const EVALUATE_PATH = '/api/promotions/evaluate';
const PRODUCT_PAGE_PATH = '/api/promotions/product-page';
const DYNAMIC_LABELS_PATH = '/api/promotions/dynamic-labels';
const FREE_PRODUCTS_PATH = '/api/promotions/free-products';

function buildCartPayload(): Record<string, unknown> {
  return {
    items: [
      {
        lineId: randomUUID(),
        productId: randomUUID(),
        variantId: null,
        quantity: '1',
        unitPriceNet: '20.00',
        unitPriceGross: '24.60',
        priceIsPromotional: false,
      },
    ],
    currency: 'USD',
    evaluatedAt: new Date().toISOString(),
    buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
    customerOrderCount: null,
    cartWeight: null,
    codes: [],
  };
}

test.describe('TC-PROM-081: cart-facing routes cross-tenant isolation', () => {
  test('a tenant-A promotion is never visible or matched through evaluate/product-page/dynamic-labels/free-products under tenant B', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();

    let actor: SecondTenantActor | null = null;
    let noRulePromotionId: string | null = null;
    let productRulePromotionId: string | null = null;
    let productId: string | null = null;
    const sku = `QA-PROM-081-${stamp}`;

    try {
      actor = await createSecondTenantActor(request, superadminToken, stamp, [
        ...PROMOTIONS_FEATURES,
        'promotions.evaluate',
      ]);

      // --- Fixture 1: a no-rule promotion that would match ANY tenant's cart if
      // tenant/organization scoping were broken — covers `evaluate` + `free-products`.
      const rewardProductId = randomUUID();
      const noRuleFixture = await createPromotionFixture(request, adminToken, {
        name: `QA PROM 081 NoRule ${stamp}`,
        order: 1,
        active: true,
      });
      noRulePromotionId = noRuleFixture.id;
      const noRulePut = await apiRequest(request, 'PUT', promotionTreePath(noRulePromotionId), {
        token: adminToken,
        data: {
          updatedAt: noRuleFixture.updatedAt,
          root: {
            id: noRuleFixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [],
            benefits: [
              {
                benefitType: 'cart_discount',
                appliesTo: 'order',
                config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Tenant A only' } },
              },
              {
                benefitType: 'free_product',
                appliesTo: 'order',
                config: { productId: rewardProductId, categoryId: null, quantity: 1, labels: { en: 'Tenant A free gift' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(noRulePut.status(), 'no-rule tree PUT should succeed').toBe(200);

      // --- Fixture 2: a product-rule promotion targeting a tenant-A-only product —
      // covers `product-page` + `dynamic-labels`.
      productId = await createProductFixture(request, adminToken, { title: `QA PROM 081 Product ${stamp}`, sku });
      const productRuleFixture = await createPromotionFixture(request, adminToken, {
        name: `QA PROM 081 Product ${stamp}`,
        order: 2,
        active: true,
      });
      productRulePromotionId = productRuleFixture.id;
      const productRulePut = await apiRequest(request, 'PUT', promotionTreePath(productRulePromotionId), {
        token: adminToken,
        data: {
          updatedAt: productRuleFixture.updatedAt,
          root: {
            id: productRuleFixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [{ ruleType: 'product', config: { productId, variantId: null, quantity: 1, operator: 'gte' } }],
            benefits: [
              {
                benefitType: 'cart_discount',
                appliesTo: 'order',
                config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Tenant A product badge' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(productRulePut.status(), 'product-rule tree PUT should succeed').toBe(200);

      // Sanity: both fixtures are real and visible under tenant A's own token before
      // asserting what tenant B must NOT see (mirrors TC-PROM-004's "survivor" check).
      const sanityEvaluate = await apiRequest(request, 'POST', EVALUATE_PATH, { token: adminToken, data: buildCartPayload() });
      expect(sanityEvaluate.status()).toBe(200);
      const sanityEvaluateBody = await readJsonSafe<{ appliedPromotions: Array<{ promotionId: string }> }>(sanityEvaluate);
      expect(
        sanityEvaluateBody?.appliedPromotions.some((entry) => entry.promotionId === noRulePromotionId),
        'the no-rule promotion must match under tenant A itself',
      ).toBe(true);

      // === evaluate: tenant B must not see the no-rule promotion ===
      const evaluateB = await apiRequest(request, 'POST', EVALUATE_PATH, { token: actor.token, data: buildCartPayload() });
      expect(evaluateB.status(), 'evaluate under tenant B should return 200').toBe(200);
      const evaluateBBody = await readJsonSafe<{ appliedPromotions: Array<{ promotionId: string }> }>(evaluateB);
      expect(
        evaluateBBody?.appliedPromotions.some((entry) => entry.promotionId === noRulePromotionId),
        'tenant B evaluate must never match the tenant-A no-rule promotion',
      ).toBe(false);

      // === free-products: tenant B must not see the no-rule promotion's free item offer ===
      const freeProductsB = await apiRequest(request, 'POST', FREE_PRODUCTS_PATH, { token: actor.token, data: buildCartPayload() });
      expect(freeProductsB.status(), 'free-products under tenant B should return 200').toBe(200);
      const freeProductsBBody = await readJsonSafe<{ appliedPromotions: Array<{ promotionId: string }> }>(freeProductsB);
      expect(
        freeProductsBBody?.appliedPromotions.some((entry) => entry.promotionId === noRulePromotionId),
        'tenant B free-products must never offer the tenant-A no-rule promotion\'s free item',
      ).toBe(false);

      // === product-page: tenant B must get no badge for the tenant-A-only SKU ===
      const productPageB = await apiRequest(request, 'POST', PRODUCT_PAGE_PATH, { token: actor.token, data: { skus: [sku] } });
      expect(productPageB.status(), 'product-page under tenant B should return 200').toBe(200);
      const productPageBBody = await readJsonSafe<{ badges: Array<{ sku: string; promotionId: string }> }>(productPageB);
      expect(
        (productPageBBody?.badges ?? []).filter((badge) => badge.sku === sku),
        'tenant B product-page must never badge the tenant-A-only SKU',
      ).toHaveLength(0);

      // === dynamic-labels: tenant B must never list either tenant-A promotion ===
      const dynamicLabelsB = await apiRequest(request, 'GET', DYNAMIC_LABELS_PATH, { token: actor.token });
      expect(dynamicLabelsB.status(), 'dynamic-labels under tenant B should return 200').toBe(200);
      const dynamicLabelsBBody = await readJsonSafe<{ promotions: Array<{ promotionId: string }> }>(dynamicLabelsB);
      const visibleIdsForB = new Set((dynamicLabelsBBody?.promotions ?? []).map((entry) => entry.promotionId));
      expect(visibleIdsForB.has(noRulePromotionId), 'tenant B dynamic-labels must never list the tenant-A no-rule promotion').toBe(false);
      expect(
        visibleIdsForB.has(productRulePromotionId),
        'tenant B dynamic-labels must never list the tenant-A product-rule promotion',
      ).toBe(false);

      // The tenant-A promotions and product survive untouched under tenant A's own token.
      const survivorProductPage = await apiRequest(request, 'POST', PRODUCT_PAGE_PATH, { token: adminToken, data: { skus: [sku] } });
      expect(survivorProductPage.status()).toBe(200);
      const survivorProductPageBody = await readJsonSafe<{ badges: Array<{ sku: string; promotionId: string }> }>(survivorProductPage);
      expect(
        (survivorProductPageBody?.badges ?? []).some((badge) => badge.sku === sku && badge.promotionId === productRulePromotionId),
        'tenant A must still see its own product-page badge',
      ).toBe(true);
    } finally {
      await deletePromotionIfExists(request, adminToken, noRulePromotionId);
      await deletePromotionIfExists(request, adminToken, productRulePromotionId);
      await deleteCatalogProductIfExists(request, adminToken, productId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
