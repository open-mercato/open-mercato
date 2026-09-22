import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setRoleAclFeatures,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenContext, deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCurrencyFixture,
  generateUniqueCurrencyCode,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import {
  createFiscalPeriodFixture,
  createAccountTypeFixture,
  createAccountFixture,
  seedJournalEntryInDb,
  deleteJournalEntryInDb,
} from '@open-mercato/core/helpers/integration/ledgerFixtures';

/**
 * TC-GL-001: `GET /api/ledger/journal-entries` — listing, filtering by
 * periodId/accountId, and 403 without `ledger.entries.view` (OM-14).
 *
 * Scope per the OM-14 ticket and the spec's own Testing Strategy
 * ("Integration: `GET /api/ledger/journal-entries` returns filtered results
 * and 403s without `ledger.entries.view`") — see
 * `.ai/specs/2026-08-18-general-ledger-core-engine.md`.
 *
 * `postJournalEntry` has no HTTP route in Phase 1 (API Contracts: "No
 * POST/PUT/DELETE on this route — posting only happens through
 * postJournalEntry/reverseJournalEntry [called programmatically]"), so the
 * journal entries this spec reads back are seeded directly in the database
 * via `seedJournalEntryInDb` rather than posted through the command — see
 * that helper's doc comment. Balance/period-lock/reversal/sequence-
 * concurrency behavior of the command itself is covered by the OM-13 unit
 * suite and the OM-174 BDD scenarios, not here.
 */

const randomSlug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  const id = body?.id;
  expect(typeof id === 'string' && id.length > 0).toBeTruthy();
  return id as string;
}

function scopedHeaders(scope: { tenantId: string; organizationId: string }): Record<string, string> {
  return {
    Cookie: [
      `om_selected_tenant=${encodeURIComponent(scope.tenantId)}`,
      `om_selected_org=${encodeURIComponent(scope.organizationId)}`,
    ].join('; '),
  };
}

test.describe('TC-GL-001: journal-entries list/filter/403', () => {
  test('returns 403 without ledger.entries.view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId, tenantId } = getTokenContext(adminToken);
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      roleId = await createRoleFixture(request, adminToken, { name: randomSlug('QA-GL-001-role'), tenantId });
      await setRoleAclFeatures(request, adminToken, { roleId, features: [] });
      const email = `qa-gl-001-${randomUUID().slice(0, 8)}@acme.com`;
      userId = await createUserFixture(request, adminToken, {
        email,
        password: 'secret',
        organizationId,
        roles: [roleId],
      });
      const restrictedToken = await getAuthToken(request, email, 'secret');

      const res = await apiRequest(request, 'GET', '/api/ledger/journal-entries', { token: restrictedToken });
      expect(res.status(), 'GET without ledger.entries.view should return 403').toBe(403);
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });

  test('lists all seeded entries and filters by periodId and accountId', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();

    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let currencyId: string | null = null;
    let periodAId: string | null = null;
    let periodBId: string | null = null;
    let accountTypeId: string | null = null;
    let cashAccountId: string | null = null;
    let revenueAccountId: string | null = null;
    let entryInPeriodAId: string | null = null;
    let entryInPeriodBId: string | null = null;

    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-001 Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-001 Organization ${stamp}`,
        tenantId,
      });
      const scope = { tenantId, organizationId };
      const headers = scopedHeaders(scope);

      currencyId = await createCurrencyFixture(request, superadminToken, {
        code: generateUniqueCurrencyCode(),
        name: 'QA TC-GL-001 Currency',
      });

      // Two disjoint, non-overlapping fiscal periods — operationDate then
      // unambiguously selects exactly one via the periodId filter's
      // startDate/endDate range resolution (see api/journal-entries/route.ts).
      periodAId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2031-01-01', endDate: '2031-01-31' },
        { headers },
      );
      periodBId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId, tenantId, startDate: '2031-02-01', endDate: '2031-02-28' },
        { headers },
      );

      accountTypeId = await createAccountTypeFixture(
        request,
        superadminToken,
        {
          organizationId,
          tenantId,
          slug: randomSlug('qa-gl-001-type'),
          name: 'QA TC-GL-001 Account Type',
          normalBalance: 'DEBIT',
        },
        { headers },
      );
      cashAccountId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, slug: randomSlug('qa-gl-001-cash'), accountTypeId },
        { headers },
      );
      revenueAccountId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId, tenantId, slug: randomSlug('qa-gl-001-revenue'), accountTypeId },
        { headers },
      );

      entryInPeriodAId = await seedJournalEntryInDb({
        organizationId,
        tenantId,
        currencyId,
        operationDate: '2031-01-15',
        lines: [
          { accountId: cashAccountId, debit: '100.0000', credit: '0' },
          { accountId: revenueAccountId, debit: '0', credit: '100.0000' },
        ],
      });
      entryInPeriodBId = await seedJournalEntryInDb({
        organizationId,
        tenantId,
        currencyId,
        operationDate: '2031-02-15',
        lines: [
          { accountId: cashAccountId, debit: '50.0000', credit: '0' },
          { accountId: revenueAccountId, debit: '0', credit: '50.0000' },
        ],
      });

      // periodId filter: only the entry whose operationDate falls inside period A.
      const byPeriod = await apiRequest(
        request,
        'GET',
        `/api/ledger/journal-entries?periodId=${encodeURIComponent(periodAId)}`,
        { token: superadminToken, headers },
      );
      expect(byPeriod.status(), 'GET ?periodId= should return 200').toBe(200);
      const byPeriodBody = (await byPeriod.json()) as { items: Array<{ id: string }> };
      const byPeriodIds = byPeriodBody.items.map((item) => item.id);
      expect(byPeriodIds, 'periodId filter should include the period-A entry').toContain(entryInPeriodAId);
      expect(byPeriodIds, 'periodId filter should exclude the period-B entry').not.toContain(entryInPeriodBId);

      // accountId filter: both seeded entries have a line on the revenue account.
      const byAccount = await apiRequest(
        request,
        'GET',
        `/api/ledger/journal-entries?accountId=${encodeURIComponent(revenueAccountId)}`,
        { token: superadminToken, headers },
      );
      expect(byAccount.status(), 'GET ?accountId= should return 200').toBe(200);
      const byAccountBody = (await byAccount.json()) as { items: Array<{ id: string }> };
      const byAccountIds = byAccountBody.items.map((item) => item.id);
      expect(byAccountIds, 'accountId filter should include the period-A entry').toContain(entryInPeriodAId);
      expect(byAccountIds, 'accountId filter should include the period-B entry').toContain(entryInPeriodBId);

      // Unfiltered listing includes both seeded entries.
      const listAll = await apiRequest(request, 'GET', '/api/ledger/journal-entries?pageSize=100', {
        token: superadminToken,
        headers,
      });
      expect(listAll.status(), 'unfiltered GET should return 200').toBe(200);
      const listAllBody = (await listAll.json()) as { items: Array<{ id: string }> };
      const listAllIds = listAllBody.items.map((item) => item.id);
      expect(listAllIds, 'unfiltered listing should include the period-A entry').toContain(entryInPeriodAId);
      expect(listAllIds, 'unfiltered listing should include the period-B entry').toContain(entryInPeriodBId);
    } finally {
      await deleteJournalEntryInDb(entryInPeriodAId);
      await deleteJournalEntryInDb(entryInPeriodBId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/accounts', cashAccountId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/accounts', revenueAccountId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/account-types', accountTypeId);
      // FiscalPeriod ships no DELETE route in Phase 1 (spec's Design decisions);
      // the rows are left behind but scoped to this test's own throwaway
      // organization, which is deleted below.
      await deleteCurrenciesEntityIfExists(request, superadminToken, '/api/currencies/currencies', currencyId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
    }
  });
});
