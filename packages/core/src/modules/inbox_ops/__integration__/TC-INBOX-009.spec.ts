import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForEmailProcessed,
  deleteInboxEmail,
  fetchProposalDetail,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

/**
 * TC-INBOX-009: Translate proposal — language validation and cache behavior
 * Source: GitHub issue #2479 (inbox_ops integration coverage)
 *
 * Translate returns 404 for a missing proposal, 400 for an out-of-enum locale or a
 * same-language request, and caches results (cached=false then cached=true). The
 * not-found path runs without an LLM; validation needs a real proposal; the caching
 * happy-path additionally needs a configured translation provider.
 */
test.describe('TC-INBOX-009: Translate proposal', () => {
  const FAKE_ID = '00000000-0000-4000-8000-000000000000';
  const LOCALES = ['en', 'de', 'es', 'pl'];
  let token: string;
  let proposalId: string | null = null;
  let proposalLanguage = 'en';
  const createdEmailIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90000);
    token = await getAuthToken(request, 'admin');

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Henry Walker <henry@walker-supplies.co.uk>',
        'Subject: Order PO-TC009',
        '',
        'Hello,',
        'Please process this order:',
        '- 7x Filter Cartridge FC-5 at $11.00 each',
        '',
        'Customer reference: PO-TC009',
        '',
        'Regards,',
        'Henry Walker',
      ].join('\n'),
      title: 'TC-INBOX-009 translate fixture',
    });
    if (result.emailId) createdEmailIds.push(result.emailId);

    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    if (processed && processed.status !== 'failed' && processed.proposalId) {
      proposalId = processed.proposalId;
      const detail = await fetchProposalDetail(request, token, proposalId);
      proposalLanguage = detail?.workingLanguage || 'en';
    }
  });

  test.afterAll(async ({ request }) => {
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test('returns 404 translating a non-existent proposal', async ({ request }) => {
    const response = await apiRequest(request, 'POST', `/api/inbox_ops/proposals/${FAKE_ID}/translate`, {
      token,
      data: { targetLocale: 'de' },
    });
    expect(response.status()).toBe(404);
    const body = await readJsonSafe<{ error?: string }>(response);
    expect(body?.error ?? '').toMatch(/not found/i);
  });

  test('rejects an out-of-enum locale and a same-language request with 400', async ({ request }) => {
    test.skip(!proposalId, 'LLM extraction unavailable (no API key configured)');

    const invalidLocale = await apiRequest(request, 'POST', `/api/inbox_ops/proposals/${proposalId}/translate`, {
      token,
      data: { targetLocale: 'zz' },
    });
    expect(invalidLocale.status()).toBe(400);
    const invalidBody = await readJsonSafe<{ error?: string }>(invalidLocale);
    expect(invalidBody?.error ?? '').toMatch(/invalid request/i);

    // Same-language is only expressible when the proposal language is one of the
    // supported target locales (English fixtures resolve to "en").
    if (LOCALES.includes(proposalLanguage)) {
      const sameLanguage = await apiRequest(request, 'POST', `/api/inbox_ops/proposals/${proposalId}/translate`, {
        token,
        data: { targetLocale: proposalLanguage },
      });
      expect(sameLanguage.status()).toBe(400);
      const sameBody = await readJsonSafe<{ error?: string }>(sameLanguage);
      expect(sameBody?.error ?? '').toMatch(/already in the requested language/i);
    }
  });

  test('translates to a new locale and serves the cached result on repeat', async ({ request }) => {
    test.skip(!proposalId, 'LLM extraction unavailable (no API key configured)');

    const targetLocale = LOCALES.find((locale) => locale !== proposalLanguage)!;

    const first = await apiRequest(request, 'POST', `/api/inbox_ops/proposals/${proposalId}/translate`, {
      token,
      data: { targetLocale },
    });
    // The happy path additionally requires a translation provider; skip cleanly if absent.
    test.skip(first.status() !== 200, 'translation provider unavailable');

    const firstBody = await readJsonSafe<{ translation: { summary: string; actions: Record<string, string> }; cached: boolean }>(first);
    expect(firstBody?.cached).toBe(false);
    expect(firstBody?.translation?.summary).toBeTruthy();

    const second = await apiRequest(request, 'POST', `/api/inbox_ops/proposals/${proposalId}/translate`, {
      token,
      data: { targetLocale },
    });
    expect(second.status()).toBe(200);
    const secondBody = await readJsonSafe<{ translation: { summary: string }; cached: boolean }>(second);
    expect(secondBody?.cached).toBe(true);
    expect(secondBody?.translation?.summary).toBe(firstBody?.translation?.summary);
  });
});
