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
 * TC-INBOX-003: Single Action Accept — API execution and entity creation
 * Source: GitHub issue #2479 (inbox_ops integration coverage)
 *
 * Accepting a pending action executes it in the target module: the action
 * transitions to `executed`, optionally records the created entity, and the
 * proposal status is recalculated. Asserts only invariants that hold across
 * LLM-derived action types (the concrete action set is non-deterministic).
 *
 * Extraction requires a configured LLM provider. When none is available the
 * worker marks the email `failed`; the execution assertions are then skipped,
 * matching the established TC-INBOX-P2-* pattern.
 */
test.describe('TC-INBOX-003: Single Action Accept', () => {
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

  test('accepting a pending action executes it and updates the proposal', async ({ request }) => {
    test.setTimeout(75000);

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Giulia Bianchi <giulia@bianchi-forniture.it>',
        'Subject: Order PO-TC003',
        '',
        'Hello,',
        'Please process this order:',
        '- 8x Steel Bracket SB-12 at $14.00 each',
        '- 4x Mounting Plate MP-30 at $22.00 each',
        '',
        'Customer reference: PO-TC003',
        'Ship to: Via Verdi 9, 20121 Milano, Italy',
        '',
        'Thanks,',
        'Giulia Bianchi',
      ].join('\n'),
      title: 'TC-INBOX-003 accept action fixture',
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBeTruthy();
    if (result.emailId) createdEmailIds.push(result.emailId);

    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    expect(processed).toBeTruthy();
    if (!processed || processed.status === 'failed' || !processed.proposalId) {
      test.skip(true, 'LLM extraction unavailable (no API key configured)');
      return;
    }

    const proposalId = processed.proposalId;
    const detail = await fetchProposalDetail(request, token, proposalId);
    expect(detail).toBeTruthy();
    const action = findPendingAction(detail!.actions);
    expect(action, 'proposal should expose at least one pending action').toBeTruthy();

    const acceptResponse = await apiRequest(
      request,
      'POST',
      `/api/inbox_ops/proposals/${proposalId}/actions/${action!.id}/accept`,
      { token },
    );
    expect(acceptResponse.status()).toBe(200);
    const acceptBody = await readJsonSafe<{
      ok: boolean;
      action: { id: string; status: string; createdEntityId: string | null; createdEntityType: string | null } | null;
      proposal: { id: string; status: string } | null;
    }>(acceptResponse);

    expect(acceptBody?.ok).toBe(true);
    expect(acceptBody?.action?.id).toBe(action!.id);
    expect(acceptBody?.action?.status).toBe('executed');
    // createdEntityId/createdEntityType depend on the action type; when set they must be non-empty.
    if (acceptBody?.action?.createdEntityId != null) {
      expect(typeof acceptBody.action.createdEntityId).toBe('string');
      expect(acceptBody.action.createdEntityId.length).toBeGreaterThan(0);
      expect(typeof acceptBody.action.createdEntityType).toBe('string');
      expect((acceptBody.action.createdEntityType as string).length).toBeGreaterThan(0);
    }
    // After a successful single-action accept the proposal is no longer fully pending.
    expect(['partial', 'accepted']).toContain(acceptBody?.proposal?.status);

    // The undo header is present only for command-backed actions; assert shape when present.
    const operationHeader = acceptResponse.headers()['x-om-operation'];
    if (operationHeader) {
      expect(operationHeader.length).toBeGreaterThan(0);
    }

    // Re-read the proposal: the accepted action is now executed.
    const afterDetail = await fetchProposalDetail(request, token, proposalId);
    expect(afterDetail).toBeTruthy();
    const afterAction = afterDetail!.actions.find((candidate) => candidate.id === action!.id);
    expect(afterAction?.status).toBe('executed');

    // Counts endpoint remains well-formed after acceptance (no global delta assertions —
    // counts are tenant-wide and other parallel specs mutate them).
    const countsResponse = await apiRequest(request, 'GET', '/api/inbox_ops/proposals/counts', { token });
    expect(countsResponse.status()).toBe(200);
    const counts = await readJsonSafe<{ pending: number; accepted: number; partial: number; rejected: number }>(countsResponse);
    expect(typeof counts?.pending).toBe('number');
    expect(typeof counts?.accepted).toBe('number');
  });
});
