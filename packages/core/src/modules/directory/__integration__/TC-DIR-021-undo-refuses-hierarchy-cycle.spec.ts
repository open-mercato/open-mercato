import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import { expectOperation, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness';

const CYCLE_CODE = 'directory.organizations.errors.replayCycle';
const CYCLE_MESSAGE =
  "The organization hierarchy changed since this action, so it can't be reverted without making an organization its own ancestor.";

type ManageOrg = {
  id: string;
  name: string;
  parentId: string | null;
  ancestorIds?: string[];
  childIds?: string[];
  descendantIds?: string[];
};

async function createOrg(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/organizations', { token, data });
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  return expectId(body?.id, 'Organization creation response should include id');
}

async function setParent(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  id: string,
  parentId: string | null,
) {
  const response = await apiRequest(request, 'PUT', '/api/directory/organizations', {
    token,
    data: { id, tenantId, parentId },
  });
  expect(response.status(), `PUT parentId for ${id} should return 200`).toBe(200);
  return response;
}

async function loadManageOrg(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  orgId: string,
): Promise<ManageOrg> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(orgId)}`,
    { token },
  );
  expect(response.status(), 'GET manage view should return 200').toBe(200);
  const body = await readJsonSafe<{ items?: ManageOrg[] }>(response);
  const org = body?.items?.find((item) => item.id === orgId);
  expect(org, `organization ${orgId} should be listed`).toBeTruthy();
  return org as ManageOrg;
}

async function expectCycleRefusal(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const response = await undoByToken(request, token, undoToken);
  expect(response.status(), 'undo that would form a parent cycle returns 409').toBe(409);
  const body = await readJsonSafe<{ error?: string; code?: string }>(response);
  expect(body?.code).toBe(CYCLE_CODE);
  expect(body?.error).toBe(CYCLE_MESSAGE);
}

function expectNotOwnDescendant(org: ManageOrg): void {
  expect(org.descendantIds ?? [], `${org.name} is not its own descendant`).not.toContain(org.id);
  expect(org.ancestorIds ?? [], `${org.name} is not its own ancestor`).not.toContain(org.id);
}

type StoredOrg = {
  id: string;
  parent_id: string | null;
  ancestor_ids: string[] | null;
  descendant_ids: string[] | null;
};

async function readStoredOrgs(ids: string[]): Promise<Map<string, StoredOrg>> {
  const rows = await withClient((client) =>
    client.query<StoredOrg>(
      'select id::text as id, parent_id::text as parent_id, ancestor_ids, descendant_ids from organizations where id::text = any($1::text[])',
      [ids],
    ),
  );
  return new Map(rows.rows.map((row) => [row.id, row]));
}

async function expectStoredAcyclic(ids: string[]): Promise<Map<string, StoredOrg>> {
  const stored = await readStoredOrgs(ids);
  for (const id of ids) {
    const row = stored.get(id);
    expect(row, `organization ${id} is stored`).toBeTruthy();
    expect(row?.ancestor_ids ?? [], `${id} is not its own stored ancestor`).not.toContain(id);
    expect(row?.descendant_ids ?? [], `${id} is not its own stored descendant`).not.toContain(id);
    const seen = new Set<string>([id]);
    let current = row?.parent_id ?? null;
    while (current && stored.has(current)) {
      expect(seen.has(current), `parent chain from ${id} does not loop`).toBe(false);
      seen.add(current);
      current = stored.get(current)?.parent_id ?? null;
    }
  }
  return stored;
}

async function readActionLogState(logId: string): Promise<string | null> {
  const rows = await withClient((client) =>
    client.query<{ execution_state: string }>('select execution_state from action_logs where id::text = $1', [logId]),
  );
  return rows.rows[0]?.execution_state ?? null;
}

type SwitcherNode = { id?: string; name?: string; selectable?: boolean; children?: SwitcherNode[] };

function flattenSwitcher(items: SwitcherNode[]): SwitcherNode[] {
  return items.flatMap((item) => [item, ...flattenSwitcher(Array.isArray(item.children) ? item.children : [])]);
}

async function loadSwitcherNodes(request: APIRequestContext, token: string, query = ''): Promise<SwitcherNode[]> {
  const response = await apiRequest(request, 'GET', `/api/directory/organization-switcher${query}`, { token });
  expect(response.status(), 'GET organization switcher should return 200').toBe(200);
  const body = await readJsonSafe<{ items?: SwitcherNode[] }>(response);
  return flattenSwitcher(body?.items ?? []);
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  return expectId(body?.id, 'Tenant creation response should include id');
}

/**
 * TC-DIR-021: Undo refuses to restore a parent that would form a hierarchy cycle
 * Covers:
 * - POST /api/audit_logs/audit-logs/actions/undo for directory.organizations.update and directory.organizations.delete
 * - PUT /api/directory/organizations (reparent), DELETE /api/directory/organizations
 * - GET /api/directory/organizations?view=manage (tree fields stay acyclic)
 * - Last-operation banner Undo shows the translated refusal
 * - Hierarchy rebuild repairs a cycle already stored in the database, and the repaired
 *   descendant scope is what a restricted caller can select (GET /api/directory/organization-switcher);
 *   a caller from another tenant still sees none of it
 * - Undo racing a concurrent reparent: the replay waits for the tenant hierarchy lock, refuses on the
 *   committed graph without consuming the action log, and the same token succeeds once unobstructed
 */
test.describe('TC-DIR-021: Undo refuses to restore a parent that would form a hierarchy cycle', () => {
  test('update undo is refused while the old parent is a descendant, then succeeds once it is not', async ({ request }) => {
    let token: string | null = null;
    let parentId: string | null = null;
    let childId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);
      parentId = await createOrg(request, token, { name: `QA TC-DIR-021 A ${stamp}`, tenantId });
      childId = await createOrg(request, token, { name: `QA TC-DIR-021 B ${stamp}`, tenantId, parentId });

      const detach = await setParent(request, token, tenantId, childId, null);
      const detachOperation = expectOperation(detach, 'detaching B from A');
      await setParent(request, token, tenantId, parentId, childId);

      await expectCycleRefusal(request, token, detachOperation.undoToken);

      const parentAfterRefusal = await loadManageOrg(request, token, tenantId, parentId);
      const childAfterRefusal = await loadManageOrg(request, token, tenantId, childId);
      expect(parentAfterRefusal.parentId, 'A stays under B').toBe(childId);
      expect(childAfterRefusal.parentId, 'B keeps no parent').toBeNull();
      expect(childAfterRefusal.descendantIds ?? []).toContain(parentId);
      expectNotOwnDescendant(parentAfterRefusal);
      expectNotOwnDescendant(childAfterRefusal);

      await setParent(request, token, tenantId, parentId, null);
      const retry = await undoByToken(request, token, detachOperation.undoToken);
      expect(retry.status(), 'the refused undo stays available and succeeds once no cycle would form').toBe(200);
      const childRestored = await loadManageOrg(request, token, tenantId, childId);
      const parentRestored = await loadManageOrg(request, token, tenantId, parentId);
      expect(childRestored.parentId, 'B is back under A').toBe(parentId);
      expect(parentRestored.childIds ?? []).toContain(childId);
      expectNotOwnDescendant(childRestored);
      expectNotOwnDescendant(parentRestored);
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', childId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', parentId);
    }
  });

  test('delete undo is refused when reviving the organization would close a cycle', async ({ request }) => {
    let token: string | null = null;
    let rootId: string | null = null;
    let deletedId: string | null = null;
    let childId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);
      rootId = await createOrg(request, token, { name: `QA TC-DIR-021 P ${stamp}`, tenantId });
      deletedId = await createOrg(request, token, { name: `QA TC-DIR-021 X ${stamp}`, tenantId, parentId: rootId });
      childId = await createOrg(request, token, { name: `QA TC-DIR-021 C ${stamp}`, tenantId, parentId: deletedId });

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/directory/organizations?id=${encodeURIComponent(deletedId)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/directory/organizations should return 200').toBe(200);
      const deleteOperation = expectOperation(deleteResponse, 'deleting X');
      await setParent(request, token, tenantId, childId, null);
      await setParent(request, token, tenantId, rootId, childId);

      await expectCycleRefusal(request, token, deleteOperation.undoToken);

      const rootAfter = await loadManageOrg(request, token, tenantId, rootId);
      const childAfter = await loadManageOrg(request, token, tenantId, childId);
      expect(rootAfter.parentId, 'P stays under C').toBe(childId);
      expect(childAfter.parentId, 'C stays a root').toBeNull();
      expectNotOwnDescendant(rootAfter);
      expectNotOwnDescendant(childAfter);
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', rootId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', childId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', deletedId);
    }
  });

  test('last-operation banner shows the translated refusal', async ({ page, request }) => {
    test.slow();
    let token: string | null = null;
    let rootId: string | null = null;
    let deletedId: string | null = null;
    let childId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);
      rootId = await createOrg(request, token, { name: `QA TC-DIR-021 UI P ${stamp}`, tenantId });
      deletedId = await createOrg(request, token, { name: `QA TC-DIR-021 UI X ${stamp}`, tenantId, parentId: rootId });
      childId = await createOrg(request, token, { name: `QA TC-DIR-021 UI C ${stamp}`, tenantId, parentId: deletedId });

      await login(page, 'superadmin');
      await page.goto(`/backend/directory/organizations/${deletedId}/edit`, { waitUntil: 'commit' });
      await expect(page.locator('[data-crud-field-id="name"] input').first()).toHaveValue(`QA TC-DIR-021 UI X ${stamp}`, {
        timeout: 20_000,
      });
      const deleteButton = page.getByRole('button', { name: /^Delete(?: organization)?$/ }).first();
      const confirmDialog = page.getByRole('alertdialog');
      await expect(async () => {
        await deleteButton.click();
        await expect(confirmDialog).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/directory/organizations') && response.request().method() === 'DELETE',
      );
      await confirmDialog.getByRole('button', { name: /^Delete(?: organization)?$|^Confirm$/i }).click();
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.ok(), 'UI delete succeeds').toBeTruthy();
      await expect(page).toHaveURL(/\/backend\/directory\/organizations(?:\?.*)?$/);

      await setParent(request, token, tenantId, childId, null);
      await setParent(request, token, tenantId, rootId, childId);

      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ });
      await expect(undoButton).toBeVisible();
      const undoResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST',
      );
      await undoButton.click();
      const undoResponse = await undoResponsePromise;
      expect(undoResponse.status(), 'banner undo is refused with 409').toBe(409);
      await expect(page.getByText(CYCLE_MESSAGE).first()).toBeVisible();

      const rootAfter = await loadManageOrg(request, token, tenantId, rootId);
      expect(rootAfter.parentId, 'P stays under C').toBe(childId);
      expectNotOwnDescendant(rootAfter);
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', rootId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', childId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', deletedId);
    }
  });

  test('rebuild repairs a stored cycle and scopes callers to the repaired descendants', async ({ request }) => {
    test.slow();
    let token: string | null = null;
    const orgIds: string[] = [];
    let bystanderId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    let foreignTenantId: string | null = null;
    let foreignOrgId: string | null = null;
    let foreignRoleId: string | null = null;
    let foreignUserId: string | null = null;
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const password = 'StrongSecret123!';

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);
      const first = await createOrg(request, token, { name: `QA TC-DIR-021 Cycle 1 ${stamp}`, tenantId });
      orgIds.push(first);
      const second = await createOrg(request, token, { name: `QA TC-DIR-021 Cycle 2 ${stamp}`, tenantId, parentId: first });
      orgIds.push(second);
      const third = await createOrg(request, token, { name: `QA TC-DIR-021 Cycle 3 ${stamp}`, tenantId, parentId: second });
      orgIds.push(third);
      bystanderId = await createOrg(request, token, { name: `QA TC-DIR-021 Bystander ${stamp}`, tenantId });

      const childOf = new Map([[first, second], [second, third], [third, first]]);
      const parentOf = new Map([[second, first], [third, second], [first, third]]);
      await withClient(async (client) => {
        for (const id of orgIds) {
          const others = orgIds.filter((other) => other !== id);
          await client.query(
            `update organizations
               set parent_id = $2::uuid, ancestor_ids = $3::jsonb, child_ids = $4::jsonb, descendant_ids = $3::jsonb
             where id::text = $1`,
            [id, parentOf.get(id), JSON.stringify(others), JSON.stringify([childOf.get(id)])],
          );
        }
      });

      const cutId = [...orgIds].sort()[0]!;
      const middleId = childOf.get(cutId)!;
      const leafId = childOf.get(middleId)!;

      roleId = await createRoleFixture(request, token, { name: `qa-tc-dir-021-scope-${stamp}`, tenantId });
      await setRoleAclFeatures(request, token, {
        roleId,
        features: ['directory.organizations.view'],
        organizations: [middleId],
      });
      const restrictedEmail = `qa-tc-dir-021-scope-${stamp}@example.com`;
      userId = await createUserFixture(request, token, {
        email: restrictedEmail,
        password,
        organizationId: middleId,
        roles: [roleId],
        name: 'QA TC-DIR-021 Scoped',
      });
      const restrictedToken = await getAuthToken(request, restrictedEmail, password);

      const rename = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: bystanderId, tenantId, name: `QA TC-DIR-021 Bystander renamed ${stamp}` },
      });
      expect(rename.status(), 'an unrelated organization update rebuilds the tenant hierarchy').toBe(200);

      const stored = await expectStoredAcyclic(orgIds);
      expect(stored.get(cutId)?.parent_id, 'the cycle member with the smallest id becomes a root').toBeNull();
      expect(stored.get(middleId)?.parent_id).toBe(cutId);
      expect(stored.get(leafId)?.parent_id).toBe(middleId);
      expect(stored.get(cutId)?.descendant_ids ?? []).toEqual(expect.arrayContaining([middleId, leafId]));
      expect(stored.get(middleId)?.descendant_ids ?? []).toEqual([leafId]);
      expect(stored.get(leafId)?.descendant_ids ?? []).toEqual([]);
      for (const id of orgIds) expectNotOwnDescendant(await loadManageOrg(request, token, tenantId, id));

      await expect
        .poll(
          async () => {
            const nodes = await loadSwitcherNodes(request, restrictedToken);
            return {
              selectable: nodes.filter((node) => node.selectable).map((node) => node.id).sort(),
              visible: nodes.map((node) => node.id).filter((id) => id === cutId || id === bystanderId),
            };
          },
          { message: 'the restricted caller can select only its repaired subtree', timeout: 15_000 },
        )
        .toEqual({ selectable: [middleId, leafId].sort(), visible: [cutId] });

      foreignTenantId = await createTenant(request, token, `QA TC-DIR-021 Tenant B ${stamp}`);
      foreignOrgId = await createOrg(request, token, { name: `QA TC-DIR-021 Tenant B org ${stamp}`, tenantId: foreignTenantId });
      foreignRoleId = await createRoleFixture(request, token, {
        name: `qa-tc-dir-021-foreign-${stamp}`,
        tenantId: foreignTenantId,
      });
      await setRoleAclFeatures(request, token, {
        roleId: foreignRoleId,
        features: ['directory.organizations.view'],
        organizations: null,
      });
      const foreignEmail = `qa-tc-dir-021-foreign-${stamp}@example.com`;
      foreignUserId = await createUserFixture(request, token, {
        email: foreignEmail,
        password,
        organizationId: foreignOrgId,
        roles: [foreignRoleId],
        name: 'QA TC-DIR-021 Foreign',
      });
      const foreignToken = await getAuthToken(request, foreignEmail, password);
      const foreignNodes = await loadSwitcherNodes(request, foreignToken);
      const leaked = foreignNodes.map((node) => node.id).filter((id) => typeof id === 'string' && orgIds.includes(id));
      expect(leaked, 'a foreign-tenant caller sees no repaired organization').toEqual([]);
      const foreignSwitcher = await apiRequest(
        request,
        'GET',
        `/api/directory/organization-switcher?tenantId=${encodeURIComponent(tenantId)}`,
        { token: foreignToken },
      );
      expect(foreignSwitcher.status(), 'a foreign-tenant caller cannot switch into the repaired tenant').toBe(403);
      const foreignList = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(orgIds.join(','))}`,
        { token: foreignToken },
      );
      const foreignBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(foreignList);
      expect(foreignList.status(), 'a foreign-tenant caller cannot read the repaired organizations').toBe(403);
      expect(foreignBody?.items ?? []).toEqual([]);
    } finally {
      if (orgIds.length) {
        await withClient((client) =>
          client.query('update organizations set parent_id = null where id::text = any($1::text[])', [orgIds]),
        ).catch(() => undefined);
      }
      await deleteUserIfExists(request, token, userId);
      await deleteRoleIfExists(request, token, roleId);
      await deleteUserIfExists(request, token, foreignUserId);
      await deleteRoleIfExists(request, token, foreignRoleId);
      for (const id of [...orgIds].reverse()) {
        await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', id);
      }
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', bystanderId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', foreignOrgId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', foreignTenantId);
    }
  });

  test('undo waits for a concurrent reparent, refuses on the committed graph, and retries cleanly', async ({ request }) => {
    test.slow();
    let token: string | null = null;
    let parentId: string | null = null;
    let childId: string | null = null;
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;

    try {
      token = await getAuthToken(request, 'superadmin');
      const authToken = token;
      const { tenantId } = getTokenContext(authToken);
      const rootId = await createOrg(request, authToken, { name: `QA TC-DIR-021 Race A ${stamp}`, tenantId });
      parentId = rootId;
      const leafId = await createOrg(request, authToken, { name: `QA TC-DIR-021 Race B ${stamp}`, tenantId, parentId: rootId });
      childId = leafId;

      const detach = await setParent(request, authToken, tenantId, leafId, null);
      const detachOperation = expectOperation(detach, 'detaching B from A');

      const lockedUndoStatus = await withClient(async (client) => {
        await client.query('begin');
        try {
          await client.query('select id from tenants where id::text = $1 for update', [tenantId]);
          await client.query('update organizations set parent_id = $2::uuid where id::text = $1', [rootId, leafId]);
          const backend = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
          const lockHolderPid = backend.rows[0]!.pid;
          const undoPromise = undoByToken(request, authToken, detachOperation.undoToken);
          await expect
            .poll(
              async () => {
                const waiting = await withClient((probe) =>
                  probe.query<{ count: string }>(
                    'select count(*)::text as count from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
                    [lockHolderPid],
                  ),
                );
                return Number(waiting.rows[0]?.count ?? 0);
              },
              { message: 'the undo blocks on the tenant hierarchy lock held by the reparent', timeout: 30_000 },
            )
            .toBeGreaterThan(0);
          await client.query('commit');
          const undoResponse = await undoPromise;
          const body = await readJsonSafe<{ code?: string }>(undoResponse);
          return { status: undoResponse.status(), code: body?.code ?? null };
        } catch (error) {
          await client.query('rollback').catch(() => undefined);
          throw error;
        }
      });
      expect(lockedUndoStatus, 'the undo re-reads the committed reparent and refuses').toEqual({ status: 409, code: CYCLE_CODE });

      const afterRefusal = await expectStoredAcyclic([rootId, leafId]);
      expect(afterRefusal.get(leafId)?.parent_id, 'the refused undo wrote nothing to B').toBeNull();
      expect(afterRefusal.get(rootId)?.parent_id, 'the concurrent reparent stands').toBe(leafId);
      expect(await readActionLogState(detachOperation.logId), 'the refused undo does not consume its action log').toBe('done');

      await setParent(request, authToken, tenantId, rootId, null);
      const retry = await undoByToken(request, authToken, detachOperation.undoToken);
      expect(retry.status(), 'the same token succeeds once the obstruction is cleared').toBe(200);
      const afterRetry = await expectStoredAcyclic([rootId, leafId]);
      expect(afterRetry.get(leafId)?.parent_id, 'B is back under A').toBe(rootId);
      expect(afterRetry.get(rootId)?.parent_id).toBeNull();
      expect(await readActionLogState(detachOperation.logId)).toBe('undone');

      for (let round = 0; round < 4; round += 1) {
        const roundDetach = await setParent(request, authToken, tenantId, leafId, null);
        const roundOperation = expectOperation(roundDetach, `detaching B from A (round ${round})`);
        const [undoResponse, reparentResponse] = await Promise.all([
          undoByToken(request, authToken, roundOperation.undoToken),
          apiRequest(request, 'PUT', '/api/directory/organizations', {
            token: authToken,
            data: { id: rootId, tenantId, parentId: leafId },
          }),
        ]);
        const outcome = [undoResponse.status(), reparentResponse.status()];
        const stored = await expectStoredAcyclic([rootId, leafId]);
        if (undoResponse.status() === 200) {
          expect(outcome, `round ${round}: the reparent loses after the undo commits`).toEqual([200, 400]);
          expect(stored.get(leafId)?.parent_id).toBe(rootId);
          expect(stored.get(rootId)?.parent_id).toBeNull();
          continue;
        }
        expect(outcome, `round ${round}: the undo loses after the reparent commits`).toEqual([409, 200]);
        expect(stored.get(rootId)?.parent_id).toBe(leafId);
        expect(stored.get(leafId)?.parent_id).toBeNull();
        expect(await readActionLogState(roundOperation.logId)).toBe('done');
        await setParent(request, authToken, tenantId, rootId, null);
        const roundRetry = await undoByToken(request, authToken, roundOperation.undoToken);
        expect(roundRetry.status(), `round ${round}: the refused token succeeds once unobstructed`).toBe(200);
        const retried = await expectStoredAcyclic([rootId, leafId]);
        expect(retried.get(leafId)?.parent_id).toBe(rootId);
      }
    } finally {
      if (parentId && childId) {
        await withClient((client) =>
          client.query('update organizations set parent_id = null where id::text = any($1::text[])', [[parentId, childId]]),
        ).catch(() => undefined);
      }
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', childId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', parentId);
    }
  });
});
