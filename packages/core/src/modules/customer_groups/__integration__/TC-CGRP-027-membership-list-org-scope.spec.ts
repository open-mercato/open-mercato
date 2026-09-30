import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
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
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-027: membership lists that do not name a customer are narrowed to
 * the caller's organizations inside the list query.
 *
 * Two sibling organizations are created in the admin tenant, with one person
 * and one membership of the same group in each. A user whose role is limited
 * to org A:
 *   - listing by `groupId` sees only the org-A membership;
 *   - listing by `id` sees the org-A membership and nothing for the org-B id;
 *   - an unfiltered list contains the org-A membership and never the org-B one;
 *   - moving the org-A membership onto the org-B person is a 400 and leaves
 *     the membership on its original customer.
 * The unrestricted admin, listing by `groupId`, sees both memberships.
 */
const MEMBERSHIPS_PATH = '/api/customer_groups/customer-groups/memberships';
const PEOPLE_PATH = '/api/customers/people';
const RESTRICTED_FEATURES = ['customer_groups.memberships.view', 'customer_groups.memberships.manage'];

type MembershipListBody = { items?: Array<{ id: string; customer_id?: string }>; total?: number };

async function createPersonInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  label: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', PEOPLE_PATH, {
    token,
    selectedOrgId: organizationId,
    data: { firstName: 'QA', lastName: label, displayName: `QA ${label}` },
  });
  expect(response.status(), `person fixture in org ${organizationId} should be 201`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'person fixture should return an id');
}

async function createMembershipInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  input: { groupId: string; customerId: string },
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', MEMBERSHIPS_PATH, {
    token,
    selectedOrgId: organizationId,
    data: { ...input, source: 'manual' },
  });
  expect(response.status(), 'membership create should be 201').toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'membership create should return an id');
}

async function deleteInOrgIfExists(
  request: APIRequestContext,
  token: string,
  organizationId: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!organizationId || !id) return;
  await apiRequestWithSelectedOrg(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, {
    token,
    selectedOrgId: organizationId,
  }).catch(() => undefined);
}

async function listMembershipIds(request: APIRequestContext, token: string, query: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${MEMBERSHIPS_PATH}?${query}`, { token });
  expect(response.status(), `membership list (${query}) should be 200`).toBe(200);
  const body = await readJsonSafe<MembershipListBody>(response);
  return (body?.items ?? []).map((item) => item.id);
}

test.describe('TC-CGRP-027: membership lists are narrowed to the caller organizations', () => {
  test('an org-A user lists only org-A memberships by group, by id and unfiltered, and cannot move one to an org-B customer', async ({
    request,
  }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(adminToken);
    const stamp = uniqueStamp();
    const email = `qa-cgrp-027-${stamp}@test.invalid`;
    const password = 'Valid1!Pass';

    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let groupId: string | null = null;
    let personAId: string | null = null;
    let personBId: string | null = null;
    let membershipAId: string | null = null;
    let membershipBId: string | null = null;

    try {
      orgAId = await createOrganizationFixture(request, superadminToken, { name: `QA CGRP 027 Org A ${stamp}`, tenantId });
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `QA CGRP 027 Org B ${stamp}`, tenantId });

      personAId = await createPersonInOrg(request, adminToken, orgAId, `CGRP027 OrgA ${stamp}`);
      personBId = await createPersonInOrg(request, adminToken, orgBId, `CGRP027 OrgB ${stamp}`);

      groupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-027-${stamp}`,
        name: `QA CGRP 027 Group ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });

      membershipAId = await createMembershipInOrg(request, adminToken, orgAId, { groupId, customerId: personAId });
      membershipBId = await createMembershipInOrg(request, adminToken, orgBId, { groupId, customerId: personBId });

      roleId = await createRoleFixture(request, superadminToken, { name: `QA CGRP 027 Org A Role ${stamp}`, tenantId });
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: RESTRICTED_FEATURES,
        organizations: [orgAId],
      });
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgAId,
        roles: [roleId],
      });
      const restrictedToken = await getAuthToken(request, email, password);

      const adminByGroup = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?groupId=${encodeURIComponent(groupId)}&pageSize=100`,
        { token: adminToken, selectedOrgId: orgBId },
      );
      expect(adminByGroup.status(), 'admin list by group should be 200').toBe(200);
      const adminByGroupIds = ((await readJsonSafe<MembershipListBody>(adminByGroup))?.items ?? []).map((item) => item.id);
      expect(adminByGroupIds, 'the unrestricted admin sees both memberships of the group').toEqual(
        expect.arrayContaining([membershipAId, membershipBId]),
      );

      const byGroup = await listMembershipIds(
        request,
        restrictedToken,
        `groupId=${encodeURIComponent(groupId)}&pageSize=100`,
      );
      expect(byGroup, 'listing by group shows only the org-A membership').toEqual([membershipAId]);

      const byOwnId = await listMembershipIds(request, restrictedToken, `id=${encodeURIComponent(membershipAId)}`);
      expect(byOwnId, 'listing by the org-A membership id returns it').toEqual([membershipAId]);

      const byForeignId = await listMembershipIds(request, restrictedToken, `id=${encodeURIComponent(membershipBId)}`);
      expect(byForeignId, 'listing by the org-B membership id returns nothing').toEqual([]);

      const unfiltered = await listMembershipIds(request, restrictedToken, 'pageSize=100');
      expect(unfiltered, 'the unfiltered list contains the org-A membership').toContain(membershipAId);
      expect(unfiltered, 'the unfiltered list never contains the org-B membership').not.toContain(membershipBId);

      const crossMove = await apiRequest(request, 'PUT', MEMBERSHIPS_PATH, {
        token: restrictedToken,
        data: { id: membershipAId, customerId: personBId },
      });
      expect(crossMove.status(), 'moving an org-A membership onto an org-B customer must be 400').toBe(400);

      const afterMove = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipAId)}`,
        { token: restrictedToken },
      );
      expect(afterMove.status()).toBe(200);
      const afterMoveBody = await readJsonSafe<MembershipListBody>(afterMove);
      expect(afterMoveBody?.items?.[0]?.customer_id, 'the membership must stay on its org-A customer').toBe(personAId);
    } finally {
      await deleteInOrgIfExists(request, adminToken, orgAId, MEMBERSHIPS_PATH, membershipAId);
      await deleteInOrgIfExists(request, adminToken, orgBId, MEMBERSHIPS_PATH, membershipBId);
      await deleteInOrgIfExists(request, adminToken, orgAId, PEOPLE_PATH, personAId);
      await deleteInOrgIfExists(request, adminToken, orgBId, PEOPLE_PATH, personBId);
      await deleteCustomerGroupIfExists(request, adminToken, groupId);
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, orgAId);
      await deleteOrganizationIfExists(request, superadminToken, orgBId);
    }
  });
});
