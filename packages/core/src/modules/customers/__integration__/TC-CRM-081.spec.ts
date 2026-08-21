import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-CRM-081: RBAC denial on protected customers endpoints.
 * Issue: https://github.com/open-mercato/open-mercato/issues/2458
 *
 * Verified-against-source contract:
 * - `POST|PUT|DELETE /api/customers/people` require `customers.people.manage`;
 *   `POST /api/customers/deals` requires `customers.deals.manage`.
 * - A user granted only the `.view` features (via the ACL API, which invalidates
 *   the RBAC cache) can list but is denied (403) on every manage operation.
 */
test.describe('TC-CRM-081: RBAC denial on protected customers endpoints', () => {
  test('denies manage operations for a view-only user (403)', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    const password = 'Secret123!';
    const restrictedEmail = `tc-crm-081-${stamp}@example.com`;
    let adminToken: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let personId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(adminToken);
      expect(organizationId.length > 0 && tenantId.length > 0, 'admin token carries org + tenant').toBe(true);

      // A real person for the PUT/DELETE attempts (the feature gate runs before lookup, but be realistic).
      personId = await createPersonFixture(request, adminToken, { firstName: 'View', lastName: 'Only', displayName: `TC-CRM-081 P ${stamp}` });

      // View-only role + user, granted ONLY the `.view` features at the user level.
      roleId = await createRoleFixture(request, adminToken, { name: `TC-CRM-081 Viewer ${stamp}`, tenantId });
      userId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password,
        organizationId,
        roles: [roleId],
        name: 'TC-CRM-081 Restricted',
      });
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: [organizationId],
        features: ['customers.people.view', 'customers.deals.view'],
      });
      const restrictedToken = await getAuthToken(request, restrictedEmail, password);

      // Sanity: the view feature is honored.
      const canView = await apiRequest(request, 'GET', '/api/customers/people', { token: restrictedToken });
      expect(canView.status(), 'view-only user can list people').toBe(200);

      // Manage operations are denied.
      const denyCreate = await apiRequest(request, 'POST', '/api/customers/people', {
        token: restrictedToken,
        data: { firstName: 'No', lastName: 'Access', displayName: `TC-CRM-081 denied ${stamp}` },
      });
      expect(denyCreate.status(), 'POST people without manage → 403').toBe(403);

      const denyUpdate = await apiRequest(request, 'PUT', '/api/customers/people', {
        token: restrictedToken,
        data: { id: personId, description: 'denied' },
      });
      expect(denyUpdate.status(), 'PUT people without manage → 403').toBe(403);

      const denyDelete = await apiRequest(request, 'DELETE', '/api/customers/people', {
        token: restrictedToken,
        data: { id: personId },
      });
      expect(denyDelete.status(), 'DELETE people without manage → 403').toBe(403);

      const denyDeal = await apiRequest(request, 'POST', '/api/customers/deals', {
        token: restrictedToken,
        data: { title: `TC-CRM-081 denied deal ${stamp}` },
      });
      expect(denyDeal.status(), 'POST deals without manage → 403').toBe(403);
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
