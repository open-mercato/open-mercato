import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createResourceFixture,
  deleteResourceIfExists,
  createResourceTagFixture,
  deleteResourceTagIfExists,
} from './helpers/resourcesFixtures';

export const integrationMeta = {
  dependsOnModules: ['resources', 'audit_logs'],
};

/**
 * TC-RESO-007 (issue #2461): Tag assign/unassign custom routes + undo.
 *
 * `POST /api/resources/resources/tags/assign` and `.../unassign` are custom
 * (non-CRUD) write routes that mutate the tag-assignment set and emit an undo
 * token in the `x-om-operation` header. This spec verifies the real contract:
 *   - assign -> 201 (+ undo token); unassign -> 200 (+ undo token)
 *   - the assignment is reflected on the resource's `tags` array
 *   - duplicate assign -> 409 ("Tag already assigned.")
 *   - assign of an unknown (valid-UUID) tag -> 404; malformed tagId -> 400
 *   - unassign of an absent assignment -> 404
 *   - undo of unassign restores the assignment; undo of assign removes it
 */
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo';
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

function parseUndoToken(res: APIResponse): string {
  const header = res.headers()['x-om-operation'] ?? '';
  const encoded = header.replace(/^omop:/, '');
  const payload = JSON.parse(decodeURIComponent(encoded)) as { undoToken?: string };
  expect(typeof payload.undoToken, 'operation header should carry an undo token').toBe('string');
  return payload.undoToken as string;
}

async function resourceTagIds(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<string[]> {
  const res = await apiRequest(request, 'GET', `/api/resources/resources?ids=${encodeURIComponent(resourceId)}`, { token });
  const body = await readJsonSafe<{ items?: Array<{ id?: string; tags?: Array<{ id?: string }> }> }>(res);
  const item = (body?.items ?? []).find((entry) => entry.id === resourceId);
  const tags = Array.isArray(item?.tags) ? item!.tags : [];
  return tags
    .map((tag) => (typeof tag?.id === 'string' ? tag.id : null))
    .filter((id): id is string => typeof id === 'string')
    .sort((a, b) => a.localeCompare(b));
}

async function expectResourceTags(
  request: APIRequestContext,
  token: string,
  resourceId: string,
  expected: string[],
  message: string,
): Promise<void> {
  const sorted = [...expected].sort((a, b) => a.localeCompare(b));
  await expect
    .poll(async () => resourceTagIds(request, token, resourceId), { timeout: 8000, message })
    .toEqual(sorted);
}

test.describe('TC-RESO-007: tag assign/unassign routes + undo', () => {
  test('assigns, unassigns, enforces 409/404/400 edges, and undoes both directions', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();

    let resourceId: string | null = null;
    let tagAId: string | null = null;
    let tagBId: string | null = null;
    try {
      tagAId = await createResourceTagFixture(request, token, { label: `QA Assign A ${stamp}` });
      tagBId = await createResourceTagFixture(request, token, { label: `QA Assign B ${stamp}` });
      resourceId = await createResourceFixture(request, token, `QA Assign Resource ${stamp}`);

      // Assign A -> 201 + undo token; resource tags = [A].
      const assignA = await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
        token,
        data: { resourceId, tagId: tagAId },
      });
      expect(assignA.status(), 'assign tag A should return 201').toBe(201);
      const assignAUndo = parseUndoToken(assignA);
      await expectResourceTags(request, token, resourceId, [tagAId], 'resource should carry tag A after assign');

      // Assign B -> 201; resource tags = [A, B].
      const assignB = await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
        token,
        data: { resourceId, tagId: tagBId },
      });
      expect(assignB.status(), 'assign tag B should return 201').toBe(201);
      const assignBUndo = parseUndoToken(assignB);
      await expectResourceTags(request, token, resourceId, [tagAId, tagBId], 'resource should carry tags A and B');

      // Unassign A -> 200 + undo token; resource tags = [B].
      const unassignA = await apiRequest(request, 'POST', '/api/resources/resources/tags/unassign', {
        token,
        data: { resourceId, tagId: tagAId },
      });
      expect(unassignA.status(), 'unassign tag A should return 200').toBe(200);
      const unassignAUndo = parseUndoToken(unassignA);
      await expectResourceTags(request, token, resourceId, [tagBId], 'resource should carry only tag B after unassign');

      // Edge cases.
      const duplicate = await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
        token,
        data: { resourceId, tagId: tagBId },
      });
      expect(duplicate.status(), 'assigning an already-assigned tag must return 409').toBe(409);

      const unknownTag = await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
        token,
        data: { resourceId, tagId: UNKNOWN_UUID },
      });
      expect(unknownTag.status(), 'assigning an unknown (valid-UUID) tag must return 404').toBe(404);

      const malformedTag = await apiRequest(request, 'POST', '/api/resources/resources/tags/assign', {
        token,
        data: { resourceId, tagId: 'not-a-uuid' },
      });
      expect(malformedTag.status(), 'assigning a malformed tag id must return 400').toBe(400);

      const unassignAbsent = await apiRequest(request, 'POST', '/api/resources/resources/tags/unassign', {
        token,
        data: { resourceId, tagId: tagAId },
      });
      expect(unassignAbsent.status(), 'unassigning an absent assignment must return 404').toBe(404);

      // Undo the unassign of A -> A is restored; resource tags = [A, B].
      const undoUnassign = await apiRequest(request, 'POST', UNDO_PATH, { token, data: { undoToken: unassignAUndo } });
      expect(undoUnassign.status(), 'undo of unassign should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(undoUnassign))?.ok, 'undo reports ok').toBe(true);
      await expectResourceTags(request, token, resourceId, [tagAId, tagBId], 'undo of unassign restores tag A');

      // Undo the assign of B -> B is removed; resource tags = [A].
      const undoAssign = await apiRequest(request, 'POST', UNDO_PATH, { token, data: { undoToken: assignBUndo } });
      expect(undoAssign.status(), 'undo of assign should return 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(undoAssign))?.ok, 'undo reports ok').toBe(true);
      await expectResourceTags(request, token, resourceId, [tagAId], 'undo of assign removes tag B');

      // assignAUndo is intentionally left unused: tag A stays assigned and is cleaned up via tag deletion below.
      expect(typeof assignAUndo, 'assign A also issued an undo token').toBe('string');
    } finally {
      await deleteResourceTagIfExists(request, token, tagAId);
      await deleteResourceTagIfExists(request, token, tagBId);
      await deleteResourceIfExists(request, token, resourceId);
    }
  });
});
