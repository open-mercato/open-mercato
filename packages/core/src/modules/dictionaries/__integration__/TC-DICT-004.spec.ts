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
 * TC-DICT-004: Authorization — missing `dictionaries.manage` blocks writes
 *
 * Every dictionaries write route declares `requireFeatures: ['dictionaries.manage']`.
 * A user who holds only `dictionaries.view` can read but must be blocked from
 * POST/PATCH/DELETE on both dictionaries and entries. The framework guard returns
 * 403 `{ error: 'Forbidden' }` for an authenticated user missing the feature.
 *
 * Mints a dedicated view-only role (self-contained) and asserts that:
 *   - all five write surfaces return 403 for the view-only token, while reads succeed;
 *   - the admin token (which holds `dictionaries.manage`) can perform the same mutations.
 */
test.describe('TC-DICT-004: Missing dictionaries.manage blocks POST/PATCH/DELETE', () => {
  test('write routes return 403 for a view-only token; admin (manage) succeeds', async ({ request }) => {
    const stamp = Date.now();
    let adminToken: string | null = null;
    let viewOnlyToken: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let dictionaryId: string | null = null;
    let entryId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);

      // Role granting view but NOT manage.
      const roleName = `qa_dict_viewonly_${stamp}`;
      roleId = await createRoleFixture(request, adminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      });
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['dictionaries.view'] });

      const email = `qa-dict-viewonly-${stamp}@acme.com`;
      const password = 'Dict-Manage-1!';
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Dict View-Only User',
      });
      viewOnlyToken = await getAuthToken(request, email, password);

      // -- POST dictionary is blocked for view-only --------------------------
      const blockedCreate = await apiRequest(request, 'POST', '/api/dictionaries', {
        token: viewOnlyToken,
        data: { key: `qa_dict_viewonly_blocked_${stamp}`, name: 'Should not be created' },
      });
      expect(blockedCreate.status(), 'view-only POST /api/dictionaries should return 403').toBe(403);

      // Admin (manage) creates the fixture dictionary + entry.
      const adminCreate = await apiRequest(request, 'POST', '/api/dictionaries', {
        token: adminToken,
        data: { key: `qa_dict_viewonly_${stamp}`, name: 'QA TC-DICT-004 Dictionary' },
      });
      expect(adminCreate.status(), 'admin POST /api/dictionaries should return 201').toBe(201);
      dictionaryId = (await readJsonSafe<{ id?: string }>(adminCreate))?.id ?? null;
      expect(dictionaryId, 'Created dictionary should have an id').toBeTruthy();

      const adminEntry = await apiRequest(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}/entries`,
        { token: adminToken, data: { value: 'qa_value', label: 'QA Value' } },
      );
      expect(adminEntry.status(), 'admin POST entry should return 201').toBe(201);
      entryId = (await readJsonSafe<{ id?: string }>(adminEntry))?.id ?? null;
      expect(entryId, 'Created entry should have an id').toBeTruthy();

      // -- View-only is blocked from every write surface (403) ----------------
      const blockedPatchDict = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        { token: viewOnlyToken, data: { name: 'Should not update' } },
      );
      expect(blockedPatchDict.status(), 'view-only PATCH /api/dictionaries/[id] should return 403').toBe(403);

      const blockedDeleteDict = await apiRequest(
        request,
        'DELETE',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        { token: viewOnlyToken },
      );
      expect(blockedDeleteDict.status(), 'view-only DELETE /api/dictionaries/[id] should return 403').toBe(403);

      const blockedCreateEntry = await apiRequest(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}/entries`,
        { token: viewOnlyToken, data: { value: 'blocked_value', label: 'Blocked' } },
      );
      expect(blockedCreateEntry.status(), 'view-only POST entries should return 403').toBe(403);

      const blockedPatchEntry = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}/entries/${encodeURIComponent(entryId!)}`,
        { token: viewOnlyToken, data: { label: 'Blocked update' } },
      );
      expect(blockedPatchEntry.status(), 'view-only PATCH entries/[entryId] should return 403').toBe(403);

      const blockedDeleteEntry = await apiRequest(
        request,
        'DELETE',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}/entries/${encodeURIComponent(entryId!)}`,
        { token: viewOnlyToken },
      );
      expect(blockedDeleteEntry.status(), 'view-only DELETE entries/[entryId] should return 403').toBe(403);

      // -- View-only CAN read (proves the block is specific to `manage`) ------
      const allowedList = await apiRequest(request, 'GET', '/api/dictionaries', { token: viewOnlyToken });
      expect(allowedList.status(), 'view-only GET /api/dictionaries should return 200').toBe(200);
      const allowedDetail = await apiRequest(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        { token: viewOnlyToken },
      );
      expect(allowedDetail.status(), 'view-only GET /api/dictionaries/[id] should return 200').toBe(200);

      // -- Admin (manage) can mutate ------------------------------------------
      const adminPatch = await apiRequest(
        request,
        'PATCH',
        `/api/dictionaries/${encodeURIComponent(dictionaryId!)}`,
        { token: adminToken, data: { name: 'QA TC-DICT-004 Updated' } },
      );
      expect(adminPatch.status(), 'admin PATCH /api/dictionaries/[id] should return 200').toBe(200);
      expect((await readJsonSafe<{ name?: string }>(adminPatch))?.name, 'admin update should persist').toBe(
        'QA TC-DICT-004 Updated',
      );
    } finally {
      await deleteEntityByPathIfExists(
        request,
        adminToken,
        dictionaryId && entryId
          ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId)}`
          : null,
      );
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
