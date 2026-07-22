import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createResourceFixture, deleteResourceIfExists } from './helpers/resourcesFixtures';

export const integrationMeta = {
  dependsOnModules: ['resources'],
};

/**
 * TC-RESO-006 (issue #2461): Resource Activities CRUD (timeline events).
 *
 * Activities are time-scoped timeline entries created over
 * `/api/resources/activities` (makeActivityRoute) with `entityId` = the parent
 * resource id. The list transforms rows to camelCase (`entityId`, `activityType`,
 * `occurredAt`, ...) and enriches the author from the User entity. This spec
 * verifies create (author defaults to the caller; `occurredAt` round-trips as the
 * provided ISO timestamp), update of the subject, and removal on delete. Reads
 * are query-index backed and poll briefly.
 */
type ActivityListBody = { items?: Array<Record<string, unknown>> };

async function listActivities(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/resources/activities?entityId=${encodeURIComponent(resourceId)}&pageSize=100`,
    { token },
  );
  expect(res.ok(), `activities list should succeed (status ${res.status()})`).toBeTruthy();
  const body = await readJsonSafe<ActivityListBody>(res);
  return body?.items ?? [];
}

test.describe('TC-RESO-006: Resource Activities CRUD (timeline events)', () => {
  test('creates an activity with author + occurredAt, updates the subject, and deletes', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const { userId } = getTokenScope(token);
    const stamp = Date.now();
    const occurredAt = '2026-01-15T10:00:00.000Z';

    let resourceId: string | null = null;
    let activityId: string | null = null;
    try {
      resourceId = await createResourceFixture(request, token, `QA Activity Resource ${stamp}`);

      const subject = `Filter replacement ${stamp}`;
      const createRes = await apiRequest(request, 'POST', '/api/resources/activities', {
        token,
        data: {
          entityId: resourceId,
          activityType: 'maintenance',
          subject,
          body: 'Completed filter maintenance',
          occurredAt,
        },
      });
      expect(createRes.status(), 'create activity should return 201').toBe(201);
      const createBody = await readJsonSafe<{ id?: string; authorUserId?: string }>(createRes);
      activityId = createBody?.id ?? null;
      expect(activityId, 'activity id returned').toBeTruthy();
      expect(createBody?.authorUserId, 'activity author defaults to the caller').toBe(userId);

      await expect
        .poll(async () => (await listActivities(request, token, resourceId!)).some((activity) => activity.id === activityId), {
          timeout: 8000,
          message: 'activity should appear in the timeline',
        })
        .toBe(true);
      const item = (await listActivities(request, token, resourceId)).find((activity) => activity.id === activityId)!;
      expect(item.entityId).toBe(resourceId);
      expect(item.activityType).toBe('maintenance');
      expect(item.subject).toBe(subject);
      expect(item.body).toBe('Completed filter maintenance');
      expect(item.occurredAt).toBe(occurredAt);
      expect(item.authorUserId).toBe(userId);

      // Update the subject.
      const updatedSubject = `Filter replacement (completed) ${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/resources/activities', {
        token,
        data: { id: activityId, subject: updatedSubject },
      });
      expect(updateRes.status(), 'update activity should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(updateRes))?.ok, 'update reports ok').toBe(true);

      await expect
        .poll(
          async () =>
            (await listActivities(request, token, resourceId!)).find((activity) => activity.id === activityId)?.subject ?? null,
          { timeout: 8000, message: 'updated subject should be readable' },
        )
        .toBe(updatedSubject);
      const afterUpdate = (await listActivities(request, token, resourceId)).find((activity) => activity.id === activityId)!;
      expect(afterUpdate.occurredAt, 'occurredAt unchanged by subject update').toBe(occurredAt);

      // Delete -> gone from the timeline.
      const delRes = await apiRequest(request, 'DELETE', `/api/resources/activities?id=${encodeURIComponent(activityId!)}`, {
        token,
      });
      expect(delRes.status(), 'delete activity should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(delRes))?.ok, 'delete reports ok').toBe(true);

      await expect
        .poll(async () => (await listActivities(request, token, resourceId!)).some((activity) => activity.id === activityId), {
          timeout: 8000,
          message: 'deleted activity should be gone',
        })
        .toBe(false);
      activityId = null;
    } finally {
      if (activityId) {
        await apiRequest(request, 'DELETE', `/api/resources/activities?id=${encodeURIComponent(activityId)}`, { token }).catch(
          () => {},
        );
      }
      await deleteResourceIfExists(request, token, resourceId);
    }
  });
});
