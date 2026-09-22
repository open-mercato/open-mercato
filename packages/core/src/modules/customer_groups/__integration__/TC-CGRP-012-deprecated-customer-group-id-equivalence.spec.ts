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
 * TC-CGRP-012: the deprecated singular `PricingContext.customerGroupId`
 * yields the same resolution as the current plural `customerGroupIds: [id]`.
 * Source: PR #6268's backward-compatibility shim in `catalog/lib/pricing.ts`
 * (`matchesContext`: "Falls back to `customerGroupId` ... when
 * [`customerGroupIds`] is omitted") + PLAN.md §13 required coverage.
 *
 * This module never edits `catalog/lib/pricing.ts` (owned by #6268 — see
 * PLAN.md's Non-goals); this spec proves the ALREADY-SHIPPED shim keeps
 * working end-to-end through `customer_groups`' own real data: a real group,
 * a real membership, and a real group-scoped `CatalogProductPrice` row
 * created over HTTP exactly like TC-CGRP-007.
 */
const GROUPS_PATH = '/api/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer-groups/memberships';
const PRICES_PATH = '/api/catalog/prices';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';

async function createPriceKindFixture(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: { code: `qa_cgrp012_${stamp}`, title: `QA CGRP 012 Price Kind ${stamp}` },
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
  return {
    id: str('id', 'id') ?? '',
    kind: str('kind', 'kind') ?? 'regular',
    minQuantity: num('minQuantity', 'min_quantity', 1),
    customerGroupId: str('customerGroupId', 'customer_group_id'),
  } as unknown as PriceRow;
}

test.describe('TC-CGRP-012: deprecated PricingContext.customerGroupId equals customerGroupIds: [id]', () => {
  test('selectBestPrice returns the same winning row for the singular and plural fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const memberCustomerId = randomUUID();

    let groupId: string | null = null;
    let membershipId: string | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let currencyId: string | null = null;
    let currencyCode: string | null = null;
    let baselinePriceId: string | null = null;
    let groupScopedPriceId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-012-${stamp}`,
        name: `QA CGRP 012 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });
      membershipId = await createCustomerGroupMembershipFixture(request, token, {
        groupId,
        customerId: memberCustomerId,
      });

      productId = await createProductFixture(request, token, {
        title: `QA CGRP 012 Product ${stamp}`,
        sku: `QA-CGRP-012-${stamp}`,
      });
      priceKindId = await createPriceKindFixture(request, token, stamp);
      const currency = await createRandomCurrencyFixture(request, token, { name: `QA CGRP 012 Currency ${stamp}` });
      currencyId = currency.id;
      currencyCode = currency.code;

      // Baseline unscoped row: proves the deprecated field's equivalence is
      // specifically about group matching, not "the only candidate always wins".
      const baselineResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: { productId, priceKindId, currencyCode, minQuantity: 1, unitPriceNet: 50 },
      });
      expect(baselineResponse.status(), 'baseline price create should be 201').toBe(201);
      baselinePriceId = expectId(
        (await readJsonSafe<{ id?: string }>(baselineResponse))?.id,
        'baseline price should return an id',
      );

      const groupPriceResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: { productId, priceKindId, currencyCode, minQuantity: 1, unitPriceNet: 30, customerGroupId: groupId },
      });
      expect(groupPriceResponse.status(), 'group-scoped price create should be 201').toBe(201);
      groupScopedPriceId = expectId(
        (await readJsonSafe<{ id?: string }>(groupPriceResponse))?.id,
        'group-scoped price should return an id',
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
      const baselineRaw = items.find((item) => item.id === baselinePriceId);
      const groupScopedRaw = items.find((item) => item.id === groupScopedPriceId);
      expect(baselineRaw, 'baseline price row should be readable').toBeTruthy();
      expect(groupScopedRaw, 'group-scoped price row should be readable').toBeTruthy();
      const rows: PriceRow[] = [toPriceRow(baselineRaw!), toPriceRow(groupScopedRaw!)];

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
      expect(memberGroupIds).toContain(groupId);

      // Deprecated singular field.
      const singularCtx: PricingContext = { customerGroupId: groupId, quantity: 1, date: new Date() };
      const singularWinner = selectBestPrice(rows, singularCtx);

      // Current plural field.
      const pluralCtx: PricingContext = { customerGroupIds: [groupId], quantity: 1, date: new Date() };
      const pluralWinner = selectBestPrice(rows, pluralCtx);

      expect(singularWinner?.id, 'the deprecated customerGroupId must resolve the group-scoped row').toBe(
        groupScopedPriceId,
      );
      expect(pluralWinner?.id, 'customerGroupIds: [id] must resolve the same group-scoped row').toBe(
        groupScopedPriceId,
      );
      expect(singularWinner?.id, 'both PricingContext shapes must resolve the exact same winning row').toBe(
        pluralWinner?.id,
      );
    } finally {
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, groupScopedPriceId);
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, baselinePriceId);
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId);
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteCustomerGroupMembershipIfExists(request, token, membershipId);
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });
});
