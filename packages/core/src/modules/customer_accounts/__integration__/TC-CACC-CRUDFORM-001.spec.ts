import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-CACC-CRUDFORM-001: Customer Role CrudForm persists scalars + portal permissions (#2466, #2562).
 *
 * `customer_accounts` is a Tier B surface — hand-written routes, NOT `makeCrud` — so the shared
 * `runCrudFormRoundTrip` helper does not fit. This spec runs the same create → read-back → assert →
 * update → read-back → assert → delete cycle inline, mirroring exactly what the role CrudForm does:
 *
 *  - Create (`roles/create` page) POSTs the collection route: `{ name, slug, description, isDefault,
 *    customerAssignable }`. The role is created with an empty ACL.
 *  - Edit (`roles/[id]` page) saves with TWO calls: PUT `/{id}` for the scalars, then PUT `/{id}/acl`
 *    for the portal-permission `features[]` array (the `PortalPermissionsEditor` group component).
 *
 * Verified contract (hand-written routes, so NOT the makeCrud conventions):
 *  - Responses are camelCase (`isDefault`, `customerAssignable`), not snake_case.
 *  - Create returns the id under `role.id`; the list route has no `?id=`/`?ids=` filter, so read-back
 *    uses the detail GET `/{id}`, which returns the role plus its ACL `features[]`.
 *  - PUT scalars omits `slug` (immutable after create) and returns `{ ok, updatedAt }`, not the record.
 *  - There are no custom fields (`ce.ts` declares none); the portal `features[]` array is the
 *    "multiselect where applicable" surface.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const ROLES_PATH = '/api/customer_accounts/admin/roles';

async function readRoleById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${ROLES_PATH}/${encodeURIComponent(id)}`, { token });
  if (response.status() === 404) return null;
  expect(response.status(), `read-back role failed: ${response.status()}`).toBe(200);
  return (await readJsonSafe<CrudRecord>(response)) ?? null;
}

test.describe('TC-CACC-CRUDFORM-001: Customer Role CrudForm persists scalars + portal permissions', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars and portal permission features on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    let roleId: string | null = null;

    try {
      // CREATE — mirrors the roles/create CrudForm POST to the collection route.
      const createResponse = await apiRequest(request, 'POST', ROLES_PATH, {
        token,
        data: {
          name: `QA CRUDFORM Role ${stamp}`,
          slug: `qa-crudform-role-${stamp}`,
          description: 'Original role description',
          isDefault: true,
          customerAssignable: true,
        },
      });
      expect(createResponse.status(), 'create role should be 201').toBe(201);
      const createBody = await readJsonSafe<{ role?: CrudRecord }>(createResponse);
      roleId = expectId(createBody?.role?.id, 'create role should return role.id');

      // READ-BACK after create — every scalar persisted; a fresh role starts with an empty ACL.
      const afterCreate = await readRoleById(request, token, roleId);
      expect(afterCreate, 'created role should be readable').toBeTruthy();
      assertScalarFieldsPersisted(
        afterCreate as CrudRecord,
        {
          name: `QA CRUDFORM Role ${stamp}`,
          slug: `qa-crudform-role-${stamp}`,
          description: 'Original role description',
          isDefault: true,
          isSystem: false,
          customerAssignable: true,
        },
        'after-create',
      );
      expect((afterCreate as CrudRecord).features, 'new role starts with empty portal permissions').toEqual([]);

      // UPDATE — mirrors the roles/[id] CrudForm: PUT scalars, then PUT the portal permissions.
      const portalFeatures = ['portal.profile.view', 'portal.orders.view', 'portal.invoices.view'];
      const scalarUpdate = await apiRequest(request, 'PUT', `${ROLES_PATH}/${encodeURIComponent(roleId)}`, {
        token,
        data: {
          name: `QA CRUDFORM Role ${stamp} EDITED`,
          description: 'Updated role description',
          isDefault: false,
          customerAssignable: false,
        },
      });
      expect(scalarUpdate.status(), 'role scalar update should be 200').toBe(200);

      const aclUpdate = await apiRequest(request, 'PUT', `${ROLES_PATH}/${encodeURIComponent(roleId)}/acl`, {
        token,
        data: { features: portalFeatures },
      });
      expect(aclUpdate.status(), 'role ACL (portal permissions) update should be 200').toBe(200);

      // READ-BACK after update — scalars changed (slug immutable) and portal features persisted.
      const afterUpdate = await readRoleById(request, token, roleId);
      expect(afterUpdate, 'updated role should be readable').toBeTruthy();
      assertScalarFieldsPersisted(
        afterUpdate as CrudRecord,
        {
          name: `QA CRUDFORM Role ${stamp} EDITED`,
          slug: `qa-crudform-role-${stamp}`,
          description: 'Updated role description',
          isDefault: false,
          customerAssignable: false,
        },
        'after-update',
      );
      const persistedFeatures = Array.isArray((afterUpdate as CrudRecord).features)
        ? ((afterUpdate as CrudRecord).features as string[])
        : [];
      expect([...persistedFeatures].sort(), 'portal permission features should persist').toEqual(
        [...portalFeatures].sort(),
      );
    } finally {
      if (roleId) {
        await apiRequest(request, 'DELETE', `${ROLES_PATH}/${encodeURIComponent(roleId)}`, { token }).catch(
          () => undefined,
        );
      }
    }
  });
});
