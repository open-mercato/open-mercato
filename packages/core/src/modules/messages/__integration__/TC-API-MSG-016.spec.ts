import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  composeMessageWithToken,
  decodeJwtSubject,
  deleteMessageIfExists,
  replyToMessageWithToken,
} from './helpers';

/**
 * TC-API-MSG-016: Forward Preview and Body Truncation
 * Surface: packages/core/src/modules/messages/api/[id]/forward-preview/route.ts (GET)
 *
 * The forward preview returns { subject, body } where `body` is the rendered
 * forward block for the thread slice UP TO (and including) the selected
 * message — later replies are excluded. Only participants (sender/recipient)
 * can preview; others get 403. When the rendered body exceeds the forward
 * length cap (50k) the route returns 413.
 */
test.describe('TC-API-MSG-016: Forward Preview and Body Truncation', () => {
  test('should scope the preview to the selected slice and reject non-participants', async ({ request }) => {
    let rootId: string | null = null;
    let replyId: string | null = null;
    let adminToken: string | null = null;
    let superadminToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      superadminToken = await getAuthToken(request, 'superadmin');
      const employeeToken = await getAuthToken(request, 'employee');
      const superadminUserId = decodeJwtSubject(superadminToken);

      const timestamp = Date.now();
      const rootBody = `Root preview body ${timestamp}`;
      const replyBody = `Reply preview body ${timestamp}`;

      rootId = await composeMessageWithToken(request, adminToken, {
        recipients: [{ userId: superadminUserId, type: 'to' }],
        subject: `QA TC-API-MSG-016 ${timestamp}`,
        body: rootBody,
        sendViaEmail: false,
      });
      replyId = await replyToMessageWithToken(request, superadminToken, rootId, replyBody);

      // Previewing the reply (deepest node) includes the whole visible slice.
      const replyPreview = await apiRequest(request, 'GET', `/api/messages/${replyId}/forward-preview`, {
        token: adminToken,
      });
      expect(replyPreview.status()).toBe(200);
      const replyPreviewBody = (await replyPreview.json()) as { subject?: unknown; body?: unknown };
      expect(typeof replyPreviewBody.subject).toBe('string');
      expect(replyPreviewBody.subject as string).toMatch(/^Fwd:/i);
      expect(typeof replyPreviewBody.body).toBe('string');
      expect(replyPreviewBody.body as string).toContain(rootBody);
      expect(replyPreviewBody.body as string).toContain(replyBody);

      // Previewing the root excludes the later reply (slice up to selected message).
      const rootPreview = await apiRequest(request, 'GET', `/api/messages/${rootId}/forward-preview`, {
        token: adminToken,
      });
      expect(rootPreview.status()).toBe(200);
      const rootPreviewBody = (await rootPreview.json()) as { body?: unknown };
      expect(rootPreviewBody.body as string).toContain(rootBody);
      expect(rootPreviewBody.body as string).not.toContain(replyBody);

      // A non-participant (employee — same org, has messages.compose, but neither
      // sender nor recipient of this thread) is denied.
      const outsiderPreview = await apiRequest(request, 'GET', `/api/messages/${replyId}/forward-preview`, {
        token: employeeToken,
      });
      expect(outsiderPreview.status()).toBe(403);
    } finally {
      await deleteMessageIfExists(request, superadminToken, replyId);
      await deleteMessageIfExists(request, adminToken, rootId);
    }
  });

  test('should return 413 when the rendered forward body exceeds the length cap', async ({ request }) => {
    test.setTimeout(120_000);

    let rootId: string | null = null;
    let replyId: string | null = null;
    let adminToken: string | null = null;
    let employeeToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      employeeToken = await getAuthToken(request, 'employee');
      const employeeUserId = decodeJwtSubject(employeeToken);

      const timestamp = Date.now();
      // The per-message API validator allows 50k bodies; two 25k messages plus
      // the rendered forward headers deterministically exceed the 50k cap.
      const rootBody = 'A'.repeat(25_000);
      const replyBody = 'B'.repeat(25_000);

      rootId = await composeMessageWithToken(request, adminToken, {
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: `QA TC-API-MSG-016 oversized ${timestamp}`,
        body: rootBody,
        sendViaEmail: false,
      });
      replyId = await replyToMessageWithToken(request, employeeToken, rootId, replyBody);

      const preview = await apiRequest(request, 'GET', `/api/messages/${replyId}/forward-preview`, {
        token: adminToken,
      });
      expect(preview.status()).toBe(413);
      const previewBody = (await preview.json()) as { error?: unknown };
      expect(typeof previewBody.error).toBe('string');
    } finally {
      await deleteMessageIfExists(request, employeeToken, replyId);
      await deleteMessageIfExists(request, adminToken, rootId);
    }
  });
});
