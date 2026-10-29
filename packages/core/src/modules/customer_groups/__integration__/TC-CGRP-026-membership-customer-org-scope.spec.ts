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
 * TC-CGRP-026: membership and explain-terms customers are scoped to the
 * caller's organizations.
 *
 * Customer groups are tenant-scoped, but the customer a membership names is
 * organization-scoped (`lib/customerScope.ts`). Two sibling organizations are
 * created in the admin tenant, with one person in each. A user whose role is
 * limited to org A:
 *   - creates a membership for the org-A person (201) — control, proves the
 *     role's features are enough;
 *   - gets 400 creating a membership for the org-B person, also when the body
 *     carries a bogus `assignedByUserId`;
 *   - gets 404 on `GET memberships?customerId=` and `explain-terms?customerId=`
 *     for the org-B person;
 *   - gets 404 updating or deleting an existing org-B membership.
 * The unrestricted admin, with org B selected (`om_selected_org`), succeeds on
 * all of it for the org-B person.
 */
const MEMBERSHIPS_PATH = '/api/customer_groups/customer-groups/memberships';
const EXPLAIN_TERMS_PATH = '/api/customer_groups/customer-groups/explain-terms';
const PEOPLE_PATH = '/api/customers/people';
const RESTRICTED_FEATURES = [
  'customer_groups.memberships.view',
  'customer_groups.memberships.manage',
  'customer_groups.terms.view',
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

test.describe('TC-CGRP-026: membership customers are scoped to the caller organizations', () => {
  test('an org-A user cannot read or change the groups of an org-B customer; an unrestricted admin can', async ({
    request,
  }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(adminToken);
    const stamp = uniqueStamp();
    const email = `qa-cgrp-026-${stamp}@test.invalid`;
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
      orgAId = await createOrganizationFixture(request, superadminToken, { name: `QA CGRP 026 Org A ${stamp}`, tenantId });
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `QA CGRP 026 Org B ${stamp}`, tenantId });

      personAId = await createPersonInOrg(request, adminToken, orgAId, `CGRP026 OrgA ${stamp}`);
      personBId = await createPersonInOrg(request, adminToken, orgBId, `CGRP026 OrgB ${stamp}`);

      groupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-026-${stamp}`,
        name: `QA CGRP 026 Group ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });

      roleId = await createRoleFixture(request, superadminToken, { name: `QA CGRP 026 Org A Role ${stamp}`, tenantId });
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

      // Control: the org-A user can manage the groups of its own org's customer.
      const ownCreate = await apiRequest(request, 'POST', MEMBERSHIPS_PATH, {
        token: restrictedToken,
        data: { groupId, customerId: personAId, source: 'manual' },
      });
      expect(ownCreate.status(), 'org-A user creating a membership for an org-A customer should be 201').toBe(201);
      membershipAId = expectId(
        (await readJsonSafe<{ id?: string }>(ownCreate))?.id,
        'org-A membership create should return an id',
      );

      // An org-B customer reads as "does not exist" to the org-A user.
      const crossCreate = await apiRequest(request, 'POST', MEMBERSHIPS_PATH, {
        token: restrictedToken,
        data: { groupId, customerId: personBId, source: 'manual' },
      });
      expect(crossCreate.status(), 'org-A user creating a membership for an org-B customer must be 400').toBe(400);

      // `assigned_by_user_id` is set from the session, so a body value the hook's
      // validation would reject must not let the request skip the scope check.
      const crossCreateBogusActor = await apiRequest(request, 'POST', MEMBERSHIPS_PATH, {
        token: restrictedToken,
        data: { groupId, customerId: personBId, source: 'manual', assignedByUserId: 'not-a-uuid' },
      });
      expect(
        crossCreateBogusActor.status(),
        'a bogus assignedByUserId must not bypass the org-scope check',
      ).toBe(400);

      // The unrestricted admin, with org B selected, can attach the org-B customer.
      membershipBId = await createMembershipInOrg(request, adminToken, orgBId, { groupId, customerId: personBId });

      const adminList = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(personBId)}&pageSize=100`,
        { token: adminToken, selectedOrgId: orgBId },
      );
      expect(adminList.status(), 'admin list of the org-B customer memberships should be 200').toBe(200);
      const adminListBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(adminList);
      expect((adminListBody?.items ?? []).map((item) => item.id)).toContain(membershipBId);

      const adminExplain = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${EXPLAIN_TERMS_PATH}?customerId=${encodeURIComponent(personBId)}`,
        { token: adminToken, selectedOrgId: orgBId },
      );
      expect(adminExplain.status(), 'admin explain-terms for the org-B customer should be 200').toBe(200);
      const adminExplainBody = await readJsonSafe<{ groups?: Array<{ id: string }> }>(adminExplain);
      expect((adminExplainBody?.groups ?? []).map((group) => group.id)).toContain(groupId);

      // The org-A user can neither read nor change the org-B customer's groups.
      const crossList = await apiRequest(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(personBId)}&pageSize=100`,
        { token: restrictedToken },
      );
      expect(crossList.status(), 'org-A user listing an org-B customer memberships must be 404').toBe(404);
      const crossListBody = await readJsonSafe<{ items?: unknown }>(crossList);
      expect(crossListBody?.items, 'the 404 body must not carry any membership rows').toBeUndefined();

      const crossExplain = await apiRequest(
        request,
        'GET',
        `${EXPLAIN_TERMS_PATH}?customerId=${encodeURIComponent(personBId)}`,
        { token: restrictedToken },
      );
      expect(crossExplain.status(), 'org-A user explain-terms for an org-B customer must be 404').toBe(404);
      const crossExplainBody = await readJsonSafe<{ groups?: unknown; fields?: unknown }>(crossExplain);
      expect(crossExplainBody?.groups, 'the 404 body must not carry any resolved groups').toBeUndefined();
      expect(crossExplainBody?.fields, 'the 404 body must not carry any resolved terms').toBeUndefined();

      const crossUpdate = await apiRequest(request, 'PUT', MEMBERSHIPS_PATH, {
        token: restrictedToken,
        data: { id: membershipBId, notes: 'cross-org edit attempt' },
      });
      expect(crossUpdate.status(), 'org-A user updating an org-B membership must be 404').toBe(404);

      const crossDelete = await apiRequest(
        request,
        'DELETE',
        `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipBId)}`,
        { token: restrictedToken },
      );
      expect(crossDelete.status(), 'org-A user deleting an org-B membership must be 404').toBe(404);

      // The org-B membership survives both attempts untouched.
      const survivor = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${MEMBERSHIPS_PATH}?id=${encodeURIComponent(membershipBId)}`,
        { token: adminToken, selectedOrgId: orgBId },
      );
      expect(survivor.status()).toBe(200);
      const survivorBody = await readJsonSafe<{ items?: Array<{ id: string; notes: string | null }> }>(survivor);
      expect(survivorBody?.items?.[0]?.id, 'the org-B membership must still exist').toBe(membershipBId);
      expect(survivorBody?.items?.[0]?.notes, 'the org-B membership must be unaffected').toBeFalsy();
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
