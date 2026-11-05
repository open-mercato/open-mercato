import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-CAT-REDO-KEEPS-ID: redo of a *.create must re-materialize the row with the
 * SAME id (no orphaned soft-deleted original, no new id). Covers the catalog
 * create commands converted to makeCreateRedo that previously lacked redo
 * integration coverage:
 *  - catalog.priceKinds.create
 *  - catalog.optionSchemas.create
 *
 * Endpoints:
 *   - POST/GET/DELETE /api/catalog/price-kinds
 *   - POST/GET/DELETE /api/catalog/option-schemas
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

test.describe('TC-CAT-REDO-KEEPS-ID: redo of catalog *.create restores the original id', () => {
  test('catalog.priceKinds.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const code = `qa-redo-pk-${stamp()}`;

      const createRes = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
        token,
        data: { organizationId, tenantId, code, title: 'QA Redo Price Kind' },
      });
      expect(createRes.status(), 'create price kind 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'price kind id returned').toBeTruthy();
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(
        await findInList(request, token, `/api/catalog/price-kinds?id=${encodeURIComponent(id)}`, id),
        'price kind gone after create-undo',
      ).toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original price kind id').toBe(id);

      const restored = await findInList(
        request,
        token,
        `/api/catalog/price-kinds?id=${encodeURIComponent(id)}`,
        id,
      );
      expect(restored, 'price kind exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME price kind id').toBe(id);
      expect(restored!.code, 'restored row keeps its code').toBe(code);
    } finally {
      await deleteIfExists(request, token, '/api/catalog/price-kinds', id);
    }
  });

  test('catalog.optionSchemas.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const name = `QA Redo Option Schema ${stamp()}`;

      const createRes = await apiRequest(request, 'POST', '/api/catalog/option-schemas', {
        token,
        data: { organizationId, tenantId, name, schema: { options: [] } },
      });
      expect(createRes.status(), 'create option schema 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'option schema id returned').toBeTruthy();
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(
        await findInList(request, token, `/api/catalog/option-schemas?id=${encodeURIComponent(id)}`, id),
        'option schema gone after create-undo',
      ).toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original option schema id').toBe(id);

      const restored = await findInList(request, token, `/api/catalog/option-schemas?id=${encodeURIComponent(id)}`, id);
      expect(restored, 'option schema exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME option schema id').toBe(id);
      expect(restored!.name, 'restored row keeps its name').toBe(name);
    } finally {
      await deleteIfExists(request, token, '/api/catalog/option-schemas', id);
    }
  });
});
