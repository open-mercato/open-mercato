import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  readJsonSafe,
  deleteEntityByPathIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DICT-006: Dictionary duplicate key validation — 409 on key collision
 *
 * Dictionary keys are unique per organization/tenant. The route does an explicit
 * lookup (scoped to deletedAt: null) and returns 409
 * `{ error: 'A dictionary with this key already exists' }` before insert/update,
 * so the conflict is deterministic and does not depend on a DB constraint firing.
 *
 * Covers POST (create collision) and PATCH (rename collision + successful rename).
 */
test.describe('TC-DICT-006: Duplicate dictionary key returns 409', () => {
  test('POST and PATCH reject a colliding key with 409; a unique rename succeeds', async ({ request }) => {
    const stamp = Date.now();
    const keyA = `qa_dict_006_a_${stamp}`;
    const keyB = `qa_dict_006_b_${stamp}`;
    const keyC = `qa_dict_006_c_${stamp}`;
    let token: string | null = null;
    let firstId: string | null = null;
    let secondId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      // D1 with key A.
      const firstResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: keyA, name: 'QA TC-DICT-006 First' },
      });
      expect(firstResponse.status(), 'POST first dictionary should return 201').toBe(201);
      firstId = (await readJsonSafe<{ id?: string }>(firstResponse))?.id ?? null;
      expect(firstId, 'First dictionary should have an id').toBeTruthy();

      // POST another dictionary with the same key -> 409.
      const duplicateResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: keyA, name: 'QA TC-DICT-006 Duplicate' },
      });
      expect(duplicateResponse.status(), 'POST with duplicate key should return 409').toBe(409);
      const duplicateBody = await readJsonSafe<{ error?: string }>(duplicateResponse);
      expect(
        typeof duplicateBody?.error === 'string' && /exist|duplicate/i.test(duplicateBody.error),
        'Duplicate POST error should mention the key already exists',
      ).toBe(true);

      // D2 with key B.
      const secondResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: keyB, name: 'QA TC-DICT-006 Second' },
      });
      expect(secondResponse.status(), 'POST second dictionary should return 201').toBe(201);
      secondId = (await readJsonSafe<{ id?: string }>(secondResponse))?.id ?? null;
      expect(secondId, 'Second dictionary should have an id').toBeTruthy();

      // PATCH D2 to key A (collision) -> 409.
      const patchCollision = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(secondId!)}`,
        { token, data: { key: keyA } },
      );
      expect(patchCollision.status(), 'PATCH to an existing key should return 409').toBe(409);

      // PATCH D2 to a new unique key C -> 200.
      const patchUnique = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(secondId!)}`,
        { token, data: { key: keyC } },
      );
      expect(patchUnique.status(), 'PATCH to a unique key should return 200').toBe(200);
      expect((await readJsonSafe<{ key?: string }>(patchUnique))?.key, 'Key should be updated to the unique value').toBe(keyC);
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        firstId ? `/api/dictionaries/${encodeURIComponent(firstId)}` : null,
      );
      await deleteEntityByPathIfExists(
        request,
        token,
        secondId ? `/api/dictionaries/${encodeURIComponent(secondId)}` : null,
      );
    }
  });
});
