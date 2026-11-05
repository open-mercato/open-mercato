import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createCompanyFixture, createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-CACC-CRUDFORM-002: Customer User CrudForm persists scalars, role assignments + CRM links (#2466, #2562).
 *
 * `customer_accounts` is a Tier B surface — hand-written routes, NOT `makeCrud` — so this spec runs the
 * create → read-back → assert → update → read-back → assert → delete cycle inline, mirroring what the
 * customer-user admin form does:
 *
 *  - The staff create path POSTs the collection route `{ email, password, displayName, roleIds?,
 *    customerEntityId? }` (the portal also creates users via invite; the persistence contract is the same).
 *  - Edit (`users/[id]` page → `handleSave`) PUTs `/{id}` with `{ displayName, isActive, roleIds,
 *    personEntityId, customerEntityId }`.
 *
 * Verified contract (hand-written routes):
 *  - Responses are camelCase. Create returns the id under `user.id`; the list route has no `?id=`/`?ids=`
 *    filter, so read-back uses the detail GET `/{id}`.
 *  - `roleIds[]` (the multiselect) round-trips as a `roles: [{ id, name, slug }]` array on read-back.
 *  - `email` is create-only (the update schema has no email); `personEntityId`/`customerEntityId` are the
 *    CRM entity references and round-trip as plain UUID columns.
 *  - There are no custom fields (`ce.ts` declares none).
 *  - Self-contained: creates its own roles + CRM company/person, and tears everything down in `finally`.
 *    The role DELETE route refuses while users are assigned, so the user's roles are cleared first.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const USERS_PATH = '/api/customer_accounts/admin/users';
const ROLES_PATH = '/api/customer_accounts/admin/roles';
const PEOPLE_PATH = '/api/customers/people';
const COMPANIES_PATH = '/api/customers/companies';

async function createRoleFixture(
  request: APIRequestContext,
  token: string,
  stamp: number,
  suffix: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', ROLES_PATH, {
    token,
    data: { name: `QA CRUDFORM User Role ${suffix} ${stamp}`, slug: `qa-crudform-user-role-${suffix}-${stamp}` },
  });
  expect(response.status(), `role fixture ${suffix} should be 201`).toBe(201);
  return expectId(
    (await readJsonSafe<{ role?: { id?: string } }>(response))?.role?.id,
    `role fixture ${suffix} should return role.id`,
  );
}

async function readUserById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${USERS_PATH}/${encodeURIComponent(id)}`, { token });
  if (response.status() === 404) return null;
  expect(response.status(), `read-back user failed: ${response.status()}`).toBe(200);
  return (await readJsonSafe<CrudRecord>(response)) ?? null;
}

function assignedRoleIds(record: CrudRecord): string[] {
  const roles = Array.isArray(record.roles) ? (record.roles as Array<{ id?: unknown }>) : [];
  return roles
    .map((role) => role.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
}

test.describe('TC-CACC-CRUDFORM-002: Customer User CrudForm persists scalars, roles + CRM links', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, role assignments, and CRM entity links on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const email = `qa-cacc-crudform-002-${stamp}@test.local`;
    let userId: string | null = null;
    let roleAId: string | null = null;
    let roleBId: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    try {
      roleAId = await createRoleFixture(request, token, stamp, 'a');
      roleBId = await createRoleFixture(request, token, stamp, 'b');
      companyId = await createCompanyFixture(request, token, `QA CRUDFORM Company ${stamp}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CrudForm ${stamp}`,
        displayName: `QA CrudForm Person ${stamp}`,
      });

      // CREATE — role assignment and the CRM company link persist on create.
      const createResponse = await apiRequest(request, 'POST', USERS_PATH, {
        token,
        data: {
          email,
          password: `CrudFormPass1!${stamp}`,
          displayName: `QA CRUDFORM User ${stamp}`,
          roleIds: [roleAId],
          customerEntityId: companyId,
        },
      });
      expect(createResponse.status(), 'create user should be 201').toBe(201);
      userId = expectId(
        (await readJsonSafe<{ user?: { id?: string } }>(createResponse))?.user?.id,
        'create user should return user.id',
      );

      // READ-BACK after create.
      const afterCreate = await readUserById(request, token, userId);
      expect(afterCreate, 'created user should be readable').toBeTruthy();
      assertScalarFieldsPersisted(
        afterCreate as CrudRecord,
        {
          email,
          displayName: `QA CRUDFORM User ${stamp}`,
          isActive: true,
          customerEntityId: companyId,
          personEntityId: null,
        },
        'after-create',
      );
      expect(assignedRoleIds(afterCreate as CrudRecord), 'assigned role persists on create').toEqual([roleAId].sort());

      // UPDATE — mirrors the users/[id] form save: scalars, role reassignment, and both CRM links.
      const updateResponse = await apiRequest(request, 'PUT', `${USERS_PATH}/${encodeURIComponent(userId)}`, {
        token,
        data: {
          displayName: `QA CRUDFORM User ${stamp} EDITED`,
          isActive: false,
          roleIds: [roleBId],
          personEntityId: personId,
          customerEntityId: companyId,
        },
      });
      expect(updateResponse.status(), 'user update should be 200').toBe(200);

      // READ-BACK after update.
      const afterUpdate = await readUserById(request, token, userId);
      expect(afterUpdate, 'updated user should be readable').toBeTruthy();
      assertScalarFieldsPersisted(
        afterUpdate as CrudRecord,
        {
          email,
          displayName: `QA CRUDFORM User ${stamp} EDITED`,
          isActive: false,
          customerEntityId: companyId,
          personEntityId: personId,
        },
        'after-update',
      );
      expect(assignedRoleIds(afterUpdate as CrudRecord), 'role reassignment persists on update').toEqual(
        [roleBId].sort(),
      );
    } finally {
      if (userId) {
        // Clear role links first — the role DELETE route refuses while users are assigned.
        await apiRequest(request, 'PUT', `${USERS_PATH}/${encodeURIComponent(userId)}`, {
          token,
          data: { roleIds: [] },
        }).catch(() => undefined);
        await apiRequest(request, 'DELETE', `${USERS_PATH}/${encodeURIComponent(userId)}`, { token }).catch(
          () => undefined,
        );
      }
      if (roleAId) {
        await apiRequest(request, 'DELETE', `${ROLES_PATH}/${encodeURIComponent(roleAId)}`, { token }).catch(
          () => undefined,
        );
      }
      if (roleBId) {
        await apiRequest(request, 'DELETE', `${ROLES_PATH}/${encodeURIComponent(roleBId)}`, { token }).catch(
          () => undefined,
        );
      }
      await deleteGeneralEntityIfExists(request, token, PEOPLE_PATH, personId);
      await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });
});
