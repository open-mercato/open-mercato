import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
}

/**
 * TC-PERSP-ATOMIC-VERIFY (PR #2354 / umbrella #2333): backward-compatibility +
 * data-safety verification for the multi-table atomic save of perspectives.
 *
 * POST /api/perspectives/[tableId] saves the personal perspective (and any role
 * perspectives) under a single transaction (withAtomicFlush({ transaction:
 * true })). This suite verifies, end to end over HTTP, that a personal-only save
 * round-trips every settings field and persists exactly one perspective.
 *
 * Probe findings: the save endpoint returns { perspective, rolePerspectives,
 * clearedRoleIds } and does NOT emit an x-om-operation header — perspective save
 * is not wired into the audit-log/undo pipeline, so there is no undo token to
 * verify here. Deletion is the inverse operation (DELETE .../[perspectiveId]).
 */
test.describe('TC-PERSP-ATOMIC-VERIFY: perspectives save fidelity', () => {
  test('saves a personal perspective with full settings and reads every field back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-verify-${stamp}`;
    const name = `QA Persp ${stamp}`;
    const settings = {
      pageSize: 25,
      columnOrder: ['col-a', 'col-b'],
      columnVisibility: { 'col-a': true, 'col-b': false },
      sorting: [{ id: 'col-a', desc: true }],
      // Filters MUST use the versioned (v2) tree shape. The read path runs
      // `maybeMigrateLegacyFilterValues`, which intentionally drops legacy flat
      // key/value filter records (anything without `v:2` or a `root` node) — so a
      // `{ status: 'active' }` fixture would be migrated away on read by design.
      // Using the v2 shape proves filters genuinely round-trip through the atomic save.
      filters: { v: 2, root: { combinator: 'and', rules: [] } },
      searchValue: `needle-${stamp}`,
    };

    let createdId: string | null = null;

    try {
      // --- Save (create) the personal perspective ---
      const saveRes = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings, isDefault: true },
      });
      expect(saveRes.status(), 'save perspective').toBe(200);
      const saveBody = (await saveRes.json()) as {
        perspective?: { id?: string; name?: string; isDefault?: boolean; settings?: Record<string, unknown> };
        rolePerspectives?: unknown[];
        clearedRoleIds?: unknown[];
      };
      expect(typeof saveBody.perspective?.id).toBe('string');
      createdId = saveBody.perspective!.id as string;

      // Response fidelity (set -> response).
      expect(saveBody.perspective!.name).toBe(name);
      expect(saveBody.perspective!.isDefault).toBe(true);
      expect(saveBody.perspective!.settings).toMatchObject(settings);
      // Personal-only save: no role side effects.
      expect(saveBody.rolePerspectives).toEqual([]);
      expect(saveBody.clearedRoleIds).toEqual([]);

      // --- Read it back via GET and assert persistence of every field ---
      const stateRes = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
      });
      expect(stateRes.ok(), 'load perspectives state').toBeTruthy();
      const state = (await stateRes.json()) as {
        perspectives?: Array<{ id?: string; name?: string; isDefault?: boolean; settings?: Record<string, unknown> }>;
        defaultPerspectiveId?: string | null;
      };
      const persisted = (state.perspectives ?? []).filter((item) => item.id === createdId);
      expect(persisted, 'exactly one personal perspective persisted').toHaveLength(1);
      expect(persisted[0].name).toBe(name);
      expect(persisted[0].isDefault).toBe(true);
      expect(persisted[0].settings).toMatchObject(settings);
      expect(state.defaultPerspectiveId).toBe(createdId);
    } finally {
      if (createdId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/perspectives/${encodeURIComponent(tableId)}/${createdId}`,
          { token },
        ).catch(() => {});
      }
    }
  });
});
