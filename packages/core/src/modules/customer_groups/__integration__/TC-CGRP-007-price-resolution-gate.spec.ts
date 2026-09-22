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
 * TC-CGRP-007: THE PHASE 1 GATE — "a price row authored against a real group
 * resolves for a member and not for a non-member."
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13/§14 Phase 1
 * acceptance gate.
 *
 * `resolveGroups()` (services/customerGroupsService.ts) has no direct HTTP
 * endpoint. Per the plan's guidance for this step, this spec proves the same
 * outcome fully at the HTTP level (option "b"): it creates a real membership
 * through `POST /api/customer-groups/memberships`, then reads the group id
 * BACK via `GET /api/customer-groups/memberships?customerId=...` (the same
 * wire response a caller would see) instead of importing/resolving the
 * `customerGroupsService` DI service directly. `PricingContext.customerGroupIds`
 * is built from that real HTTP response, then fed into the real
 * `catalog`'s `selectBestPrice` resolver — the exact function
 * `catalogPricingService` uses in production (see
 * `packages/core/src/modules/catalog/AGENTS.md` § Always).
 *
 * Mirrors `packages/core/src/modules/catalog/__integration__/TC-CAT-PRICES-001.spec.ts`
 * for the catalog-side fixtures (product, price-kind, currency, price rows)
 * and the `selectBestPrice` call shape.
 */
const GROUPS_PATH = '/api/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer-groups/memberships';
const PRICES_PATH = '/api/catalog/prices';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';

async function createPriceKindFixture(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: { code: `qa_cgrp007_${stamp}`, title: `QA CGRP 007 Price Kind ${stamp}` },
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

test.describe('TC-CGRP-007: Phase 1 gate — group-scoped price resolves for a member, not for a non-member', () => {
  test('selectBestPrice honors real HTTP-resolved group membership', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const memberCustomerId = randomUUID();
    const nonMemberCustomerId = randomUUID();

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
        code: `qa-cgrp-007-${stamp}`,
        name: `QA CGRP 007 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });
      membershipId = await createCustomerGroupMembershipFixture(request, token, {
        groupId,
        customerId: memberCustomerId,
      });

      productId = await createProductFixture(request, token, {
        title: `QA CGRP 007 Product ${stamp}`,
        sku: `QA-CGRP-007-${stamp}`,
      });
      priceKindId = await createPriceKindFixture(request, token, stamp);
      const currency = await createRandomCurrencyFixture(request, token, { name: `QA CGRP 007 Currency ${stamp}` });
      currencyId = currency.id;
      currencyCode = currency.code;

      // Baseline: unscoped price for the same product/currency/kind.
      const baselineResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: { productId, priceKindId, currencyCode, minQuantity: 1, unitPriceNet: 50 },
      });
      expect(baselineResponse.status(), 'baseline price create should be 201').toBe(201);
      baselinePriceId = expectId(
        (await readJsonSafe<{ id?: string }>(baselineResponse))?.id,
        'baseline price should return an id',
      );

      // Group-scoped: the row this gate exists to prove.
      const groupPriceResponse = await apiRequest(request, 'POST', PRICES_PATH, {
        token,
        data: { productId, priceKindId, currencyCode, minQuantity: 1, unitPriceNet: 30, customerGroupId: groupId },
      });
      expect(groupPriceResponse.status(), 'group-scoped price create should be 201').toBe(201);
      groupScopedPriceId = expectId(
        (await readJsonSafe<{ id?: string }>(groupPriceResponse))?.id,
        'group-scoped price should return an id',
      );

      // Read both prices back exactly like a real caller would.
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

      // The wire-level membership resolution this gate is about: fetch the
      // member customer's real active group ids via the memberships API.
      const memberMembershipsResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(memberCustomerId)}&activeOnly=true&pageSize=100`,
        { token },
      );
      const memberMembershipsBody = await readJsonSafe<{ items?: Array<{ group_id?: string; groupId?: string }> }>(
        memberMembershipsResponse,
      );
      const memberGroupIds = (memberMembershipsBody?.items ?? [])
        .map((item) => item.groupId ?? item.group_id)
        .filter((id): id is string => typeof id === 'string');
      expect(memberGroupIds, 'the member customer should resolve at least the fixture group over HTTP').toContain(
        groupId,
      );

      // The non-member customer has never had a membership row created —
      // its real (empty) resolution is likewise fetched over HTTP, not assumed.
      const nonMemberMembershipsResponse = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(nonMemberCustomerId)}&activeOnly=true&pageSize=100`,
        { token },
      );
      const nonMemberMembershipsBody = await readJsonSafe<{ items?: Array<unknown> }>(nonMemberMembershipsResponse);
      expect(nonMemberMembershipsBody?.items ?? [], 'the non-member customer must have zero memberships').toHaveLength(
        0,
      );

      // MEMBER: the group-scoped row (more specific, higher score) wins.
      const memberCtx: PricingContext = { customerGroupIds: memberGroupIds, quantity: 1, date: new Date() };
      const memberWinner = selectBestPrice(rows, memberCtx);
      expect(memberWinner?.id, 'a member of the group must resolve the group-scoped price row').toBe(
        groupScopedPriceId,
      );

      // NON-MEMBER: the group-scoped row is filtered out by `matchesContext`
      // (its `customerGroupId` is not in an empty `customerGroupIds` set); the
      // baseline (unscoped) row is what resolves instead.
      const nonMemberCtx: PricingContext = { customerGroupIds: [], quantity: 1, date: new Date() };
      const nonMemberWinner = selectBestPrice(rows, nonMemberCtx);
      expect(
        nonMemberWinner?.id,
        'a non-member must NOT resolve the group-scoped price row; it falls through to the unscoped baseline',
      ).toBe(baselinePriceId);
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
