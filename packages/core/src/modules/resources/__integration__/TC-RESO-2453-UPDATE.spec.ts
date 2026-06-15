import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

export const integrationMeta = {
  dependsOnModules: ['resources'],
}

/**
 * TC-RESO-2453-UPDATE (#2453-class regression): a resource update that changes
 * scalar columns (name + isActive) AND changes its tag set must actually
 * PERSIST the scalar changes.
 *
 * Root cause guarded against: `updateResourceCommand` mutates the resource row,
 * then calls `syncResourcesResourceTags`, which runs `em.find(...)` on the SAME
 * EntityManager before the explicit `em.flush()`. Pre-fix, that interleaved read
 * reset MikroORM's unit-of-work change tracking, so the route returned 200 and
 * bumped `updated_at`, but the scalar `name` / `is_active` columns silently
 * reverted to their prior values. The fix wraps the scalar mutation + tag sync
 * in `withAtomicFlush(em, [...], { transaction: true })`.
 *
 * The tag change in the PUT payload is the load-bearing trigger: without it
 * `syncResourcesResourceTags` short-circuits (no interleaved `em.find`) and the
 * bug does not reproduce. This test therefore creates a tag, attaches it on
 * update, and asserts name + isActive round-trip on a fresh GET — not just that
 * the request returned 200.
 *
 * Scope (tenantId/organizationId) is injected from the auth token by the CRUD
 * route, so payloads omit it. The resource list response exposes the scalar
 * columns under their snake_case names (`name`, `is_active`).
 */
test.describe('TC-RESO-2453-UPDATE: tag-change update persists scalar columns', () => {
  const createTag = async (
    request: import('@playwright/test').APIRequestContext,
    token: string,
    label: string,
  ): Promise<string> => {
    const res = await apiRequest(request, 'POST', '/api/resources/tags', {
      token,
      data: { label },
    });
    expect(res.status(), `tag create (${label})`).toBe(201);
    const body = (await res.json()) as { id?: string };
    expect(typeof body.id, 'tag create should return an id').toBe('string');
    return body.id as string;
  };

  const readResource = async (
    request: import('@playwright/test').APIRequestContext,
    token: string,
    resourceId: string,
  ): Promise<Record<string, unknown> | null> => {
    const res = await apiRequest(
      request,
      'GET',
      `/api/resources/resources?ids=${encodeURIComponent(resourceId)}`,
      { token },
    );
    expect(res.ok(), 'resource list request should succeed').toBeTruthy();
    const body = (await res.json()) as { items?: Array<Record<string, unknown>> };
    return (body.items ?? []).find((item) => item.id === resourceId) ?? null;
  };

  const tagIdsOf = (resource: Record<string, unknown>): string[] => {
    const tags = Array.isArray(resource.tags) ? (resource.tags as Array<{ id?: string }>) : [];
    return tags
      .map((tag) => (typeof tag?.id === 'string' ? tag.id : null))
      .filter((id): id is string => typeof id === 'string')
      .sort((a, b) => a.localeCompare(b));
  };

  test('update changing name + isActive AND tags persists the scalar columns (not just 200)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();

    let resourceId: string | null = null;
    let tagId: string | null = null;

    try {
      tagId = await createTag(request, token, `QA 2453 Tag ${stamp}`);

      // --- Create with distinct initial scalar values and no tags ---
      const initialName = `QA 2453 Resource ${stamp}`;
      const createRes = await apiRequest(request, 'POST', '/api/resources/resources', {
        token,
        data: { name: initialName, isActive: true },
      });
      expect(createRes.status(), 'create resource').toBe(201);
      const createBody = (await createRes.json()) as { id?: string };
      expect(typeof createBody.id, 'create should return an id').toBe('string');
      resourceId = createBody.id as string;

      const afterCreate = await readResource(request, token, resourceId);
      expect(afterCreate, 'created resource must be readable').not.toBeNull();
      expect(afterCreate!.name).toBe(initialName);
      expect(afterCreate!.is_active).toBe(true);
      expect(tagIdsOf(afterCreate!), 'resource starts with no tags').toEqual([]);

      // Capture the optimistic-lock token (updated_at). The resources CRUD route
      // accepts a header-less PUT additively, so the lock header is not required
      // to drive the update; we read it to mirror the locking-aware flow.
      const lockToken = afterCreate!.updated_at;
      expect(typeof lockToken === 'string' || lockToken === undefined).toBeTruthy();

      // --- The #2453 trigger: change name + isActive AND add a tag in one PUT.
      // The tag change forces syncResourcesResourceTags' interleaved em.find,
      // which pre-fix would revert the scalar name/is_active changes. ---
      const updatedName = `QA 2453 Resource UPDATED ${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/resources/resources', {
        token,
        data: {
          id: resourceId,
          name: updatedName,
          isActive: false,
          tags: [tagId],
        },
      });
      expect(updateRes.status(), 'update resource').toBe(200);

      // --- Fresh GET: EACH changed scalar column must round-trip to its new
      // value. This is the assertion that fails pre-fix (columns reverted). ---
      const afterUpdate = await readResource(request, token, resourceId);
      expect(afterUpdate, 'updated resource must be readable').not.toBeNull();
      expect(afterUpdate!.name, 'name must persist after tag-change update').toBe(updatedName);
      expect(afterUpdate!.is_active, 'isActive must persist after tag-change update').toBe(false);
      // Sanity: the tag change (the bug trigger) actually took effect.
      expect(tagIdsOf(afterUpdate!), 'tag set after update is exactly [tag]').toEqual([tagId]);
    } finally {
      if (resourceId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/resources/resources?id=${encodeURIComponent(resourceId)}`,
          { token },
        ).catch(() => {});
      }
      if (tagId) {
        await apiRequest(request, 'DELETE', `/api/resources/tags?id=${encodeURIComponent(tagId)}`, {
          token,
        }).catch(() => {});
      }
    }
  });
});
