import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  readJsonSafe,
  deleteEntityByPathIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DICT-011: A deleted or archived dictionary key answers 409, never 500
 *
 * DELETE and PATCH `isActive: false` soft-delete a dictionary (set deletedAt) but the
 * row keeps holding its key under `dictionaries_scope_key_unique`. Creating a dictionary
 * with that key, or renaming one onto it, answers the duplicate-key 409 and leaves the
 * deleted dictionary untouched. Concurrent creates or renames onto the same key resolve
 * to one winner and clean 409s, never a 500.
 */

type DictionaryListItem = { id?: string; key?: string };

const DUPLICATE_KEY_ERROR = 'A dictionary with this key already exists';

async function createDictionary(
  request: APIRequestContext,
  token: string,
  key: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/dictionaries', { token, data: { key, name } });
  expect(response.status(), `POST ${key} should return 201`).toBe(201);
  const id = (await readJsonSafe<{ id?: string }>(response))?.id ?? null;
  expect(id, `Dictionary ${key} should have an id`).toBeTruthy();
  return id!;
}

async function liveDictionariesWithKey(
  request: APIRequestContext,
  token: string,
  key: string,
): Promise<DictionaryListItem[]> {
  const response = await apiRequest(request, 'GET', '/api/dictionaries?includeInactive=true', { token });
  expect(response.status(), 'GET /api/dictionaries should return 200').toBe(200);
  const body = await readJsonSafe<{ items?: DictionaryListItem[] }>(response);
  return (body?.items ?? []).filter((item) => item.key === key);
}

test.describe('TC-DICT-011: deleted or archived dictionary key answers 409', () => {
  test('rejects recreating a deleted key and renaming onto an archived key with 409', async ({ request }) => {
    const stamp = Date.now();
    const deletedKey = `qa_dict_011_deleted_${stamp}`;
    const archivedKey = `qa_dict_011_archived_${stamp}`;
    const renameSourceKey = `qa_dict_011_source_${stamp}`;
    let token: string | null = null;
    const createdIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');

      const deletedId = await createDictionary(request, token, deletedKey, 'QA TC-DICT-011 Deleted');
      createdIds.push(deletedId);
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/dictionaries/${encodeURIComponent(deletedId)}`, { token });
      expect(deleteResponse.status(), 'DELETE should return 200').toBe(200);

      const recreateResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: deletedKey, name: 'QA TC-DICT-011 Recreated' },
      });
      expect(recreateResponse.status(), 'POST with a deleted dictionary key should return 409').toBe(409);
      expect(
        (await readJsonSafe<{ error?: string }>(recreateResponse))?.error,
        'POST with a deleted dictionary key should return the duplicate-key error',
      ).toBe(DUPLICATE_KEY_ERROR);
      expect(await liveDictionariesWithKey(request, token, deletedKey), 'No live dictionary should hold the deleted key').toEqual([]);

      const archivedId = await createDictionary(request, token, archivedKey, 'QA TC-DICT-011 Archived');
      createdIds.push(archivedId);
      const archiveResponse = await apiRequest(request, 'PATCH', `/api/dictionaries/${encodeURIComponent(archivedId)}`, {
        token,
        data: { isActive: false },
      });
      expect(archiveResponse.status(), 'PATCH isActive:false should return 200').toBe(200);

      const sourceId = await createDictionary(request, token, renameSourceKey, 'QA TC-DICT-011 Source');
      createdIds.push(sourceId);
      const renameResponse = await apiRequest(request, 'PATCH', `/api/dictionaries/${encodeURIComponent(sourceId)}`, {
        token,
        data: { key: archivedKey },
      });
      expect(renameResponse.status(), 'PATCH key onto an archived dictionary key should return 409').toBe(409);
      expect(
        (await readJsonSafe<{ error?: string }>(renameResponse))?.error,
        'PATCH key onto an archived dictionary key should return the duplicate-key error',
      ).toBe(DUPLICATE_KEY_ERROR);

      const sourceResponse = await apiRequest(request, 'GET', `/api/dictionaries/${encodeURIComponent(sourceId)}`, { token });
      expect(sourceResponse.status(), 'GET the rename source should return 200').toBe(200);
      expect((await readJsonSafe<{ key?: string }>(sourceResponse))?.key, 'The rejected rename should keep the source key').toBe(renameSourceKey);
    } finally {
      for (const id of createdIds) {
        await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${encodeURIComponent(id)}`);
      }
    }
  });

  test('concurrent creates of one key yield one 201 and 409s, never a 500', async ({ request }) => {
    const key = `qa_dict_011_race_${Date.now()}`;
    let token: string | null = null;
    const createdIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      const authToken = token;
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_unused, index) =>
          apiRequest(request, 'POST', '/api/dictionaries', {
            token: authToken,
            data: { key, name: `QA TC-DICT-011 Race ${index}` },
          }),
        ),
      );
      const statuses = responses.map((response) => response.status());
      for (const response of responses) {
        if (response.status() === 201) {
          const id = (await readJsonSafe<{ id?: string }>(response))?.id;
          if (id) createdIds.push(id);
        }
      }

      expect(statuses.filter((status) => status === 201), `Exactly one create should win: ${statuses.join(',')}`).toHaveLength(1);
      expect(statuses.filter((status) => status !== 201 && status !== 409), `Losers should get 409: ${statuses.join(',')}`).toEqual([]);
      const live = await liveDictionariesWithKey(request, token, key);
      expect(live, 'Exactly one live dictionary should hold the raced key').toHaveLength(1);
    } finally {
      for (const id of createdIds) {
        await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${encodeURIComponent(id)}`);
      }
    }
  });

  test('concurrent renames onto one key yield one 200 and 409s, never a 500', async ({ request }) => {
    const stamp = Date.now();
    const targetKey = `qa_dict_011_rename_race_${stamp}`;
    let token: string | null = null;
    const createdIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      for (let index = 0; index < 8; index += 1) {
        createdIds.push(await createDictionary(request, token, `qa_dict_011_rename_src_${index}_${stamp}`, `QA TC-DICT-011 Rename ${index}`));
      }
      const authToken = token;
      const responses = await Promise.all(
        createdIds.map((id) =>
          apiRequest(request, 'PATCH', `/api/dictionaries/${encodeURIComponent(id)}`, {
            token: authToken,
            data: { key: targetKey },
          }),
        ),
      );
      const statuses = responses.map((response) => response.status());

      expect(statuses.filter((status) => status === 200), `Exactly one rename should win: ${statuses.join(',')}`).toHaveLength(1);
      expect(statuses.filter((status) => status !== 200 && status !== 409), `Losers should get 409: ${statuses.join(',')}`).toEqual([]);
      const live = await liveDictionariesWithKey(request, token, targetKey);
      expect(live, 'Exactly one live dictionary should hold the raced key').toHaveLength(1);
    } finally {
      for (const id of createdIds) {
        await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${encodeURIComponent(id)}`);
      }
    }
  });
});
