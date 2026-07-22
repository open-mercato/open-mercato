import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-PERSP-ATOMIC-001: Perspective save is all-or-nothing across roles.
 * Source: #2340 (SQL transaction-safety audit, umbrella #2333).
 *
 * The POST /api/perspectives/[tableId] handler validates role operations first
 * and then commits the personal perspective + role perspectives in a single
 * transaction (withAtomicFlush). When a referenced role does not exist the whole
 * request must be rejected with no partial personal perspective committed.
 *
 * Before the fix, saveUserPerspective() committed before role validation, so the
 * personal perspective survived a rejected request — exactly the partial commit
 * this test guards against.
 */
test.describe('TC-PERSP-ATOMIC-001: perspectives multi-table write atomicity', () => {
  const nonexistentRoleId = '00000000-0000-4000-8000-000000000000';

  test('does not persist the personal perspective when a referenced role is invalid', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const tableId = `qa-persp-atomic-${Date.now()}`;
    const name = `QA Atomic Rejected ${Date.now()}`;

    const rejected = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
      token: adminToken,
      data: {
        name,
        settings: { pageSize: 25 },
        applyToRoles: [nonexistentRoleId],
      },
    });
    expect(rejected.status()).toBe(400);
    const rejectedBody = (await rejected.json()) as { error?: unknown; missing?: unknown };
    expect(rejectedBody.error).toBe('Invalid roles');
    expect(Array.isArray(rejectedBody.missing)).toBe(true);

    const stateResponse = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, {
      token: adminToken,
    });
    expect(stateResponse.ok()).toBeTruthy();
    const state = (await stateResponse.json()) as { perspectives?: Array<{ name?: unknown }> };
    const matching = (state.perspectives ?? []).filter((item) => item.name === name);
    expect(matching).toHaveLength(0);
  });

  test('persists the personal perspective when no role operations are requested', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const tableId = `qa-persp-atomic-ok-${Date.now()}`;
    const name = `QA Atomic OK ${Date.now()}`;
    let createdId: string | null = null;

    try {
      const saved = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: adminToken,
        data: {
          name,
          settings: { pageSize: 25 },
        },
      });
      expect(saved.ok()).toBeTruthy();
      const savedBody = (await saved.json()) as { perspective?: { id?: unknown } };
      expect(typeof savedBody.perspective?.id).toBe('string');
      createdId = savedBody.perspective!.id as string;

      const stateResponse = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: adminToken,
      });
      expect(stateResponse.ok()).toBeTruthy();
      const state = (await stateResponse.json()) as { perspectives?: Array<{ id?: unknown; name?: unknown }> };
      const matching = (state.perspectives ?? []).filter((item) => item.name === name);
      expect(matching).toHaveLength(1);
    } finally {
      if (createdId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${createdId}`, {
          token: adminToken,
        });
      }
    }
  });
});
