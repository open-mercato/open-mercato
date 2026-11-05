import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForEmailProcessed,
  deleteInboxEmail,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

/**
 * TC-INBOX-P2-002: Category filter in proposals list
 *
 * Verifies that the category query parameter correctly filters proposals
 * by their assigned category.
 */
test.describe('TC-INBOX-P2-002: Category Filter in Proposals List', () => {
  let token: string;
  let llmAvailable = true;
  const createdEmailIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90000);
    token = await getAuthToken(request, 'admin');

    // Create a fixture proposal — the extraction worker assigns a category
    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Hans Mueller <hans@mueller-gmbh.de>',
        'Subject: RFQ for 500 units of Industrial Bearings',
        '',
        'Dear Sales Team,',
        'We would like to request a quotation for:',
        '- 500x Industrial Bearing Model IB-200 at competitive pricing',
        '',
        'Please send the quote to hans@mueller-gmbh.de.',
        '',
        'Regards,',
        'Hans Mueller',
      ].join('\n'),
      title: 'TC-INBOX-P2-002 category filter fixture',
    });

    if (result.emailId) {
      createdEmailIds.push(result.emailId);
      const processed = await waitForEmailProcessed(request, token, result.emailId, 45000);
      if (!processed || processed.status === 'failed') {
        llmAvailable = false;
      }
    }
  });

  test.afterAll(async ({ request }) => {
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test('proposals list returns items without category filter', async ({ request }) => {
    test.skip(!llmAvailable, 'LLM extraction failed (no API key configured in CI)');

    const response = await apiRequest(
      request, 'GET', '/api/inbox_ops/proposals?pageSize=20', { token },
    );
    expect(response.status()).toBe(200);
    const body = await readJsonSafe<{ items: Array<{ id: string; category?: string | null }> }>(response);
    expect(body?.items).toBeTruthy();
    expect(body!.items.length).toBeGreaterThan(0);
  });

  test('proposals list filters by category query parameter', async ({ request }) => {
    test.skip(!llmAvailable, 'LLM extraction failed (no API key configured in CI)');

    // First, get all proposals to find out which categories exist
    const allResponse = await apiRequest(
      request, 'GET', '/api/inbox_ops/proposals?pageSize=50', { token },
    );
    expect(allResponse.status()).toBe(200);
    const allBody = await readJsonSafe<{ items: Array<{ id: string; category?: string | null }> }>(allResponse);
    const allItems = allBody?.items ?? [];

    // Find a category that has at least one proposal
    const categorizedItem = allItems.find((item) => item.category);
    if (!categorizedItem || !categorizedItem.category) {
      test.skip(true, 'No categorized proposals found to test filter');
      return;
    }

    const targetCategory = categorizedItem.category;

    // Filter by that category
    const filteredResponse = await apiRequest(
      request, 'GET', `/api/inbox_ops/proposals?category=${targetCategory}&pageSize=50`, { token },
    );
    expect(filteredResponse.status()).toBe(200);
    const filteredBody = await readJsonSafe<{ items: Array<{ id: string; category?: string | null }> }>(filteredResponse);
    expect(filteredBody?.items).toBeTruthy();
    expect(filteredBody!.items.length).toBeGreaterThan(0);

    // All returned items should have the target category
    for (const item of filteredBody!.items) {
      expect(item.category).toBe(targetCategory);
    }
  });

  test('counts endpoint includes byCategory breakdown', async ({ request }) => {
    const response = await apiRequest(
      request, 'GET', '/api/inbox_ops/proposals/counts', { token },
    );
    expect(response.status()).toBe(200);
    const body = await readJsonSafe<{
      pending: number;
      byCategory: Record<string, number>;
    }>(response);
    expect(body?.byCategory).toBeTruthy();
    expect(typeof body!.byCategory).toBe('object');

    // At least the standard categories should be present
    const expectedCategories = ['rfq', 'order', 'order_update', 'complaint', 'shipping_update', 'inquiry', 'payment', 'other'];
    for (const cat of expectedCategories) {
      expect(body!.byCategory).toHaveProperty(cat);
      expect(typeof body!.byCategory[cat]).toBe('number');
    }
  });
});
