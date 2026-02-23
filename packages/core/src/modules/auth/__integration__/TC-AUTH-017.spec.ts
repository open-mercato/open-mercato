import { test, expect } from '@playwright/test';
import { postForm, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * TC-AUTH-017: Token Refresh for Mobile/API Clients
 *
 * Tests the token refresh flow for mobile and API clients:
 * - Login with remember=true returns refreshToken in response
 * - POST /api/auth/token/refresh accepts tokens via JSON body or cookie
 * - Refreshed accessToken can be used for authenticated API calls
 */
test.describe('TC-AUTH-017: Token Refresh for Mobile/API Clients', () => {
  test('login with remember=true returns refreshToken in response', async ({ request }) => {
    const { email, password } = DEFAULT_CREDENTIALS.admin;

    const response = await postForm(request, '/api/auth/login', {
      email,
      password,
      remember: '1',
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.accessToken).toBeDefined();
    expect(body.accessToken).toBe(body.token);
    expect(body.refreshToken).toBeDefined();
    expect(body.refreshToken.length).toBeGreaterThanOrEqual(32);
  });

  test('login without remember does not return refreshToken', async ({ request }) => {
    const { email, password } = DEFAULT_CREDENTIALS.admin;

    const response = await postForm(request, '/api/auth/login', {
      email,
      password,
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeUndefined();
  });

  test('refresh via JSON body returns new accessToken', async ({ request }) => {
    const { email, password } = DEFAULT_CREDENTIALS.admin;

    const loginResponse = await postForm(request, '/api/auth/login', {
      email,
      password,
      remember: '1',
    });
    const { refreshToken } = await loginResponse.json();

    const refreshResponse = await request.post(`${BASE_URL}/api/auth/token/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ refreshToken }),
    });

    expect(refreshResponse.status()).toBe(200);
    const body = await refreshResponse.json();
    expect(body.ok).toBe(true);
    expect(body.accessToken).toBeDefined();
    expect(body.expiresIn).toBe(28800);
  });

  test('refresh with invalid token returns 401', async ({ request }) => {
    const refreshResponse = await request.post(`${BASE_URL}/api/auth/token/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ refreshToken: 'invalid-token-that-does-not-exist' }),
    });

    expect(refreshResponse.status()).toBe(401);
    const body = await refreshResponse.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  test('refresh without token returns 400', async ({ request }) => {
    const refreshResponse = await request.post(`${BASE_URL}/api/auth/token/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({}),
    });

    expect(refreshResponse.status()).toBe(400);
    const body = await refreshResponse.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  test('refreshed accessToken can be used for authenticated API calls', async ({ request }) => {
    const { email, password } = DEFAULT_CREDENTIALS.admin;

    const loginResponse = await postForm(request, '/api/auth/login', {
      email,
      password,
      remember: '1',
    });
    const { refreshToken } = await loginResponse.json();

    const refreshResponse = await request.post(`${BASE_URL}/api/auth/token/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ refreshToken }),
    });
    const { accessToken } = await refreshResponse.json();

    const apiResponse = await apiRequest(request, 'GET', '/api/auth/features', {
      token: accessToken,
    });

    expect(apiResponse.status()).toBe(200);
  });
});
