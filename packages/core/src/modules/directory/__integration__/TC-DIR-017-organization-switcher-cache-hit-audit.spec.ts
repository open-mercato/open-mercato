import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';

type SwitcherPayload = {
  items?: Array<{ id?: string }>;
};

type AccessLogPayload = {
  items?: Array<{
    resourceKind?: string;
    resourceId?: string;
    actorUserId?: string | null;
  }>;
};

test.describe('TC-DIR-017: Organization switcher cache-hit audit', () => {
  test('persists one access row for the cold request and one for the immediate cache hit', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(superadminToken);
    expect(tenantId, 'Superadmin token should include a tenant context').toBeTruthy();

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const email = `qa-tc-dir-017-${stamp}@example.com`;
    const password = 'StrongSecret123!';
    let organizationId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;

    try {
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-DIR-017 ${stamp}`,
        tenantId: tenantId as string,
      });
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-dir-017-${stamp}`,
        tenantId: tenantId as string,
      });
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['directory.organizations.view', 'audit_logs.view_self'],
        organizations: [organizationId],
      });
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-DIR-017',
      });
      const selectedOrganizationId = organizationId;
      const auditUserId = userId;
      const userToken = await getAuthToken(request, email, password);
      const after = new Date(Date.now() - 1_000).toISOString();

      const coldResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        '/api/directory/organization-switcher',
        { token: userToken, selectedOrgId: selectedOrganizationId },
      );
      expect(coldResponse.status(), 'Cold organization switcher request should return 200').toBe(200);
      const coldPayload = await readJsonSafe<SwitcherPayload>(coldResponse);
      expect(coldPayload?.items?.map((item) => item.id), 'Restricted user should receive one root organization').toEqual([
        selectedOrganizationId,
      ]);

      const hitResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        '/api/directory/organization-switcher',
        { token: userToken, selectedOrgId: selectedOrganizationId },
      );
      expect(hitResponse.status(), 'Cached organization switcher request should return 200').toBe(200);

      const query = new URLSearchParams({
        resourceKind: 'directory.organization_switcher',
        organizationId: selectedOrganizationId,
        after,
        pageSize: '20',
      });
      await expect.poll(
        async () => {
          const auditResponse = await apiRequestWithSelectedOrg(
            request,
            'GET',
            `/api/audit_logs/audit-logs/access?${query.toString()}`,
            { token: userToken, selectedOrgId: selectedOrganizationId },
          );
          const auditPayload = await readJsonSafe<AccessLogPayload>(auditResponse);
          const matchingEntries = (auditPayload?.items ?? []).filter(
            (item) =>
              item.resourceKind === 'directory.organization_switcher'
              && item.resourceId === selectedOrganizationId
              && item.actorUserId === auditUserId,
          );
          return {
            status: auditResponse.status(),
            matchingCount: matchingEntries.length,
          };
        },
        {
          intervals: [100, 250, 500],
          timeout: 10_000,
          message: 'Cold request and cache hit should each persist one access row',
        },
      ).toEqual({ status: 200, matchingCount: 2 });
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, organizationId);
    }
  });
});
