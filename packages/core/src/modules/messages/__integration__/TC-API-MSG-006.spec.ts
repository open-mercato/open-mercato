import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject, deleteMessageIfExists, uploadAttachmentToMessage } from './helpers';

test.describe('TC-API-MSG-006: Thread-Aware Forward Preview And Body Precedence', () => {
  test('should include only thread history up to selected message and persist explicit body', async ({ request }) => {
    let rootMessageId: string | null = null;
    let secondMessageId: string | null = null;
    let thirdMessageId: string | null = null;
    let legacyForwardId: string | null = null;
    let forwardedMessageId: string | null = null;
    let adminToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const employeeToken = await getAuthToken(request, 'employee');
      const adminUserId = decodeJwtSubject(adminToken);
      const employeeUserId = decodeJwtSubject(employeeToken);

      const timestamp = Date.now();
      const rootSubject = `QA TC-API-MSG-006 ${timestamp}`;
      const bodyOne = `Thread body one ${timestamp}`;
      const bodyTwo = `Thread body two ${timestamp}`;
      const bodyThree = `Thread body three ${timestamp}`;
      const rootAttachmentName = `tc-api-msg-006-root-${timestamp}.txt`;
      const middleAttachmentName = `tc-api-msg-006-middle-${timestamp}.txt`;
      const futureAttachmentName = `tc-api-msg-006-future-${timestamp}.txt`;

      const rootResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: rootSubject,
          body: bodyOne,
          sendViaEmail: false,
        },
      });
      expect(rootResponse.status()).toBe(201);
      const rootPayload = (await rootResponse.json()) as { id?: unknown };
      expect(typeof rootPayload.id).toBe('string');
      rootMessageId = rootPayload.id as string;

      const secondResponse = await apiRequest(request, 'POST', `/api/messages/${rootMessageId}/reply`, {
        token: employeeToken,
        data: {
          body: bodyTwo,
          sendViaEmail: false,
        },
      });
      expect(secondResponse.status()).toBe(201);
      const secondPayload = (await secondResponse.json()) as { id?: unknown };
      expect(typeof secondPayload.id).toBe('string');
      secondMessageId = secondPayload.id as string;

      const thirdResponse = await apiRequest(request, 'POST', `/api/messages/${secondMessageId}/reply`, {
        token: adminToken,
        data: {
          body: bodyThree,
          sendViaEmail: false,
        },
      });
      expect(thirdResponse.status()).toBe(201);
      const thirdPayload = (await thirdResponse.json()) as { id?: unknown };
      expect(typeof thirdPayload.id).toBe('string');
      thirdMessageId = thirdPayload.id as string;

      await uploadAttachmentToMessage(request, adminToken, rootMessageId, { fileName: rootAttachmentName });
      await uploadAttachmentToMessage(request, employeeToken, secondMessageId, { fileName: middleAttachmentName });
      await uploadAttachmentToMessage(request, adminToken, thirdMessageId, { fileName: futureAttachmentName });

      const legacyForwardResponse = await apiRequest(request, 'POST', `/api/messages/${secondMessageId}/forward`, {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          additionalBody: 'Legacy prefix',
          includeAttachments: false,
          sendViaEmail: false,
        },
      });
      expect(legacyForwardResponse.status()).toBe(201);
      const legacyForwardPayload = (await legacyForwardResponse.json()) as { id?: unknown };
      expect(typeof legacyForwardPayload.id).toBe('string');
      legacyForwardId = legacyForwardPayload.id as string;

      const legacyForwardDetailResponse = await apiRequest(request, 'GET', `/api/messages/${legacyForwardId}`, {
        token: employeeToken,
      });
      expect(legacyForwardDetailResponse.status()).toBe(200);
      const legacyForwardDetail = (await legacyForwardDetailResponse.json()) as { body?: unknown };
      expect(typeof legacyForwardDetail.body).toBe('string');
      expect(legacyForwardDetail.body as string).toContain('Legacy prefix');
      expect(legacyForwardDetail.body as string).toContain(bodyTwo);
      expect(legacyForwardDetail.body as string).not.toContain(bodyThree);
      expect(legacyForwardDetail.body as string).not.toContain(thirdMessageId);

      const explicitBody = `Explicit forwarded body ${timestamp}`;
      const forwardResponse = await apiRequest(request, 'POST', `/api/messages/${secondMessageId}/forward`, {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          body: explicitBody,
          additionalBody: 'legacy note should be ignored',
          includeAttachments: true,
          sendViaEmail: false,
        },
      });
      expect(forwardResponse.status()).toBe(201);
      const forwardPayload = (await forwardResponse.json()) as { id?: unknown };
      expect(typeof forwardPayload.id).toBe('string');
      forwardedMessageId = forwardPayload.id as string;

      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${forwardedMessageId}`, {
        token: employeeToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as { body?: unknown; recipients?: Array<{ userId?: unknown }> };
      expect(detailBody.body).toBe(explicitBody);
      expect((detailBody.recipients ?? []).some((recipient) => recipient.userId === employeeUserId)).toBeTruthy();

      const forwardedAttachmentsResponse = await apiRequest(
        request,
        'GET',
        `/api/messages/${forwardedMessageId}/attachments`,
        { token: employeeToken },
      );
      expect(forwardedAttachmentsResponse.status()).toBe(200);
      const forwardedAttachmentsBody = (await forwardedAttachmentsResponse.json()) as {
        attachments?: Array<{ fileName?: unknown }>;
      };
      const forwardedAttachmentNames = new Set(
        (forwardedAttachmentsBody.attachments ?? [])
          .map((item) => item.fileName)
          .filter((name): name is string => typeof name === 'string'),
      );
      expect(forwardedAttachmentNames.has(rootAttachmentName)).toBeTruthy();
      expect(forwardedAttachmentNames.has(middleAttachmentName)).toBeTruthy();
      expect(forwardedAttachmentNames.has(futureAttachmentName)).toBeFalsy();

      const adminInboxResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=sent&search=${encodeURIComponent(rootSubject)}&pageSize=100`,
        { token: adminToken },
      );
      expect(adminInboxResponse.ok()).toBeTruthy();
      const adminSentBody = (await adminInboxResponse.json()) as {
        items?: Array<{ id?: unknown; senderUserId?: unknown }>;
      };
      const sentIds = (adminSentBody.items ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string');
      expect(sentIds).toContain(forwardedMessageId);
      expect((adminSentBody.items ?? []).some((item) => item.senderUserId === adminUserId)).toBeTruthy();
    } finally {
      await deleteMessageIfExists(request, adminToken, forwardedMessageId);
      await deleteMessageIfExists(request, adminToken, legacyForwardId);
      await deleteMessageIfExists(request, adminToken, thirdMessageId);
      await deleteMessageIfExists(request, adminToken, secondMessageId);
      await deleteMessageIfExists(request, adminToken, rootMessageId);
    }
  });
});
