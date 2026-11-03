import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, uniqueStamp, USAGE_REGISTER_PATH } from './helpers';
import { sumPromotionUsageInDb, deletePromotionUsageRowsInDb } from './helpers/db';

/**
 * TC-PROM-050b–056 (real-concurrency variant, Release 4 PLAN.md Step 6.8; SPEC-055
 * §Implementation Plan Phase 3 "`TC-PROM-050b`–`056` (rev — C6/D-R4-12, A-R6) — N
 * concurrent `registerUsage` calls against one promotion inside one ambient transaction
 * never jointly exceed `max_budget`" / R-H2).
 *
 * `lib/__tests__/promotion-usage-service.test.ts`'s own header comment documents this
 * exact limitation: its fake `EntityManager` accepts and ignores `lockMode`, so it can
 * only prove the SEQUENTIAL re-read-then-write decision, never a genuine race. This spec
 * is the live proof the comment calls for: N real HTTP requests to
 * `POST /api/promotions/usage/register`, fired concurrently, each for a DISTINCT orderId
 * against the SAME promotion — each request opens its OWN connection/transaction (there
 * is no ambient `transactionalEm` at the HTTP layer, confirmed by reading
 * `lib/promotions-service.ts#registerUsage` and `commands/usage.ts#resolveCommandEm`),
 * so the only thing that can prevent an overshoot is `promotion-usage-service.ts`'s real
 * `PESSIMISTIC_WRITE` lock on the `Promotion` row serializing the re-read-then-write
 * across those independent connections.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation Plan
 * Phase 3 "TC-PROM-050b-056" + §Promotion Usage Lifecycle's row-lock correction.
 */
const CONCURRENT_REGISTRATIONS = 10;
const PER_REGISTRATION_AMOUNT = 100;
const MAX_BUDGET = 500;

test.describe('TC-PROM-050b-056: concurrent registerUsage never jointly exceeds max_budget', () => {
  test(`${CONCURRENT_REGISTRATIONS} concurrent registrations of ${PER_REGISTRATION_AMOUNT} each against a ${MAX_BUDGET} budget never overshoot`, async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;
    let organizationId: string | null = null;
    let tenantId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 050B ${stamp}`,
        maxBudget: `${MAX_BUDGET}.00`,
        budgetCurrency: 'USD',
      });
      promotionId = fixture.id;
      const detail = await apiRequest(request, 'GET', `/api/promotions/${promotionId}`, { token });
      const detailBody = await readJsonSafe<{ organizationId?: string; tenantId?: string }>(detail);
      organizationId = detailBody?.organizationId ?? null;
      tenantId = detailBody?.tenantId ?? null;

      const attempts = Array.from({ length: CONCURRENT_REGISTRATIONS }, (_unused, index) =>
        apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
          token,
          data: {
            orderId: `qa-prom-050b-${stamp}-${index}`,
            orderType: 'order',
            customerId: null,
            currency: 'USD',
            appliedPromotions: [
              {
                promotionId,
                promotionName: 'QA Promo 050B',
                effects: [{ type: 'LINE_DISCOUNT', amountNet: `-${PER_REGISTRATION_AMOUNT}.00` }],
              },
            ],
          },
        }),
      );

      const responses = await Promise.all(attempts);
      const outcomes = await Promise.all(
        responses.map(async (response) => ({
          status: response.status(),
          body: await readJsonSafe<{ ok: boolean; budgetExceeded: string[] }>(response),
        })),
      );

      const accepted = outcomes.filter((entry) => entry.status === 200);
      const blocked = outcomes.filter((entry) => entry.status === 207);

      expect(accepted.length + blocked.length, 'every request must answer 200 or 207, nothing else').toBe(
        CONCURRENT_REGISTRATIONS,
      );
      for (const entry of blocked) {
        expect(entry.body?.budgetExceeded).toEqual([promotionId]);
      }

      // The core guarantee: even under real concurrency, the budget is never jointly
      // exceeded. With a budget that divides evenly by the per-call amount, the correct
      // outcome is exactly MAX_BUDGET / PER_REGISTRATION_AMOUNT acceptances — asserted as
      // the primary expectation, with the ceiling re-asserted independently via a direct
      // DB sum in case any one request legitimately failed outright (network/transport)
      // rather than being cleanly blocked.
      const expectedAcceptances = MAX_BUDGET / PER_REGISTRATION_AMOUNT;
      expect(
        accepted.length,
        `expected exactly ${expectedAcceptances} of ${CONCURRENT_REGISTRATIONS} concurrent registrations to be accepted`,
      ).toBe(expectedAcceptances);

      const consumedInDb = await sumPromotionUsageInDb({
        promotionId: promotionId!,
        organizationId: organizationId!,
        tenantId: tenantId!,
        currency: 'USD',
      });
      expect(Number(consumedInDb), 'the authoritative DB sum must never exceed max_budget').toBeLessThanOrEqual(MAX_BUDGET);
      expect(Number(consumedInDb)).toBe(accepted.length * PER_REGISTRATION_AMOUNT);
    } finally {
      await deletePromotionUsageRowsInDb(promotionId);
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
