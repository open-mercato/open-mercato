import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-STAFF-CRUDFORM-001: Team Member CrudForm persists scalars, multiselect arrays + custom fields (#2466).
 *
 * The richest core surface: scalars (displayName, description, teamId FK, isActive), two
 * multiselect arrays (roleIds[] → role_ids, tags[]), and custom fields of several kinds
 * (date/text, float, integer, select, boolean, currency). Proves create + update round-trip.
 *
 * Verified contract:
 * - Read-back uses `?ids=` (the list route ignores `?id=`).
 * - Request bodies camelCase; responses snake_case (`role_ids`, `is_active`, ...). Custom fields
 *   submit as `cf_<key>` and return under `customValues` (the harness resolver handles it).
 * - PUT is a partial update — omitted custom fields are retained.
 * - Self-contained: creates its own team + two team-roles, deletes them in `finally`.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const MEMBERS_PATH = '/api/staff/team-members';
const TEAMS_PATH = '/api/staff/teams';
const ROLES_PATH = '/api/staff/team-roles';

async function createStaffFixture(
  request: APIRequestContext,
  token: string,
  path: string,
  data: CrudRecord,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data });
  expect(response.status(), `fixture create ${path} should be 201`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `fixture ${path} should return an id`);
}

async function readMemberByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${MEMBERS_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back team-members failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === id) ?? null;
}

test.describe('TC-STAFF-CRUDFORM-001: Team Member CrudForm persists scalars, multiselect + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, role_ids/tags arrays, and custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    let teamId: string | null = null;
    let roleAId: string | null = null;
    let roleBId: string | null = null;

    try {
      teamId = await createStaffFixture(request, token, TEAMS_PATH, {
        name: `QA CRUDFORM Team ${stamp}`,
        isActive: true,
      });
      roleAId = await createStaffFixture(request, token, ROLES_PATH, { name: `QA CRUDFORM Role A ${stamp}` });
      roleBId = await createStaffFixture(request, token, ROLES_PATH, { name: `QA CRUDFORM Role B ${stamp}` });

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: MEMBERS_PATH,
        readById: (id) => readMemberByIds(request, token, id),
        create: {
          payload: {
            displayName: `QA CRUDFORM Member ${stamp}`,
            description: 'Original member description',
            teamId,
            roleIds: [roleAId, roleBId],
            tags: ['alpha', 'beta'],
            isActive: true,
            cf_employment_date: '2024-03-15',
            cf_hourly_rate: 125.5,
            cf_currency_code: 'USD',
            cf_employment_type: 'full_time',
            cf_work_mode: 'hybrid',
            cf_onboarded: true,
            cf_years_of_experience: 7,
          },
        },
        expectAfterCreate: {
          scalars: {
            display_name: `QA CRUDFORM Member ${stamp}`,
            description: 'Original member description',
            team_id: teamId,
            role_ids: [roleAId, roleBId],
            tags: ['alpha', 'beta'],
            is_active: true,
          },
          customFields: {
            employment_date: '2024-03-15',
            hourly_rate: 125.5,
            currency_code: 'USD',
            employment_type: 'full_time',
            work_mode: 'hybrid',
            onboarded: true,
            years_of_experience: 7,
          },
        },
        update: {
          payload: (id) => ({
            id,
            displayName: `QA CRUDFORM Member ${stamp} EDITED`,
            description: 'Updated member description',
            roleIds: [roleAId],
            tags: ['gamma'],
            isActive: false,
            cf_hourly_rate: 200,
            cf_employment_type: 'contract',
            cf_work_mode: 'remote',
            cf_onboarded: false,
            cf_years_of_experience: 12,
          }),
        },
        expectAfterUpdate: {
          scalars: {
            display_name: `QA CRUDFORM Member ${stamp} EDITED`,
            description: 'Updated member description',
            role_ids: [roleAId],
            tags: ['gamma'],
            is_active: false,
          },
          customFields: {
            hourly_rate: 200,
            employment_type: 'contract',
            work_mode: 'remote',
            onboarded: false,
            years_of_experience: 12,
            employment_date: '2024-03-15',
            currency_code: 'USD',
          },
        },
      });
    } finally {
      await deleteGeneralEntityIfExists(request, token, ROLES_PATH, roleAId);
      await deleteGeneralEntityIfExists(request, token, ROLES_PATH, roleBId);
      await deleteGeneralEntityIfExists(request, token, TEAMS_PATH, teamId);
    }
  });
});
