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
 * TC-INBOX-005: Edit Action Payload — PATCH before acceptance
 * Source: GitHub issue #2479 (inbox_ops integration coverage)
 *
 * PATCH deep-merges the supplied payload onto the action and re-validates it for
 * the action type. Validation (400) and not-found (404) are exercised without an
 * LLM (the body is validated before the action lookup); the merge/persist and the
 * edit-after-execute 409 guard run when extraction produces a real action.
 */
test.describe('TC-INBOX-005: Edit Action Payload', () => {
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

  test('rejects a malformed edit body with 400', async ({ request }) => {
    const response = await apiRequest(
      request,
      'PATCH',
      `/api/inbox_ops/proposals/${FAKE_ID}/actions/${FAKE_ID}`,
      { token, data: {} },
    );
    expect(response.status()).toBe(400);
    const body = await readJsonSafe<{ error?: string }>(response);
    expect(body?.error ?? '').toMatch(/invalid payload/i);
  });

  test('returns 404 when editing a non-existent action', async ({ request }) => {
    const response = await apiRequest(
      request,
      'PATCH',
      `/api/inbox_ops/proposals/${FAKE_ID}/actions/${FAKE_ID}`,
      { token, data: { payload: {} } },
    );
    expect(response.status()).toBe(404);
    const body = await readJsonSafe<{ error?: string }>(response);
    expect(body?.error ?? '').toMatch(/not found/i);
  });

  test('merges and persists a payload edit, then blocks editing after execution', async ({ request }) => {
    test.setTimeout(75000);

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Lena Schäfer <lena@schaefer-handel.de>',
        'Subject: Order PO-TC005',
        '',
        'Hello,',
        'Order request:',
        '- 6x Hinge Set HS-9 at $9.00 each',
        '',
        'Customer reference: PO-TC005',
        '',
        'Best,',
        'Lena Schäfer',
      ].join('\n'),
      title: 'TC-INBOX-005 edit fixture',
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
    const originalKeys = Object.keys(action!.payload ?? {});
    const actionPath = `/api/inbox_ops/proposals/${proposalId}/actions/${action!.id}`;

    // An unknown marker key survives the deep merge (action schemas are non-strict,
    // so it is stripped at validation time but persisted on the stored payload).
    const markerKey = '__tcInbox005Marker';
    const markerValue = `edited-${processed.proposalId}`;
    const editResponse = await apiRequest(request, 'PATCH', actionPath, {
      token,
      data: { payload: { [markerKey]: markerValue } },
    });
    expect(editResponse.status()).toBe(200);
    const editBody = await readJsonSafe<{ ok: boolean; action: { status: string; payload: Record<string, unknown> } }>(editResponse);
    expect(editBody?.ok).toBe(true);
    expect(editBody?.action?.status).toBe('pending');
    expect(editBody?.action?.payload?.[markerKey]).toBe(markerValue);
    // Existing payload keys are preserved by the merge.
    for (const key of originalKeys) {
      expect(editBody?.action?.payload).toHaveProperty(key);
    }

    // Edit persists across a fresh read.
    const afterEdit = await fetchProposalDetail(request, token, proposalId);
    const editedAction = afterEdit?.actions.find((candidate) => candidate.id === action!.id);
    expect(editedAction?.payload?.[markerKey]).toBe(markerValue);

    // The edited action still executes; afterwards a further edit is a 409.
    const acceptResponse = await apiRequest(request, 'POST', `${actionPath}/accept`, { token });
    expect(acceptResponse.status()).toBe(200);

    const editAfterAccept = await apiRequest(request, 'PATCH', actionPath, {
      token,
      data: { payload: { [markerKey]: 'second-edit' } },
    });
    expect(editAfterAccept.status()).toBe(409);
    const conflictBody = await readJsonSafe<{ error?: string }>(editAfterAccept);
    expect(conflictBody?.error ?? '').toMatch(/already processed/i);
  });
});
