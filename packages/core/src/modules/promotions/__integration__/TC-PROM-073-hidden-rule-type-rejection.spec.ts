import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp } from './helpers';

/**
 * Rule-type allow-list rejection: a request naming one of the six hidden
 * Release-4 rule types (`producer`, `exclude_pharmaceutical`,
 * `consent_flag`, `delivery_method`, `payment_method`, `shipping_address`)
 * is rejected 422 at the write path — `ruleInputSchema` only accepts the
 * eleven shipped types, so an unmatched `ruleType` discriminator fails the
 * tree PUT's own schema parse before any command runs, regardless of
 * whether the admin UI ever offers the hidden type.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation
 * Plan Phase 1 step 17 + §Testing Strategy Phase 1 bullet ("a hidden-rule-type
 * write rejected at the API even though the UI never offers it") +
 * `data/validators.ts` (`PROMOTIONS_HIDDEN_RULE_TYPES`, `ruleInputSchema`).
 * No official TC id is assigned to this case in the spec's own test-id list;
 * numbered TC-PROM-073 here as the next free id after the highest cited
 * (`TC-PROM-072`).
 */
test.describe('TC-PROM-073: hidden rule type rejected at the write path', () => {
  test('a "producer" rule (hidden, no data source) is rejected 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 073 ${stamp}`, order: 1 });
      promotionId = fixture.id;

      const response = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: fixture.updatedAt,
          root: {
            id: fixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [{ ruleType: 'producer', config: { producerCode: 'ACME', quantity: 1, operator: 'gte' } }],
            benefits: [],
            children: [],
          },
        },
      });
      expect(response.status(), 'a hidden rule type must be rejected 422, not silently accepted').toBe(422);
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
