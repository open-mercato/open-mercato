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
 * TC-INBOX-007: Email Reprocess — retire active proposals and re-queue extraction
 * Source: GitHub issue #2479 (inbox_ops integration coverage)
 *
 * Reprocess retires the email's active proposals, resets its status to `received`,
 * and re-queues extraction. A second reprocess while queued is a 409 ("already
 * queued"); reprocess after an action was executed is a 409 ("cannot reprocess").
 * The not-found path runs without an LLM; the retire/guard paths are LLM-gated.
 */
test.describe('TC-INBOX-007: Email Reprocess', () => {
  const FAKE_ID = '00000000-0000-4000-8000-000000000000';
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

  test('returns 404 reprocessing a non-existent email', async ({ request }) => {
    const response = await apiRequest(request, 'POST', `/api/inbox_ops/emails/${FAKE_ID}/reprocess`, { token });
    expect(response.status()).toBe(404);
    const body = await readJsonSafe<{ error?: string }>(response);
    expect(body?.error ?? '').toMatch(/not found/i);
  });

  test('retires the active proposal and rejects an immediate second reprocess', async ({ request }) => {
    test.setTimeout(75000);

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Pierre Dubois <pierre@dubois-sarl.fr>',
        'Subject: Order PO-TC007A',
        '',
        'Bonjour,',
        'Please process:',
        '- 5x Valve Assembly VA-7 at $30.00 each',
        '',
        'Customer reference: PO-TC007A',
        '',
        'Cordialement,',
        'Pierre Dubois',
      ].join('\n'),
      title: 'TC-INBOX-007 retire fixture',
    });
    expect(result.ok).toBe(true);
    if (result.emailId) createdEmailIds.push(result.emailId);

    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    if (!processed || processed.status === 'failed' || !processed.proposalId) {
      test.skip(true, 'LLM extraction unavailable (no API key configured)');
      return;
    }
    const proposalId = processed.proposalId;

    // The proposal is active before reprocess.
    const before = await apiRequest(request, 'GET', `/api/inbox_ops/proposals/${proposalId}`, { token });
    expect(before.status()).toBe(200);

    const reprocess = await apiRequest(request, 'POST', `/api/inbox_ops/emails/${result.emailId}/reprocess`, { token });
    expect(reprocess.status()).toBe(200);
    const reprocessBody = await readJsonSafe<{ ok: boolean; retiredProposalCount: number; retiredActionCount: number }>(reprocess);
    expect(reprocessBody?.ok).toBe(true);
    expect(reprocessBody?.retiredProposalCount).toBeGreaterThanOrEqual(1);
    expect(typeof reprocessBody?.retiredActionCount).toBe('number');

    // The retired proposal is no longer active (detail lookup filters isActive).
    const after = await apiRequest(request, 'GET', `/api/inbox_ops/proposals/${proposalId}`, { token });
    expect(after.status()).toBe(404);

    // Reprocess set the email back to `received`; a back-to-back second call is rejected.
    const reprocessAgain = await apiRequest(request, 'POST', `/api/inbox_ops/emails/${result.emailId}/reprocess`, { token });
    expect(reprocessAgain.status()).toBe(409);
    const conflictBody = await readJsonSafe<{ error?: string }>(reprocessAgain);
    expect(conflictBody?.error ?? '').toMatch(/already queued/i);
  });

  test('refuses to reprocess once an action has been executed', async ({ request }) => {
    test.setTimeout(75000);

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Sofia Ramirez <sofia@ramirez-suministros.es>',
        'Subject: Order PO-TC007B',
        '',
        'Hola,',
        'Order request:',
        '- 9x Gasket GK-3 at $4.50 each',
        '',
        'Customer reference: PO-TC007B',
        '',
        'Saludos,',
        'Sofia Ramirez',
      ].join('\n'),
      title: 'TC-INBOX-007 executed-guard fixture',
    });
    expect(result.ok).toBe(true);
    if (result.emailId) createdEmailIds.push(result.emailId);

    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    if (!processed || processed.status === 'failed' || !processed.proposalId) {
      test.skip(true, 'LLM extraction unavailable (no API key configured)');
      return;
    }

    const detail = await fetchProposalDetail(request, token, processed.proposalId);
    const action = findPendingAction(detail?.actions ?? []);
    expect(action, 'proposal should expose at least one pending action').toBeTruthy();

    const accept = await apiRequest(
      request,
      'POST',
      `/api/inbox_ops/proposals/${processed.proposalId}/actions/${action!.id}/accept`,
      { token },
    );
    expect(accept.status()).toBe(200);

    const reprocess = await apiRequest(request, 'POST', `/api/inbox_ops/emails/${result.emailId}/reprocess`, { token });
    expect(reprocess.status()).toBe(409);
    const body = await readJsonSafe<{ error?: string }>(reprocess);
    expect(body?.error ?? '').toMatch(/cannot reprocess/i);
  });
});
