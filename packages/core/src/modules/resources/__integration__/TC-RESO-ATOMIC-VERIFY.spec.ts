import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

export const integrationMeta = {
  dependsOnModules: ['resources'],
}

/**
 * TC-RESO-ATOMIC-VERIFY (PR #2356 / umbrella #2333): backward-compatibility +
 * data-safety verification for the atomic-write refactor of resources.
 *
 * The create/update commands persist the scalar resource row and sync its
 * tag-assignment set inside a single transaction (withAtomicFlush({ transaction:
 * true })), and both record an undo payload that captures the full tag set. This
 * suite verifies, end to end over HTTP:
 *   1. Field fidelity (set -> read) including the tag-assignment set on create.
 *   2. Atomic tag-set replacement on update (no orphan / duplicate assignments).
 *   3. Undo of create removes the resource AND its tag assignments.
 *   4. Undo of update restores the prior scalar fields AND the prior tag set.
 *
 * Scope (tenantId/organizationId) is injected from the auth token by the CRUD
 * route, so payloads omit it. Tags are exposed on the resource list response via
 * the afterList hook as { id, label, color }.
 */
test.describe('TC-RESO-ATOMIC-VERIFY: resources atomic write fidelity + undo', () => {
  const undoPath = '/api/audit_logs/audit-logs/actions/undo';

  const parseUndoToken = (res: import('@playwright/test').APIResponse): string => {
    const header = (res.headers()['x-om-operation'] ?? '');
    const payload = JSON.parse(decodeURIComponent(header.slice(5))) as { undoToken?: string };
    expect(typeof payload.undoToken, 'create/update must issue an undo token').toBe('string');
    return payload.undoToken as string;
  };

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
    expect(typeof body.id).toBe('string');
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

  test('round-trips fields + tag set, atomically replaces tags on update, and undoes both create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();

    let resourceId: string | null = null;
    let tagAId: string | null = null;
    let tagBId: string | null = null;

    try {
      tagAId = await createTag(request, token, `QA Tag A ${stamp}`);
      tagBId = await createTag(request, token, `QA Tag B ${stamp}`);
      const initialTagSet = [tagAId, tagBId].sort((a, b) => a.localeCompare(b));

      // --- 1. Create with full validator fields + tags [A, B] ---
      const name = `QA Resource ${stamp}`;
      const description = `desc ${stamp}`;
      const createRes = await apiRequest(request, 'POST', '/api/resources/resources', {
        token,
        data: {
          name,
          description,
          capacity: 5,
          isActive: false,
          appearanceIcon: 'star',
          appearanceColor: '#112233',
          tags: [tagAId, tagBId],
        },
      });
      expect(createRes.status(), 'create resource').toBe(201);
      const createBody = (await createRes.json()) as { id?: string };
      expect(typeof createBody.id).toBe('string');
      resourceId = createBody.id as string;
      const createUndoToken = parseUndoToken(createRes);

      // --- Field fidelity (set -> read) including tag-assignment set ---
      const afterCreate = await readResource(request, token, resourceId);
      expect(afterCreate, 'created resource must be readable').not.toBeNull();
      expect(afterCreate!.name).toBe(name);
      expect(afterCreate!.description).toBe(description);
      expect(afterCreate!.capacity).toBe(5);
      expect(afterCreate!.is_active).toBe(false);
      expect(afterCreate!.appearance_icon).toBe('star');
      expect(afterCreate!.appearance_color).toBe('#112233');
      expect(tagIdsOf(afterCreate!), 'tag-assignment set on create').toEqual(initialTagSet);

      // --- 2. Update: change scalar fields + replace tag set with [B] only ---
      const updatedName = `QA Resource UPDATED ${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/resources/resources', {
        token,
        data: {
          id: resourceId,
          name: updatedName,
          capacity: 9,
          isActive: true,
          tags: [tagBId],
        },
      });
      expect(updateRes.status(), 'update resource').toBe(200);
      const updateUndoToken = parseUndoToken(updateRes);

      const afterUpdate = await readResource(request, token, resourceId);
      expect(afterUpdate, 'updated resource must be readable').not.toBeNull();
      expect(afterUpdate!.name).toBe(updatedName);
      expect(afterUpdate!.capacity).toBe(9);
      expect(afterUpdate!.is_active).toBe(true);
      // Atomic tag-set replacement: exactly [B], no orphan/duplicate assignments.
      expect(tagIdsOf(afterUpdate!), 'tag set after update is exactly [B]').toEqual([tagBId]);

      // --- 4. Undo the update: restore prior scalar fields AND prior tag set ---
      const undoUpdateRes = await apiRequest(request, 'POST', undoPath, {
        token,
        data: { undoToken: updateUndoToken },
      });
      expect(undoUpdateRes.status(), 'undo update status').toBe(200);
      const undoUpdateBody = (await undoUpdateRes.json()) as { ok?: boolean };
      expect(undoUpdateBody.ok).toBe(true);

      const afterUndoUpdate = await readResource(request, token, resourceId);
      expect(afterUndoUpdate, 'resource must exist after undo of update').not.toBeNull();
      expect(afterUndoUpdate!.name).toBe(name);
      expect(afterUndoUpdate!.capacity).toBe(5);
      expect(afterUndoUpdate!.is_active).toBe(false);
      expect(tagIdsOf(afterUndoUpdate!), 'undo of update restores prior tag set [A, B]').toEqual(initialTagSet);

      // --- 3. Undo the create: resource gone AND tag assignments gone ---
      const undoCreateRes = await apiRequest(request, 'POST', undoPath, {
        token,
        data: { undoToken: createUndoToken },
      });
      expect(undoCreateRes.status(), 'undo create status').toBe(200);
      const undoCreateBody = (await undoCreateRes.json()) as { ok?: boolean };
      expect(undoCreateBody.ok).toBe(true);

      const afterUndoCreate = await readResource(request, token, resourceId);
      expect(afterUndoCreate, 'resource must be gone after undo of create').toBeNull();

      // Tag assignments gone: filtering resources by tag A returns nothing.
      const byTagRes = await apiRequest(
        request,
        'GET',
        `/api/resources/resources?tagIds=${encodeURIComponent(tagAId)}`,
        { token },
      );
      expect(byTagRes.ok()).toBeTruthy();
      const byTagBody = (await byTagRes.json()) as { items?: Array<{ id?: string }> };
      const stillAssigned = (byTagBody.items ?? []).some((item) => item.id === resourceId);
      expect(stillAssigned, 'no tag assignment should survive undo of create').toBe(false);

      resourceId = null; // soft-deleted via undo; nothing left to clean up.
    } finally {
      if (resourceId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/resources/resources?id=${encodeURIComponent(resourceId)}`,
          { token },
        ).catch(() => {});
      }
      if (tagAId) {
        await apiRequest(request, 'DELETE', `/api/resources/tags?id=${encodeURIComponent(tagAId)}`, {
          token,
        }).catch(() => {});
      }
      if (tagBId) {
        await apiRequest(request, 'DELETE', `/api/resources/tags?id=${encodeURIComponent(tagBId)}`, {
          token,
        }).catch(() => {});
      }
    }
  });
});
