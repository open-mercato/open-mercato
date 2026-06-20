import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-005: Organization hierarchy stays consistent across atomic writes (issue #2339)
 *
 * directory.organizations create/update/delete wrap the org write + child reparent
 * loop + hierarchy rebuild in a single transaction. These specs assert the committed
 * state is fully consistent on a real database — no half-applied reparent and no
 * stale ancestor/child arrays — for the create-with-children and delete-reparent paths.
 */
type ManageOrg = {
  id: string;
  name: string;
  parentId: string | null;
  ancestorIds?: string[];
  childIds?: string[];
};

async function deleteOrgIfExists(
  request: APIRequestContext,
  token: string | null,
  orgId: string | null,
): Promise<void> {
  if (!token || !orgId) return;
  await apiRequest(request, 'DELETE', `/api/directory/organizations?id=${encodeURIComponent(orgId)}`, { token }).catch(
    () => undefined,
  );
}

async function loadManageOrg(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  orgId: string,
): Promise<ManageOrg | undefined> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&pageSize=100`,
    { token },
  );
  expect(response.status(), 'GET manage view should return 200').toBe(200);
  const body = await readJsonSafe<{ items?: ManageOrg[] }>(response);
  return body?.items?.find((item) => item.id === orgId);
}

test.describe('TC-DIR-005: Organization hierarchy atomic writes (#2339)', () => {
  test('delete reparents children and leaves a consistent hierarchy', async ({ request }) => {
    let token: string | null = null;
    let parentId: string | null = null;
    let childId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);

      const parentRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token,
        data: { name: `QA TC-DIR-005 parent ${stamp}`, tenantId },
      });
      expect(parentRes.status(), 'create parent should return 201').toBe(201);
      parentId = (await readJsonSafe<{ id?: string }>(parentRes))?.id ?? null;
      expect(parentId, 'parent id').toBeTruthy();

      const childRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token,
        data: { name: `QA TC-DIR-005 child ${stamp}`, tenantId, parentId },
      });
      expect(childRes.status(), 'create child should return 201').toBe(201);
      childId = (await readJsonSafe<{ id?: string }>(childRes))?.id ?? null;
      expect(childId, 'child id').toBeTruthy();

      // After create-with-parent: hierarchy must reflect the parent link.
      const childBefore = await loadManageOrg(request, token, tenantId, childId!);
      expect(childBefore?.parentId, 'child.parentId should be the parent').toBe(parentId);
      expect(childBefore?.ancestorIds ?? [], 'child.ancestorIds should include the parent').toContain(parentId);
      const parentBefore = await loadManageOrg(request, token, tenantId, parentId!);
      expect(parentBefore?.childIds ?? [], 'parent.childIds should include the child').toContain(childId);

      // Atomic delete: soft-delete parent + reparent child + rebuild hierarchy, all-or-nothing.
      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/directory/organizations?id=${encodeURIComponent(parentId!)}`,
        { token },
      );
      expect(deleteRes.status(), 'delete parent should return 200').toBe(200);
      const deletedParentId = parentId;
      parentId = null;

      // Child must be reparented to the deleted parent's parent (null) with a fully
      // rebuilt hierarchy — proving the reparent + rebuild committed together.
      const childAfter = await loadManageOrg(request, token, tenantId, childId!);
      expect(childAfter, 'child should still exist after parent delete').toBeTruthy();
      expect(childAfter?.parentId, 'child.parentId should be cleared to null').toBeNull();
      expect(childAfter?.ancestorIds ?? [], 'child.ancestorIds should no longer reference the deleted parent').not.toContain(
        deletedParentId,
      );

      // Parent is soft-deleted and no longer listed in the manage view.
      const parentAfter = await loadManageOrg(request, token, tenantId, deletedParentId!);
      expect(parentAfter, 'deleted parent should not appear in manage view').toBeUndefined();
    } finally {
      await deleteOrgIfExists(request, token, childId);
      await deleteOrgIfExists(request, token, parentId);
    }
  });
});
