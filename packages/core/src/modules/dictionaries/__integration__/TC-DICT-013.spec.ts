import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  readJsonSafe,
  deleteEntityByPathIfExists,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DICT-013: An explicit null dictionary description is accepted
 *
 * The description column is nullable and GET returns `description: null` for a dictionary
 * without one, so POST and PATCH accept `description: null` too: PATCH clears the stored
 * description and POST creates the dictionary without one.
 */

type DictionaryDetail = { id?: string; description?: string | null };

async function readDictionary(request: APIRequestContext, token: string, id: string): Promise<DictionaryDetail | null> {
  const response = await apiRequest(request, 'GET', `/api/dictionaries/${encodeURIComponent(id)}`, { token });
  expect(response.status(), 'GET dictionary should return 200').toBe(200);
  return readJsonSafe<DictionaryDetail>(response);
}

test.describe('TC-DICT-013: explicit null dictionary description', () => {
  test('PATCH with description null clears the description', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    const createdIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      const createResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: `qa_dict_013_patch_${stamp}`, name: 'QA TC-DICT-013 Patch', description: 'To be cleared' },
      });
      expect(createResponse.status(), 'POST should return 201').toBe(201);
      const id = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null;
      expect(id, 'Created dictionary should have an id').toBeTruthy();
      createdIds.push(id!);
      expect((await readDictionary(request, token, id!))?.description).toBe('To be cleared');

      const patchResponse = await apiRequest(request, 'PATCH', `/api/dictionaries/${encodeURIComponent(id!)}`, {
        token,
        data: { description: null },
      });
      expect(patchResponse.status(), 'PATCH with description null should return 200').toBe(200);
      expect((await readJsonSafe<DictionaryDetail>(patchResponse))?.description).toBeNull();
      expect((await readDictionary(request, token, id!))?.description, 'GET should return the cleared description').toBeNull();
    } finally {
      for (const id of createdIds) {
        await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${encodeURIComponent(id)}`);
      }
    }
  });

  test('POST with description null creates the dictionary without a description', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    const createdIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      const createResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: `qa_dict_013_post_${stamp}`, name: 'QA TC-DICT-013 Post', description: null },
      });
      const id = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null;
      if (id) createdIds.push(id);
      expect(createResponse.status(), 'POST with description null should return 201').toBe(201);
      expect(id, 'Created dictionary should have an id').toBeTruthy();
      expect((await readDictionary(request, token, id!))?.description).toBeNull();
    } finally {
      for (const id of createdIds) {
        await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${encodeURIComponent(id)}`);
      }
    }
  });
});
