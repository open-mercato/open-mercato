import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-STAFF-REDO-KEEPS-ID: redo of a *.create must re-materialize the row with
 * the SAME id (no orphaned soft-deleted original, no new id). Covers the staff
 * create commands converted to makeCreateRedo that previously lacked redo
 * integration coverage:
 *  - staff.teams.create
 *  - staff.team-roles.create
 *  - staff.team-member-comments.create (requires a team + team member parent)
 *
 * Endpoints:
 *   - POST/GET/DELETE /api/staff/teams
 *   - POST/GET/DELETE /api/staff/team-roles
 *   - POST/GET/DELETE /api/staff/team-members
 *   - POST/GET/DELETE /api/staff/comments
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

test.describe('TC-STAFF-REDO-KEEPS-ID: redo of staff *.create restores the original id', () => {
  test('staff.teams.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);
      const name = `QA Redo Team ${stamp()}`;

      const createRes = await apiRequest(request, 'POST', '/api/staff/teams', {
        token,
        data: { organizationId, tenantId, name },
      });
      expect(createRes.status(), 'create team 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'team id returned').toBeTruthy();
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(
        await findInList(request, token, `/api/staff/teams?id=${encodeURIComponent(id)}`, id),
        'team gone after create-undo',
      ).toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original team id').toBe(id);

      const restored = await findInList(request, token, `/api/staff/teams?id=${encodeURIComponent(id)}`, id);
      expect(restored, 'team exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME team id').toBe(id);
      expect(restored!.name, 'restored row keeps its name').toBe(name);
    } finally {
      await deleteIfExists(request, token, '/api/staff/teams', id);
    }
  });

  test('staff.team-roles.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let teamId: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const teamRes = await apiRequest(request, 'POST', '/api/staff/teams', {
        token,
        data: { organizationId, tenantId, name: `QA Redo Role Team ${stamp()}` },
      });
      expect(teamRes.status(), 'create parent team 201').toBe(201);
      teamId = ((await teamRes.json()) as { id: string }).id;

      const name = `QA Redo Role ${stamp()}`;
      const createRes = await apiRequest(request, 'POST', '/api/staff/team-roles', {
        token,
        data: { organizationId, tenantId, teamId, name },
      });
      expect(createRes.status(), 'create team role 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'team role id returned').toBeTruthy();
      const op = readOperation(createRes);

      await undo(request, token, op.undoToken);
      expect(
        await findInList(request, token, `/api/staff/team-roles?id=${encodeURIComponent(id)}`, id),
        'team role gone after create-undo',
      ).toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original team role id').toBe(id);

      const restored = await findInList(request, token, `/api/staff/team-roles?id=${encodeURIComponent(id)}`, id);
      expect(restored, 'team role exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME team role id').toBe(id);
      expect(restored!.name, 'restored row keeps its name').toBe(name);
    } finally {
      await deleteIfExists(request, token, '/api/staff/team-roles', id);
      await deleteIfExists(request, token, '/api/staff/teams', teamId);
    }
  });

  test('staff.team-member-comments.create redo keeps the same id', async ({ request }) => {
    let token: string | null = null;
    let teamId: string | null = null;
    let memberId: string | null = null;
    let id: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const { organizationId, tenantId } = getTokenContext(token);

      const teamRes = await apiRequest(request, 'POST', '/api/staff/teams', {
        token,
        data: { organizationId, tenantId, name: `QA Redo Comment Team ${stamp()}` },
      });
      expect(teamRes.status(), 'create parent team 201').toBe(201);
      teamId = ((await teamRes.json()) as { id: string }).id;

      const memberRes = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { organizationId, tenantId, teamId, displayName: `QA Redo Member ${stamp()}` },
      });
      expect(memberRes.status(), 'create parent team member 201').toBe(201);
      memberId = ((await memberRes.json()) as { id: string }).id;
      expect(memberId, 'team member id returned').toBeTruthy();

      const body = `QA redo comment ${stamp()}`;
      const createRes = await apiRequest(request, 'POST', '/api/staff/comments', {
        token,
        data: { organizationId, tenantId, entityId: memberId, body },
      });
      expect(createRes.status(), 'create comment 201').toBe(201);
      id = ((await createRes.json()) as { id: string }).id;
      expect(id, 'comment id returned').toBeTruthy();
      const op = readOperation(createRes);

      const listPath = `/api/staff/comments?entityId=${encodeURIComponent(memberId)}&pageSize=100`;
      await undo(request, token, op.undoToken);
      expect(await findInList(request, token, listPath, id), 'comment gone after create-undo').toBeFalsy();

      const redoOp = await redo(request, token, op.id);
      expect(redoOp.resourceId, 'redo resourceId equals the original comment id').toBe(id);

      const restored = await findInList(request, token, listPath, id);
      expect(restored, 'comment exists again after redo').toBeTruthy();
      expect(restored!.id, 'redo restored the SAME comment id').toBe(id);
      expect(restored!.body, 'restored row keeps its body').toBe(body);
    } finally {
      await deleteIfExists(request, token, '/api/staff/comments', id);
      await deleteIfExists(request, token, '/api/staff/team-members', memberId);
      await deleteIfExists(request, token, '/api/staff/teams', teamId);
    }
  });
});
