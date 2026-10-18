import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
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

/**
 * TC-DIR-021: Undo refuses to restore a parent that would form a hierarchy cycle
 * Covers:
 * - POST /api/audit_logs/audit-logs/actions/undo for directory.organizations.update and directory.organizations.delete
 * - PUT /api/directory/organizations (reparent), DELETE /api/directory/organizations
 * - GET /api/directory/organizations?view=manage (tree fields stay acyclic)
 * - Last-operation banner Undo shows the translated refusal
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
});
