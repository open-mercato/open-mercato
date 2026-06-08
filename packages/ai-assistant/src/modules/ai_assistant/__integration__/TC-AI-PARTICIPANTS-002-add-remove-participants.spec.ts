import { test, expect } from '@playwright/test';
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
 * TC-AI-PARTICIPANTS-002 — Conversation participants (add / list / remove).
 * Source: GitHub issue #2495.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/ai/conversations/{id}/participants            (POST, GET)
 *   - /api/ai_assistant/ai/conversations/{id}/participants/{userId}    (DELETE)
 *
 * Contract notes verified against the route handlers:
 *   - add requires `ai_assistant.conversations.share`; only the owner may add.
 *   - the only wire role is `viewer` (the owner row is implicit).
 *   - add returns 201 `{ participant: { userId, role, lastReadAt, addedAt } }`.
 *   - removing a participant returns 204; removing the OWNER is 403; a missing
 *     participant is 404 `participant_not_found`.
 *   - self-add is 400 `self_share_not_allowed`; a duplicate is 409
 *     `duplicate_participant`; a target in another org is 400 `user_not_found`.
 */

const CONVERSATIONS = '/api/ai_assistant/ai/conversations';

interface ParticipantRow {
  userId: string;
  role: string;
  lastReadAt: string | null;
  addedAt: string;
}

test.describe('TC-AI-PARTICIPANTS-002: Conversation participants', () => {
  test('add -> list -> remove lifecycle plus owner/duplicate/self/cross-org/RBAC guards', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId: orgAId, userId: ownerId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const password = 'Secret123!';
    const agentId = `it_part.agent_${stamp}`;
    const conversationId = `it-part-${randomUUID()}`;

    let roleId: string | null = null;
    let memberId: string | null = null;
    let foreignOrgId: string | null = null;
    let foreignUserId: string | null = null;
    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT Part Role ${stamp}` });
      // Member lives in the SAME org as the owner and carries only view -> valid
      // share target AND a deterministic "lacks conversations.share" caller.
      memberId = await createUserFixture(request, adminToken, {
        email: `it-part-member-${stamp}@example.com`,
        password,
        organizationId: orgAId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: memberId,
        features: ['ai_assistant.view'],
        organizations: [orgAId],
      });
      // Foreign user lives in another org -> cannot be shared into this conversation.
      foreignOrgId = await createOrganizationInDb({ name: `IT Part OrgB ${stamp}`, tenantId });
      foreignUserId = await createUserFixture(request, adminToken, {
        email: `it-part-foreign-${stamp}@example.com`,
        password,
        organizationId: foreignOrgId,
        roles: [roleId],
      });

      const createRes = await apiRequest(request, 'POST', CONVERSATIONS, {
        token: adminToken,
        data: { agentId, conversationId, title: 'Shareable conversation' },
      });
      expect(createRes.status()).toBe(201);

      const participantsPath = `${CONVERSATIONS}/${encodeURIComponent(conversationId)}/participants`;

      // Add member -> 201 viewer
      const addRes = await apiRequest(request, 'POST', participantsPath, {
        token: adminToken,
        data: { userId: memberId },
      });
      expect(addRes.status(), 'add participant returns 201').toBe(201);
      const added = await readJsonSafe<{ participant: ParticipantRow }>(addRes);
      expect(added?.participant.userId).toBe(memberId);
      expect(added?.participant.role).toBe('viewer');

      // List -> owner + member
      const listRes = await apiRequest(request, 'GET', participantsPath, { token: adminToken });
      expect(listRes.status()).toBe(200);
      const list = await readJsonSafe<{ ownerUserId: string; participants: ParticipantRow[] }>(listRes);
      expect(list?.ownerUserId).toBe(ownerId);
      expect(list?.participants.some((p) => p.userId === ownerId && p.role === 'owner')).toBe(true);
      expect(list?.participants.some((p) => p.userId === memberId && p.role === 'viewer')).toBe(true);

      // Self-add -> 400 self_share_not_allowed
      const selfAdd = await apiRequest(request, 'POST', participantsPath, {
        token: adminToken,
        data: { userId: ownerId },
      });
      expect(selfAdd.status()).toBe(400);
      expect((await readJsonSafe<{ code?: string }>(selfAdd))?.code).toBe('self_share_not_allowed');

      // Duplicate -> 409 duplicate_participant
      const dup = await apiRequest(request, 'POST', participantsPath, {
        token: adminToken,
        data: { userId: memberId },
      });
      expect(dup.status()).toBe(409);
      expect((await readJsonSafe<{ code?: string }>(dup))?.code).toBe('duplicate_participant');

      // Foreign-org target -> 400 user_not_found
      const foreign = await apiRequest(request, 'POST', participantsPath, {
        token: adminToken,
        data: { userId: foreignUserId },
      });
      expect(foreign.status()).toBe(400);
      expect((await readJsonSafe<{ code?: string }>(foreign))?.code).toBe('user_not_found');

      // Caller lacking conversations.share -> 403 (feature gate fires first)
      const memberToken = await getAuthToken(request, `it-part-member-${stamp}@example.com`, password);
      const denied = await apiRequest(request, 'POST', participantsPath, {
        token: memberToken,
        data: { userId: randomUUID() },
      });
      expect(denied.status(), 'caller without conversations.share is 403').toBe(403);

      // Remove the OWNER -> 403
      const removeOwner = await apiRequest(
        request,
        'DELETE',
        `${participantsPath}/${encodeURIComponent(ownerId)}`,
        { token: adminToken },
      );
      expect(removeOwner.status(), 'cannot revoke the owner').toBe(403);

      // Remove the member -> 204
      const removeMember = await apiRequest(
        request,
        'DELETE',
        `${participantsPath}/${encodeURIComponent(memberId)}`,
        { token: adminToken },
      );
      expect(removeMember.status(), 'revoke participant returns 204').toBe(204);

      // List -> member gone
      const listAfter = await apiRequest(request, 'GET', participantsPath, { token: adminToken });
      expect(listAfter.status()).toBe(200);
      const after = await readJsonSafe<{ participants: ParticipantRow[] }>(listAfter);
      expect(after?.participants.some((p) => p.userId === memberId)).toBe(false);

      // Remove again -> 404 participant_not_found
      const removeAgain = await apiRequest(
        request,
        'DELETE',
        `${participantsPath}/${encodeURIComponent(memberId)}`,
        { token: adminToken },
      );
      expect(removeAgain.status()).toBe(404);
      expect((await readJsonSafe<{ code?: string }>(removeAgain))?.code).toBe('participant_not_found');
    } finally {
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
      await deleteUserAclInDb(memberId ?? '').catch(() => undefined);
      await deleteUserIfExists(request, adminToken, memberId);
      await deleteUserIfExists(request, adminToken, foreignUserId);
      await deleteRoleIfExists(request, adminToken, roleId);
      await deleteOrganizationInDb(foreignOrgId).catch(() => undefined);
    }
  });
});
