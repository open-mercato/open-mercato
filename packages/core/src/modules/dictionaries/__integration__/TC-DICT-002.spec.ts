import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createDictionaryFixture } from '@open-mercato/core/modules/core/__integration__/helpers/dictionariesFixtures';
import { deleteEntityByPathIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DICT-002: Dictionary Entries CRUD via API
 * Covers: POST/PATCH/GET/DELETE /api/dictionaries/[dictionaryId]/entries and /api/dictionaries/[dictionaryId]/entries/[entryId]
 */
test.describe('TC-DICT-002: Dictionary Entries CRUD via API', () => {
  test('should create, update, read, and delete a dictionary entry', async ({ request }) => {
    let token: string | null = null;
    let dictionaryId: string | null = null;
    let entryId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      dictionaryId = await createDictionaryFixture(request, token, {
        key: `qa_dict_entries_${Date.now()}`,
        name: 'QA TC-DICT-002 Dictionary',
      });

      const createEntryResponse = await apiRequest(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        {
          token,
          data: { value: 'qa_entry_value', label: 'QA Entry Label' },
        },
      );
      expect(createEntryResponse.status(), 'POST /api/dictionaries/[id]/entries should return 201').toBe(201);
      const createEntryBody = (await createEntryResponse.json()) as { id?: string };
      expect(createEntryBody.id, 'Response should contain an id').toBeTruthy();
      entryId = createEntryBody.id ?? null;

      const patchEntryResponse = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId!)}`,
        {
          token,
          data: { label: 'QA Entry Updated Label' },
        },
      );
      expect(patchEntryResponse.status(), 'PATCH /api/dictionaries/[id]/entries/[entryId] should return 200').toBe(200);

      const listEntriesResponse = await apiRequest(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        { token },
      );
      expect(listEntriesResponse.status(), 'GET /api/dictionaries/[id]/entries should return 200').toBe(200);
      const listBody = (await listEntriesResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(listBody.items), 'Response should contain items array').toBeTruthy();
      const updatedEntry = (listBody.items ?? []).find((item) => item.id === entryId);
      expect(updatedEntry, 'Created entry should appear in the list').toBeTruthy();
      expect(updatedEntry?.label, 'label should be updated').toBe('QA Entry Updated Label');

      const deleteEntryResponse = await apiRequest(
        request,
        'DELETE',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId!)}`,
        { token },
      );
      expect(deleteEntryResponse.status(), 'DELETE /api/dictionaries/[id]/entries/[entryId] should return 200').toBe(200);
      entryId = null;
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
