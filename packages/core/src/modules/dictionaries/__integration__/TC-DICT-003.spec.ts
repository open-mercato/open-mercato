import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createDictionaryFixture } from '@open-mercato/core/modules/core/__integration__/helpers/dictionariesFixtures';
import { deleteEntityByPathIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';

/**
 * TC-DICT-003 — DictionariesManager save regression (issue #9) + optimistic lock.
 *
 * The manager edit dialog disables the key field but still resubmits the
 * existing key with the rest of the payload. Before the fix, the PATCH route
 * re-validated that key with the strict create-key regex (which forbids dots),
 * so editing a system dictionary whose key is namespaced (e.g.
 * `resources.activity-types`) threw a ZodError that fell through to the
 * catch-all 500 ("Failed to update dictionary"). This proves:
 *   - a normal manager-shape edit (key resubmitted unchanged) → 200,
 *   - a dotted/namespaced key resubmitted unchanged → 200 (no 500),
 *   - a stale optimistic-lock header → 409 `optimistic_lock_conflict`.
 */
test.describe('TC-DICT-003: dictionary save (manager edit) + optimistic lock', () => {
  test('normal manager-shape edit returns 200 and a stale edit returns 409', async ({ request }) => {
    let token: string | null = null;
    let dictionaryId: string | null = null;
    const key = `qa_dict_lock_${Date.now()}`;

    try {
      token = await getAuthToken(request, 'admin');
      dictionaryId = await createDictionaryFixture(request, token, {
        key,
        name: 'QA TC-DICT-003 Dictionary',
      });

      const detail = await apiRequest(request, 'GET', `/api/dictionaries/${dictionaryId}`, { token });
      expect(detail.status(), 'GET dictionary should be 200').toBe(200);
      const detailBody = (await detail.json()) as { updatedAt?: string };
      const currentUpdatedAt = detailBody.updatedAt;
      expect(typeof currentUpdatedAt, 'dictionary should expose updatedAt').toBe('string');

      // Normal save: manager resubmits the unchanged key alongside name + sort.
      const okResponse = await request.fetch(`/api/dictionaries/${dictionaryId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: currentUpdatedAt as string,
        },
        data: { key, name: 'QA TC-DICT-003 Updated', entrySortMode: 'label_desc' },
      });
      expect(okResponse.status(), 'manager-shape edit (matching lock) should be 200').toBe(200);
      const okBody = (await okResponse.json()) as { name?: string };
      expect(okBody.name, 'name should be updated').toBe('QA TC-DICT-003 Updated');

      // Stale save: replay with the now-outdated token → 409 conflict body.
      const staleResponse = await request.fetch(`/api/dictionaries/${dictionaryId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: currentUpdatedAt as string,
        },
        data: { key, name: 'QA TC-DICT-003 Stale', entrySortMode: 'label_asc' },
      });
      expect(staleResponse.status(), 'stale edit should be 409').toBe(409);
      const staleBody = (await staleResponse.json()) as { code?: string };
      expect(staleBody.code, 'stale body should carry the conflict code').toBe('optimistic_lock_conflict');
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${dictionaryId}` : null,
      );
    }
  });

  test('editing a namespaced (dotted) dictionary key resubmitted unchanged does not 500', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const listResponse = await apiRequest(request, 'GET', '/api/dictionaries', { token });
    expect(listResponse.status(), 'GET /api/dictionaries should be 200').toBe(200);
    const listBody = (await listResponse.json()) as {
      items?: Array<{ id: string; key: string; name: string; updatedAt?: string }>;
    };
    const dotted = (listBody.items ?? []).find(
      (item) => typeof item.key === 'string' && item.key.includes('.'),
    );
    test.skip(!dotted, 'no namespaced (dotted) dictionary key available in this environment');
    if (!dotted) return;

    const original = dotted;
    try {
      const patchResponse = await request.fetch(`/api/dictionaries/${original.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(typeof original.updatedAt === 'string'
            ? { [OPTIMISTIC_LOCK_HEADER_NAME]: original.updatedAt }
            : {}),
        },
        // Resubmit the dotted key unchanged, exactly like the manager edit dialog.
        data: { key: original.key, name: original.name },
      });
      expect(
        patchResponse.status(),
        `editing dotted key "${original.key}" must not 500 (got ${patchResponse.status()})`,
      ).not.toBe(500);
      expect(patchResponse.status(), 'resubmitting an unchanged dotted key should be accepted').toBe(200);
    } finally {
      // Restore the original name in case the edit landed.
      await request
        .fetch(`/api/dictionaries/${original.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: { name: original.name },
        })
        .catch(() => undefined);
    }
  });
});
