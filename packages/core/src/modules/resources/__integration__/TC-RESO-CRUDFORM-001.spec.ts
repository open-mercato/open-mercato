import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-RESO-CRUDFORM-001: Resource CrudForm persists scalars + custom fields (#2466).
 *
 * Resources is the canonical rich-field surface: scalars (name, capacity, appearance,
 * resourceTypeId FK, isActive) plus custom fields of several kinds (text, integer, select,
 * boolean). Proves create + update round-trip every value.
 *
 * Notes from the verified API contract:
 * - The list GET filters by `?ids=` (comma-separated), NOT `?id=` — so a custom `readById`.
 * - Request bodies are camelCase; responses are snake_case. Custom fields submit + return as
 *   top-level `cf_<key>` (the harness resolver handles that shape).
 * - capacityUnitValue is intentionally omitted: its dictionary values are example-seeded, not
 *   default-seeded, so relying on them would violate the self-contained-fixtures rule.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const RESOURCES_PATH = '/api/resources/resources';
const RESOURCE_TYPES_PATH = '/api/resources/resource-types';

async function readResourceByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${RESOURCES_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back resources failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === id) ?? null;
}

test.describe('TC-RESO-CRUDFORM-001: Resource CrudForm persists scalars + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars + custom fields (text/number/select/boolean) on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    let resourceTypeId: string | null = null;

    try {
      const typeResponse = await apiRequest(request, 'POST', RESOURCE_TYPES_PATH, {
        token,
        data: { name: `QA CRUDFORM Resource Type ${stamp}` },
      });
      expect(typeResponse.status(), 'resource-type fixture create should be 201').toBe(201);
      resourceTypeId = expectId(
        (await readJsonSafe<{ id?: string }>(typeResponse))?.id,
        'resource-type fixture should return an id',
      );

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: RESOURCES_PATH,
        readById: (id) => readResourceByIds(request, token, id),
        create: {
          payload: {
            name: `QA CRUDFORM Resource ${stamp}`,
            description: 'Original resource description',
            resourceTypeId,
            capacity: 4,
            appearanceIcon: 'lucide:laptop',
            appearanceColor: '#22c55e',
            isActive: true,
            cf_laptop_serial: 'SN-CRUDFORM-001',
            cf_laptop_ram_gb: 16,
            cf_laptop_os: 'macos',
            cf_asset_tag: 'AT-CRUDFORM-001',
            cf_room_projector: true,
          },
        },
        expectAfterCreate: {
          scalars: {
            name: `QA CRUDFORM Resource ${stamp}`,
            description: 'Original resource description',
            resource_type_id: resourceTypeId,
            capacity: 4,
            is_active: true,
            appearance_icon: 'lucide:laptop',
            appearance_color: '#22c55e',
          },
          customFields: {
            laptop_serial: 'SN-CRUDFORM-001',
            laptop_ram_gb: 16,
            laptop_os: 'macos',
            asset_tag: 'AT-CRUDFORM-001',
            room_projector: true,
          },
        },
        update: {
          payload: (id) => ({
            id,
            name: `QA CRUDFORM Resource ${stamp} EDITED`,
            description: 'Updated resource description',
            capacity: 8,
            isActive: false,
            cf_laptop_serial: 'SN-CRUDFORM-EDIT',
            cf_laptop_ram_gb: 32,
            cf_laptop_os: 'linux',
            cf_room_projector: false,
          }),
        },
        expectAfterUpdate: {
          scalars: {
            name: `QA CRUDFORM Resource ${stamp} EDITED`,
            description: 'Updated resource description',
            capacity: 8,
            is_active: false,
          },
          customFields: {
            laptop_serial: 'SN-CRUDFORM-EDIT',
            laptop_ram_gb: 32,
            laptop_os: 'linux',
            room_projector: false,
            asset_tag: 'AT-CRUDFORM-001',
          },
        },
      });
    } finally {
      await deleteGeneralEntityIfExists(request, token, RESOURCE_TYPES_PATH, resourceTypeId);
    }
  });
});
