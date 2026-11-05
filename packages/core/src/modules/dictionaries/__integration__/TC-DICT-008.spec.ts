import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  readJsonSafe,
  deleteEntityByPathIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { createDictionaryFixture } from '@open-mercato/core/modules/core/__integration__/helpers/dictionariesFixtures';

/**
 * TC-DICT-008: Entry reorder — POST /entries/reorder updates positions and persists
 *
 * The reorder route accepts `{ entries: [{ id, position }] }` and returns
 * `{ ok: true }`. It persists each entry's `position`. Note: the GET entries
 * endpoint sorts by the dictionary's `entrySortMode` (default `label_asc`) — there
 * is NO position-based sort mode — so the assertion verifies the persisted
 * `position` FIELD on each entry rather than the array order of the response.
 */
type DictionaryEntry = { id?: string; position?: number };

async function entryPositions(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
): Promise<Map<string, number>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
    { token },
  );
  expect(response.status(), 'GET entries should return 200').toBe(200);
  const items = (await readJsonSafe<{ items?: DictionaryEntry[] }>(response))?.items ?? [];
  const positions = new Map<string, number>();
  for (const item of items) {
    if (typeof item.id === 'string') positions.set(item.id, item.position ?? 0);
  }
  return positions;
}

async function createEntry(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  value: string,
  label: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
    { token, data: { value, label } },
  );
  expect(response.status(), `POST entry "${value}" should return 201`).toBe(201);
  const id = (await readJsonSafe<{ id?: string }>(response))?.id ?? null;
  expect(id, `Entry "${value}" should have an id`).toBeTruthy();
  return id as string;
}

test.describe('TC-DICT-008: Reorder dictionary entries', () => {
  test('reorder persists the position field for each entry and can run repeatedly', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let dictionaryId: string | null = null;
    const entryIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      dictionaryId = await createDictionaryFixture(request, token, {
        key: `qa_dict_008_${stamp}`,
        name: 'QA TC-DICT-008 Dictionary',
      });

      const first = await createEntry(request, token, dictionaryId, 'first', 'First');
      const second = await createEntry(request, token, dictionaryId, 'second', 'Second');
      const third = await createEntry(request, token, dictionaryId, 'third', 'Third');
      entryIds.push(first, second, third);

      // Reorder #1: third=0, first=1, second=2.
      const reorder1 = await apiRequest(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/reorder`,
        {
          token,
          data: {
            entries: [
              { id: third, position: 0 },
              { id: first, position: 1 },
              { id: second, position: 2 },
            ],
          },
        },
      );
      expect(reorder1.status(), 'POST /entries/reorder should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(reorder1))?.ok, 'reorder should report ok: true').toBe(true);

      const positions1 = await entryPositions(request, token, dictionaryId);
      expect(positions1.get(third), 'third entry position should be 0').toBe(0);
      expect(positions1.get(first), 'first entry position should be 1').toBe(1);
      expect(positions1.get(second), 'second entry position should be 2').toBe(2);

      // Reorder #2: a different permutation can be applied again.
      const reorder2 = await apiRequest(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/reorder`,
        {
          token,
          data: {
            entries: [
              { id: first, position: 0 },
              { id: second, position: 1 },
              { id: third, position: 2 },
            ],
          },
        },
      );
      expect(reorder2.status(), 'second POST /entries/reorder should return 200').toBe(200);

      const positions2 = await entryPositions(request, token, dictionaryId);
      expect(positions2.get(first), 'first entry position should be 0 after second reorder').toBe(0);
      expect(positions2.get(second), 'second entry position should be 1 after second reorder').toBe(1);
      expect(positions2.get(third), 'third entry position should be 2 after second reorder').toBe(2);
    } finally {
      for (const entryId of entryIds) {
        await deleteEntityByPathIfExists(
          request,
          token,
          dictionaryId
            ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId)}`
            : null,
        );
      }
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      );
    }
  });
});
