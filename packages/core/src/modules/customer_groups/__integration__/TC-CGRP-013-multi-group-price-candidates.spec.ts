import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupMembershipFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { selectBestPrice, type PriceRow, type PricingContext } from '@open-mercato/core/modules/catalog/lib/pricing';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-013: price resolution when a customer is a member of TWO groups
 * that each carry a matching, equally-specific price row for the same
 * product/kind/currency.
 * Source: PLAN.md §13 required coverage + PLAN.md's own documented Risk
 * ("Group-priority tie-break in `catalog/lib/pricing.ts` is explicitly NOT
 * implemented" — `scorePrice` gives every group-scoped row the same +3
 * regardless of which group; see `catalog/AGENTS.md` § "Resolver-chain
 * tie-break" / "Price selection order").
 *
 * IMPORTANT — what this test does NOT assert: it does NOT assert that the
 * HIGHER-priority group's row wins a tie. That behavior is not implemented in
 * this PR (out of scope per PLAN.md Risks; `catalog/lib/pricing.ts` is owned
 * by PR #6268 and this PR is constrained from editing it). Asserting a
 * priority-based winner here would fail against real, documented, intentional
 * behavior.
 *
 * What IS real and deterministic (proven below):
 *  1. Both group-scoped rows individually satisfy `matchesContext` for a
 *     customer who is a member of both groups — `customerGroupIds`
 *     containing BOTH ids means EITHER row can match on the group dimension.
 *  2. When both rows are equally scored (same kind/specificity, group-scoped
 *     `+3` on each), `selectBestPrice`'s DOCUMENTED tie-break dimension
 *     (`startsAt` descending — see `catalog/AGENTS.md` § "Price selection
 *     order") decides the winner. The winning group here is deliberately the
 *     LOWER-priority one (later `startsAt`) to make explicit that group
 *     `priority` plays no role in this resolution.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer_groups/customer-groups/memberships';
const PRICES_PATH = '/api/catalog/prices';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';

async function createPriceKindFixture(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: { code: `qa_cgrp013_${stamp}`, title: `QA CGRP 013 Price Kind ${stamp}` },
  });
  expect(response.status(), 'price-kind fixture create should be 201').toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'price-kind fixture should return an id');
}

function toPriceRow(raw: Record<string, unknown>): PriceRow {
  const str = (camel: string, snake: string): string | undefined => {
    const value = raw[camel] ?? raw[snake];
    return typeof value === 'string' && value.length ? value : undefined;
  };
  const num = (camel: string, snake: string, fallback: number): number => {
    const value = raw[camel] ?? raw[snake];
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const startsAtRaw = raw['startsAt'] ?? raw['starts_at'];
  const startsAt =
    typeof startsAtRaw === 'string' && startsAtRaw.length ? new Date(startsAtRaw) : undefined;
  return {
    id: str('id', 'id') ?? '',
    kind: str('kind', 'kind') ?? 'regular',
    minQuantity: num('minQuantity', 'min_quantity', 1),
    customerGroupId: str('customerGroupId', 'customer_group_id'),
    startsAt,
  } as unknown as PriceRow;
}

test.describe('TC-CGRP-013: two group-scoped price rows both match a multi-group member', () => {
  test('both rows individually satisfy matchesContext; the documented startsAt tie-break (not group priority) decides the winner', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const memberCustomerId = randomUUID();

    let higherPriorityGroupId: string | null = null;
    let lowerPriorityGroupId: string | null = null;
    let membershipHighId: string | null = null;
    let membershipLowId: string | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let currencyId: string | null = null;
    let currencyCode: string | null = null;
    let higherPriorityPriceId: string | null = null;
    let lowerPriorityPriceId: string | null = null;

    try {
      // Deliberately HIGHER numeric priority for group A, LOWER for group B —
      // the winner below comes from group B despite this, proving priority is
      // not the deciding dimension.
      higherPriorityGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-013-a-${stamp}`,
        name: `QA CGRP 013 Group A (higher priority) ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 100),
      });
      lowerPriorityGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-013-b-${stamp}`,
        name: `QA CGRP 013 Group B (lower priority) ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });

      membershipHighId = await createCustomerGroupMembershipFixture(request, token, {
        groupId: higherPriorityGroupId,
        customerId: memberCustomerId,
      });
      membershipLowId = await createCustomerGroupMembershipFixture(request, token, {
        groupId: lowerPriorityGroupId,
        customerId: memberCustomerId,
      });

      productId = await createProductFixture(request, token, {
        title: `QA CGRP 013 Product ${stamp}`,
        sku: `QA-CGRP-013-${stamp}`,
      });
      priceKindId = await createPriceKindFixture(request, token, stamp);
      const currency = await createRandomCurrencyFixture(request, token, { name: `QA CGRP 013 Currency ${stamp}` });
      currencyId = currency.id;
      currencyCode = currency.code;

      const now = Date.now();
      const earlierStartsAt = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      const laterStartsAt = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

      const higherPriorityPriceResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: {
          productId,
          priceKindId,
          currencyCode,
          minQuantity: 1,
          unitPriceNet: 40,
          customerGroupId: higherPriorityGroupId,
          startsAt: earlierStartsAt,
        },
      });
      expect(higherPriorityPriceResponse.status(), 'group A price create should be 201').toBe(201);
      higherPriorityPriceId = expectId(
        (await readJsonSafe<{ id?: string }>(higherPriorityPriceResponse))?.id,
        'group A price should return an id',
      );

      const lowerPriorityPriceResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: {
          productId,
          priceKindId,
          currencyCode,
          minQuantity: 1,
          unitPriceNet: 35,
          customerGroupId: lowerPriorityGroupId,
          startsAt: laterStartsAt,
        },
      });
      expect(lowerPriorityPriceResponse.status(), 'group B price create should be 201').toBe(201);
      lowerPriorityPriceId = expectId(
        (await readJsonSafe<{ id?: string }>(lowerPriorityPriceResponse))?.id,
        'group B price should return an id',
      );

      const listResponse = await apiRequest(
        request,
        'GET',
        `${PRICES_PATH}?productId=${encodeURIComponent(productId)}&pageSize=100`,
        { token },
      );
      expect(listResponse.status()).toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse);
      const items = listBody?.items ?? [];
      const higherRaw = items.find((item) => item.id === higherPriorityPriceId);
      const lowerRaw = items.find((item) => item.id === lowerPriorityPriceId);
      expect(higherRaw, 'group A price row should be readable').toBeTruthy();
      expect(lowerRaw, 'group B price row should be readable').toBeTruthy();
      const higherRow = toPriceRow(higherRaw!);
      const lowerRow = toPriceRow(lowerRaw!);

      const membershipsResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(memberCustomerId)}&activeOnly=true&pageSize=100`,
        { token },
      );
      const membershipsBody = await readJsonSafe<{ items?: Array<{ group_id?: string; groupId?: string }> }>(
        membershipsResponse,
      );
      const memberGroupIds = (membershipsBody?.items ?? [])
        .map((item) => item.groupId ?? item.group_id)
        .filter((id): id is string => typeof id === 'string');
      expect(memberGroupIds, 'the member must resolve both real groups over HTTP').toEqual(
        expect.arrayContaining([higherPriorityGroupId, lowerPriorityGroupId]),
      );

      const ctx: PricingContext = { customerGroupIds: memberGroupIds, quantity: 1, date: new Date() };

      // 1. Each row individually matches for a member of both groups —
      // customerGroupIds containing BOTH ids means EITHER row can match on
      // the group dimension alone.
      expect(
        selectBestPrice([higherRow], ctx)?.id,
        'group A row alone must match a member of both groups',
      ).toBe(higherPriorityPriceId);
      expect(
        selectBestPrice([lowerRow], ctx)?.id,
        'group B row alone must match a member of both groups',
      ).toBe(lowerPriorityPriceId);

      // 2. Together, the documented startsAt tie-break (descending) picks the
      // row with the MORE RECENT startsAt — group B's row — even though group
      // A carries the higher CustomerGroup.priority. This is the real,
      // deterministic behavior; group-priority tie-break is out of scope
      // (PLAN.md Risks).
      const winner = selectBestPrice([higherRow, lowerRow], ctx);
      expect(
        winner?.id,
        'the row with the later startsAt (group B, the LOWER-priority group) wins the tie, not the higher-priority group',
      ).toBe(lowerPriorityPriceId);
    } finally {
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, higherPriorityPriceId);
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, lowerPriorityPriceId);
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteCustomerGroupMembershipIfExists(request, token, membershipHighId);
      await deleteCustomerGroupMembershipIfExists(request, token, membershipLowId);
      await deleteCustomerGroupIfExists(request, token, higherPriorityGroupId);
      await deleteCustomerGroupIfExists(request, token, lowerPriorityGroupId);
    }
  });
});
