import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures';

/**
 * TC-SALES-NOTE-REDO-KEEPS-ID: redo of sales.notes.create must re-materialize
 * the note with the SAME id (no orphaned soft-deleted original, no new id).
 * A sales note requires a parent document context, so the test creates an
 * order fixture first and posts the note against it (contextType=order).
 *
 * Self-skips when the principal lacks sales-write ACLs (dev databases whose
 * role ACLs were never synced); CI runs a fully-synced tenant.
 *
 * Endpoints:
 *   - POST/DELETE /api/sales/orders
 *   - POST/GET/DELETE /api/sales/notes
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

test.describe('TC-SALES-NOTE-REDO-KEEPS-ID: redo of sales.notes.create restores the original id', () => {
  test('sales.notes.create redo keeps the same id', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    test.skip(!(await canManageSalesOrders(request, token)), 'principal lacks sales-write ACLs (run yarn mercato auth sync-role-acls)');

    let orderId: string | null = null;
    let id: string | null = null;
    try {
      orderId = await createSalesOrderFixture(request, token);

      const body = `QA redo note ${stamp()}`;
      const createRes = await apiRequest(request, 'POST', '/api/sales/notes', {
        token,
        data: { contextType: 'order', contextId: orderId, orderId, body },
      });
      expect(createRes.status(), 'create note 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'note id returned').toBeTruthy();
      const op = readOperation(createRes);

      const listPath = `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId)}&pageSize=100`;
      await undo(request, token, op.undoToken);
      expect(await findInList(request, token, listPath, id), 'note gone after create-undo').toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original note id').toBe(id);

      const restored = await findInList(request, token, listPath, id);
      expect(restored, 'note exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME note id').toBe(id);
      expect(restored!.body, 'restored row keeps its body').toBe(body);
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/notes', id);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});
