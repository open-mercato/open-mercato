import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createResourceFixture, deleteResourceIfExists } from './helpers/resourcesFixtures';

export const integrationMeta = {
  dependsOnModules: ['resources'],
};

/**
 * TC-RESO-005 (issue #2461): Resource Comments CRUD + author enrichment.
 *
 * Comments are timeline notes on a resource, created over `/api/resources/comments`
 * with `entityId` = the resource id. This spec verifies that the author defaults
 * to the authenticated user when `authorUserId` is omitted (via
 * `normalizeAuthorUserId`), that the list `afterList` hook enriches each row with
 * `authorEmail` looked up from the User entity (the comment row stores only
 * `author_user_id`), update of the body, and removal from the timeline on delete.
 * The comment list is query-index backed, so reads poll briefly.
 */
type CommentListBody = { items?: Array<Record<string, unknown>> };

async function listComments(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/resources/comments?entityId=${encodeURIComponent(resourceId)}&pageSize=100`,
    { token },
  );
  expect(res.ok(), `comments list should succeed (status ${res.status()})`).toBeTruthy();
  const body = await readJsonSafe<CommentListBody>(res);
  return body?.items ?? [];
}

async function pollForComment(
  request: APIRequestContext,
  token: string,
  resourceId: string,
  commentId: string,
): Promise<Record<string, unknown>> {
  await expect
    .poll(async () => (await listComments(request, token, resourceId)).some((comment) => comment.id === commentId), {
      timeout: 8000,
      message: 'comment should appear in the timeline',
    })
    .toBe(true);
  const item = (await listComments(request, token, resourceId)).find((comment) => comment.id === commentId);
  expect(item, 'comment present after poll').toBeTruthy();
  return item as Record<string, unknown>;
}

test.describe('TC-RESO-005: Resource Comments CRUD + author enrichment', () => {
  test('creates a comment with auto author, enriches author email, updates the body, and deletes', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const { userId } = getTokenScope(token);
    const stamp = Date.now();

    let resourceId: string | null = null;
    let commentId: string | null = null;
    try {
      resourceId = await createResourceFixture(request, token, `QA Comment Resource ${stamp}`);

      const body = `QA comment ${stamp}`;
      const createRes = await apiRequest(request, 'POST', '/api/resources/comments', {
        token,
        data: { entityId: resourceId, body },
      });
      expect(createRes.status(), 'create comment should return 201').toBe(201);
      const createBody = await readJsonSafe<{ id?: string; authorUserId?: string }>(createRes);
      commentId = createBody?.id ?? null;
      expect(commentId, 'comment id returned').toBeTruthy();
      // Author defaults to the authenticated user when omitted.
      expect(createBody?.authorUserId, 'comment author defaults to the caller').toBe(userId);

      const item = await pollForComment(request, token, resourceId, commentId!);
      expect(item.resource_id).toBe(resourceId);
      expect(item.body).toBe(body);
      expect(item.author_user_id).toBe(userId);
      // Enrichment: the email is loaded from the User table during list (the row stores only author_user_id).
      expect(typeof item.authorEmail, 'authorEmail enriched from User entity').toBe('string');
      expect((item.authorEmail as string).length, 'authorEmail is non-empty').toBeGreaterThan(0);
      expect('authorName' in item, 'authorName key present from enrichment').toBe(true);

      // Update the body.
      const updatedBody = `QA comment UPDATED ${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/resources/comments', {
        token,
        data: { id: commentId, body: updatedBody },
      });
      expect(updateRes.status(), 'update comment should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(updateRes))?.ok, 'update reports ok').toBe(true);

      await expect
        .poll(
          async () => (await listComments(request, token, resourceId!)).find((comment) => comment.id === commentId)?.body ?? null,
          { timeout: 8000, message: 'updated body should be readable' },
        )
        .toBe(updatedBody);
      const afterUpdate = (await listComments(request, token, resourceId)).find((comment) => comment.id === commentId);
      expect(typeof afterUpdate?.authorEmail, 'author still enriched after update').toBe('string');

      // Delete -> removed from the timeline.
      const delRes = await apiRequest(request, 'DELETE', `/api/resources/comments?id=${encodeURIComponent(commentId!)}`, { token });
      expect(delRes.status(), 'delete comment should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(delRes))?.ok, 'delete reports ok').toBe(true);

      await expect
        .poll(async () => (await listComments(request, token, resourceId!)).some((comment) => comment.id === commentId), {
          timeout: 8000,
          message: 'deleted comment should be gone from the timeline',
        })
        .toBe(false);
      commentId = null;
    } finally {
      if (commentId) {
        await apiRequest(request, 'DELETE', `/api/resources/comments?id=${encodeURIComponent(commentId)}`, { token }).catch(
          () => {},
        );
      }
      await deleteResourceIfExists(request, token, resourceId);
    }
  });
});
