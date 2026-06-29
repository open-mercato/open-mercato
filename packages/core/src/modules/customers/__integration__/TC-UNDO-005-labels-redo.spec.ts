import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

/**
 * TC-UNDO-005 (issue #2506 finding #2, invariant I6): redo of a *.create must
 * re-materialize the record with the SAME id rather than minting a new one and
 * orphaning the soft-deleted original. Covered here for customers.labels.create
 * (a user- and organization-scoped command converted to makeCreateRedo that
 * previously lacked redo integration coverage).
 *
 * The labels API exposes no DELETE endpoint, so teardown re-undoes the redone
 * create (best-effort) to keep the tenant clean. Each run uses a unique slug.
 *
 * Endpoints:
 *   - POST/GET /api/customers/labels
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

async function redo(request: APIRequestContext, token: string, logId: string): Promise<APIResponse> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', { token, data: { logId } });
  expect(res.status(), 'redo 200').toBe(200);
  expect(((await res.json()) as { ok?: boolean }).ok).toBe(true);
  return res;
}

async function findLabelById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await apiRequest(request, 'GET', '/api/customers/labels?pageSize=100', { token });
  expect(res.status()).toBe(200);
  const rows = ((await res.json()) as { items?: Array<Record<string, unknown>> }).items ?? [];
  return rows.find((row) => row.id === id);
}

test.describe('TC-UNDO-005: redo of customers.labels.create restores the original id', () => {
  test('customers.labels.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    let redoUndoToken: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const slug = `qa-redo-label-${stamp()}`;

      const createRes = await apiRequest(request, 'POST', '/api/customers/labels', {
        token,
        data: { label: 'QA Redo Label', slug },
      });
      expect(createRes.status(), 'create label 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'label id returned').toBeTruthy();
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(await findLabelById(request, token, id), 'label gone after create-undo').toBeFalsy();

      const redoRes = await redo(request, token, op.id);
      const redoOp = readOperation(redoRes);
      redoUndoToken = redoOp.undoToken;
      expect(redoOp.resourceId, 'redo resourceId equals the original label id').toBe(id);

      const restored = await findLabelById(request, token, id);
      expect(restored, 'label exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME label id').toBe(id);
      expect(restored!.slug, 'restored row keeps its slug').toBe(slug);
    } finally {
      if (token && redoUndoToken) {
        try {
          await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
            token,
            data: { undoToken: redoUndoToken },
          });
        } catch {
          /* best-effort cleanup; labels expose no DELETE endpoint */
        }
      }
    }
  });
});
