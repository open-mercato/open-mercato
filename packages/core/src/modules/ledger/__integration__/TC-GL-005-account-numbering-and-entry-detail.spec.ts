import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCurrencyFixture,
  generateUniqueCurrencyCode,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures';
import {
  createAccountFixture,
  createAccountTypeFixture,
  createFiscalPeriodFixture,
  seedAccountGroupInDb,
  seedJournalEntryInDb,
} from '@open-mercato/core/helpers/integration/ledgerFixtures';

/**
 * TC-GL-005: PL account numbering, frozen numbers after posting, and the
 * journal entry detail (`GET /api/ledger/journal-entries?id=` with `lines`).
 *
 * Covers PR #6340 review points that the Jest unit suite and the Cucumber
 * scenarios can only exercise against fakes: the numbering rule is enforced
 * by the real commands behind the real routes (400), the freeze after a
 * posting is enforced against real rows (409), and the detail response
 * carries the posted lines with account number and name.
 *
 * Reversal has no HTTP route in Phase 1, so "a reversal dated before the
 * original is rejected" stays in the Jest and BDD suites.
 */

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = await readJsonSafe<{ id?: string }>(response);
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

test.describe('TC-GL-005: account numbering, frozen numbers, entry detail', () => {
  test('enforces the PL number rules, freezes numbers after posting and returns entry lines', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const stamp = randomUUID();
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let currencyId: string | null = null;
    let headers: Record<string, string> = {};

    try {
      tenantId = await createTenant(request, token, `QA TC-GL-005 Tenant ${stamp}`);
      organizationId = await createOrganizationFixture(request, token, {
        name: `QA TC-GL-005 Organization ${stamp}`,
        tenantId,
      });
      const scope = { tenantId, organizationId };
      headers = scopedHeaders(scope);
      currencyId = await createCurrencyFixture(request, token, {
        code: generateUniqueCurrencyCode(),
        name: 'QA TC-GL-005 Currency',
        organizationId,
        tenantId,
        headers,
      });
      await createFiscalPeriodFixture(
        request,
        token,
        { organizationId, tenantId, startDate: '2032-01-01', endDate: '2032-12-31' },
        { headers },
      );
      const groupId = await seedAccountGroupInDb({ ...scope, code: '4', name: 'QA group 4' });

      const postType = (data: Record<string, unknown>) =>
        apiRequest(request, 'POST', '/api/ledger/account-types', { token, headers, data: { ...scope, ...data } });
      const postAccount = (data: Record<string, unknown>) =>
        apiRequest(request, 'POST', '/api/ledger/accounts', { token, headers, data: { ...scope, ...data } });
      const putType = (data: Record<string, unknown>) =>
        apiRequest(request, 'PUT', '/api/ledger/account-types', { token, headers, data });
      const putAccount = (data: Record<string, unknown>) =>
        apiRequest(request, 'PUT', '/api/ledger/accounts', { token, headers, data });

      // A type number that does not start with the group digit is rejected.
      const wrongDigit = await postType({
        number: '502', name: 'Wrong group digit', normalBalance: 'DEBIT', accountGroupId: groupId,
      });
      expect(wrongDigit.status(), 'type 502 in group 4 should be rejected with 400').toBe(400);

      // A type number that is not exactly three digits is rejected.
      const wrongFormat = await postType({
        number: '40', name: 'Wrong format', normalBalance: 'DEBIT', accountGroupId: groupId,
      });
      expect(wrongFormat.status(), 'two-digit type number should be rejected with 400').toBe(400);

      // A valid type, and an account under it that does not start with the type number.
      const typeId = await createAccountTypeFixture(
        request,
        token,
        { ...scope, number: '402', name: 'QA expenses by nature', normalBalance: 'DEBIT', accountGroupId: groupId },
        { headers },
      );
      const wrongPrefix = await postAccount({ number: '403-01', accountTypeId: typeId });
      expect(wrongPrefix.status(), 'account 403-01 under type 402 should be rejected with 400').toBe(400);

      const cashId = await createAccountFixture(
        request, token,
        { ...scope, number: '402-01', accountTypeId: typeId, description: 'QA Materials' },
        { headers },
      );
      const otherId = await createAccountFixture(
        request, token,
        { ...scope, number: '402-02', accountTypeId: typeId, description: 'QA Energy' },
        { headers },
      );

      // Before any posting both numbers can still change.
      const renameBefore = await putAccount({ id: otherId, number: '402-03' });
      expect(renameBefore.status(), 'unposted account number can change').toBe(200);

      // Renumbering a type carries its accounts along (402-01 under 410 -> 411-01
      // under 411); it does not strand them with the old prefix.
      const movingTypeId = await createAccountTypeFixture(
        request,
        token,
        { ...scope, number: '410', name: 'QA moving type', normalBalance: 'DEBIT', accountGroupId: groupId },
        { headers },
      );
      const movingAccountId = await createAccountFixture(
        request, token,
        { ...scope, number: '410-01', accountTypeId: movingTypeId, description: 'QA Moving account' },
        { headers },
      );
      const renumberMoving = await putType({ id: movingTypeId, number: '411' });
      expect(renumberMoving.status(), 'unposted type can be renumbered').toBe(200);
      const movedAccount = await apiRequest(
        request, 'GET', `/api/ledger/accounts?id=${encodeURIComponent(movingAccountId)}`, { token, headers },
      );
      const movedBody = (await movedAccount.json()) as { items?: Array<{ number?: string }> };
      expect(movedBody.items?.[0]?.number, 'account follows the renumbered type').toBe('411-01');

      // Post an entry through the DB seed (no posting route in Phase 1).
      const entryId = await seedJournalEntryInDb({
        organizationId, tenantId, currencyId,
        operationDate: '2032-03-10',
        lines: [
          { accountId: cashId, debit: '75.0000', credit: '0' },
          { accountId: otherId, debit: '0', credit: '75.0000' },
        ],
      });

      // After posting: the account number is frozen, the description is not.
      const renamePosted = await putAccount({ id: cashId, number: '402-09' });
      expect(renamePosted.status(), 'posted account number must be frozen (409)').toBe(409);
      const describePosted = await putAccount({ id: cashId, description: 'QA Materials (renamed)' });
      expect(describePosted.status(), 'posted account description stays editable').toBe(200);

      // The type number is frozen too, the type name is not.
      const renumberType = await putType({ id: typeId, number: '403' });
      expect(renumberType.status(), 'type number frozen once an account has postings (409)').toBe(409);
      const renameType = await putType({ id: typeId, name: 'QA expenses (renamed)' });
      expect(renameType.status(), 'type name stays editable').toBe(200);

      // Entry detail returns the posted lines with account number and name.
      const detail = await apiRequest(
        request, 'GET', `/api/ledger/journal-entries?id=${encodeURIComponent(entryId)}`, { token, headers },
      );
      expect(detail.status(), 'GET ?id= should return 200').toBe(200);
      const body = (await detail.json()) as {
        items?: Array<{ id: string; lines?: Array<{ accountNumber: string; accountName: string | null; debit: string; credit: string }> }>;
      };
      const entry = (body.items ?? [])[0];
      expect(entry?.id).toBe(entryId);
      const lines = entry?.lines ?? [];
      expect(lines, 'detail should carry both posted lines').toHaveLength(2);
      expect(lines[0].accountNumber, 'debit line first').toBe('402-01');
      expect(Number(lines[0].debit)).toBe(75);
      expect(lines[1].accountNumber).toBe('402-03');
      expect(Number(lines[1].credit)).toBe(75);
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId, { headers }).catch(() => undefined);
      await deleteOrganizationIfExists(request, token, organizationId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId);
    }
  });
});
