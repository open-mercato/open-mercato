import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  readJsonSafe,
  deleteEntityByPathIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DICT-005: Dictionary filtering — `includeInactive` query parameter and soft delete
 *
 * Behavior under test (verified against the route implementation):
 *  - GET /api/dictionaries ALWAYS filters `deletedAt: null`; by default it also
 *    filters `isActive: true`. `?includeInactive=true` drops only the `isActive`
 *    filter — it does NOT surface soft-deleted (deletedAt != null) dictionaries.
 *  - A dictionary created with `isActive: false` (deletedAt stays null) is hidden
 *    from the default list but visible under `includeInactive=true`.
 *  - PATCH `isActive: false` AND DELETE both archive the record (set deletedAt),
 *    so the row disappears from BOTH the default list and the includeInactive list.
 *
 * The list payload exposes `isActive` (not `deletedAt`), so visibility is asserted
 * via list membership plus the `isActive` flag — the observable API contract.
 */
type DictionaryListItem = { id?: string; isActive?: boolean };

async function listDictionaries(
  request: APIRequestContext,
  token: string,
  includeInactive: boolean,
): Promise<DictionaryListItem[]> {
  const path = includeInactive ? '/api/dictionaries?includeInactive=true' : '/api/dictionaries';
  const response = await apiRequest(request, 'GET', path, { token });
  expect(response.status(), `GET ${path} should return 200`).toBe(200);
  const body = await readJsonSafe<{ items?: DictionaryListItem[] }>(response);
  return Array.isArray(body?.items) ? body.items : [];
}

test.describe('TC-DICT-005: includeInactive filtering and soft-delete behavior', () => {
  test('includeInactive surfaces inactive-but-not-deleted dictionaries; PATCH/DELETE archive them', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let activeId: string | null = null;
    let inactiveId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      // D_active: created active (isActive defaults to true, deletedAt null).
      const activeResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: `qa_dict_005_active_${stamp}`, name: 'QA TC-DICT-005 Active' },
      });
      expect(activeResponse.status(), 'POST active dictionary should return 201').toBe(201);
      activeId = (await readJsonSafe<{ id?: string }>(activeResponse))?.id ?? null;
      expect(activeId, 'Active dictionary should have an id').toBeTruthy();

      // D_inactive: created with isActive:false -> hidden from default, visible with includeInactive.
      const inactiveResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token,
        data: { key: `qa_dict_005_inactive_${stamp}`, name: 'QA TC-DICT-005 Inactive', isActive: false },
      });
      expect(inactiveResponse.status(), 'POST inactive dictionary should return 201').toBe(201);
      const inactiveBody = await readJsonSafe<{ id?: string; isActive?: boolean }>(inactiveResponse);
      inactiveId = inactiveBody?.id ?? null;
      expect(inactiveId, 'Inactive dictionary should have an id').toBeTruthy();
      expect(inactiveBody?.isActive, 'POST with isActive:false should persist isActive=false').toBe(false);

      // Default list: active present, inactive absent.
      const defaultList1 = await listDictionaries(request, token, false);
      expect(
        defaultList1.some((item) => item.id === activeId),
        'Active dictionary should appear in the default list',
      ).toBe(true);
      expect(
        defaultList1.some((item) => item.id === inactiveId),
        'Inactive dictionary should NOT appear in the default list',
      ).toBe(false);

      // includeInactive list: both present; inactive carries isActive=false.
      const inactiveList1 = await listDictionaries(request, token, true);
      expect(
        inactiveList1.some((item) => item.id === activeId),
        'Active dictionary should appear in the includeInactive list',
      ).toBe(true);
      const inactiveInList = inactiveList1.find((item) => item.id === inactiveId);
      expect(inactiveInList, 'Inactive dictionary should appear in the includeInactive list').toBeTruthy();
      expect(inactiveInList?.isActive, 'Inactive dictionary should report isActive=false').toBe(false);

      // PATCH active -> isActive:false. This sets deletedAt (archive), so the row
      // leaves BOTH lists — includeInactive does not resurface archived records.
      const patchResponse = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(activeId!)}`,
        { token, data: { isActive: false } },
      );
      expect(patchResponse.status(), 'PATCH isActive:false should return 200').toBe(200);
      expect((await readJsonSafe<{ isActive?: boolean }>(patchResponse))?.isActive, 'PATCH should set isActive=false').toBe(false);

      const defaultList2 = await listDictionaries(request, token, false);
      expect(
        defaultList2.some((item) => item.id === activeId),
        'Archived (PATCH isActive:false) dictionary should be absent from the default list',
      ).toBe(false);
      const inactiveList2 = await listDictionaries(request, token, true);
      expect(
        inactiveList2.some((item) => item.id === activeId),
        'Archived (PATCH isActive:false) dictionary should also be absent from the includeInactive list',
      ).toBe(false);

      // DELETE inactive -> soft delete (sets deletedAt) -> leaves the includeInactive list too.
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/dictionaries/${encodeURIComponent(inactiveId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE inactive dictionary should return 200').toBe(200);

      const inactiveList3 = await listDictionaries(request, token, true);
      expect(
        inactiveList3.some((item) => item.id === inactiveId),
        'Soft-deleted dictionary should be absent from the includeInactive list',
      ).toBe(false);
      activeId = null;
      inactiveId = null;
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        activeId ? `/api/dictionaries/${encodeURIComponent(activeId)}` : null,
      );
      await deleteEntityByPathIfExists(
        request,
        token,
        inactiveId ? `/api/dictionaries/${encodeURIComponent(inactiveId)}` : null,
      );
    }
  });
});
