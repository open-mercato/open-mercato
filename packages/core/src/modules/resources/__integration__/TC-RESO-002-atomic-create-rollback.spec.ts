import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

export const integrationMeta = {
  dependsOnModules: ['resources'],
}

/**
 * TC-RESO-002 (issues #2341 / #2333): resource create must be atomic with its
 * tag-assignment sync.
 *
 * The create command persists the scalar record and syncs tag assignments
 * inside a single transaction (withAtomicFlush({ transaction: true })). When a
 * tag id is not in scope the sync phase throws, so the whole create must roll
 * back and leave no orphan resource row.
 *
 * Regression guard: before the fix the scalar record was flushed (committed)
 * before the tag sync ran, so a failing tag sync left an orphan resource — this
 * test would find that orphan and fail. After the fix the rollback removes it.
 */
test.describe('TC-RESO-002: Resources create is atomic with tag sync', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('rejects create with an unknown tag and leaves no orphan resource', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const resourceName = `QA Atomic Resource ${stamp}`;
    // A syntactically valid UUID that does not match any tag in this scope.
    const unknownTagId = '00000000-0000-4000-8000-000000000000';

    let leakedResourceId: string | null = null;
    try {
      const createResponse = await apiRequest(request, 'POST', '/api/resources/resources', {
        token,
        data: { name: resourceName, isActive: true, tags: [unknownTagId] },
      });

      // The tag-sync phase throws (tag not found for this scope) -> client error.
      expect(createResponse.ok(), 'Create with an unknown tag must fail').toBeFalsy();
      expect(createResponse.status(), 'Expected a 4xx client error').toBeGreaterThanOrEqual(400);
      expect(createResponse.status(), 'Expected a 4xx client error').toBeLessThan(500);

      // Atomicity assertion: the resource row must have been rolled back, so a
      // search by its unique name returns nothing.
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/resources/resources?search=${encodeURIComponent(resourceName)}&pageSize=100`,
        { token },
      );
      expect(listResponse.ok(), 'Resource list request should succeed').toBeTruthy();
      const listBody = (await listResponse.json()) as { items?: Array<{ id?: string; name?: string }> };
      const orphan = (listBody.items ?? []).find((item) => item.name === resourceName);
      leakedResourceId = typeof orphan?.id === 'string' ? orphan.id : null;
      expect(orphan, 'No orphan resource should remain after the failed create').toBeUndefined();
    } finally {
      // Defensive cleanup: only fires if the atomicity guarantee regressed.
      if (leakedResourceId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/resources/resources?id=${encodeURIComponent(leakedResourceId)}`,
          { token },
        ).catch(() => {});
      }
    }
  });
});
