import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteConversationCascadeInDb } from './helpers/aiAssistantFixtures';

/**
 * TC-AI-CONVERSATIONS-002 — Conversation list cursor pagination returns every row exactly once.
 *
 * Conversations without messages have a null `lastMessageAt` and sort first. Walking
 * `nextCursor` page by page must still reach every one of them, then the conversations
 * that do have messages.
 */

const CONVERSATIONS = '/api/ai_assistant/ai/conversations';

interface ListResponse {
  items: Array<{ conversationId: string }>;
  nextCursor: string | null;
}

test.describe('TC-AI-CONVERSATIONS-002: conversation list cursor pagination', () => {
  test('walking nextCursor with limit=1 returns every conversation exactly once', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const agentId = `it_conv.cursor_${randomUUID().slice(0, 8)}`;
    const created: string[] = [];

    try {
      const activeId = `it-conv-active-${randomUUID()}`;
      created.push(activeId);
      const importRes = await apiRequest(request, 'POST', `${CONVERSATIONS}/import`, {
        token: adminToken,
        data: {
          conversation: { conversationId: activeId, agentId },
          messages: [{ clientMessageId: `msg-${randomUUID()}`, role: 'user', content: 'hello' }],
        },
      });
      expect(importRes.status(), 'import with a message succeeds').toBe(200);

      const emptyIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const conversationId = `it-conv-empty-${index}-${randomUUID()}`;
        created.push(conversationId);
        const createRes = await apiRequest(request, 'POST', CONVERSATIONS, {
          token: adminToken,
          data: { agentId, conversationId },
        });
        expect(createRes.status(), 'create returns 201').toBe(201);
        emptyIds.push(conversationId);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const query = new URLSearchParams({ agent: agentId, limit: '1' });
        if (cursor) query.set('cursor', cursor);
        const listRes = await apiRequest(request, 'GET', `${CONVERSATIONS}?${query.toString()}`, {
          token: adminToken,
        });
        expect(listRes.status()).toBe(200);
        const body = await readJsonSafe<ListResponse>(listRes);
        seen.push(...(body?.items ?? []).map((item) => item.conversationId));
        cursor = body?.nextCursor ?? null;
        if (!cursor) break;
      }

      expect(seen).toEqual([...emptyIds].reverse().concat(activeId));
    } finally {
      for (const conversationId of created) {
        await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
      }
    }
  });
});
