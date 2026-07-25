import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AUTH-054 [P1]: customer-user admin routes enforce organization scope (#4031).
 *
 * Two staff users and two customer users are created in different organizations of the
 * same tenant. Staff A has the real customer_accounts view/manage grants. The scenario
 * proves that a CustomerUser UUID from organization B is indistinguishable from a missing
 * record across every item/action route, while same-organization access still works.
 */
const USERS_PATH = '/api/customer_accounts/admin/users';
const STAFF_FEATURES = ['customer_accounts.view', 'customer_accounts.manage'];

type CustomerUserDetail = {
  id?: string;
  email?: string;
  displayName?: string;
  emailVerifiedAt?: string | null;
  isActive?: boolean;
  updatedAt?: string | null;
};

function randomFixtureToken(): string {
  return randomBytes(12).toString('hex');
}

function strongPassword(label: string): string {
  return `${label}-${randomBytes(18).toString('base64url')}A1!`;
}

async function createCustomerUser(
  request: APIRequestContext,
  token: string,
  input: { email: string; password: string; displayName: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', USERS_PATH, { token, data: input });
  expect(response.status(), `create customer user ${input.email}`).toBe(201);
  const body = await readJsonSafe<{ user?: { id?: string } }>(response);
  return expectId(body?.user?.id, 'customer-user create response should include user.id');
}

async function readCustomerUser(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<{ response: APIResponse; body: CustomerUserDetail | null }> {
  const response = await apiRequest(
    request,
    'GET',
    `${USERS_PATH}/${encodeURIComponent(userId)}`,
    { token },
  );
  return { response, body: await readJsonSafe<CustomerUserDetail>(response) };
}

async function expectUserNotFound(response: APIResponse, operation: string): Promise<void> {
  expect(response.status(), `${operation} must hide a foreign-organization customer user`).toBe(404);
  const body = await readJsonSafe<{ error?: string }>(response);
  expect(body?.error, `${operation} should return the not-found contract`).toBe('User not found');
}

function stableUserState(user: CustomerUserDetail | null): CustomerUserDetail {
  return {
    id: user?.id,
    email: user?.email,
    displayName: user?.displayName,
    emailVerifiedAt: user?.emailVerifiedAt ?? null,
    isActive: user?.isActive,
    updatedAt: user?.updatedAt ?? null,
  };
}

test.describe('TC-AUTH-054: customer-user admin routes enforce organization scope (#4031)', () => {
  test('returns 404 for every foreign-org item/action route and preserves the foreign user', async ({ request }) => {
    const fixtureToken = randomFixtureToken();
    const superadminToken = await getAuthToken(request, 'superadmin');
    const tenantId = expectId(
      getTokenScope(superadminToken).tenantId,
      'superadmin token should identify the fixture tenant',
    );

    const staffAPassword = strongPassword('StaffA');
    const staffBPassword = strongPassword('StaffB');
    const customerAPassword = strongPassword('CustomerA');
    const customerBPassword = strongPassword('CustomerB');
    const sameOrgResetPassword = strongPassword('SameOrgReset');
    const rejectedPassword = strongPassword('Rejected');
    const staffAEmail = `qa-auth-054-staff-a-${fixtureToken}@test.local`;
    const staffBEmail = `qa-auth-054-staff-b-${fixtureToken}@test.local`;
    const customerAEmail = `qa-auth-054-customer-a-${fixtureToken}@test.local`;
    const customerBEmail = `qa-auth-054-customer-b-${fixtureToken}@test.local`;

    let organizationAId: string | null = null;
    let organizationBId: string | null = null;
    let staffAId: string | null = null;
    let staffBId: string | null = null;
    let staffAToken: string | null = null;
    let staffBToken: string | null = null;
    let customerAId: string | null = null;
    let customerBId: string | null = null;

    try {
      organizationAId = await createOrganizationFixture(request, superadminToken, {
        name: `QA AUTH 054 Organization A ${fixtureToken}`,
        tenantId,
      });
      organizationBId = await createOrganizationFixture(request, superadminToken, {
        name: `QA AUTH 054 Organization B ${fixtureToken}`,
        tenantId,
      });

      staffAId = await createUserFixture(request, superadminToken, {
        email: staffAEmail,
        password: staffAPassword,
        organizationId: organizationAId,
        roles: [],
        name: `QA AUTH 054 Staff A ${fixtureToken}`,
      });
      staffBId = await createUserFixture(request, superadminToken, {
        email: staffBEmail,
        password: staffBPassword,
        organizationId: organizationBId,
        roles: [],
        name: `QA AUTH 054 Staff B ${fixtureToken}`,
      });
      await setUserAclVisibility(request, superadminToken, {
        userId: staffAId,
        features: STAFF_FEATURES,
        organizations: [organizationAId],
      });
      await setUserAclVisibility(request, superadminToken, {
        userId: staffBId,
        features: STAFF_FEATURES,
        organizations: [organizationBId],
      });

      staffAToken = await getAuthToken(request, staffAEmail, staffAPassword);
      staffBToken = await getAuthToken(request, staffBEmail, staffBPassword);
      expect(getTokenScope(staffAToken)).toMatchObject({
        tenantId,
        organizationId: organizationAId,
      });
      expect(getTokenScope(staffBToken)).toMatchObject({
        tenantId,
        organizationId: organizationBId,
      });

      customerAId = await createCustomerUser(request, staffAToken, {
        email: customerAEmail,
        password: customerAPassword,
        displayName: `QA AUTH 054 Customer A ${fixtureToken}`,
      });
      customerBId = await createCustomerUser(request, staffBToken, {
        email: customerBEmail,
        password: customerBPassword,
        displayName: `QA AUTH 054 Customer B ${fixtureToken}`,
      });

      const sameOrgRead = await readCustomerUser(request, staffAToken, customerAId);
      expect(sameOrgRead.response.status(), 'staff A should read its own organization customer user').toBe(200);
      expect(sameOrgRead.body?.id).toBe(customerAId);

      const sameOrgPut = await apiRequest(
        request,
        'PUT',
        `${USERS_PATH}/${encodeURIComponent(customerAId)}`,
        {
          token: staffAToken,
          data: { displayName: `QA AUTH 054 Customer A Updated ${fixtureToken}` },
        },
      );
      expect(sameOrgPut.status(), 'staff A should update its own organization customer user').toBe(200);

      const sameOrgResetLink = await apiRequest(
        request,
        'POST',
        `${USERS_PATH}/${encodeURIComponent(customerAId)}/send-reset-link`,
        { token: staffAToken },
      );
      expect(sameOrgResetLink.status(), 'staff A should create a reset link for its own customer user').toBe(200);

      const sameOrgVerify = await apiRequest(
        request,
        'POST',
        `${USERS_PATH}/${encodeURIComponent(customerAId)}/verify-email`,
        { token: staffAToken },
      );
      expect(sameOrgVerify.status(), 'staff A should verify its own organization customer user').toBe(200);

      const sameOrgReset = await apiRequest(
        request,
        'POST',
        `${USERS_PATH}/${encodeURIComponent(customerAId)}/reset-password`,
        { token: staffAToken, data: { newPassword: sameOrgResetPassword } },
      );
      expect(sameOrgReset.status(), 'staff A should reset its own organization customer user password').toBe(200);

      const sameOrgDelete = await apiRequest(
        request,
        'DELETE',
        `${USERS_PATH}/${encodeURIComponent(customerAId)}`,
        { token: staffAToken },
      );
      expect(sameOrgDelete.status(), 'staff A should delete its own organization customer user').toBe(200);
      customerAId = null;

      const foreignBefore = await readCustomerUser(request, staffBToken, customerBId);
      expect(foreignBefore.response.status(), 'staff B should read its own customer user fixture').toBe(200);
      const foreignStateBefore = stableUserState(foreignBefore.body);

      await expectUserNotFound(
        (await readCustomerUser(request, staffAToken, customerBId)).response,
        'GET /admin/users/[id]',
      );
      await expectUserNotFound(
        await apiRequest(request, 'PUT', `${USERS_PATH}/${encodeURIComponent(customerBId)}`, {
          token: staffAToken,
          data: {
            displayName: `QA AUTH 054 Cross-org overwrite ${fixtureToken}`,
            isActive: false,
          },
        }),
        'PUT /admin/users/[id]',
      );
      await expectUserNotFound(
        await apiRequest(request, 'DELETE', `${USERS_PATH}/${encodeURIComponent(customerBId)}`, {
          token: staffAToken,
        }),
        'DELETE /admin/users/[id]',
      );
      await expectUserNotFound(
        await apiRequest(
          request,
          'POST',
          `${USERS_PATH}/${encodeURIComponent(customerBId)}/reset-password`,
          { token: staffAToken, data: { newPassword: rejectedPassword } },
        ),
        'POST /admin/users/[id]/reset-password',
      );
      await expectUserNotFound(
        await apiRequest(
          request,
          'POST',
          `${USERS_PATH}/${encodeURIComponent(customerBId)}/send-reset-link`,
          { token: staffAToken },
        ),
        'POST /admin/users/[id]/send-reset-link',
      );
      await expectUserNotFound(
        await apiRequest(
          request,
          'POST',
          `${USERS_PATH}/${encodeURIComponent(customerBId)}/verify-email`,
          { token: staffAToken },
        ),
        'POST /admin/users/[id]/verify-email',
      );

      const foreignAfter = await readCustomerUser(request, staffBToken, customerBId);
      expect(foreignAfter.response.status(), 'foreign customer user should remain readable in organization B').toBe(200);
      expect(stableUserState(foreignAfter.body), 'rejected cross-org operations must not mutate the foreign user').toEqual(
        foreignStateBefore,
      );
    } finally {
      if (staffAToken && customerAId) {
        await apiRequest(request, 'DELETE', `${USERS_PATH}/${encodeURIComponent(customerAId)}`, {
          token: staffAToken,
        }).catch(() => undefined);
      }
      if (staffBToken && customerBId) {
        await apiRequest(request, 'DELETE', `${USERS_PATH}/${encodeURIComponent(customerBId)}`, {
          token: staffBToken,
        }).catch(() => undefined);
      }
      await deleteUserIfExists(request, superadminToken, staffAId);
      await deleteUserIfExists(request, superadminToken, staffBId);
      await deleteOrganizationIfExists(request, superadminToken, organizationAId);
      await deleteOrganizationIfExists(request, superadminToken, organizationBId);
    }
  });
});
