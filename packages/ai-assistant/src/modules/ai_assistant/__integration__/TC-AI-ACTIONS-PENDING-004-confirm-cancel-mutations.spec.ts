import { test, expect, request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  seedPendingActionInDb,
  deletePendingActionInDb,
  type SeedPendingActionInput,
} from './helpers/aiAssistantFixtures';

/**
 * TC-AI-ACTIONS-PENDING-004 — Pending action confirm/cancel (mutation-approval gate).
 * Source: GitHub issue #2495.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/ai/actions/{id}            (GET)
 *   - /api/ai_assistant/ai/actions/{id}/confirm     (POST)
 *   - /api/ai_assistant/ai/actions/{id}/cancel       (POST)
 *
 * Contract notes verified against the route handlers:
 *   - there is NO public route to CREATE a pending action (it is born only from
 *     the internal `prepareMutation` path), so rows are seeded directly via SQL.
 *   - GET strips `normalizedInput`, `createdByUserId`, `idempotencyKey`,
 *     `tenantId`, `organizationId` from the client serialization.
 *   - confirm/cancel are idempotent at the route layer; an already-terminal row
 *     short-circuits (200) rather than throwing.
 *   - cancelling an expired row -> 409 `expired`; confirming a cancelled row ->
 *     409 `invalid_status`; unknown id -> 404 `pending_action_not_found`.
 *   - all three require `ai_assistant.view`.
 *
 * The confirm HAPPY path is exercised via the terminal short-circuit (a seeded
 * `confirmed` row) so the test stays deterministic and provider-free — driving a
 * real `pending -> confirmed` transition would execute a live tool mutation that
 * depends on the agent/tool registry and an LLM-proposed payload.
 */

const ACTIONS = '/api/ai_assistant/ai/actions';

interface SerializedPendingAction {
  id: string;
  agentId: string;
  toolName: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  executionResult: unknown;
  normalizedInput?: unknown;
  createdByUserId?: unknown;
  idempotencyKey?: unknown;
  tenantId?: unknown;
  organizationId?: unknown;
}

test.describe('TC-AI-ACTIONS-PENDING-004: Pending action confirm/cancel', () => {
  test('GET serialization, cancel + confirm idempotency, and state-machine guards', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const seededIds: string[] = [];
    const seed = async (overrides: Partial<SeedPendingActionInput>) => {
      const row = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: adminId,
        ...overrides,
      });
      seededIds.push(row.id);
      return row;
    };

    try {
      // GET returns the client serialization with privileged fields stripped.
      const pending = await seed({ status: 'pending' });
      const getRes = await apiRequest(request, 'GET', `${ACTIONS}/${pending.id}`, { token: adminToken });
      expect(getRes.status()).toBe(200);
      const body = await readJsonSafe<SerializedPendingAction>(getRes);
      expect(body?.id).toBe(pending.id);
      expect(body?.status).toBe('pending');
      expect(typeof body?.agentId).toBe('string');
      expect(typeof body?.expiresAt).toBe('string');
      expect(body?.normalizedInput, 'normalizedInput is stripped').toBeUndefined();
      expect(body?.createdByUserId, 'createdByUserId is stripped').toBeUndefined();
      expect(body?.idempotencyKey, 'idempotencyKey is stripped').toBeUndefined();
      expect(body?.tenantId, 'tenantId is stripped').toBeUndefined();
      expect(body?.organizationId, 'organizationId is stripped').toBeUndefined();

      // Cancel happy path + idempotency.
      const cancelable = await seed({ status: 'pending' });
      const cancel = await apiRequest(request, 'POST', `${ACTIONS}/${cancelable.id}/cancel`, {
        token: adminToken,
        data: { reason: 'user_rejected' },
      });
      expect(cancel.status()).toBe(200);
      const cancelBody = await readJsonSafe<{ ok: boolean; pendingAction: SerializedPendingAction }>(cancel);
      expect(cancelBody?.ok).toBe(true);
      expect(cancelBody?.pendingAction.status).toBe('cancelled');

      const cancelAgain = await apiRequest(request, 'POST', `${ACTIONS}/${cancelable.id}/cancel`, {
        token: adminToken,
        data: {},
      });
      expect(cancelAgain.status(), 'cancel is idempotent').toBe(200);
      expect((await readJsonSafe<{ pendingAction: SerializedPendingAction }>(cancelAgain))?.pendingAction.status).toBe(
        'cancelled',
      );

      // Confirm happy path via the terminal short-circuit (seeded confirmed row).
      const confirmed = await seed({ status: 'confirmed', executionResult: { recordId: 'seeded-record' } });
      const confirm = await apiRequest(request, 'POST', `${ACTIONS}/${confirmed.id}/confirm`, {
        token: adminToken,
        data: {},
      });
      expect(confirm.status()).toBe(200);
      const confirmBody = await readJsonSafe<{ ok: boolean; pendingAction: SerializedPendingAction; mutationResult: unknown }>(
        confirm,
      );
      expect(confirmBody?.ok).toBe(true);
      expect(confirmBody?.pendingAction.status).toBe('confirmed');
      expect(confirmBody?.mutationResult).toEqual({ recordId: 'seeded-record' });

      // Confirming a cancelled row -> 409 invalid_status.
      const cancelledRow = await seed({ status: 'cancelled' });
      const confirmCancelled = await apiRequest(request, 'POST', `${ACTIONS}/${cancelledRow.id}/confirm`, {
        token: adminToken,
        data: {},
      });
      expect(confirmCancelled.status()).toBe(409);
      expect((await readJsonSafe<{ code?: string }>(confirmCancelled))?.code).toBe('invalid_status');

      // Cancelling an expired row -> 409 expired.
      const expiredRow = await seed({ status: 'pending', expiresInMinutes: -10 });
      const cancelExpired = await apiRequest(request, 'POST', `${ACTIONS}/${expiredRow.id}/cancel`, {
        token: adminToken,
        data: {},
      });
      expect(cancelExpired.status()).toBe(409);
      expect((await readJsonSafe<{ code?: string }>(cancelExpired))?.code).toBe('expired');

      // Unknown id -> 404; over-long id -> 400 validation_error.
      const notFound = await apiRequest(request, 'GET', `${ACTIONS}/${randomUUID()}`, { token: adminToken });
      expect(notFound.status()).toBe(404);
      expect((await readJsonSafe<{ code?: string }>(notFound))?.code).toBe('pending_action_not_found');

      const tooLong = await apiRequest(request, 'GET', `${ACTIONS}/${'a'.repeat(200)}`, { token: adminToken });
      expect(tooLong.status()).toBe(400);
      expect((await readJsonSafe<{ code?: string }>(tooLong))?.code).toBe('validation_error');
    } finally {
      for (const id of seededIds) {
        await deletePendingActionInDb(id).catch(() => undefined);
      }
    }
  });

  test('auth gates: unauthenticated 401 and missing ai_assistant.view 403', async ({ request, baseURL }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const password = 'Secret123!';

    let seededId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      const row = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: adminId,
        status: 'pending',
      });
      seededId = row.id;

      // Unauthenticated GET -> 401 (fresh context, no session cookie).
      const anon = await playwrightRequest.newContext({ baseURL });
      try {
        const res = await anon.fetch(`${ACTIONS}/${seededId}`, { method: 'GET' });
        expect(res.status()).toBe(401);
      } finally {
        await anon.dispose();
      }

      // Authenticated user lacking ai_assistant.view -> 403.
      roleId = await createRoleFixture(request, adminToken, { name: `IT Pending Role ${stamp}` });
      userId = await createUserFixture(request, adminToken, {
        email: `it-pending-${stamp}@example.com`,
        password,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, { userId, features: [], organizations: null });
      const viewlessToken = await getAuthToken(request, `it-pending-${stamp}@example.com`, password);
      const denied = await apiRequest(request, 'GET', `${ACTIONS}/${seededId}`, { token: viewlessToken });
      expect(denied.status(), 'caller without ai_assistant.view is 403').toBe(403);
    } finally {
      await deletePendingActionInDb(seededId).catch(() => undefined);
      await deleteUserAclInDb(userId ?? '').catch(() => undefined);
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
