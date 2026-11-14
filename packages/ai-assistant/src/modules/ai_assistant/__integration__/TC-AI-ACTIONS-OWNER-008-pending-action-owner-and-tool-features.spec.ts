import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  seedPendingActionInDb,
  deletePendingActionInDb,
  readPendingActionStateInDb,
  readCatalogProductTitleInDb,
} from './helpers/aiAssistantFixtures';

/**
 * TC-AI-ACTIONS-OWNER-008 — pending actions are resolvable only by their creator,
 * and confirm re-checks the tool's required features against the confirming user.
 * Source: GitHub issue #3806.
 *
 * Fixture: the shipped `catalog.merchandising_assistant` agent (requires
 * `catalog.products.view`, `confirm-required`) and its `catalog.update_product`
 * mutation tool (requires `catalog.products.manage`). Rows are seeded via SQL
 * because pending actions have no public create route.
 *
 * The action routes never consult conversations, so a same-organization user
 * who is not the creator stands in for a shared-conversation participant (the
 * participant learns the action id from the transcript; the route sees only
 * the id and the caller).
 */

const ACTIONS = '/api/ai_assistant/ai/actions';
const AGENT_ID = 'catalog.merchandising_assistant';
const TOOL_NAME = 'catalog.update_product';
const PASSWORD = 'Secret123!';

type Cleanup = () => Promise<void>;

async function createScopedUser(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  label: string,
  features: string[],
  cleanups: Cleanup[],
): Promise<{ userId: string; roleId: string; token: string }> {
  const stamp = randomUUID().slice(0, 8);
  const email = `it-owner-${label}-${stamp}@example.com`;
  const roleId = await createRoleFixture(request, adminToken, { name: `IT Owner ${label} ${stamp}` });
  cleanups.push(() => deleteRoleIfExists(request, adminToken, roleId));
  await setRoleAclFeatures(request, adminToken, { roleId, features, organizations: null });
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
  });
  cleanups.push(async () => {
    await deleteUserAclInDb(userId).catch(() => undefined);
    await deleteUserIfExists(request, adminToken, userId);
  });
  const token = await getAuthToken(request, email, PASSWORD);
  return { userId, roleId, token };
}

test.describe('TC-AI-ACTIONS-OWNER-008: pending action owner scope and tool feature recheck', () => {
  test('another user in the same organization cannot read, cancel or confirm a pending action', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const cleanups: Cleanup[] = [];
    try {
      const productId = await createProductFixture(request, adminToken, {
        title: `IT owner product ${randomUUID().slice(0, 8)}`,
        sku: `IT-OWN-${randomUUID().slice(0, 8)}`,
      });
      cleanups.push(() => deleteCatalogProductIfExists(request, adminToken, productId));
      const originalTitle = await readCatalogProductTitleInDb(productId);

      const row = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: adminId,
        agentId: AGENT_ID,
        toolName: TOOL_NAME,
        normalizedInput: { productId, title: 'Changed by another user' },
      });
      cleanups.push(() => deletePendingActionInDb(row.id));

      const other = await createScopedUser(request, adminToken, organizationId, 'other', [
        'ai_assistant.view',
        'catalog.products.view',
        'catalog.products.manage',
      ], cleanups);

      const read = await apiRequest(request, 'GET', `${ACTIONS}/${row.id}`, { token: other.token });
      expect(read.status(), 'non-owner GET is indistinguishable from an unknown id').toBe(404);
      expect((await readJsonSafe<{ code?: string }>(read))?.code).toBe('pending_action_not_found');

      const cancel = await apiRequest(request, 'POST', `${ACTIONS}/${row.id}/cancel`, {
        token: other.token,
        data: { reason: 'not mine' },
      });
      expect(cancel.status(), 'non-owner cancel is rejected').toBe(404);
      expect((await readJsonSafe<{ code?: string }>(cancel))?.code).toBe('pending_action_not_found');

      const confirm = await apiRequest(request, 'POST', `${ACTIONS}/${row.id}/confirm`, {
        token: other.token,
        data: {},
      });
      expect(confirm.status(), 'non-owner confirm is rejected').toBe(404);
      expect((await readJsonSafe<{ code?: string }>(confirm))?.code).toBe('pending_action_not_found');

      expect(await readPendingActionStateInDb(row.id)).toEqual({ status: 'pending', resolvedByUserId: null });
      expect(await readCatalogProductTitleInDb(productId)).toBe(originalTitle);

      const ownerRead = await apiRequest(request, 'GET', `${ACTIONS}/${row.id}`, { token: adminToken });
      expect(ownerRead.status(), 'the creator still reads their own action').toBe(200);
      const ownerCancel = await apiRequest(request, 'POST', `${ACTIONS}/${row.id}/cancel`, {
        token: adminToken,
        data: {},
      });
      expect(ownerCancel.status(), 'the creator still cancels their own action').toBe(200);
      expect(await readPendingActionStateInDb(row.id)).toEqual({ status: 'cancelled', resolvedByUserId: adminId });
    } finally {
      for (const cleanup of cleanups.reverse()) {
        await cleanup().catch(() => undefined);
      }
    }
  });

  test('confirm re-checks the tool features after they are revoked from the proposer', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId } = getTokenScope(adminToken);
    const cleanups: Cleanup[] = [];
    try {
      const productId = await createProductFixture(request, adminToken, {
        title: `IT feature product ${randomUUID().slice(0, 8)}`,
        sku: `IT-FEAT-${randomUUID().slice(0, 8)}`,
      });
      cleanups.push(() => deleteCatalogProductIfExists(request, adminToken, productId));
      const originalTitle = await readCatalogProductTitleInDb(productId);

      const viewer = await createScopedUser(request, adminToken, organizationId, 'revoked', [
        'ai_assistant.view',
        'catalog.products.view',
        'catalog.products.manage',
      ], cleanups);
      const viewerRow = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: viewer.userId,
        agentId: AGENT_ID,
        toolName: TOOL_NAME,
        normalizedInput: { productId, title: 'Changed without manage' },
      });
      cleanups.push(() => deletePendingActionInDb(viewerRow.id));

      await setRoleAclFeatures(request, adminToken, {
        roleId: viewer.roleId,
        features: ['ai_assistant.view', 'catalog.products.view'],
        organizations: null,
      });

      const denied = await apiRequest(request, 'POST', `${ACTIONS}/${viewerRow.id}/confirm`, {
        token: viewer.token,
        data: {},
      });
      expect(denied.status(), 'owner whose tool feature was revoked cannot confirm').toBe(403);
      expect((await readJsonSafe<{ code?: string }>(denied))?.code).toBe('tool_features_denied');

      const deniedPolish = await apiRequest(request, 'POST', `${ACTIONS}/${viewerRow.id}/confirm`, {
        token: viewer.token,
        data: {},
        headers: { 'Accept-Language': 'pl' },
      });
      expect(deniedPolish.status()).toBe(403);
      expect(await readJsonSafe<{ code?: string; error?: string }>(deniedPolish), 'the refusal is localized').toEqual({
        code: 'tool_features_denied',
        error: 'Brakuje Ci jednego z uprawnień wymaganych przez narzędzie: catalog.products.manage',
      });
      expect(await readCatalogProductTitleInDb(productId)).toBe(originalTitle);
      expect((await readPendingActionStateInDb(viewerRow.id))?.status).toBe('pending');

      const viewerCancel = await apiRequest(request, 'POST', `${ACTIONS}/${viewerRow.id}/cancel`, {
        token: viewer.token,
        data: {},
      });
      expect(viewerCancel.status(), 'owner without the tool feature can still cancel').toBe(200);

      const manager = await createScopedUser(request, adminToken, organizationId, 'manager', [
        'ai_assistant.view',
        'catalog.products.view',
        'catalog.products.manage',
      ], cleanups);
      const managerTitle = `Changed with manage ${randomUUID().slice(0, 8)}`;
      const managerRow = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: manager.userId,
        agentId: AGENT_ID,
        toolName: TOOL_NAME,
        normalizedInput: { productId, title: managerTitle },
      });
      cleanups.push(() => deletePendingActionInDb(managerRow.id));

      const confirmed = await apiRequest(request, 'POST', `${ACTIONS}/${managerRow.id}/confirm`, {
        token: manager.token,
        data: {},
      });
      expect(confirmed.status(), 'owner holding the tool feature confirms').toBe(200);
      const confirmedBody = await readJsonSafe<{ ok?: boolean; pendingAction?: { status?: string } }>(confirmed);
      expect(confirmedBody?.ok).toBe(true);
      expect(confirmedBody?.pendingAction?.status).toBe('confirmed');
      expect(await readCatalogProductTitleInDb(productId)).toBe(managerTitle);
    } finally {
      for (const cleanup of cleanups.reverse()) {
        await cleanup().catch(() => undefined);
      }
    }
  });
});
