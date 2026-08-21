import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-RES-REDO-KEEPS-ID: redo of a *.create must re-materialize the row with the
 * SAME id (no orphaned soft-deleted original, no new id). Covers the resources
 * create commands converted to makeCreateRedo that previously lacked redo
 * integration coverage:
 *  - resources.resourceTypes.create
 *  - resources.resource-comments.create (requires a resource parent)
 *
 * Endpoints:
 *   - POST/GET/DELETE /api/resources/resource-types
 *   - POST/GET/DELETE /api/resources/resources
 *   - POST/GET/DELETE /api/resources/comments
 *   - POST /api/audit_logs/audit-logs/actions/undo  { undoToken }
 *   - POST /api/audit_logs/audit-logs/actions/redo  { logId }
 */

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type Operation = { id: string; undoToken: string; resourceId: string | null };

function readOperation(res: APIResponse): Operation {
  const header = res.headers()['x-om-operation'] ?? '';
  const enc = header.startsWith('omop:') ? header.slice(5) : '';
  expect(enc, 'x-om-operation header carries an omop: payload').not.toBe('');
  const payload = JSON.parse(decodeURIComponent(enc)) as { id?: string; undoToken?: string; resourceId?: string | null };
  expect(typeof payload.id, 'log id present').toBe('string');
  expect(typeof payload.undoToken, 'undoToken present').toBe('string');
  return { id: payload.id as string, undoToken: payload.undoToken as string, resourceId: payload.resourceId ?? null };
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken } });
  expect(res.status(), 'undo 200').toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok).toBe(true);
}

async function redo(request: APIRequestContext, token: string, logId: string): Promise<Operation> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', { token, data: { logId } });
  expect(res.status(), 'redo 200').toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok).toBe(true);
  return readOperation(res);
}

async function findInList(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await apiRequest(request, 'GET', path, { token });
  expect(res.status()).toBe(200);
  const rows = ((await res.json()) as { items?: Array<Record<string, unknown>> }).items ?? [];
  return rows.find((row) => row.id === id);
}

async function deleteIfExists(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token });
  } catch {
    /* ignore */
  }
}

test.describe('TC-RES-REDO-KEEPS-ID: redo of resources *.create restores the original id', () => {
  test('resources.resourceTypes.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const name = `QA Redo Resource Type ${stamp()}`;

      const createRes = await apiRequest(request, 'POST', '/api/resources/resource-types', {
        token,
        data: { organizationId, tenantId, name },
      });
      expect(createRes.status(), 'create resource type 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'resource type id returned').toBeTruthy();
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(
        await findInList(request, token, `/api/resources/resource-types?id=${encodeURIComponent(id)}`, id),
        'resource type gone after create-undo',
      ).toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original resource type id').toBe(id);

      const restored = await findInList(request, token, `/api/resources/resource-types?id=${encodeURIComponent(id)}`, id);
      expect(restored, 'resource type exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME resource type id').toBe(id);
      expect(restored!.name, 'restored row keeps its name').toBe(name);
    } finally {
      await deleteIfExists(request, token, '/api/resources/resource-types', id);
    }
  });

  test('resources.resource-comments.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let resourceId: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const resourceRes = await apiRequest(request, 'POST', '/api/resources/resources', {
        token,
        data: { organizationId, tenantId, name: `QA Redo Comment Resource ${stamp()}` },
      });
      expect(resourceRes.status(), 'create parent resource 201').toBe(201);
      resourceId = ((await resourceRes.json()) as { id: string }).id;
      expect(resourceId, 'resource id returned').toBeTruthy();

      const body = `QA redo resource comment ${stamp()}`;
      const createRes = await apiRequest(request, 'POST', '/api/resources/comments', {
        token,
        data: { organizationId, tenantId, entityId: resourceId, body },
      });
      expect(createRes.status(), 'create comment 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'comment id returned').toBeTruthy();
      const op = readOperation(createRes);

      const listPath = `/api/resources/comments?entityId=${encodeURIComponent(resourceId)}&pageSize=100`;
      await undo(request, token, op.undoToken);
      expect(await findInList(request, token, listPath, id), 'comment gone after create-undo').toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original comment id').toBe(id);

      const restored = await findInList(request, token, listPath, id);
      expect(restored, 'comment exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME comment id').toBe(id);
      expect(restored!.body, 'restored row keeps its body').toBe(body);
    } finally {
      await deleteIfExists(request, token, '/api/resources/comments', id);
      await deleteIfExists(request, token, '/api/resources/resources', resourceId);
    }
  });
});
