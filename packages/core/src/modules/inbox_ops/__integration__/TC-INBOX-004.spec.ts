import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForEmailProcessed,
  deleteInboxEmail,
  fetchProposalDetail,
  findPendingAction,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

/**
 * TC-INBOX-004: Action Already Processed — 409 on retry accept/reject
 * Source: GitHub issue #2479 (inbox_ops integration coverage)
 *
 * Accepting an action is idempotency-guarded: a second accept, and a reject of
 * an already-executed action, both return 409 "Action already processed" and
 * leave the action in `executed` state. LLM-gated like the other proposal flows.
 */
test.describe('TC-INBOX-004: Action Already Processed (409)', () => {
  let token: string;
  const createdEmailIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90000);
    token = await getAuthToken(request, 'admin');
  });

  test.afterAll(async ({ request }) => {
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test('a processed action rejects repeated accept and reject with 409', async ({ request }) => {
    test.setTimeout(75000);

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Tomas Novak <tomas@novak-trade.cz>',
        'Subject: Order PO-TC004',
        '',
        'Hi,',
        'Please place this order:',
        '- 12x Cable Tie CT-200 at $3.50 each',
        '',
        'Customer reference: PO-TC004',
        '',
        'Regards,',
        'Tomas Novak',
      ].join('\n'),
      title: 'TC-INBOX-004 already-processed fixture',
    });

    expect(result.ok).toBe(true);
    if (result.emailId) createdEmailIds.push(result.emailId);

    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    if (!processed || processed.status === 'failed' || !processed.proposalId) {
      test.skip(true, 'LLM extraction unavailable (no API key configured)');
      return;
    }

    const proposalId = processed.proposalId;
    const detail = await fetchProposalDetail(request, token, proposalId);
    const action = findPendingAction(detail?.actions ?? []);
    expect(action, 'proposal should expose at least one pending action').toBeTruthy();
    const actionPath = `/api/inbox_ops/proposals/${proposalId}/actions/${action!.id}`;

    // First accept succeeds.
    const firstAccept = await apiRequest(request, 'POST', `${actionPath}/accept`, { token });
    expect(firstAccept.status()).toBe(200);
    const firstBody = await readJsonSafe<{ ok: boolean; action: { status: string } | null }>(firstAccept);
    expect(firstBody?.ok).toBe(true);
    expect(firstBody?.action?.status).toBe('executed');

    // Second accept of the same action is rejected as already processed.
    const secondAccept = await apiRequest(request, 'POST', `${actionPath}/accept`, { token });
    expect(secondAccept.status()).toBe(409);
    const secondBody = await readJsonSafe<{ error?: string }>(secondAccept);
    expect(secondBody?.error ?? '').toMatch(/already processed/i);

    // Rejecting an already-executed action is also a 409.
    const rejectAfterAccept = await apiRequest(request, 'POST', `${actionPath}/reject`, { token });
    expect(rejectAfterAccept.status()).toBe(409);
    const rejectBody = await readJsonSafe<{ error?: string }>(rejectAfterAccept);
    expect(rejectBody?.error ?? '').toMatch(/already processed/i);

    // The action remains executed — retries did not mutate it.
    const afterDetail = await fetchProposalDetail(request, token, proposalId);
    const afterAction = afterDetail?.actions.find((candidate) => candidate.id === action!.id);
    expect(afterAction?.status).toBe('executed');
  });
});
