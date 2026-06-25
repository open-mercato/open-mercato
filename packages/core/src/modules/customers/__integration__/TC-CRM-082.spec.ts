import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  createDealFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';
import { randomUUID } from 'node:crypto';

/**
 * TC-CRM-082: Deals KPI summary endpoint (`GET /api/customers/deals/summary`).
 * Source spec: .ai/specs/2026-06-08-deals-list-redesign.md ("Integration Test Coverage").
 *
 * Verified-against-source contract (`api/deals/summary/route.ts`):
 * - Returns the four KPI cards (pipelineValue, activeDeals, wonThisQuarter, winRate) with
 *   quarter-over-quarter deltas, a per-stage open-pipeline breakdown, top owners, and a
 *   6-month win-rate series. All money is converted to the tenant base currency where rates
 *   are available; partial conversions are disclosed via `convertedAll` / `missingRateCurrencies`.
 * - `activeDeals.value` / `pipelineValue.value` aggregate OPEN deals (status ∈ {open, in_progress}).
 * - `wonThisQuarter` counts deals (status='win' OR closure_outcome='won') whose `updated_at` falls
 *   in the current quarter — a freshly-created `win` deal qualifies (updated_at = now).
 * - `needAttention` = open + overdue (expected_close_at < today) ∪ stuck deals.
 * - Requires auth: an unauthenticated GET returns 401.
 *
 * The summary aggregates ALL org deals, so demo/seeded deals are present in the totals. This test
 * is therefore deterministic against shared data by asserting BEFORE→AFTER DELTAS for the fixtures
 * it seeds, never absolute totals. Fully self-contained: all fixtures are created in `try` and
 * removed in `finally` (deals → stage → pipeline → company, to avoid FK conflicts).
 */

const SUMMARY_PATH = '/api/customers/deals/summary';

type SummaryDelta = { value: number; direction: 'up' | 'down' | 'unchanged' };

type DealsSummaryResponse = {
  baseCurrencyCode: string | null;
  convertedAll: boolean;
  missingRateCurrencies: string[];
  pipelineValue: {
    value: number;
    delta: SummaryDelta;
    stages: { stage: string | null; count: number; value: number }[];
  };
  activeDeals: {
    value: number;
    delta: SummaryDelta;
    ownersCount: number;
    needAttention: number;
    owners: { id: string; count: number }[];
    ownersOverflow: number;
  };
  wonThisQuarter: { value: number; delta: SummaryDelta; dealsClosed: number; avgDeal: number };
  winRate: {
    value: number;
    deltaPp: number;
    direction: 'up' | 'down' | 'unchanged';
    previousValue: number;
    series: { period: string; rate: number }[];
  };
};

async function fetchSummary(request: APIRequestContext, token: string): Promise<DealsSummaryResponse> {
  const response = await apiRequest(request, 'GET', SUMMARY_PATH, { token });
  expect(response.ok(), `GET ${SUMMARY_PATH} returned ${response.status()}`).toBeTruthy();
  const body = await readJsonSafe<DealsSummaryResponse>(response);
  expect(body, 'summary response body should parse').toBeTruthy();
  return body as DealsSummaryResponse;
}

function assertSummaryShape(summary: DealsSummaryResponse): void {
  expect(typeof summary.convertedAll).toBe('boolean');
  expect(Array.isArray(summary.missingRateCurrencies)).toBe(true);

  expect(typeof summary.pipelineValue.value).toBe('number');
  expect(typeof summary.pipelineValue.delta.value).toBe('number');
  expect(['up', 'down', 'unchanged']).toContain(summary.pipelineValue.delta.direction);
  expect(Array.isArray(summary.pipelineValue.stages)).toBe(true);

  expect(typeof summary.activeDeals.value).toBe('number');
  expect(typeof summary.activeDeals.ownersCount).toBe('number');
  expect(typeof summary.activeDeals.needAttention).toBe('number');
  expect(Array.isArray(summary.activeDeals.owners)).toBe(true);
  expect(typeof summary.activeDeals.ownersOverflow).toBe('number');

  expect(typeof summary.wonThisQuarter.value).toBe('number');
  expect(typeof summary.wonThisQuarter.dealsClosed).toBe('number');
  expect(typeof summary.wonThisQuarter.avgDeal).toBe('number');

  expect(typeof summary.winRate.value).toBe('number');
  expect(typeof summary.winRate.deltaPp).toBe('number');
  expect(['up', 'down', 'unchanged']).toContain(summary.winRate.direction);
  expect(Array.isArray(summary.winRate.series)).toBe(true);
}

test.describe('TC-CRM-082: Deals KPI summary endpoint', () => {
  test('aggregates seeded open/won/lost/overdue deals into the KPI deltas and enforces auth', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    // Unique stage label so the per-stage breakdown row is attributable to this test's deals only
    // (the route groups open pipeline by the resolved `pipeline_stage` dictionary label).
    const stageLabel = `TC-CRM-082 Stage ${stamp}`;

    let token: string | null = null;
    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    const dealIds: string[] = [];

    // Known seeded amounts. Open pipeline sum = 10000 + 20000 + 15000 (overdue) = 45000.
    const OPEN_A = 10000;
    const OPEN_B = 20000;
    const OPEN_OVERDUE = 15000;
    const WON = 50000;
    const LOST = 5000;
    const EXPECTED_OPEN_SUM = OPEN_A + OPEN_B + OPEN_OVERDUE;

    try {
      token = await getAuthToken(request, 'admin');
      const scope = getTokenScope(token);
      expect(scope.userId.length > 0, 'admin token carries a user id').toBe(true);

      // Baseline first so the base currency is known before seeding.
      const before = await fetchSummary(request, token);
      assertSummaryShape(before);
      const cur = before.baseCurrencyCode; // string | null
      const seedCurrency = cur ?? undefined; // when null, omit so deals use the system default

      companyId = await createCompanyFixture(request, token, `TC-CRM-082 Co ${stamp}`);
      pipelineId = await createPipelineFixture(request, token, { name: `TC-CRM-082 Pipe ${stamp}` });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageLabel, order: 0 });

      // ~30 days in the past, as an ISO string (schema coerces to Date). `expected_close_at` is a
      // bare date column; the route's overdue check is `expected_close_at < today`.
      const overdueIso = new Date(stamp - 30 * 24 * 60 * 60 * 1000).toISOString();

      // 2 normal OPEN deals (count toward activeDeals + pipelineValue), owned by the admin user.
      dealIds.push(await createDealFixture(request, token, {
        title: `TC-CRM-082 Open A ${stamp}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
        status: 'open',
        valueAmount: OPEN_A,
        valueCurrency: seedCurrency,
        ownerUserId: scope.userId,
      }));
      dealIds.push(await createDealFixture(request, token, {
        title: `TC-CRM-082 Open B ${stamp}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
        status: 'open',
        valueAmount: OPEN_B,
        valueCurrency: seedCurrency,
        ownerUserId: scope.userId,
      }));

      // 1 OPEN + OVERDUE deal → contributes to activeDeals, pipelineValue, AND needAttention.
      dealIds.push(await createDealFixture(request, token, {
        title: `TC-CRM-082 Overdue ${stamp}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
        status: 'open',
        valueAmount: OPEN_OVERDUE,
        valueCurrency: seedCurrency,
        ownerUserId: scope.userId,
        expectedCloseAt: overdueIso,
      }));

      // 1 WIN deal (updated_at = now → counts in wonThisQuarter + win rate). Not "open" → excluded
      // from activeDeals/pipelineValue.
      dealIds.push(await createDealFixture(request, token, {
        title: `TC-CRM-082 Won ${stamp}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
        status: 'win',
        valueAmount: WON,
        valueCurrency: seedCurrency,
        ownerUserId: scope.userId,
      }));

      // 1 LOOSE deal (counts in the current-quarter win-rate denominator).
      dealIds.push(await createDealFixture(request, token, {
        title: `TC-CRM-082 Lost ${stamp}`,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
        status: 'loose',
        valueAmount: LOST,
        valueCurrency: seedCurrency,
        ownerUserId: scope.userId,
      }));

      const after = await fetchSummary(request, token);
      assertSummaryShape(after);

      // --- Count deltas (currency-independent — assert regardless of base currency) ---

      // 3 OPEN deals seeded (2 normal + 1 overdue).
      expect(after.activeDeals.value - before.activeDeals.value, 'activeDeals.value should increase by the 3 seeded open deals').toBe(3);

      // 1 WON deal closed this quarter.
      expect(after.wonThisQuarter.dealsClosed - before.wonThisQuarter.dealsClosed, 'wonThisQuarter.dealsClosed should increase by 1').toBe(1);

      // The overdue open deal adds at least one record to "need attention".
      expect(after.activeDeals.needAttention - before.activeDeals.needAttention, 'needAttention should increase by >= 1 (the overdue deal)').toBeGreaterThanOrEqual(1);

      // The per-stage open-pipeline breakdown must include our uniquely-labelled stage with the 3 open deals.
      const stageEntry = after.pipelineValue.stages.find((entry) => entry.stage === stageLabel);
      expect(stageEntry, `pipelineValue.stages should include the seeded stage "${stageLabel}"`).toBeTruthy();
      expect(stageEntry!.count, 'seeded stage should report the 3 open deals (>= 2)').toBeGreaterThanOrEqual(2);

      // Win rate is a valid percentage and the trailing series always has 6 monthly points.
      expect(after.winRate.value, 'winRate.value should be a percentage >= 0').toBeGreaterThanOrEqual(0);
      expect(after.winRate.value, 'winRate.value should be a percentage <= 100').toBeLessThanOrEqual(100);
      expect(after.winRate.series.length, 'winRate.series should have 6 trailing-month points').toBe(6);

      // --- Money deltas (only deterministic 1:1 when a base currency exists and all seeds use it) ---
      if (cur) {
        const openSumDelta = after.pipelineValue.value - before.pipelineValue.value;
        expect(Math.abs(openSumDelta - EXPECTED_OPEN_SUM), `pipelineValue.value should increase by ~${EXPECTED_OPEN_SUM} (got delta ${openSumDelta})`).toBeLessThanOrEqual(1);

        const wonSumDelta = after.wonThisQuarter.value - before.wonThisQuarter.value;
        expect(Math.abs(wonSumDelta - WON), `wonThisQuarter.value should increase by ~${WON} (got delta ${wonSumDelta})`).toBeLessThanOrEqual(1);

        const stageValueDelta = stageEntry!.value;
        expect(stageValueDelta, 'the seeded stage value should be > 0 when seeds use the base currency').toBeGreaterThan(0);
      }

      // --- Scoping / auth: the endpoint must reject unauthenticated access ---
      const noTokenResponse = await request.fetch(
        (process.env.BASE_URL?.trim() || '') + SUMMARY_PATH,
        { method: 'GET' },
      );
      expect(noTokenResponse.status(), 'GET summary without a token should be 401').toBe(401);
    } finally {
      // Deals first (soft-delete), then stage, pipeline, company — FK-safe order.
      for (const id of dealIds) await deleteEntityIfExists(request, token, '/api/customers/deals', id);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  // Spec-mandated cross-org isolation guard (.ai/specs/2026-06-08-deals-list-redesign.md →
  // "Integration Test Coverage": "a second-org deal is excluded").
  //
  // The route scopes every aggregate by `tenant_id = ? AND organization_id IN (orgFilterIds)`,
  // where `orgFilterIds` is the caller's resolved org scope. For the (non-super-admin) tenant
  // admin sending NO selected-org cookie, that resolves to the admin's HOME org (+ descendants).
  // A deal whose `organization_id` is a DIFFERENT org of the same tenant therefore lies outside
  // the admin's filter set and MUST NOT move the admin's KPIs.
  //
  // Seeding a foreign-org deal — pure-API and ephemeral-env-safe:
  //   - The deal create route (`makeCrudRoute` + `withScopedPayload`) resolves the new record's
  //     org from `body.organizationId ?? ctx.selectedOrganizationId ?? auth.orgId`, and
  //     `parseScopedCommandInput` only constrains the TENANT (a non-super-admin must target their
  //     own tenant) — it does NOT require the organization to be the caller's home org or even to
  //     pre-exist. So POSTing a deal with an explicit synthetic `organizationId` (a fresh UUID in
  //     the admin's tenant) lands it in a "second org" the admin's summary scope excludes.
  //   - This avoids the raw-DB org insert used by TC-CRM-072 (`createOrganizationInDb`), which
  //     targets `apps/mercato/.env`'s DATABASE_URL and FK-fails against the ephemeral app's
  //     separate database. A synthetic-org-id deal needs no `organizations` row.
  // Self-contained: the foreign deal is soft-deleted in `finally`.
  test('excludes a second-org open deal from the admin org summary', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    const FOREIGN_OPEN = 999_777; // a large, unmistakable value so any leak into the totals shows.
    // A synthetic "second org" in the admin's tenant — distinct from the admin's home org.
    const foreignOrgId = randomUUID();

    let token: string | null = null;
    let foreignDealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const scope = getTokenScope(token);
      expect(scope.tenantId, 'admin token should carry a tenant id').toBeTruthy();
      expect(foreignOrgId, 'synthetic foreign org must differ from the admin home org').not.toBe(scope.organizationId);

      // Baseline: the admin org's KPIs BEFORE the foreign deal exists.
      const before = await fetchSummary(request, token);
      assertSummaryShape(before);

      // An OPEN deal of known value placed in the foreign org by passing an explicit
      // organizationId. OPEN status => it would land in `activeDeals.value` + `pipelineValue.value`
      // IF (and only if) the route failed to scope by organization.
      const createResponse = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: {
          title: `TC-CRM-082 Foreign Open ${stamp}`,
          status: 'open',
          valueAmount: FOREIGN_OPEN,
          valueCurrency: before.baseCurrencyCode ?? undefined,
          organizationId: foreignOrgId,
        },
      });
      expect(createResponse.status(), 'foreign-org deal create should return 201').toBe(201);
      const created = await readJsonSafe<{ id?: string; dealId?: string }>(createResponse);
      foreignDealId = created?.id ?? created?.dealId ?? null;
      expect(typeof foreignDealId === 'string' && foreignDealId.length > 0, 'create response should include id').toBe(true);

      // The admin (home-org scope, NO selected-org cookie) re-reads the summary.
      const after = await fetchSummary(request, token);
      assertSummaryShape(after);

      // The foreign open deal must be invisible to the admin org's aggregates: neither the open
      // deal count nor the open-pipeline value may change.
      expect(
        after.activeDeals.value,
        'a second-org open deal must NOT increase the admin org active-deal count',
      ).toBe(before.activeDeals.value);
      expect(
        after.pipelineValue.value,
        'a second-org open deal must NOT increase the admin org pipeline value',
      ).toBe(before.pipelineValue.value);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', foreignDealId);
    }
  });
});
