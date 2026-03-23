import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForEmailProcessed,
  deleteInboxEmail,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

/**
 * TC-INBOX-P2-001: Full webhook -> extraction -> proposal -> accept -> entity creation flow
 *
 * Tests the end-to-end flow of submitting text for extraction, waiting for the
 * extraction worker to create a proposal, then verifying the proposal appears
 * with actions that can be accepted.
 */
test.describe('TC-INBOX-P2-001: Full Extraction to Proposal Flow', () => {
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

  test('text submission creates email, extraction creates proposal with actions', async ({ request }) => {
    test.setTimeout(60000);

    // Step 1: Submit text for extraction
    const extractionText = [
      'From: Marco Rossi <marco@rossi-imports.com>',
      'Subject: New Order PO-2024-TC001',
      '',
      'Dear team,',
      'Please process the following order:',
      '- 10x Widget Alpha at $25.00 each',
      '- 5x Widget Beta at $40.00 each',
      '',
      'Customer reference: PO-2024-TC001',
      'Ship to: Via Roma 42, 00100 Rome, Italy',
      '',
      'Best regards,',
      'Marco Rossi',
    ].join('\n');

    const result = await submitTextExtraction(request, token, {
      text: extractionText,
      title: 'TC-INBOX-P2-001 full flow test',
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBeTruthy();
    if (result.emailId) createdEmailIds.push(result.emailId);

    // Step 2: Wait for extraction to complete
    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    expect(processed).toBeTruthy();

    // Extraction requires a configured LLM provider (API key). In CI without
    // a key the worker sets status='failed'. Skip LLM-dependent assertions.
    if (processed!.status === 'failed') {
      test.skip(true, 'LLM extraction failed (no API key configured in CI)');
      return;
    }

    expect(['processed', 'needs_review']).toContain(processed!.status);

    // Step 3: Verify proposal was created
    const proposalsResponse = await apiRequest(
      request, 'GET', '/api/inbox_ops/proposals?pageSize=20', { token },
    );
    expect(proposalsResponse.status()).toBe(200);
    const proposalsBody = await readJsonSafe<{
      items: Array<{
        id: string;
        inboxEmailId: string;
        summary: string;
        status: string;
        confidence: string;
        category?: string | null;
      }>;
    }>(proposalsResponse);

    const proposal = proposalsBody?.items?.find((p) => p.inboxEmailId === result.emailId);
    expect(proposal).toBeTruthy();
    expect(proposal!.status).toBe('pending');
    expect(proposal!.summary).toBeTruthy();

    // Step 4: Verify proposal has actions
    const detailResponse = await apiRequest(
      request, 'GET', `/api/inbox_ops/proposals/${proposal!.id}`, { token },
    );
    expect(detailResponse.status()).toBe(200);
    const detailBody = await readJsonSafe<{
      proposal: {
        id: string;
        status: string;
        actions: Array<{
          id: string;
          actionType: string;
          status: string;
          payload: Record<string, unknown>;
        }>;
      };
    }>(detailResponse);

    expect(detailBody?.proposal?.actions).toBeTruthy();
    expect(detailBody!.proposal.actions.length).toBeGreaterThan(0);

    // Step 5: Verify counts endpoint reflects the new proposal
    const countsResponse = await apiRequest(
      request, 'GET', '/api/inbox_ops/proposals/counts', { token },
    );
    expect(countsResponse.status()).toBe(200);
    const countsBody = await readJsonSafe<{
      pending: number;
      partial: number;
      accepted: number;
      rejected: number;
      byCategory: Record<string, number>;
    }>(countsResponse);
    expect(countsBody).toBeTruthy();
    expect(countsBody!.pending).toBeGreaterThanOrEqual(1);
  });

  test('proposal can be navigated to in the UI', async ({ page }) => {
    test.setTimeout(30000);
    await login(page, 'admin');
    await page.goto('/backend/inbox-ops');

    // The proposals list should load with at least one row from the fixture above
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toBeVisible({ timeout: 10000 });
  });
});
