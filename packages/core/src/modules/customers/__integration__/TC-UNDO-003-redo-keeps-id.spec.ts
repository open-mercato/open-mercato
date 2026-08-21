import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-UNDO-003 (issue #2506 finding #2, invariant I6): redo of a *.create must
 * re-materialize the record with the SAME id rather than minting a new one and
 * orphaning the soft-deleted original. Covered here for the MULTI-ENTITY
 * customers.people.create (entity + profile + relations) and the single-entity
 * customers.tags.create.
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

async function getOne(request: APIRequestContext, token: string, path: string, id: string): Promise<Record<string, unknown> | undefined> {
  const res = await apiRequest(request, 'GET', `${path}?id=${encodeURIComponent(id)}`, { token });
  expect(res.status()).toBe(200);
  return (((await res.json()) as { items?: Record<string, unknown>[] }).items ?? [])[0];
}

test.describe('TC-UNDO-003: redo of *.create restores the original id', () => {
  test('customers.people.create (multi-entity) redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const firstName = 'QA';
      const lastName = `Redo ${stamp()}`;

      const createRes = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: { organizationId, tenantId, firstName, lastName },
      });
      expect(createRes.status(), 'create person 201').toBe(201);
      const created = (await createRes.json()) as { id?: string; entityId?: string };
      id = (created.id ?? created.entityId) as string;
      expect(id, 'person id returned').toBeTruthy();
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(await getOne(request, token, '/api/customers/people', id), 'person gone after create-undo').toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo log resourceId equals original person id').toBe(id);

      const restored = await getOne(request, token, '/api/customers/people', id);
      expect(restored, 'person exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME person id').toBe(id);
      expect(restored!.firstName ?? restored!.first_name, 'redo preserves decrypted firstName').toBe(firstName);
      expect(restored!.lastName ?? restored!.last_name, 'redo preserves decrypted lastName').toBe(lastName);
    } finally {
      if (token && id) {
        try { await apiRequest(request, 'DELETE', `/api/customers/people?id=${encodeURIComponent(id)}`, { token }); } catch { /* ignore */ }
      }
    }
  });

  test('customers.tags.create (single-entity) redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const createRes = await apiRequest(request, 'POST', '/api/customers/tags', {
        token,
        data: { organizationId, tenantId, slug: `qa-redo-tag-${stamp()}`, label: 'QA Redo Tag', color: '#3366ff' },
      });
      expect(createRes.status(), 'create tag 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals original tag id').toBe(id);

      // The tags list endpoint does not support an ?id= filter, so list and find by id.
      const listRes = await apiRequest(request, 'GET', '/api/customers/tags?pageSize=100', { token });
      expect(listRes.status()).toBe(200);
      const rows = ((await listRes.json()) as { items?: Array<{ id: string }> }).items ?? [];
      const restored = rows.find((row) => row.id === id);
      expect(restored, 'tag with the original id exists again after redo').toBeTruthy();
    } finally {
      if (token && id) {
        try { await apiRequest(request, 'DELETE', `/api/customers/tags?id=${encodeURIComponent(id)}`, { token }); } catch { /* ignore */ }
      }
    }
  });
});
