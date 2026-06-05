import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  readJsonSafe,
  deleteEntityByPathIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { createDictionaryFixture } from '@open-mercato/core/modules/core/__integration__/helpers/dictionariesFixtures';

/**
 * TC-DICT-009: Set default entry — POST /entries/set-default clears the previous default
 *
 * The set-default route accepts `{ entryId }` and returns `{ ok: true }`. Only one
 * entry per dictionary may be the default; setting a new default clears the prior
 * one. Asserts the invariant after each call rather than the (route-internal)
 * initial state, so the test stays robust regardless of create-time defaults.
 */
type DictionaryEntry = { id?: string; isDefault?: boolean };

async function entryDefaults(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
): Promise<Map<string, boolean>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
    { token },
  );
  expect(response.status(), 'GET entries should return 200').toBe(200);
  const items = (await readJsonSafe<{ items?: DictionaryEntry[] }>(response))?.items ?? [];
  const defaults = new Map<string, boolean>();
  for (const item of items) {
    if (typeof item.id === 'string') defaults.set(item.id, item.isDefault === true);
  }
  return defaults;
}

async function createEntry(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  value: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
    { token, data: { value, label: value } },
  );
  expect(response.status(), `POST entry "${value}" should return 201`).toBe(201);
  const id = (await readJsonSafe<{ id?: string }>(response))?.id ?? null;
  expect(id, `Entry "${value}" should have an id`).toBeTruthy();
  return id as string;
}

async function setDefault(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  entryId: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/set-default`,
    { token, data: { entryId } },
  );
  expect(response.status(), 'POST /entries/set-default should return 200').toBe(200);
  expect((await readJsonSafe<{ ok?: boolean }>(response))?.ok, 'set-default should report ok: true').toBe(true);
}

test.describe('TC-DICT-009: Set default dictionary entry', () => {
  test('setting a default marks one entry and clears any previous default', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let dictionaryId: string | null = null;
    const entryIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      dictionaryId = await createDictionaryFixture(request, token, {
        key: `qa_dict_009_${stamp}`,
        name: 'QA TC-DICT-009 Dictionary',
      });

      const optionA = await createEntry(request, token, dictionaryId, 'option_a');
      const optionB = await createEntry(request, token, dictionaryId, 'option_b');
      const optionC = await createEntry(request, token, dictionaryId, 'option_c');
      entryIds.push(optionA, optionB, optionC);

      // Set option A as default.
      await setDefault(request, token, dictionaryId, optionA);
      const afterA = await entryDefaults(request, token, dictionaryId);
      expect(afterA.get(optionA), 'option A should be the default').toBe(true);
      expect(afterA.get(optionB), 'option B should not be default').toBe(false);
      expect(afterA.get(optionC), 'option C should not be default').toBe(false);

      // Switch the default to option B — option A must be cleared.
      await setDefault(request, token, dictionaryId, optionB);
      const afterB = await entryDefaults(request, token, dictionaryId);
      expect(afterB.get(optionB), 'option B should be the default').toBe(true);
      expect(afterB.get(optionA), 'option A should be cleared after switching default').toBe(false);
      expect(afterB.get(optionC), 'option C should still not be default').toBe(false);

      const defaultCount = [...afterB.values()].filter(Boolean).length;
      expect(defaultCount, 'exactly one entry should be the default').toBe(1);
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
