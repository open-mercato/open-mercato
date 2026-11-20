import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp } from './helpers';

/**
 * TC-PROM-062 / TC-PROM-071: the shared quantity-cap write-path rejections
 * (§Data Models "Write-path rejections (422), normative") are enforced, not
 * merely documented. Every sub-case here fails Zod validation inside
 * `promotionTreeUpdateSchema.parse(...)` at the route BEFORE the command
 * loads the promotion or checks the optimistic lock, so a fixed, reused
 * promotion and a throwaway `updatedAt` are safe across every sub-test.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Data Models +
 * §B.9 (TC-PROM-062, TC-PROM-071).
 */
test.describe('TC-PROM-062 / TC-PROM-071: quantity-cap write-path rejections', () => {
  let token: string;
  let promotionId: string;
  let rootGroupId: string;
  // Every rejected PUT below fails `promotionTreeUpdateSchema.parse(...)` at
  // the route, BEFORE the command ever loads the promotion — so the real
  // `updatedAt` never advances across those sub-cases and a throwaway value
  // is safe for them. The one accepting sub-case at the end reaches the
  // command's optimistic-lock check for real, so it needs this captured value.
  let currentUpdatedAt: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    const fixture = await createPromotionFixture(request, token, {
      name: `QA PROM 062-071 ${uniqueStamp()}`,
      order: 1,
    });
    promotionId = fixture.id;
    rootGroupId = fixture.rootGroupId;
    currentUpdatedAt = fixture.updatedAt;
  });

  test.afterAll(async ({ request }) => {
    await deletePromotionIfExists(request, token, promotionId);
  });

  async function putTreeWithBenefit(request: import('@playwright/test').APIRequestContext, benefit: Record<string, unknown>) {
    return apiRequest(request, 'PUT', promotionTreePath(promotionId), {
      token,
      data: {
        updatedAt: new Date().toISOString(),
        root: { id: rootGroupId, operator: 'and', sortOrder: 0, rules: [], benefits: [benefit], children: [] },
      },
    });
  }

  test('a cap with no selector is rejected 422 (TC-PROM-062)', async ({ request }) => {
    const response = await putTreeWithBenefit(request, {
      benefitType: 'product_discount',
      appliesTo: 'line',
      config: { discountType: 'percentage', value: '10', labels: { en: 'x' }, maxQuantity: 5 },
    });
    expect(response.status()).toBe(422);
  });

  test('selector "all" combined with a cap is rejected 422 (TC-PROM-062)', async ({ request }) => {
    const response = await putTreeWithBenefit(request, {
      benefitType: 'product_discount',
      appliesTo: 'line',
      config: { discountType: 'percentage', value: '10', labels: { en: 'x' }, maxQuantity: 5, selector: 'all' },
    });
    expect(response.status()).toBe(422);
  });

  test('selector "nth" combined with a cap is rejected 422 (TC-PROM-071)', async ({ request }) => {
    const response = await putTreeWithBenefit(request, {
      benefitType: 'product_discount',
      appliesTo: 'line',
      config: { discountType: 'percentage', value: '10', labels: { en: 'x' }, maxQuantity: 5, selector: 'nth', nthPosition: 1 },
    });
    expect(response.status()).toBe(422);
  });

  test('selector "nth" without nthPosition is rejected 422 (TC-PROM-071)', async ({ request }) => {
    const response = await putTreeWithBenefit(request, {
      benefitType: 'product_discount',
      appliesTo: 'line',
      config: { discountType: 'percentage', value: '10', labels: { en: 'x' }, selector: 'nth' },
    });
    expect(response.status()).toBe(422);
  });

  test('nthPosition without selector "nth" is rejected 422 (TC-PROM-071)', async ({ request }) => {
    const response = await putTreeWithBenefit(request, {
      benefitType: 'product_discount',
      appliesTo: 'line',
      config: { discountType: 'percentage', value: '10', labels: { en: 'x' }, selector: 'cheapest', nthPosition: 3 },
    });
    expect(response.status()).toBe(422);
  });

  test('a quantity cap on an order-target benefit is rejected 422 (TC-PROM-071)', async ({ request }) => {
    const response = await putTreeWithBenefit(request, {
      benefitType: 'cart_discount',
      appliesTo: 'order',
      config: { discountType: 'percentage', value: '10', labels: { en: 'x' }, maxQuantity: 3 },
    });
    expect(response.status()).toBe(422);
  });

  test('quantityStep under appliesTo "line" is rejected 422 (TC-PROM-071)', async ({ request }) => {
    const response = await putTreeWithBenefit(request, {
      benefitType: 'product_discount',
      appliesTo: 'line',
      config: { discountType: 'percentage', value: '5', labels: { en: 'step' }, quantityStep: 3 },
    });
    expect(response.status()).toBe(422);
  });

  test('a well-formed capped benefit (selector + maxQuantity under appliesTo "unit") is accepted', async ({ request }) => {
    const response = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
      token,
      data: {
        updatedAt: currentUpdatedAt,
        root: {
          id: rootGroupId,
          operator: 'and',
          sortOrder: 0,
          rules: [],
          benefits: [
            {
              benefitType: 'product_discount',
              appliesTo: 'unit',
              config: { discountType: 'percentage', value: '10', labels: { en: 'ok' }, maxQuantity: 5, selector: 'cheapest' },
            },
          ],
          children: [],
        },
      },
    });
    expect(response.status(), 'a correctly-shaped capped benefit must not be rejected').toBe(200);
  });
});
