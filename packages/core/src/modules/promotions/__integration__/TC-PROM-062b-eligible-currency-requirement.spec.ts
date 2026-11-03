import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import {
  PROMOTIONS_PATH,
  createPromotionFixture,
  deletePromotionIfExists,
  getPromotionDetail,
  promotionTreePath,
  uniqueStamp,
} from './helpers';

/**
 * TC-PROM-062b: a `fixed`-amount benefit requires exactly one
 * `eligibleCurrencies` entry on the promotion (D-R4-27) — rejected 422 when
 * absent, accepted once the promotion is scoped to a single currency.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Data Models
 * (D-R4-27) + `data/validators.ts` `assertPromotionCurrencyRequirements`.
 */
test.describe('TC-PROM-062b: single eligible-currency requirement for fixed-amount benefits', () => {
  test('a fixed-amount benefit without a single eligible currency is rejected 422, then accepted once scoped', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      // No eligibleCurrencies set (defaults to []) — the promotion is
      // currency-unscoped.
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 062b ${stamp}`, order: 1 });
      promotionId = fixture.id;

      const fixedBenefitTree = {
        id: fixture.rootGroupId,
        operator: 'and' as const,
        sortOrder: 0,
        rules: [],
        benefits: [
          {
            benefitType: 'product_discount',
            appliesTo: 'line',
            config: { discountType: 'fixed', value: '5.00', labels: { en: 'fixed off' } },
          },
        ],
        children: [],
      };

      const rejected = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: { updatedAt: fixture.updatedAt, root: fixedBenefitTree },
      });
      expect(rejected.status(), 'fixed-amount benefit without a single eligible currency should 422').toBe(422);

      // Scope the promotion to exactly one currency.
      const scopeUpdate = await apiRequest(request, 'PUT', PROMOTIONS_PATH, {
        token,
        data: { id: promotionId, eligibleCurrencies: ['USD'] },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: fixture.updatedAt },
      });
      expect(scopeUpdate.status()).toBe(200);

      const afterScope = await getPromotionDetail(request, token, promotionId);
      expect(afterScope.eligibleCurrencies).toEqual(['USD']);

      const accepted = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: { updatedAt: afterScope.updatedAt, root: fixedBenefitTree },
      });
      expect(accepted.status(), 'fixed-amount benefit is accepted once scoped to a single currency').toBe(200);
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
