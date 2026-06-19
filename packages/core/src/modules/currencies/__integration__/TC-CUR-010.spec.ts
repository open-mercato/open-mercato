import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-010: Organization-scope isolation for currencies.
 * Source: issue #2490 (currencies integration coverage).
 *
 * The currencies list route scopes by BOTH tenant and organization
 * (`filter.tenantId = auth.tenantId; if (auth.orgId) filter.organizationId =
 * auth.orgId`). This exercises the organization dimension — the part testable via
 * API/DB fixtures without provisioning a second tenant: a currency created in
 * org B is invisible to a user scoped to org A and vice versa, and a cross-org id
 * lookup returns no rows.
 *
 * ENVIRONMENT: mixes API fixtures (hit the app) with a DB-level org fixture (raw
 * `pg` against `DATABASE_URL`, because the directory create command denies
 * non-super-admin actors). It MUST run under a coherent app+DB stack (the
 * standard `yarn test:integration` / `yarn test:integration:ephemeral` harness)
 * where the app server and the fixtures share one database.
 */
async function listCurrencyIds(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<{ status: number; items: Array<{ id: string; organizationId: string }> }> {
  const response = await apiRequest(request, 'GET', `/api/currencies/currencies${query}`, { token });
  const body = await readJsonSafe<{ items?: Array<{ id: string; organizationId: string }> }>(response);
  return { status: response.status(), items: body?.items ?? [] };
}

test.describe('TC-CUR-010: cross-organization currency isolation', () => {
  test('a currency in org B is invisible to an org A user and vice versa', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const password = 'Secret123!';
    const orgBUserEmail = `tc-cur-010-orgb-${stamp}@example.com`;

    let adminToken: string | null = null;
    let orgBToken: string | null = null;
    let orgBId: string | null = null;
    let roleId: string | null = null;
    let orgBUserId: string | null = null;
    let currencyOrgAId: string | null = null;
    let currencyOrgBId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { tenantId } = getTokenScope(adminToken);
      expect(tenantId, 'admin token should carry a tenant id').toBeTruthy();

      // Org B is a fresh, unseeded organization in the admin tenant.
      orgBId = await createOrganizationInDb({ name: `TC-CUR-010 Org B ${stamp}`, tenantId });

      // A user whose home org is org B, granted currencies access scoped to org B.
      roleId = await createRoleFixture(request, adminToken, { name: `TC-CUR-010 Org B ${stamp}` });
      orgBUserId = await createUserFixture(request, adminToken, {
        email: orgBUserEmail,
        password,
        organizationId: orgBId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: orgBUserId,
        features: ['currencies.view', 'currencies.manage'],
        organizations: [orgBId],
      });
      orgBToken = await getAuthToken(request, orgBUserEmail, password);
      expect(getTokenScope(orgBToken).organizationId, 'org B user token should be scoped to org B').toBe(orgBId);

      currencyOrgAId = (await createRandomCurrencyFixture(request, adminToken, { name: 'QA TC-CUR-010 Org A' })).id;
      currencyOrgBId = (await createRandomCurrencyFixture(request, orgBToken, { name: 'QA TC-CUR-010 Org B' })).id;

      // Each scope sees only its own currency by id.
      const adminSeesOwn = await listCurrencyIds(request, adminToken, `?id=${encodeURIComponent(currencyOrgAId)}`);
      expect(adminSeesOwn.status, 'admin GET own currency should be 200').toBe(200);
      expect(adminSeesOwn.items.map((item) => item.id), 'admin should see its own org A currency').toContain(currencyOrgAId);

      const adminCannotSeeOrgB = await listCurrencyIds(request, adminToken, `?id=${encodeURIComponent(currencyOrgBId)}`);
      expect(adminCannotSeeOrgB.items, 'admin (org A) must not see the org B currency').toHaveLength(0);

      const orgBSeesOwn = await listCurrencyIds(request, orgBToken, `?id=${encodeURIComponent(currencyOrgBId)}`);
      expect(orgBSeesOwn.status, 'org B GET own currency should be 200').toBe(200);
      expect(orgBSeesOwn.items.map((item) => item.id), 'org B user should see its own currency').toContain(currencyOrgBId);

      const orgBCannotSeeOrgA = await listCurrencyIds(request, orgBToken, `?id=${encodeURIComponent(currencyOrgAId)}`);
      expect(orgBCannotSeeOrgA.items, 'org B user must not see the org A currency by id').toHaveLength(0);

      // The org B user's full list never leaks another org's rows.
      const orgBList = await listCurrencyIds(request, orgBToken, '?pageSize=100');
      expect(orgBList.status, 'org B list should be 200').toBe(200);
      expect(orgBList.items.length, 'org B list should contain its own currency').toBeGreaterThan(0);
      expect(
        orgBList.items.every((item) => item.organizationId === orgBId),
        'org B list must only contain org B currencies',
      ).toBeTruthy();
    } finally {
      await deleteCurrenciesEntityIfExists(request, orgBToken, '/api/currencies/currencies', currencyOrgBId);
      await deleteCurrenciesEntityIfExists(request, adminToken, '/api/currencies/currencies', currencyOrgAId);
      await deleteUserIfExists(request, adminToken, orgBUserId);
      await deleteUserAclInDb(orgBUserId ?? '').catch(() => undefined);
      await deleteRoleIfExists(request, adminToken, roleId);
      await deleteOrganizationInDb(orgBId).catch(() => undefined);
    }
  });
});
