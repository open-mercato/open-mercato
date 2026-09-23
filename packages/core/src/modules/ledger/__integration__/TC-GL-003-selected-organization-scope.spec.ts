import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures';
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
 * TC-GL-003: `GET /api/ledger/{account-types,accounts,fiscal-periods,
 * journal-entries}` scope to the organization selected for the request, not
 * the caller's home organization (a coverage gap flagged in PR #6340 review,
 * wojciechszyjka: M6).
 *
 * Before the M6 fix, all four routes filtered by `auth.orgId` — the token's
 * own home organization — and only fell back to no filter at all when that
 * was absent. A superadmin token's home organization is whatever org the
 * environment minted it against, which is neither of the two throwaway
 * organizations this test creates; so with the pre-fix code, selecting
 * organization B via the `om_selected_org` cookie would still filter (or
 * fail to filter) against the superadmin's own home org, never against B —
 * meaning organization B's rows would either be missing entirely or, if the
 * pre-fix code's `auth.orgId` guard failed open, organization A's rows would
 * leak in alongside them. `resolveOrganizationScopeForRequest` (the fix)
 * makes the selected-organization cookie win, matching the pattern already
 * used correctly by the fiscal-period lock/unlock routes (TC-GL-002).
 *
 * Each route is exercised the same way: seed one row scoped to organization
 * A and one scoped to organization B (same tenant), then GET with the
 * request scoped to organization B and assert the response contains B's row
 * and excludes A's — proving the query is actually filtered by the selected
 * organization rather than listing across the tenant or resolving to the
 * wrong organization.
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

test.describe('TC-GL-003: GET routes honor the selected organization, not the caller\'s home org', () => {
  test('account-types, accounts, fiscal-periods, and journal-entries all scope to the selected organization', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();

    let tenantId: string | null = null;
    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let currencyId: string | null = null;
    let accountTypeAId: string | null = null;
    let accountTypeBId: string | null = null;
    let accountAId: string | null = null;
    let accountBId: string | null = null;
    let fiscalPeriodAId: string | null = null;
    let fiscalPeriodBId: string | null = null;
    let journalEntryAId: string | null = null;
    let journalEntryBId: string | null = null;

    try {
      tenantId = await createTenant(request, superadminToken, `QA TC-GL-003 Tenant ${stamp}`);
      orgAId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-003 Organization A ${stamp}`,
        tenantId,
      });
      orgBId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-GL-003 Organization B ${stamp}`,
        tenantId,
      });
      const headersA = scopedHeaders({ tenantId, organizationId: orgAId });
      const headersB = scopedHeaders({ tenantId, organizationId: orgBId });

      // A single currency is enough — it's only referenced by id in the raw
      // SQL insert below, which bypasses API-level organization scoping.
      currencyId = await createCurrencyFixture(request, superadminToken, {
        code: generateUniqueCurrencyCode(),
        name: `QA TC-GL-003 Currency ${stamp}`,
      });

      accountTypeAId = await createAccountTypeFixture(
        request,
        superadminToken,
        { organizationId: orgAId, tenantId, slug: randomSlug('qa-gl-003-type-a'), name: 'QA Type A', normalBalance: 'DEBIT' },
        { headers: headersA },
      );
      accountTypeBId = await createAccountTypeFixture(
        request,
        superadminToken,
        { organizationId: orgBId, tenantId, slug: randomSlug('qa-gl-003-type-b'), name: 'QA Type B', normalBalance: 'DEBIT' },
        { headers: headersB },
      );

      accountAId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId: orgAId, tenantId, slug: randomSlug('qa-gl-003-account-a'), accountTypeId: accountTypeAId },
        { headers: headersA },
      );
      accountBId = await createAccountFixture(
        request,
        superadminToken,
        { organizationId: orgBId, tenantId, slug: randomSlug('qa-gl-003-account-b'), accountTypeId: accountTypeBId },
        { headers: headersB },
      );

      fiscalPeriodAId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId: orgAId, tenantId, startDate: '2033-01-01', endDate: '2033-01-31' },
        { headers: headersA },
      );
      fiscalPeriodBId = await createFiscalPeriodFixture(
        request,
        superadminToken,
        { organizationId: orgBId, tenantId, startDate: '2033-02-01', endDate: '2033-02-28' },
        { headers: headersB },
      );

      journalEntryAId = await seedJournalEntryInDb({
        organizationId: orgAId,
        tenantId,
        currencyId,
        operationDate: '2033-01-15',
        description: `QA TC-GL-003 entry A ${stamp}`,
        lines: [
          { accountId: accountAId, debit: '100.00', credit: '0.00' },
          { accountId: accountAId, debit: '0.00', credit: '100.00' },
        ],
      });
      journalEntryBId = await seedJournalEntryInDb({
        organizationId: orgBId,
        tenantId,
        currencyId,
        operationDate: '2033-02-15',
        description: `QA TC-GL-003 entry B ${stamp}`,
        lines: [
          { accountId: accountBId, debit: '50.00', credit: '0.00' },
          { accountId: accountBId, debit: '0.00', credit: '50.00' },
        ],
      });

      // --- account-types ---
      const accountTypesRes = await apiRequest(request, 'GET', '/api/ledger/account-types?pageSize=100', {
        token: superadminToken,
        headers: headersB,
      });
      expect(accountTypesRes.status(), 'GET account-types scoped to org B should return 200').toBe(200);
      const accountTypesBody = (await accountTypesRes.json()) as { items: Array<{ id: string }> };
      const accountTypeIds = accountTypesBody.items.map((item) => item.id);
      expect(accountTypeIds, 'org B account-types list should include org B\'s account type').toContain(accountTypeBId);
      expect(accountTypeIds, 'org B account-types list must not include org A\'s account type').not.toContain(accountTypeAId);

      // --- accounts ---
      const accountsRes = await apiRequest(request, 'GET', '/api/ledger/accounts?pageSize=100', {
        token: superadminToken,
        headers: headersB,
      });
      expect(accountsRes.status(), 'GET accounts scoped to org B should return 200').toBe(200);
      const accountsBody = (await accountsRes.json()) as { items: Array<{ id: string }> };
      const accountIds = accountsBody.items.map((item) => item.id);
      expect(accountIds, 'org B accounts list should include org B\'s account').toContain(accountBId);
      expect(accountIds, 'org B accounts list must not include org A\'s account').not.toContain(accountAId);

      // --- fiscal-periods ---
      const fiscalPeriodsRes = await apiRequest(request, 'GET', '/api/ledger/fiscal-periods?pageSize=100', {
        token: superadminToken,
        headers: headersB,
      });
      expect(fiscalPeriodsRes.status(), 'GET fiscal-periods scoped to org B should return 200').toBe(200);
      const fiscalPeriodsBody = (await fiscalPeriodsRes.json()) as { items: Array<{ id: string }> };
      const fiscalPeriodIds = fiscalPeriodsBody.items.map((item) => item.id);
      expect(fiscalPeriodIds, 'org B fiscal-periods list should include org B\'s period').toContain(fiscalPeriodBId);
      expect(fiscalPeriodIds, 'org B fiscal-periods list must not include org A\'s period').not.toContain(fiscalPeriodAId);

      // --- journal-entries ---
      const journalEntriesRes = await apiRequest(request, 'GET', '/api/ledger/journal-entries?pageSize=100', {
        token: superadminToken,
        headers: headersB,
      });
      expect(journalEntriesRes.status(), 'GET journal-entries scoped to org B should return 200').toBe(200);
      const journalEntriesBody = (await journalEntriesRes.json()) as { items: Array<{ id: string }> };
      const journalEntryIds = journalEntriesBody.items.map((item) => item.id);
      expect(journalEntryIds, 'org B journal-entries list should include org B\'s entry').toContain(journalEntryBId);
      expect(journalEntryIds, 'org B journal-entries list must not include org A\'s entry').not.toContain(journalEntryAId);
    } finally {
      await deleteJournalEntryInDb(journalEntryAId);
      await deleteJournalEntryInDb(journalEntryBId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/accounts', accountAId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/accounts', accountBId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/account-types', accountTypeAId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/ledger/account-types', accountTypeBId);
      await deleteCurrenciesEntityIfExists(request, superadminToken, '/api/currencies/currencies', currencyId);
      await deleteOrganizationIfExists(request, superadminToken, orgAId);
      await deleteOrganizationIfExists(request, superadminToken, orgBId);
    }
  });
});
