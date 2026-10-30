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
 * TC-CGRP-028: deleting a group never retires memberships outside the caller's
 * organizations (#6804).
 *
 * The group delete cascade retires every membership of the group. A user whose
 * role is limited to org A:
 *   - gets 409 deleting a group that has an org-B member; the group and the
 *     org-B membership stay live;
 *   - deletes a group whose only member is an org-A customer (200) — control,
 *     proves the role's features are enough.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer_groups/customer-groups/memberships';
const PEOPLE_PATH = '/api/customers/people';
const RESTRICTED_FEATURES = [
  'customer_groups.groups.view',
  'customer_groups.groups.manage',
  'customer_groups.memberships.view',
  'customer_groups.memberships.manage',
];

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

test.describe('TC-CGRP-028: group delete is limited to members in the caller organizations', () => {
  test('an org-A user cannot delete a group with an org-B member, but can delete one with only org-A members', async ({
    request,
  }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(adminToken);
    const stamp = uniqueStamp();
    const email = `qa-cgrp-028-${stamp}@test.invalid`;
    const password = 'Valid1!Pass';

    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let sharedGroupId: string | null = null;
    let ownGroupId: string | null = null;
    let personAId: string | null = null;
    let personBId: string | null = null;
    let membershipBId: string | null = null;

    try {
      orgAId = await createOrganizationFixture(request, superadminToken, { name: `QA CGRP 028 Org A ${stamp}`, tenantId });
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `QA CGRP 028 Org B ${stamp}`, tenantId });

      personAId = await createPersonInOrg(request, adminToken, orgAId, `CGRP028 OrgA ${stamp}`);
      personBId = await createPersonInOrg(request, adminToken, orgBId, `CGRP028 OrgB ${stamp}`);

      sharedGroupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-028-shared-${stamp}`,
        name: `QA CGRP 028 Shared ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });
      ownGroupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-028-own-${stamp}`,
        name: `QA CGRP 028 Own ${stamp}`,
        priority: fixturePriority(stamp, 2),
      });

      membershipBId = await createMembershipInOrg(request, adminToken, orgBId, {
        groupId: sharedGroupId,
        customerId: personBId,
      });
      await createMembershipInOrg(request, adminToken, orgAId, { groupId: ownGroupId, customerId: personAId });

      roleId = await createRoleFixture(request, superadminToken, { name: `QA CGRP 028 Org A Role ${stamp}`, tenantId });
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

      const crossDelete = await apiRequest(
        request,
        'DELETE',
        `${GROUPS_PATH}?id=${encodeURIComponent(sharedGroupId)}`,
        { token: restrictedToken },
      );
      expect(crossDelete.status(), 'deleting a group with an org-B member must be 409').toBe(409);
      const crossDeleteBody = await readJsonSafe<{ error?: unknown }>(crossDelete);
      expect(typeof crossDeleteBody?.error, 'the refusal must carry a reason the UI can show (#7060)').toBe('string');
      expect(String(crossDeleteBody?.error).trim().length).toBeGreaterThan(0);

      const groupAfter = await apiRequest(request, 'GET', `${GROUPS_PATH}?id=${encodeURIComponent(sharedGroupId)}`, {
        token: adminToken,
      });
      expect(groupAfter.status()).toBe(200);
      const groupAfterBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(groupAfter);
      expect(groupAfterBody?.items?.[0]?.id, 'the refused group must still exist').toBe(sharedGroupId);

      const survivor = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipBId)}`,
        { token: adminToken, selectedOrgId: orgBId },
      );
      expect(survivor.status()).toBe(200);
      const survivorBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(survivor);
      expect(survivorBody?.items?.[0]?.id, 'the org-B membership must still be live').toBe(membershipBId);

      const ownDelete = await apiRequest(request, 'DELETE', `${GROUPS_PATH}?id=${encodeURIComponent(ownGroupId)}`, {
        token: restrictedToken,
      });
      expect(ownDelete.status(), 'deleting a group with only org-A members should be 200').toBe(200);
      ownGroupId = null;
    } finally {
      await deleteInOrgIfExists(request, adminToken, orgBId, MEMBERSHIPS_PATH, membershipBId);
      await deleteCustomerGroupIfExists(request, adminToken, sharedGroupId);
      await deleteCustomerGroupIfExists(request, adminToken, ownGroupId);
      await deleteInOrgIfExists(request, adminToken, orgAId, PEOPLE_PATH, personAId);
      await deleteInOrgIfExists(request, adminToken, orgBId, PEOPLE_PATH, personBId);
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, orgAId);
      await deleteOrganizationIfExists(request, superadminToken, orgBId);
    }
  });
});
