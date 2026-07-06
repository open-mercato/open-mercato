import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SaveResponse = { perspective?: { id?: string } };
type StateResponse = { perspectives?: Array<{ id?: string; name?: string }> };

/**
 * TC-PERSP-CRUD-002 (#2491): DELETE /api/perspectives/[tableId]/[perspectiveId] removes
 * exactly one personal perspective and is idempotent.
 *
 * deleteUserPerspective() soft-deletes the matching row and returns silently when no row
 * matches, so the route always answers { success: true } / 200 — a repeat DELETE of the
 * same id must NOT 404. Two perspectives are created in the same table so the test can
 * prove that exactly the targeted record is removed and its sibling is untouched.
 */
test.describe('TC-PERSP-CRUD-002: delete personal perspective removes exactly one record', () => {
  test('deletes one personal perspective, leaves siblings, and is idempotent', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-crud-002-${stamp}`;
    const keepName = `QA Keep ${stamp}`;
    const dropName = `QA Drop ${stamp}`;
    let keepId: string | null = null;
    let dropId: string | null = null;

    const create = async (name: string): Promise<string> => {
      const res = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 20 } },
      });
      expect(res.status(), `create ${name}`).toBe(200);
      const body = await readJsonSafe<SaveResponse>(res);
      const id = body?.perspective?.id;
      expect(typeof id === 'string' && UUID_RE.test(id), 'create returns a UUID perspective id').toBe(true);
      return id as string;
    };

    try {
      keepId = await create(keepName);
      dropId = await create(dropName);

      // Both present before deletion.
      const before = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
      expect(before.status()).toBe(200);
      const beforeState = await readJsonSafe<StateResponse>(before);
      const beforeIds = (beforeState?.perspectives ?? []).map((perspective) => perspective.id);
      expect(beforeIds).toContain(keepId);
      expect(beforeIds).toContain(dropId);

      // Delete exactly the drop perspective.
      const del = await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${dropId}`, { token });
      expect(del.status(), 'DELETE returns 200').toBe(200);
      expect(await readJsonSafe<{ success?: boolean }>(del)).toEqual({ success: true });

      // Only the drop perspective is gone; the sibling survives (exactly one removed).
      const after = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
      expect(after.status()).toBe(200);
      const afterState = await readJsonSafe<StateResponse>(after);
      const afterIds = (afterState?.perspectives ?? []).map((perspective) => perspective.id);
      expect(afterIds).toContain(keepId);
      expect(afterIds).not.toContain(dropId);

      // Idempotent: deleting the same id again still returns 200 (service no-ops on missing rows).
      const delAgain = await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${dropId}`, { token });
      expect(delAgain.status(), 'idempotent DELETE returns 200 (not 404)').toBe(200);
      expect(await readJsonSafe<{ success?: boolean }>(delAgain)).toEqual({ success: true });
      dropId = null;
    } finally {
      if (keepId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${keepId}`, { token }).catch(() => {});
      }
      if (dropId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${dropId}`, { token }).catch(() => {});
      }
    }
  });
});
