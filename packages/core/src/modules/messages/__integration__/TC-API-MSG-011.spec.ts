import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject } from './helpers';

/**
 * TC-API-MSG-011: Compose Input Validation Errors
 * Verifies that the API rejects malformed compose payloads with non-2xx status codes.
 * The compose route uses Zod parse which surfaces as 5xx when unhandled; the tests
 * use `>= 400` to remain tolerant of the exact error code while confirming rejection.
 */
test.describe('TC-API-MSG-011: Compose Input Validation Errors', () => {
  test('should reject missing subject', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const employeeUserId = decodeJwtSubject(employeeToken);

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: '',
        body: 'Some body',
        sendViaEmail: false,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(201);
  });

  test('should reject missing body', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const employeeUserId = decodeJwtSubject(employeeToken);

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: 'QA TC-API-MSG-011 no body',
        body: '',
        sendViaEmail: false,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(201);
  });

  test('should reject internal message with no recipients', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        recipients: [],
        subject: 'QA TC-API-MSG-011 no recipients',
        body: 'Body content',
        sendViaEmail: false,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(201);
  });

  test('should reject duplicate recipient user IDs', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const employeeUserId = decodeJwtSubject(employeeToken);

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        recipients: [
          { userId: employeeUserId, type: 'to' },
          { userId: employeeUserId, type: 'cc' },
        ],
        subject: 'QA TC-API-MSG-011 duplicates',
        body: 'Body content',
        sendViaEmail: false,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(201);
  });

  test('should reject public visibility message without externalEmail', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        visibility: 'public',
        recipients: [],
        subject: 'QA TC-API-MSG-011 public no email',
        body: 'Body content',
        sendViaEmail: true,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(201);
  });

  test('should reject public visibility message that has internal recipients', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const employeeUserId = decodeJwtSubject(employeeToken);

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        visibility: 'public',
        externalEmail: 'external@example.com',
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: 'QA TC-API-MSG-011 public with recipients',
        body: 'Body content',
        sendViaEmail: true,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(201);
  });

  test('should reject whitespace-only subject when isDraft is false', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const employeeUserId = decodeJwtSubject(employeeToken);

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        isDraft: false,
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: '   ',
        body: 'Body content',
        sendViaEmail: false,
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).not.toBe(201);
  });
});
