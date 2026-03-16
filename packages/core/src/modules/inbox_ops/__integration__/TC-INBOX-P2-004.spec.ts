import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForEmailProcessed,
  deleteInboxEmail,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

/**
 * TC-INBOX-P2-004: Text submission via API -> extraction -> proposal
 *
 * Tests the POST /api/inbox_ops/extract endpoint specifically, verifying
 * that a raw text submission triggers extraction and creates a proposal
 * with correct metadata, category, and actions.
 */
test.describe('TC-INBOX-P2-004: Text Submission API Flow', () => {
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

  test('text submission with order content creates proposal with actions', async ({ request }) => {
    test.setTimeout(60000);

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Anna Kowalska <anna@kowalska-trading.pl>',
        'Subject: Order for Office Supplies',
        '',
        'Hi,',
        'I would like to place an order for:',
        '- 50x A4 Paper (500 sheets) at $8.00 each',
        '- 20x Ballpoint Pen Pack (10pc) at $12.00 each',
        '- 10x Desk Organizer at $25.00 each',
        '',
        'Please deliver to: ul. Marszalkowska 1, 00-001 Warszawa, Poland',
        'Our PO number: PL-TC004-2024',
        '',
        'Thank you,',
        'Anna Kowalska',
      ].join('\n'),
      title: 'TC-INBOX-P2-004 text submission test',
      metadata: { source: 'integration_test', testCase: 'TC-INBOX-P2-004' },
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBeTruthy();
    if (result.emailId) createdEmailIds.push(result.emailId);

    // Wait for extraction to complete
    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    expect(processed).toBeTruthy();

    if (processed!.status === 'failed') {
      test.skip(true, 'LLM extraction failed (no API key configured in CI)');
      return;
    }

    expect(['processed', 'needs_review']).toContain(processed!.status);

    // Verify proposal was created with expected structure
    expect(processed!.proposalId).toBeTruthy();
    const proposalResponse = await apiRequest(
      request, 'GET', `/api/inbox_ops/proposals/${processed!.proposalId}`, { token },
    );
    expect(proposalResponse.status()).toBe(200);
    const proposalBody = await readJsonSafe<{
      proposal: {
        id: string;
        summary: string;
        confidence: string;
        category: string | null;
        detectedLanguage: string | null;
        status: string;
        actions: Array<{
          id: string;
          actionType: string;
          status: string;
          description: string;
        }>;
      };
    }>(proposalResponse);

    expect(proposalBody?.proposal).toBeTruthy();
    const proposal = proposalBody!.proposal;

    // Summary should exist and describe the content
    expect(proposal.summary).toBeTruthy();
    expect(proposal.summary.length).toBeGreaterThan(5);

    // Confidence should be a numeric string
    expect(proposal.confidence).toBeTruthy();
    const confidence = Number.parseFloat(proposal.confidence);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);

    // Status should be pending (not yet accepted)
    expect(proposal.status).toBe('pending');

    // Should have at least one action (order or contact creation)
    expect(proposal.actions.length).toBeGreaterThan(0);

    // All actions should be in pending state
    for (const action of proposal.actions) {
      expect(action.status).toBe('pending');
      expect(action.actionType).toBeTruthy();
    }
  });

  test('text submission with metadata stores metadata on email', async ({ request }) => {
    test.setTimeout(60000);

    const customMetadata = { testRunId: `run-${Date.now()}`, origin: 'TC-INBOX-P2-004' };
    const result = await submitTextExtraction(request, token, {
      text: 'Simple inquiry: What products do you have in stock?',
      title: 'TC-INBOX-P2-004 metadata test',
      metadata: customMetadata,
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBeTruthy();
    if (result.emailId) createdEmailIds.push(result.emailId);

    // Verify the email record has metadata
    const emailResponse = await apiRequest(
      request, 'GET', `/api/inbox_ops/emails/${result.emailId}`, { token },
    );
    expect(emailResponse.status()).toBe(200);
    const emailBody = await readJsonSafe<{
      email: { id: string; metadata?: Record<string, unknown> };
    }>(emailResponse);
    expect(emailBody?.email).toBeTruthy();
    expect(emailBody!.email.metadata).toBeTruthy();
    expect(emailBody!.email.metadata!.origin).toBe('TC-INBOX-P2-004');
  });

  test('text submission with empty text returns 400', async ({ request }) => {
    const response = await apiRequest(request, 'POST', '/api/inbox_ops/extract', {
      token,
      data: { text: '', title: 'empty body test' },
    });
    expect(response.status()).toBe(400);
  });

  test('text submission without auth returns 401 or 403', async ({ request }) => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
    const response = await request.fetch(`${BASE_URL}/api/inbox_ops/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ text: 'test' }),
    });
    expect([401, 403]).toContain(response.status());
  });
});
