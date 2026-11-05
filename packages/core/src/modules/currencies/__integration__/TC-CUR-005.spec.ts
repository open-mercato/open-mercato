import { expect, test } from '@playwright/test';
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
  generateUniqueCurrencyCode,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-005: RBAC — `currencies.manage` gates currency mutations.
 * Source: issue #2490 (currencies integration coverage).
 *
 * A user that holds only `currencies.view` may LIST currencies (200) but is
 * forbidden (403) from POST/PUT/DELETE on /api/currencies/currencies, which the
 * route guards with `currencies.manage`.
 *
 * The currencies module seeds features only for `admin` (`currencies.*`), so the
 * seeded `employee` account has no currencies access at all. This spec therefore
 * provisions a dedicated view-only user instead of relying on a seeded role.
 */
test.describe('TC-CUR-005: currencies.manage RBAC gate', () => {
  test('view-only user lists currencies but cannot create, update, or delete', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const password = 'Secret123!';
    const viewerEmail = `tc-cur-005-viewer-${stamp}@example.com`;

    let adminToken: string | null = null;
    let viewerToken: string | null = null;
    let roleId: string | null = null;
    let viewerUserId: string | null = null;
    let currencyId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(adminToken);

      currencyId = (await createRandomCurrencyFixture(request, adminToken, { name: 'QA TC-CUR-005 Currency' })).id;

      roleId = await createRoleFixture(request, adminToken, { name: `TC-CUR-005 Viewer ${stamp}` });
      viewerUserId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: viewerUserId,
        features: ['currencies.view'],
        organizations: null,
      });
      viewerToken = await getAuthToken(request, viewerEmail, password);

      const createAttempt = await apiRequest(request, 'POST', '/api/currencies/currencies', {
        token: viewerToken,
        data: { organizationId, tenantId, code: generateUniqueCurrencyCode(), name: 'Should not be created' },
      });
      expect(createAttempt.status(), 'POST without currencies.manage must return 403').toBe(403);

      const updateAttempt = await apiRequest(request, 'PUT', '/api/currencies/currencies', {
        token: viewerToken,
        data: { id: currencyId, symbol: 'ZZ' },
      });
      expect(updateAttempt.status(), 'PUT without currencies.manage must return 403').toBe(403);

      const deleteAttempt = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/currencies?id=${encodeURIComponent(currencyId)}`,
        { token: viewerToken },
      );
      expect(deleteAttempt.status(), 'DELETE without currencies.manage must return 403').toBe(403);

      const listResponse = await apiRequest(request, 'GET', '/api/currencies/currencies?pageSize=1', {
        token: viewerToken,
      });
      expect(listResponse.status(), 'GET with currencies.view must return 200').toBe(200);
    } finally {
      await deleteCurrenciesEntityIfExists(request, adminToken, '/api/currencies/currencies', currencyId);
      await deleteUserIfExists(request, adminToken, viewerUserId);
      await deleteUserAclInDb(viewerUserId ?? '').catch(() => undefined);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
