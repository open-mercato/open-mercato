import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { submitTextExtraction, listInboxEmails, deleteInboxEmail } from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

test.describe('TC-INBOX-002: Inbox Ops Text Extract API', () => {
  let token: string;
  const createdEmailIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
  });

  test.afterAll(async ({ request }) => {
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test.describe('POST /api/inbox_ops/extract', () => {
    test('accepts text and returns emailId', async ({ request }) => {
      const result = await submitTextExtraction(request, token, {
        text: 'Hello, I would like to order 5 units of Widget Pro at $25 each. Best, John Doe <john@example.com>',
        title: 'TC-INBOX-002 test extraction',
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.emailId).toBeTruthy();
      expect(typeof result.emailId).toBe('string');
      if (result.emailId) createdEmailIds.push(result.emailId);
    });

    test('rejects empty text', async ({ request }) => {
      const response = await apiRequest(request, 'POST', '/api/inbox_ops/extract', {
        token,
        data: { text: '' },
      });

      expect(response.status()).toBe(400);
      const body = await readJsonSafe<{ error?: string }>(response);
      expect(body?.error).toBeTruthy();
    });

    test('rejects missing text field', async ({ request }) => {
      const response = await apiRequest(request, 'POST', '/api/inbox_ops/extract', {
        token,
        data: { title: 'no text' },
      });

      expect(response.status()).toBe(400);
    });

    test('rejects invalid JSON body', async ({ request }) => {
      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
      const response = await request.fetch(`${BASE_URL}/api/inbox_ops/extract`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: 'not json{{{',
      });

      expect(response.status()).toBe(400);
    });

    test('requires authentication', async ({ request }) => {
      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
      const response = await request.fetch(`${BASE_URL}/api/inbox_ops/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ text: 'test' }),
      });

      // Should be 401 or 403 without a valid token
      expect([401, 403]).toContain(response.status());
    });

    test('accepts optional title and metadata', async ({ request }) => {
      const customTitle = 'Custom title for extraction';
      const customMetadata = { source: 'integration_test', testId: 'TC-INBOX-002' };

      const result = await submitTextExtraction(request, token, {
        text: 'Please send a quote for 100 units of Part ABC-123.',
        title: customTitle,
        metadata: customMetadata,
      });

      expect(result.ok).toBe(true);
      expect(result.emailId).toBeTruthy();
      if (result.emailId) createdEmailIds.push(result.emailId);

      // Verify stored values by fetching the created email
      const fetchResponse = await apiRequest(request, 'GET', `/api/inbox_ops/emails/${result.emailId}`, { token });
      expect(fetchResponse.status()).toBe(200);
      const emailBody = await readJsonSafe<{ email?: { id?: string; subject?: string; metadata?: Record<string, unknown> } }>(fetchResponse);
      expect(emailBody).toBeDefined();
      expect(emailBody!.email!.id).toBe(result.emailId);
      if (emailBody!.email!.subject) {
        expect(emailBody!.email!.subject).toContain(customTitle);
      }
    });

    test('created email appears in emails list', async ({ request }) => {
      const result = await submitTextExtraction(request, token, {
        text: 'Order request: 3x Gizmo Standard at $15 each. Ship to 123 Main St.',
        title: `TC-INBOX-002 list check ${Date.now()}`,
      });

      expect(result.ok).toBe(true);
      expect(result.emailId).toBeTruthy();
      if (result.emailId) createdEmailIds.push(result.emailId);

      // The email should appear in the list
      const emails = await listInboxEmails(request, token, { pageSize: 50 });
      expect(emails.items.length).toBeGreaterThan(0);
      const found = emails.items.find((e) => e.id === result.emailId);
      expect(found).toBeTruthy();
    });
  });

  test.describe('GET /api/inbox_ops/emails', () => {
    test('returns paginated email list', async ({ request }) => {
      // Create a fixture so the list is never empty, even in a greenfield CI environment
      const fixture = await submitTextExtraction(request, token, {
        text: 'TC-INBOX-002 list fixture: Order 1x Widget.',
        title: 'TC-INBOX-002 list fixture',
      });
      if (fixture.emailId) createdEmailIds.push(fixture.emailId);

      const response = await apiRequest(request, 'GET', '/api/inbox_ops/emails?page=1&pageSize=10', { token });
      expect(response.status()).toBe(200);
      const body = await readJsonSafe<{ items?: Array<{ id?: string; status?: string }>; total?: number }>(response);
      expect(body).toBeDefined();
      expect(Array.isArray(body?.items)).toBe(true);
      expect(typeof body?.total).toBe('number');
      expect(body!.items!.length).toBeGreaterThan(0);

      const firstItem = body!.items![0];
      expect(firstItem.id).toBeTruthy();
      expect(typeof firstItem.id).toBe('string');
    });

    test('supports status filter', async ({ request }) => {
      const response = await apiRequest(request, 'GET', '/api/inbox_ops/emails?status=received&page=1&pageSize=10', { token });
      expect(response.status()).toBe(200);
      const body = await readJsonSafe<{ items?: Array<{ status?: string }> }>(response);
      if (body?.items && body.items.length > 0) {
        for (const item of body.items) {
          expect(item.status).toBe('received');
        }
      }
    });
  });
});
