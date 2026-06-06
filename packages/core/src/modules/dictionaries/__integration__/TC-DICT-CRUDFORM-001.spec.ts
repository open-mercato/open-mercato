import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteEntityByPathIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures';
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-DICT-CRUDFORM-001: Dictionary entry CrudForm persists every field (#2466 / #2569).
 *
 * The dictionary entry is a scalar-only surface (no custom fields — the module ships no
 * `ce.ts` — and no dictionary/multiselect sub-fields of its own). It proves create + update
 * round-trip every editable field: value, label, color, icon, position, isDefault.
 *
 * Verified API contract (why the shared `runCrudFormRoundTrip` does NOT fit this surface):
 * - Entries are nested under a dictionary: create is `POST /api/dictionaries/{id}/entries`
 *   (201), but detail mutations use the **path-param** route
 *   `PATCH|DELETE /api/dictionaries/{id}/entries/{entryId}` — update is **PATCH, not PUT**,
 *   and delete is by path, not `?id=`. The harness hard-codes PUT + `?id=` DELETE on one
 *   collection path, so this spec runs the canonical create→read→assert→update→read→assert
 *   cycle inline while reusing the shared sweep gate + `assertScalarFieldsPersisted`.
 * - Responses are **camelCase** (`{ id, value, label, color, icon, position, isDefault, ... }`),
 *   so the expectation keys are camelCase too.
 * - The entries list GET returns every entry (no `?ids=` filter), so read-back lists and
 *   matches on `id`.
 * - `color` is normalized to **lowercase** hex by the command; expectations use lowercase.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
test.describe('TC-DICT-CRUDFORM-001: Dictionary entry CrudForm persists every field on create + update', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips all scalar fields through the nested dictionary entry routes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    let dictionaryId: string | null = null;
    let entryId: string | null = null;

    try {
      // Self-contained fixture: a fresh dictionary to host the entry.
      dictionaryId = await createDictionaryFixture(request, token, {
        key: `qa_dict_crudform_${stamp}`,
        name: `QA CRUDFORM Dictionary ${stamp}`,
      });
      const entriesPath = `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`;

      const readEntryById = async (id: string): Promise<CrudRecord | null> => {
        const response = await apiRequest(request, 'GET', entriesPath, { token });
        expect(response.status(), `read-back entries failed: ${response.status()}`).toBe(200);
        const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
        return (body?.items ?? []).find((item) => item.id === id) ?? null;
      };

      // Create with every editable field populated.
      const createResponse = await apiRequest(request, 'POST', entriesPath, {
        token,
        data: {
          value: `qa-crudform-${stamp}`,
          label: 'QA CRUDFORM Entry',
          color: '#3366ff',
          icon: 'lucide:book',
          position: 3,
        },
      });
      expect(createResponse.status(), 'create entry should be 201').toBe(201);
      entryId = expectId(
        (await readJsonSafe<{ id?: string }>(createResponse))?.id,
        'create entry response should include an id',
      );

      const afterCreate = await readEntryById(entryId);
      expect(afterCreate, `created entry ${entryId} should be readable`).toBeTruthy();
      assertScalarFieldsPersisted(
        afterCreate as CrudRecord,
        {
          value: `qa-crudform-${stamp}`,
          label: 'QA CRUDFORM Entry',
          color: '#3366ff',
          icon: 'lucide:book',
          position: 3,
          isDefault: false,
        },
        'after-create',
      );

      // Update every field via PATCH (path-param detail route, not PUT on the collection).
      const updateResponse = await apiRequest(
        request,
        'PATCH',
        `${entriesPath}/${encodeURIComponent(entryId)}`,
        {
          token,
          data: {
            value: `qa-crudform-${stamp}-edited`,
            label: 'QA CRUDFORM Entry EDITED',
            color: '#aa1133',
            icon: 'lucide:bookmark',
            position: 7,
            isDefault: true,
          },
        },
      );
      expect(updateResponse.status(), 'update entry should be 200').toBe(200);

      const afterUpdate = await readEntryById(entryId);
      expect(afterUpdate, `updated entry ${entryId} should be readable`).toBeTruthy();
      assertScalarFieldsPersisted(
        afterUpdate as CrudRecord,
        {
          value: `qa-crudform-${stamp}-edited`,
          label: 'QA CRUDFORM Entry EDITED',
          color: '#aa1133',
          icon: 'lucide:bookmark',
          position: 7,
          isDefault: true,
        },
        'after-update',
      );
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId && entryId
          ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId)}`
          : null,
      );
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      );
    }
  });
});
