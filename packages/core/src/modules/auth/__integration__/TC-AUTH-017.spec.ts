import { test, expect } from '@playwright/test';
import { postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * TC-AUTH-017: API Token Refresh Flow
 *
 * Tests the header-based token refresh for mobile/API clients:
 * - Login with remember=true returns refreshToken in response
 * - POST /api/auth/session/refresh accepts refreshToken in JSON body
 * - Returns new accessToken on success
 * - Returns proper errors for invalid/missing tokens
 */
test.describe('TC-AUTH-017: API Token Refresh Flow', () => {
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
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(typeof body.refreshToken).toBe('string');
    expect(body.refreshToken.length).toBeGreaterThan(0);
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
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeUndefined();
  });

  test('POST /api/auth/session/refresh returns new accessToken for valid refreshToken', async ({ request }) => {
    const { email, password } = DEFAULT_CREDENTIALS.admin;

    // First, login with remember=true to get a refresh token
    const loginResponse = await postForm(request, '/api/auth/login', {
      email,
      password,
      remember: '1',
    });
    expect(loginResponse.status()).toBe(200);
    const loginBody = await loginResponse.json();
    const refreshToken = loginBody.refreshToken;
    expect(refreshToken).toBeTruthy();

    // Now use the refresh token to get a new access token
    const refreshResponse = await request.post(`${BASE_URL}/api/auth/session/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ refreshToken }),
    });

    expect(refreshResponse.status()).toBe(200);
    const refreshBody = await refreshResponse.json();
    expect(refreshBody.ok).toBe(true);
    expect(refreshBody.accessToken).toBeTruthy();
    expect(typeof refreshBody.accessToken).toBe('string');
    expect(refreshBody.expiresIn).toBe(60 * 60 * 8); // 8 hours in seconds
  });

  test('POST /api/auth/session/refresh returns 400 for missing refreshToken', async ({ request }) => {
    const refreshResponse = await request.post(`${BASE_URL}/api/auth/session/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({}),
    });

    expect(refreshResponse.status()).toBe(400);
    const body = await refreshResponse.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  test('POST /api/auth/session/refresh returns 401 for invalid refreshToken', async ({ request }) => {
    const refreshResponse = await request.post(`${BASE_URL}/api/auth/session/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ refreshToken: 'invalid-token-that-does-not-exist' }),
    });

    expect(refreshResponse.status()).toBe(401);
    const body = await refreshResponse.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  test('POST /api/auth/session/refresh returns 400 for invalid JSON body', async ({ request }) => {
    const refreshResponse = await request.post(`${BASE_URL}/api/auth/session/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: 'not-valid-json',
    });

    expect(refreshResponse.status()).toBe(400);
    const body = await refreshResponse.json();
    expect(body.ok).toBe(false);
  });

  test('new accessToken from refresh can be used for authenticated requests', async ({ request }) => {
    const { email, password } = DEFAULT_CREDENTIALS.admin;

    // Login with remember=true
    const loginResponse = await postForm(request, '/api/auth/login', {
      email,
      password,
      remember: '1',
    });
    const { refreshToken } = await loginResponse.json();

    // Get new access token via refresh
    const refreshResponse = await request.post(`${BASE_URL}/api/auth/session/refresh`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ refreshToken }),
    });
    const { accessToken } = await refreshResponse.json();

    // Use the new access token for an authenticated API call
    const profileResponse = await request.get(`${BASE_URL}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(profileResponse.status()).toBe(200);
    const profile = await profileResponse.json();
    expect(profile.email).toBe(email);
  });
});
