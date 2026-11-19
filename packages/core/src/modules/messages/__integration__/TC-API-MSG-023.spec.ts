import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteMessageIfExists } from './helpers';

type ParticipantRow = { role: string; email: string; deliveryStatus: string | null };

/**
 * TC-API-MSG-023: Search by any outbound external recipient
 * A public message composed with several `externalEmails` stores every address as a
 * participant; `GET /api/messages?externalEmail=` must find it by the 2nd address,
 * not only by the first one kept in `external_email`.
 */
test.describe('TC-API-MSG-023: Search messages by a second outbound recipient', () => {
  test('finds the message by its 2nd "to" address and exposes all participants on detail', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const firstEmail = `tc-api-msg-023-first-${stamp}@example.com`;
    const secondEmail = `tc-api-msg-023-second-${stamp}@example.com`;
    let messageId: string | null = null;

    try {
      const composeResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          visibility: 'public',
          externalEmails: [firstEmail, secondEmail],
          recipients: [],
          subject: `QA TC-API-MSG-023 ${stamp}`,
          body: 'Multiple external recipients',
        },
      });
      expect(composeResponse.status()).toBe(201);
      const composed = (await composeResponse.json()) as { id?: unknown };
      expect(typeof composed.id).toBe('string');
      messageId = composed.id as string;

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=sent&externalEmail=${encodeURIComponent(secondEmail)}`,
        { token: adminToken },
      );
      expect(listResponse.status()).toBe(200);
      const list = (await listResponse.json()) as { items: Array<{ id: string; externalEmail: string | null }> };
      const found = list.items.find((item) => item.id === messageId);
      expect(found).toBeDefined();
      expect(found?.externalEmail).toBe(firstEmail);

      const unrelatedResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=sent&externalEmail=${encodeURIComponent(`tc-api-msg-023-none-${stamp}@example.com`)}`,
        { token: adminToken },
      );
      expect(unrelatedResponse.status()).toBe(200);
      const unrelated = (await unrelatedResponse.json()) as { items: Array<{ id: string }> };
      expect(unrelated.items.some((item) => item.id === messageId)).toBe(false);

      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${encodeURIComponent(messageId)}`, {
        token: adminToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detail = (await detailResponse.json()) as {
        emailSendSeparately?: boolean;
        externalParticipants?: ParticipantRow[];
      };
      expect(detail.emailSendSeparately).toBe(false);
      const participants = detail.externalParticipants ?? [];
      expect(participants.map((participant) => participant.email).sort()).toEqual([firstEmail, secondEmail].sort());
      expect(participants.every((participant) => participant.role === 'to')).toBe(true);
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
