import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  deleteRoleIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-AUTH-CRUDFORM-002: Role CrudForm persists scalars + custom fields (#2557).
 *
 * Part of the CrudForm field-persistence sweep (umbrella #2466, harness PR #2548). Proves the
 * `auth` role surface saves AND reloads every field type on both create and update:
 *   - scalar: name
 *   - custom fields: text / integer / select / boolean
 *
 * Verified contract (see packages/core/src/modules/auth/api/roles/route.ts + commands/roles.ts):
 *   - POST 201, PUT 200 ({ ok: true }), DELETE `?id=` 200; list GET filters by `?id=` (single),
 *     so the harness' default read-back applies.
 *   - Responses are camelCase; custom fields submit as `cf_<key>` and return spread at the top
 *     level as `cf_<key>`. `auth` ships no `ce.ts`, so the spec creates its own field definitions
 *     via the entities API in setup and removes them in `finally`.
 *   - Roles persist custom fields scoped to `{ organizationId: null, tenantId }`; the entities API
 *     creates definitions at the admin org scope, so the storage column is resolved from the value
 *     type — text/select round-trip as strings, integer as a number, boolean as a boolean.
 *   - PUT is a partial update — the omitted select field is retained.
 *
 * Role ACL persistence is exercised by the companion test below and by the existing TC-AUTH-049
 * (role ACL organization visibility) spec.
 *
 * Self-contained: creates its own custom-field definitions and deletes them in `finally` (the
 * round-trip helper deletes the role it creates). Gated by
 * `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const ROLES_PATH = '/api/auth/roles';
const ROLE_ENTITY_ID = 'auth:role';
const DEFINITIONS_PATH = '/api/entities/definitions';

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

async function readRoleAcl(
  request: APIRequestContext,
  token: string,
  roleId: string,
): Promise<{ isSuperAdmin?: boolean; features?: string[]; organizations?: string[] | null }> {
  const response = await apiRequest(
    request,
    'GET',
    `${ROLES_PATH}/acl?roleId=${encodeURIComponent(roleId)}`,
    { token },
  );
  expect(response.status(), `read role ACL failed: ${response.status()}`).toBe(200);
  return (await readJsonSafe<{ isSuperAdmin?: boolean; features?: string[]; organizations?: string[] | null }>(response)) ?? {};
}

test.describe('TC-AUTH-CRUDFORM-002: Role CrudForm persists scalars + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips the role name and custom fields (text/integer/select/boolean) on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomInt(1_000_000)}`;
    const customFields: CustomFieldFixture[] = [
      { key: `qa_note_${stamp}`, kind: 'text', label: 'QA Note', createValue: 'Original note', updateValue: 'Updated note' },
      { key: `qa_rank_${stamp}`, kind: 'integer', label: 'QA Rank', createValue: 3, updateValue: 9 },
      { key: `qa_tier_${stamp}`, kind: 'select', label: 'QA Tier', options: ['bronze', 'silver', 'gold'], createValue: 'bronze', updateValue: 'bronze', retainOnUpdate: true },
      { key: `qa_flag_${stamp}`, kind: 'boolean', label: 'QA Flag', createValue: true, updateValue: false },
    ];

    try {
      for (const field of customFields) {
        await createCustomFieldDefinition(request, token, ROLE_ENTITY_ID, field);
      }

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
        collectionPath: ROLES_PATH,
        create: {
          payload: {
            name: `qa-crudform-role-${stamp}`,
            ...createCustomPayload,
          },
        },
        expectAfterCreate: {
          scalars: { name: `qa-crudform-role-${stamp}` },
          customFields: expectAfterCreateCustom,
        },
        update: {
          payload: (id) => ({
            id,
            name: `qa-crudform-role-${stamp}-edited`,
            ...updateCustomPayload,
          }),
        },
        expectAfterUpdate: {
          scalars: { name: `qa-crudform-role-${stamp}-edited` },
          customFields: expectAfterUpdateCustom,
        },
      });
    } finally {
      for (const field of customFields) {
        await deleteCustomFieldDefinitionIfExists(request, token, ROLE_ENTITY_ID, field.key);
      }
    }
  });

  test('round-trips role ACL features on set and update', async ({ request }) => {
    // Complements TC-AUTH-049 (role ACL organization visibility): here we assert the features
    // array round-trip — set → read-back → update → read-back — for a CrudForm-created role.
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomInt(1_000_000)}`;
    let roleId: string | null = null;

    try {
      roleId = await createRoleFixture(request, token, { name: `qa-crudform-role-acl-${stamp}` });

      await setRoleAclFeatures(request, token, { roleId, features: ['auth.users.list'] });
      const afterSet = await readRoleAcl(request, token, roleId);
      expect((afterSet.features ?? []).slice().sort(), 'granted feature should round-trip exactly').toEqual(['auth.users.list']);

      await setRoleAclFeatures(request, token, { roleId, features: ['auth.users.list', 'auth.roles.list'] });
      const afterUpdate = await readRoleAcl(request, token, roleId);
      expect((afterUpdate.features ?? []).slice().sort(), 'updated features should round-trip').toEqual([
        'auth.roles.list',
        'auth.users.list',
      ]);
    } finally {
      await deleteRoleIfExists(request, token, roleId);
    }
  });
});
