import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { decodeJwtSubject, deleteMessageIfExists } from './helpers';

// A registered command id that no message/object type declares as an action,
// standing in for a composer-controlled confused-deputy attempt.
const UNDECLARED_COMMAND_ID = 'auth.users.delete';

type ComposeResponseBody = { id?: unknown };
type MessageDetailBody = {
  actionTaken?: unknown;
  actionData?: { actions?: Array<{ id?: unknown }> } | null;
};
type ActionResultBody = { ok?: unknown; error?: unknown; result?: { confirmed?: unknown } };

async function composeMessage(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/messages', { token, data });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as ComposeResponseBody;
  expect(typeof body.id).toBe('string');
  return body.id as string;
}

/**
 * TC-MSG-016: Message Action CommandId Allowlist Guard
 * Source: GitHub issue #3670 (follow-up from PR #3559, fixes #3488)
 *
 * Locks in the confused-deputy guard end-to-end: a composer-supplied action
 * whose `commandId` is not declared by any code-side message/object type is
 * refused with 403 before any terminal claim is reserved, while a legitimately
 * allowlisted action (`messages.confirmations.confirm`) still executes.
 */
test.describe('TC-MSG-016: Message Action CommandId Allowlist Guard', () => {
  test('should refuse an undeclared action commandId with 403 and still run a declared one', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const adminUserId = decodeJwtSubject(adminToken);
    const timestamp = Date.now();

    let maliciousMessageId: string | null = null;
    let confirmationMessageId: string | null = null;

    try {
      maliciousMessageId = await composeMessage(request, adminToken, {
        type: 'default',
        recipients: [{ userId: adminUserId, type: 'to' }],
        subject: `QA TC-MSG-016 malicious ${timestamp}`,
        body: 'Composer-controlled action carrying an undeclared command id',
        sendViaEmail: false,
        actionData: {
          actions: [
            {
              id: 'acknowledge',
              label: 'Acknowledge',
              commandId: UNDECLARED_COMMAND_ID,
              isTerminal: true,
            },
          ],
        },
      });

      confirmationMessageId = await composeMessage(request, adminToken, {
        type: 'messages.confirmation',
        recipients: [{ userId: adminUserId, type: 'to' }],
        subject: `QA TC-MSG-016 confirmation ${timestamp}`,
        body: 'Confirmation message relying on the allowlisted default action',
        sendViaEmail: false,
      });

      // Guard (the fix): the undeclared command id is refused with 403.
      const guardResponse = await apiRequest(
        request,
        'POST',
        `/api/messages/${maliciousMessageId}/actions/acknowledge`,
        { token: adminToken, data: {} },
      );
      expect(guardResponse.status()).toBe(403);
      const guardBody = (await guardResponse.json()) as ActionResultBody;
      expect(guardBody.error).toBe('Action command is not allowed');

      // The guard runs before the terminal claim, so the message is unmutated:
      // `actionTaken` stays null and the action is still present.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/messages/${maliciousMessageId}`,
        { token: adminToken },
      );
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as MessageDetailBody;
      expect(detailBody.actionTaken).toBeNull();
      const actionIds = (detailBody.actionData?.actions ?? []).map((entry) => entry.id);
      expect(actionIds).toContain('acknowledge');

      // No regression: the allowlisted confirmation action still executes.
      const confirmResponse = await apiRequest(
        request,
        'POST',
        `/api/messages/${confirmationMessageId}/actions/confirmation`,
        { token: adminToken, data: { confirmed: true } },
      );
      expect(confirmResponse.status()).toBe(200);
      const confirmBody = (await confirmResponse.json()) as ActionResultBody;
      expect(confirmBody.ok).toBe(true);
      expect(confirmBody.result?.confirmed).toBe(true);
    } finally {
      await deleteMessageIfExists(request, adminToken, maliciousMessageId);
      await deleteMessageIfExists(request, adminToken, confirmationMessageId);
    }
  });
});
