import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';

type SwitcherNode = {
  name?: string;
  children?: SwitcherNode[];
};

type SwitcherPayload = {
  items?: SwitcherNode[];
  canManage?: boolean;
};

function flattenOrganizationNames(items: SwitcherNode[]): string[] {
  return items.flatMap((item) => [
    ...(typeof item.name === 'string' ? [item.name] : []),
    ...flattenOrganizationNames(Array.isArray(item.children) ? item.children : []),
  ]);
}

test.describe('TC-DIR-016: Organization switcher user isolation and ACL invalidation', () => {
  test('keeps user payloads isolated and reflects role feature grants and revocations immediately', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(superadminToken);
    expect(tenantId, 'Superadmin token should include a tenant context').toBeTruthy();

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const firstOrganizationName = `QA TC-DIR-016 First ${stamp}`;
    const secondOrganizationName = `QA TC-DIR-016 Second ${stamp}`;
    const password = 'StrongSecret123!';
    let firstOrganizationId: string | null = null;
    let secondOrganizationId: string | null = null;
    let firstRoleId: string | null = null;
    let secondRoleId: string | null = null;
    let firstUserId: string | null = null;
    let secondUserId: string | null = null;

    const loadSwitcher = async (token: string): Promise<SwitcherPayload> => {
      const response = await apiRequest(request, 'GET', '/api/directory/organization-switcher', { token });
      expect(response.status(), 'GET organization switcher should return 200').toBe(200);
      return (await readJsonSafe<SwitcherPayload>(response)) ?? {};
    };

    try {
      firstOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: firstOrganizationName,
        tenantId: tenantId as string,
      });
      secondOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: secondOrganizationName,
        tenantId: tenantId as string,
      });
      firstRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-dir-016-first-${stamp}`,
        tenantId: tenantId as string,
      });
      secondRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-dir-016-second-${stamp}`,
        tenantId: tenantId as string,
      });

      await setRoleAclFeatures(request, superadminToken, {
        roleId: firstRoleId,
        features: ['directory.organizations.view'],
        organizations: [firstOrganizationId],
      });
      await setRoleAclFeatures(request, superadminToken, {
        roleId: secondRoleId,
        features: ['directory.organizations.view', 'directory.organizations.manage'],
        organizations: [secondOrganizationId],
      });

      const firstEmail = `qa-tc-dir-016-first-${stamp}@example.com`;
      const secondEmail = `qa-tc-dir-016-second-${stamp}@example.com`;
      firstUserId = await createUserFixture(request, superadminToken, {
        email: firstEmail,
        password,
        organizationId: firstOrganizationId,
        roles: [firstRoleId],
        name: 'QA TC-DIR-016 First',
      });
      secondUserId = await createUserFixture(request, superadminToken, {
        email: secondEmail,
        password,
        organizationId: secondOrganizationId,
        roles: [secondRoleId],
        name: 'QA TC-DIR-016 Second',
      });

      const firstToken = await getAuthToken(request, firstEmail, password);
      const secondToken = await getAuthToken(request, secondEmail, password);
      await loadSwitcher(firstToken);
      await loadSwitcher(secondToken);
      const firstPayload = await loadSwitcher(firstToken);
      const secondPayload = await loadSwitcher(secondToken);
      const firstNames = flattenOrganizationNames(firstPayload.items ?? []);
      const secondNames = flattenOrganizationNames(secondPayload.items ?? []);

      expect(firstPayload.canManage, 'first user should not manage organizations initially').toBe(false);
      expect(secondPayload.canManage, 'second user should receive its manage grant').toBe(true);
      expect(firstNames, 'first user should see its assigned organization').toContain(firstOrganizationName);
      expect(firstNames, 'first user should not receive the second user payload').not.toContain(secondOrganizationName);
      expect(secondNames, 'second user should see its assigned organization').toContain(secondOrganizationName);
      expect(secondNames, 'second user should not receive the first user payload').not.toContain(firstOrganizationName);

      await setRoleAclFeatures(request, superadminToken, {
        roleId: firstRoleId,
        features: ['directory.organizations.view', 'directory.organizations.manage'],
        organizations: [firstOrganizationId],
      });
      const grantedPayload = await loadSwitcher(firstToken);
      expect(grantedPayload.canManage, 'role grant should invalidate the warmed user payload').toBe(true);

      await setRoleAclFeatures(request, superadminToken, {
        roleId: firstRoleId,
        features: ['directory.organizations.view'],
        organizations: [firstOrganizationId],
      });
      const revokedPayload = await loadSwitcher(firstToken);
      expect(revokedPayload.canManage, 'role revocation should invalidate the warmed user payload').toBe(false);
    } finally {
      await deleteUserIfExists(request, superadminToken, firstUserId);
      await deleteUserIfExists(request, superadminToken, secondUserId);
      await deleteRoleIfExists(request, superadminToken, firstRoleId);
      await deleteRoleIfExists(request, superadminToken, secondRoleId);
      await deleteOrganizationIfExists(request, superadminToken, firstOrganizationId);
      await deleteOrganizationIfExists(request, superadminToken, secondOrganizationId);
    }
  });
});
