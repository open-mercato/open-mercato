import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

type ManageOrg = {
  id: string;
  name: string;
  parentId: string | null;
  logoUrl?: string | null;
  ancestorIds?: string[];
  childIds?: string[];
  descendantIds?: string[];
};

type Tree = { rootId: string; middleId: string; leafId: string };

async function createOrg(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/organizations', { token, data });
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  return expectId(body?.id, 'Organization creation response should include id');
}

async function loadManageOrg(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  orgId: string,
): Promise<ManageOrg> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(orgId)}`,
    { token },
  );
  expect(response.status(), 'GET manage view should return 200').toBe(200);
  const body = await readJsonSafe<{ items?: ManageOrg[] }>(response);
  const org = body?.items?.find((item) => item.id === orgId);
  expect(org, `organization ${orgId} should be listed`).toBeTruthy();
  return org as ManageOrg;
}

async function expectIntactTree(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  tree: Tree,
): Promise<void> {
  const root = await loadManageOrg(request, token, tenantId, tree.rootId);
  const middle = await loadManageOrg(request, token, tenantId, tree.middleId);
  const leaf = await loadManageOrg(request, token, tenantId, tree.leafId);
  expect(middle.parentId, 'middle organization keeps its parent').toBe(tree.rootId);
  expect(leaf.parentId, 'leaf organization keeps its parent').toBe(tree.middleId);
  expect(root.childIds ?? [], 'root still lists the middle organization as a child').toContain(tree.middleId);
  expect(root.descendantIds ?? [], 'root still reaches the leaf organization').toContain(tree.leafId);
  expect(middle.childIds ?? [], 'middle still lists the leaf organization as a child').toContain(tree.leafId);
  expect(leaf.ancestorIds ?? [], 'leaf still has both ancestors').toEqual(
    expect.arrayContaining([tree.rootId, tree.middleId]),
  );
}

/**
 * TC-DIR-018: Partial organization updates keep the hierarchy
 * Covers:
 * - PUT /api/directory/organization-branding on an organization that has a parent and a child
 * - PUT /api/directory/organizations without parentId / childIds
 * - PUT /api/directory/organizations with only parentId (children stay) and explicit parentId: null
 */
test.describe('TC-DIR-018: Partial organization updates keep the hierarchy', () => {
  test('branding and partial updates leave parent and children in place', async ({ request }) => {
    let token: string | null = null;
    let rootId: string | null = null;
    let middleId: string | null = null;
    let leafId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);

      rootId = await createOrg(request, token, { name: `QA TC-DIR-018 root ${stamp}`, tenantId });
      middleId = await createOrg(request, token, {
        name: `QA TC-DIR-018 middle ${stamp}`,
        tenantId,
        parentId: rootId,
      });
      leafId = await createOrg(request, token, {
        name: `QA TC-DIR-018 leaf ${stamp}`,
        tenantId,
        parentId: middleId,
      });
      const tree: Tree = { rootId, middleId, leafId };
      await expectIntactTree(request, token, tenantId, tree);

      const logoUrl = `https://example.com/open-mercato/qa-tc-dir-018-${stamp}.svg`;
      const brandingResponse = await apiRequestWithSelectedOrg(
        request,
        'PUT',
        '/api/directory/organization-branding',
        { token, selectedOrgId: middleId, data: { logoUrl } },
      );
      expect(brandingResponse.status(), 'PUT /api/directory/organization-branding should return 200').toBe(200);
      const brandingBody = await readJsonSafe<{ organizationId?: string; logoUrl?: string | null }>(brandingResponse);
      expect(brandingBody?.organizationId).toBe(middleId);
      expect(brandingBody?.logoUrl).toBe(logoUrl);
      await expectIntactTree(request, token, tenantId, tree);

      const renamed = `QA TC-DIR-018 middle renamed ${stamp}`;
      const renameResponse = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: middleId, tenantId, name: renamed },
      });
      expect(renameResponse.status(), 'partial PUT /api/directory/organizations should return 200').toBe(200);
      expect((await loadManageOrg(request, token, tenantId, middleId)).name).toBe(renamed);
      await expectIntactTree(request, token, tenantId, tree);

      const detachResponse = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: middleId, tenantId, parentId: null },
      });
      expect(detachResponse.status(), 'explicit parentId: null should return 200').toBe(200);
      const detachedMiddle = await loadManageOrg(request, token, tenantId, middleId);
      expect(detachedMiddle.parentId, 'explicit null detaches the organization').toBeNull();
      expect(detachedMiddle.childIds ?? [], 'children stay when childIds is omitted').toContain(leafId);
      const rootAfterDetach = await loadManageOrg(request, token, tenantId, rootId);
      expect(rootAfterDetach.childIds ?? []).not.toContain(middleId);
      expect((await loadManageOrg(request, token, tenantId, leafId)).parentId).toBe(middleId);

      const reattachResponse = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: middleId, tenantId, parentId: rootId },
      });
      expect(reattachResponse.status(), 'parentId-only PUT should return 200').toBe(200);
      await expectIntactTree(request, token, tenantId, tree);

      const clearChildrenResponse = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: middleId, tenantId, childIds: [] },
      });
      expect(clearChildrenResponse.status(), 'explicit childIds: [] should return 200').toBe(200);
      const middleWithoutChildren = await loadManageOrg(request, token, tenantId, middleId);
      expect(middleWithoutChildren.parentId, 'parent stays when parentId is omitted').toBe(rootId);
      expect(middleWithoutChildren.childIds ?? [], 'explicit empty list removes the children').toEqual([]);
      expect((await loadManageOrg(request, token, tenantId, leafId)).parentId).toBeNull();
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', leafId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', middleId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', rootId);
    }
  });
});
