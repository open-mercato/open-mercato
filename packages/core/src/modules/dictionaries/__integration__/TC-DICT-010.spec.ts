import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  getTokenScope,
  readJsonSafe,
  deleteEntityByPathIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';

/**
 * TC-DICT-010: Authorization — missing `dictionaries.view` blocks GET access
 *
 * The dictionaries GET routes declare `requireFeatures: ['dictionaries.view']`
 * in their metadata. The framework guard
 * (apps/mercato/src/app/api/[...slug]/route.ts) returns:
 *   - 401 `{ error: 'Unauthorized' }` for an unauthenticated request, and
 *   - 403 `{ error: 'Forbidden', requiredFeatures: [...] }` for an authenticated
 *     user who lacks the required feature.
 *
 * This test mints a dedicated role with NO dictionaries features (self-contained,
 * does not rely on seeded role grants) and asserts both boundaries. The admin
 * token, which holds `dictionaries.view`, continues to receive 200.
 */
test.describe('TC-DICT-010: Missing dictionaries.view blocks GET access', () => {
  test('GET dictionaries routes return 403 without dictionaries.view (401 unauthenticated); admin still gets 200', async ({ request }) => {
    const stamp = Date.now();
    let adminToken: string | null = null;
    let restrictedToken: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let dictionaryId: string | null = null;

    try {
      // Unauthenticated first — before any login persists a session cookie on the
      // shared request context (a cookie would make this a 403, not the 401 we assert).
      const unauthList = await request.get('/api/dictionaries');
      expect(unauthList.status(), 'Unauthenticated GET /api/dictionaries should return 401').toBe(401);

      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);

      // Role with no dictionaries features -> user that cannot view dictionaries.
      const roleName = `qa_dict_noview_${stamp}`;
      roleId = await createRoleFixture(request, adminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      });
      await setRoleAclFeatures(request, adminToken, { roleId, features: [] });

      const email = `qa-dict-noview-${stamp}@acme.com`;
      const password = 'Dict-View-1!';
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Dict No-View User',
      });
      restrictedToken = await getAuthToken(request, email, password);

      // Fixture dictionary created by admin so the per-id routes have a target.
      const createResponse = await apiRequest(request, 'POST', '/api/dictionaries', {
        token: adminToken,
        data: { key: `qa_dict_noview_${stamp}`, name: 'QA TC-DICT-010 Dictionary' },
      });
      expect(createResponse.status(), 'admin POST /api/dictionaries should return 201').toBe(201);
      const createBody = await readJsonSafe<{ id?: string }>(createResponse);
      dictionaryId = createBody?.id ?? null;
      expect(dictionaryId, 'Created dictionary should have an id').toBeTruthy();

      // -- Authenticated but missing dictionaries.view -> 403 ------------------
      const listResponse = await apiRequest(request, 'GET', '/api/dictionaries', { token: restrictedToken });
      expect(
        listResponse.status(),
        'GET /api/dictionaries without dictionaries.view should return 403',
      ).toBe(403);

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        { token: restrictedToken },
      );
      expect(
        detailResponse.status(),
        'GET /api/dictionaries/[id] without dictionaries.view should return 403',
      ).toBe(403);

      const entriesResponse = await apiRequest(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}/entries`,
        { token: restrictedToken },
      );
      expect(
        entriesResponse.status(),
        'GET /api/dictionaries/[id]/entries without dictionaries.view should return 403',
      ).toBe(403);

      // -- Admin (has dictionaries.view) still works ---------------------------
      const adminList = await apiRequest(request, 'GET', '/api/dictionaries', { token: adminToken });
      expect(adminList.status(), 'admin GET /api/dictionaries should return 200').toBe(200);
      const adminListBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(adminList);
      expect(Array.isArray(adminListBody?.items), 'admin list payload should contain items array').toBe(true);
    } finally {
      await deleteEntityByPathIfExists(
        request,
        adminToken,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      );
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
