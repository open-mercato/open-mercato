import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityByPathIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DICT-001: Dictionary CRUD via API
 * Covers: POST/GET/PATCH/DELETE /api/dictionaries and /api/dictionaries/[dictionaryId]
 */
test.describe('TC-DICT-001: Dictionary CRUD via API', () => {
  test('should create, read, update, and delete a dictionary', async ({ request }) => {
    let token: string | null = null;
    let dictionaryId: string | null = null;
    const key = `qa_dict_${Date.now()}`;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key, name: 'QA TC-DICT-001 Dictionary' },
      });
      expect(createResponse.status(), 'POST /api/dictionaries should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      dictionaryId = createBody.id ?? null;

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/dictionaries/[id] should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { id?: string; name?: string };
      expect(getBody.id, 'GET response should include id').toBeTruthy();

      const patchResponse = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        {
          token,
          data: { name: 'QA TC-DICT-001 Updated' },
        },
      );
      expect(patchResponse.status(), 'PATCH /api/dictionaries/[id] should return 200').toBe(200);
      const patchBody = (await patchResponse.json()) as { name?: string };
      expect(patchBody.name, 'name should be updated').toBe('QA TC-DICT-001 Updated');

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/dictionaries/[id] should return 200').toBe(200);
      dictionaryId = null;
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      );
    }
  });
});
