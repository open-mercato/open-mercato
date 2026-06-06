import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-UNDO-004 (issue #2506 finding #1): the deprecated activities/todos bridge
 * routes write through the undoable command bus but historically discarded the
 * log entry, so they exposed NO undo affordance (no x-om-operation header). They
 * must now emit the x-om-operation undo token (while still carrying their
 * Deprecation header), and the issued token must undo the write.
 *
 * Endpoints:
 *   - POST /api/customers/people            (fixture parent entity)
 *   - POST /api/customers/activities        (deprecated bridge create)
 *   - POST /api/customers/todos             (deprecated bridge create)
 *   - POST /api/audit_logs/audit-logs/actions/undo
 */

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function readUndoToken(res: APIResponse): string {
  const header = res.headers()['x-om-operation'] ?? '';
  const enc = header.startsWith('omop:') ? header.slice(5) : '';
  expect(enc, 'bridge route must now carry an omop: operation payload').not.toBe('');
  const payload = JSON.parse(decodeURIComponent(enc)) as { undoToken?: string };
  expect(typeof payload.undoToken, 'undoToken present in bridge operation payload').toBe('string');
  return payload.undoToken as string;
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken } });
  expect(res.status(), 'undo returns 200').toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok, 'undo ok').toBe(true);
}

async function createPerson(request: APIRequestContext, token: string, organizationId: string, tenantId: string): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/customers/people', {
    token,
    data: { organizationId, tenantId, firstName: 'QA', lastName: `Bridge ${stamp()}` },
  });
  expect(res.status(), 'create person 201').toBe(201);
  const body = (await res.json()) as { id?: string; entityId?: string };
  const id = body.id ?? body.entityId;
  expect(id, 'person create returns an id').toBeTruthy();
  return id as string;
}

async function deletePerson(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return;
  try {
    await apiRequest(request, 'DELETE', `/api/customers/people?id=${encodeURIComponent(id)}`, { token });
  } catch { /* ignore */ }
}

test.describe('TC-UNDO-004: deprecated activities/todos bridge routes emit an undo token', () => {
  test('POST /api/customers/activities is deprecated AND undoable', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      personId = await createPerson(request, token, organizationId, tenantId);

      const res = await apiRequest(request, 'POST', '/api/customers/activities', {
        token,
        data: { entityId: personId, activityType: 'note', subject: `QA bridge ${stamp()}` },
      });
      expect(res.status(), 'activity create 201').toBe(201);
      expect(res.headers()['deprecation'], 'bridge still advertises Deprecation').toBeTruthy();

      const undoToken = readUndoToken(res);
      await undo(request, token, undoToken);
    } finally {
      await deletePerson(request, token, personId);
    }
  });

  test('POST /api/customers/todos is deprecated AND undoable', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      personId = await createPerson(request, token, organizationId, tenantId);

      const res = await apiRequest(request, 'POST', '/api/customers/todos', {
        token,
        data: { entityId: personId, title: `QA bridge todo ${stamp()}` },
      });
      expect(res.status(), 'todo create 201').toBe(201);
      expect(res.headers()['deprecation'], 'bridge still advertises Deprecation').toBeTruthy();

      const undoToken = readUndoToken(res);
      await undo(request, token, undoToken);
    } finally {
      await deletePerson(request, token, personId);
    }
  });
});
