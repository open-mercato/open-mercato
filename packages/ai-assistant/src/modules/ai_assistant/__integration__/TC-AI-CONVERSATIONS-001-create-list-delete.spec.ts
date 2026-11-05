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
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteConversationCascadeInDb } from './helpers/aiAssistantFixtures';

/**
 * TC-AI-CONVERSATIONS-001 — Conversation CRUD lifecycle (create, list, patch, delete).
 * Source: GitHub issue #2495.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/ai/conversations            (POST, GET)
 *   - /api/ai_assistant/ai/conversations/{id}        (PATCH, DELETE)
 *
 * Contract notes verified against the route handlers (not the issue's guesses):
 *   - create body field is `agentId` (required); response is a single serialized
 *     conversation with `conversationId/agentId/title/status/visibility/isOwner`.
 *   - re-creating the same `conversationId` is idempotent -> 200 (vs 201 first time).
 *   - DELETE is a SOFT delete returning 200 `{ ok: true }` (NOT 204).
 *   - item routes are scoped by tenant+organization+ownership; a caller in a
 *     different organization sees the row as absent -> 404 `conversation_not_found`
 *     (NOT 403).
 */

const CONVERSATIONS = '/api/ai_assistant/ai/conversations';

interface SerializedConversation {
  conversationId: string;
  agentId: string;
  title: string | null;
  status: string;
  visibility: string;
  isOwner: boolean | null;
  participantCount: number;
}

test.describe('TC-AI-CONVERSATIONS-001: Conversation CRUD lifecycle + org scoping', () => {
  test('create (idempotent) -> list -> patch -> soft-delete hides from list', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const agentId = `it_conv.agent_${randomUUID().slice(0, 8)}`;
    const conversationId = `it-conv-${randomUUID()}`;

    try {
      const createRes = await apiRequest(request, 'POST', CONVERSATIONS, {
        token: adminToken,
        data: { agentId, conversationId, title: 'Original title' },
      });
      expect(createRes.status(), 'create returns 201').toBe(201);
      const created = await readJsonSafe<SerializedConversation>(createRes);
      expect(created?.conversationId).toBe(conversationId);
      expect(created?.agentId).toBe(agentId);
      expect(created?.title).toBe('Original title');
      expect(created?.status).toBe('open');
      expect(created?.visibility).toBe('private');
      // `isOwner` is only enriched on the item GET (which passes callerUserId);
      // on the create/list responses it is intentionally null.
      expect(created?.isOwner).toBeNull();

      const recreate = await apiRequest(request, 'POST', CONVERSATIONS, {
        token: adminToken,
        data: { agentId, conversationId, title: 'Original title' },
      });
      expect(recreate.status(), 're-create with same id is idempotent (200)').toBe(200);

      // Item GET enriches ownership: the creator is the owner.
      const getItem = await apiRequest(
        request,
        'GET',
        `${CONVERSATIONS}/${encodeURIComponent(conversationId)}`,
        { token: adminToken },
      );
      expect(getItem.status()).toBe(200);
      const item = await readJsonSafe<{ conversation: SerializedConversation }>(getItem);
      expect(item?.conversation.conversationId).toBe(conversationId);
      expect(item?.conversation.isOwner).toBe(true);

      const listRes = await apiRequest(
        request,
        'GET',
        `${CONVERSATIONS}?agent=${encodeURIComponent(agentId)}`,
        { token: adminToken },
      );
      expect(listRes.status()).toBe(200);
      const list = await readJsonSafe<{ items: SerializedConversation[]; nextCursor: string | null }>(listRes);
      expect(Array.isArray(list?.items)).toBe(true);
      expect(list?.items.some((c) => c.conversationId === conversationId)).toBe(true);

      const patchRes = await apiRequest(
        request,
        'PATCH',
        `${CONVERSATIONS}/${encodeURIComponent(conversationId)}`,
        { token: adminToken, data: { title: 'Renamed title', status: 'closed' } },
      );
      expect(patchRes.status()).toBe(200);
      const patched = await readJsonSafe<SerializedConversation>(patchRes);
      expect(patched?.title).toBe('Renamed title');
      expect(patched?.status).toBe('closed');

      const delRes = await apiRequest(
        request,
        'DELETE',
        `${CONVERSATIONS}/${encodeURIComponent(conversationId)}`,
        { token: adminToken },
      );
      expect(delRes.status(), 'delete returns 200 (soft delete)').toBe(200);
      expect((await readJsonSafe<{ ok: boolean }>(delRes))?.ok).toBe(true);

      const listAfter = await apiRequest(
        request,
        'GET',
        `${CONVERSATIONS}?agent=${encodeURIComponent(agentId)}`,
        { token: adminToken },
      );
      expect(listAfter.status()).toBe(200);
      const listAfterBody = await readJsonSafe<{ items: SerializedConversation[] }>(listAfter);
      expect(listAfterBody?.items.some((c) => c.conversationId === conversationId)).toBe(false);
    } finally {
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
    }
  });

  test('validation + auth gates: missing agentId -> 400, unauthenticated -> 401', async ({ request, baseURL }) => {
    const adminToken = await getAuthToken(request, 'admin');

    const badCreate = await apiRequest(request, 'POST', CONVERSATIONS, {
      token: adminToken,
      data: { title: 'no agent id' },
    });
    expect(badCreate.status()).toBe(400);
    expect((await readJsonSafe<{ code?: string }>(badCreate))?.code).toBe('validation_error');

    const anon = await playwrightRequest.newContext({ baseURL });
    try {
      const res = await anon.fetch(CONVERSATIONS, { method: 'GET' });
      expect(res.status(), 'unauthenticated list is 401').toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('cross-org caller cannot GET/PATCH/DELETE another org conversation (404)', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const password = 'Secret123!';
    const agentId = `it_conv.xorg_${stamp}`;
    const conversationId = `it-conv-xorg-${randomUUID()}`;

    let orgBId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      orgBId = await createOrganizationInDb({ name: `IT Conv OrgB ${stamp}`, tenantId });
      roleId = await createRoleFixture(request, adminToken, { name: `IT Conv Role ${stamp}` });
      userId = await createUserFixture(request, adminToken, {
        email: `it-conv-${stamp}@example.com`,
        password,
        organizationId: orgBId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId,
        features: ['ai_assistant.view', 'ai_assistant.conversations.share'],
        organizations: [orgBId],
      });
      const otherToken = await getAuthToken(request, `it-conv-${stamp}@example.com`, password);
      expect(getTokenScope(otherToken).organizationId, 'fixture user is homed in org B').toBe(orgBId);

      const createRes = await apiRequest(request, 'POST', CONVERSATIONS, {
        token: adminToken,
        data: { agentId, conversationId, title: 'Org A private' },
      });
      expect(createRes.status()).toBe(201);

      const getRes = await apiRequest(
        request,
        'GET',
        `${CONVERSATIONS}/${encodeURIComponent(conversationId)}`,
        { token: otherToken },
      );
      expect(getRes.status(), 'cross-org GET is 404 (not 403)').toBe(404);
      expect((await readJsonSafe<{ code?: string }>(getRes))?.code).toBe('conversation_not_found');

      const patchRes = await apiRequest(
        request,
        'PATCH',
        `${CONVERSATIONS}/${encodeURIComponent(conversationId)}`,
        { token: otherToken, data: { title: 'hijack' } },
      );
      expect(patchRes.status(), 'cross-org PATCH is 404').toBe(404);

      const delRes = await apiRequest(
        request,
        'DELETE',
        `${CONVERSATIONS}/${encodeURIComponent(conversationId)}`,
        { token: otherToken },
      );
      expect(delRes.status(), 'cross-org DELETE is 404').toBe(404);
    } finally {
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
      await deleteUserAclInDb(userId ?? '').catch(() => undefined);
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
      await deleteOrganizationInDb(orgBId).catch(() => undefined);
    }
  });
});
