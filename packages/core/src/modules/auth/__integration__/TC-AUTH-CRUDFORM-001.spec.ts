import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-AUTH-CRUDFORM-001: User CrudForm persists scalars, the roles[] multiselect + custom fields (#2557).
 *
 * Part of the CrudForm field-persistence sweep (umbrella #2466, harness PR #2548). Proves the
 * `auth` user surface saves AND reloads every field type on both create and update:
 *   - scalars: email, name, organizationId, hasPassword
 *   - multiselect: roles[] (request `roles: [roleId…]` → response `roleIds: [uuid…]`)
 *   - custom fields: text / integer / select / boolean
 *
 * Verified contract (see packages/core/src/modules/auth/api/users/route.ts + commands/users.ts):
 *   - POST 201, PUT 200 ({ ok: true }), DELETE `?id=` 200; list GET filters by `?id=` (single).
 *   - Responses are camelCase (`roleIds`, `organizationId`, `hasPassword`); the password is
 *     write-only (only `hasPassword` is exposed).
 *   - `roles` accepts role IDs or names and resolves within the user's tenant.
 *   - PUT is a partial update — omitted scalars and custom fields are retained.
 *   - Custom fields submit as `cf_<key>` and return spread at the top level as `cf_<key>`
 *     (the harness resolver handles every shape). `auth` ships no `ce.ts`, so the spec creates
 *     its own field definitions via the entities API in setup and removes them in `finally`.
 *
 * User-/role-level ACL persistence is exercised by the companion test below and by the existing
 * TC-AUTH-043 (user ACL override) and TC-AUTH-049 (role ACL org visibility) specs.
 *
 * Self-contained: creates its own roles + custom-field definitions and deletes them in `finally`
 * (the round-trip helper deletes the user it creates). Gated by
 * `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const USERS_PATH = '/api/auth/users';
const USER_ENTITY_ID = 'auth:user';
const DEFINITIONS_PATH = '/api/entities/definitions';
// Policy-compliant password (uppercase + digit + special, length >= 6).
const USER_PASSWORD = 'StrongSecret123!';

type CustomFieldFixture = {
  key: string;
  kind: 'text' | 'integer' | 'select' | 'boolean';
  label: string;
  options?: readonly string[];
  createValue: string | number | boolean;
  updateValue: string | number | boolean;
  /** When true the field is omitted from the update payload to assert partial-update retention. */
  retainOnUpdate?: boolean;
};

async function createCustomFieldDefinition(
  request: APIRequestContext,
  token: string,
  entityId: string,
  field: CustomFieldFixture,
): Promise<void> {
  const configJson: Record<string, unknown> = { label: field.label, formEditable: true, listVisible: true };
  if (field.options) configJson.options = [...field.options];
  const response = await apiRequest(request, 'POST', DEFINITIONS_PATH, {
    token,
    data: { entityId, key: field.key, kind: field.kind, configJson },
  });
  expect(response.status(), `create custom field "${field.key}" on ${entityId} should return 200`).toBe(200);
}

async function deleteCustomFieldDefinitionIfExists(
  request: APIRequestContext,
  token: string,
  entityId: string,
  key: string,
): Promise<void> {
  await apiRequest(request, 'DELETE', DEFINITIONS_PATH, { token, data: { entityId, key } }).catch(() => undefined);
}

function sortedStrings(value: unknown): unknown {
  return Array.isArray(value) ? [...(value as string[])].sort() : value;
}

async function readUserById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${USERS_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back users failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  const item = (body?.items ?? []).find((entry) => entry.id === id);
  if (!item) return null;
  // Multiselect ordering is not guaranteed by the list query — normalize so the harness'
  // deep-equality assertion stays deterministic.
  return { ...item, roleIds: sortedStrings(item.roleIds), roles: sortedStrings(item.roles) };
}

async function readUserAcl(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<{ hasCustomAcl?: boolean; features?: string[]; organizations?: string[] | null }> {
  const response = await apiRequest(
    request,
    'GET',
    `${USERS_PATH}/acl?userId=${encodeURIComponent(userId)}`,
    { token },
  );
  expect(response.status(), `read user ACL failed: ${response.status()}`).toBe(200);
  return (await readJsonSafe<{ hasCustomAcl?: boolean; features?: string[]; organizations?: string[] | null }>(response)) ?? {};
}

test.describe('TC-AUTH-CRUDFORM-001: User CrudForm persists scalars, roles[] + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, the roles[] multiselect, and custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenContext(token);
    const stamp = `${Date.now()}_${randomInt(1_000_000)}`;
    const email = `qa-crudform-user-${stamp}@example.com`;
    const customFields: CustomFieldFixture[] = [
      { key: `qa_note_${stamp}`, kind: 'text', label: 'QA Note', createValue: 'Original note', updateValue: 'Updated note' },
      { key: `qa_rank_${stamp}`, kind: 'integer', label: 'QA Rank', createValue: 7, updateValue: 12 },
      { key: `qa_tier_${stamp}`, kind: 'select', label: 'QA Tier', options: ['bronze', 'silver', 'gold'], createValue: 'silver', updateValue: 'silver', retainOnUpdate: true },
      { key: `qa_flag_${stamp}`, kind: 'boolean', label: 'QA Flag', createValue: true, updateValue: false },
    ];
    let roleAId: string | null = null;
    let roleBId: string | null = null;

    try {
      for (const field of customFields) {
        await createCustomFieldDefinition(request, token, USER_ENTITY_ID, field);
      }
      roleAId = await createRoleFixture(request, token, { name: `qa-crudform-user-role-a-${stamp}` });
      roleBId = await createRoleFixture(request, token, { name: `qa-crudform-user-role-b-${stamp}` });
      const bothRoleIds = [roleAId, roleBId].sort();

      const createCustomPayload = Object.fromEntries(customFields.map((field) => [`cf_${field.key}`, field.createValue]));
      const updateCustomPayload = Object.fromEntries(
        customFields.filter((field) => !field.retainOnUpdate).map((field) => [`cf_${field.key}`, field.updateValue]),
      );
      const expectAfterCreateCustom = Object.fromEntries(customFields.map((field) => [field.key, field.createValue]));
      const expectAfterUpdateCustom = Object.fromEntries(
        customFields.map((field) => [field.key, field.retainOnUpdate ? field.createValue : field.updateValue]),
      );

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: USERS_PATH,
        readById: (id) => readUserById(request, token, id),
        create: {
          payload: {
            email,
            name: 'QA CrudForm User',
            password: USER_PASSWORD,
            organizationId,
            roles: [roleAId, roleBId],
            ...createCustomPayload,
          },
        },
        expectAfterCreate: {
          scalars: {
            email,
            name: 'QA CrudForm User',
            organizationId,
            roleIds: bothRoleIds,
            hasPassword: true,
          },
          customFields: expectAfterCreateCustom,
        },
        update: {
          payload: (id) => ({
            id,
            name: 'QA CrudForm User EDITED',
            roles: [roleAId],
            ...updateCustomPayload,
          }),
        },
        expectAfterUpdate: {
          scalars: {
            email,
            name: 'QA CrudForm User EDITED',
            organizationId,
            roleIds: [roleAId],
            hasPassword: true,
          },
          customFields: expectAfterUpdateCustom,
        },
      });
    } finally {
      await deleteRoleIfExists(request, token, roleAId);
      await deleteRoleIfExists(request, token, roleBId);
      for (const field of customFields) {
        await deleteCustomFieldDefinitionIfExists(request, token, USER_ENTITY_ID, field.key);
      }
    }
  });

  test('round-trips the user ACL override (features + organization visibility) on set and update', async ({ request }) => {
    // Complements TC-AUTH-043 (override enforcement): here we assert the ACL field round-trip
    // itself — set → read-back → update → read-back — for a CrudForm-created user.
    const token = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenContext(token);
    const stamp = `${Date.now()}_${randomInt(1_000_000)}`;
    const email = `qa-crudform-user-acl-${stamp}@example.com`;
    let roleId: string | null = null;
    let userId: string | null = null;

    try {
      roleId = await createRoleFixture(request, token, { name: `qa-crudform-user-acl-${stamp}` });
      userId = await createUserFixture(request, token, {
        email,
        password: USER_PASSWORD,
        organizationId,
        roles: [roleId],
        name: 'QA CrudForm User ACL',
      });

      await setUserAclVisibility(request, token, {
        userId,
        organizations: [organizationId],
        features: ['auth.users.list'],
      });
      const afterSet = await readUserAcl(request, token, userId);
      expect(afterSet.hasCustomAcl, 'user should have a custom ACL after the set').toBe(true);
      expect((afterSet.features ?? []).slice().sort(), 'granted feature should round-trip exactly').toEqual(['auth.users.list']);
      expect(afterSet.organizations ?? [], 'organization visibility should round-trip').toEqual([organizationId]);

      await setUserAclVisibility(request, token, {
        userId,
        organizations: null,
        features: ['auth.users.list', 'auth.roles.list'],
      });
      const afterUpdate = await readUserAcl(request, token, userId);
      expect((afterUpdate.features ?? []).slice().sort(), 'updated features should round-trip').toEqual([
        'auth.roles.list',
        'auth.users.list',
      ]);
      expect(afterUpdate.organizations, 'cleared organization visibility means no restriction').toBeNull();
    } finally {
      await deleteUserIfExists(request, token, userId);
      await deleteRoleIfExists(request, token, roleId);
    }
  });
});
