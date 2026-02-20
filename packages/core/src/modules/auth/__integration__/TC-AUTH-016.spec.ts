import { test, expect } from '@playwright/test';
import { postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AUTH-016: Rate Limiting on Authentication Endpoints
 *
 * API tests verifying that auth endpoints enforce rate limits and return
 * proper 429 responses with rate-limit headers when limits are exceeded.
 *
 * Default compound limits: login = 5 pts/60s, reset = 3 pts/60s.
 * Each test uses a unique email to avoid cross-test compound key pollution.
 */
test.describe('TC-AUTH-016: Rate Limiting on Authentication Endpoints', () => {
  const rateLimitHeaders = { 'x-om-test-rate-limit': 'on' };

  test('login rate limit — returns 429 after exceeding compound limit', async ({ request }) => {
    const email = `ratelimit-login-${Date.now()}@test.invalid`;
    const attempts = 6; // compound limit is 5
    let lastResponse;

    for (let i = 0; i < attempts; i++) {
      lastResponse = await postForm(request, '/api/auth/login', {
        email,
        password: 'wrong-password',
      }, { headers: rateLimitHeaders });
    }

    expect(lastResponse!.status()).toBe(429);

    const headers = lastResponse!.headers();
    expect(headers['retry-after']).toBeDefined();
    expect(headers['x-ratelimit-limit']).toBe('5');
    expect(headers['x-ratelimit-remaining']).toBe('0');

    const body = await lastResponse!.json();
    expect(body).toHaveProperty('error');
  });

  test('login rate limit — different emails get independent limits', async ({ request }) => {
    const emailA = `ratelimit-indep-a-${Date.now()}@test.invalid`;
    const emailB = `ratelimit-indep-b-${Date.now()}@test.invalid`;

    // Exhaust 5 attempts for email-A (at the compound limit)
    for (let i = 0; i < 5; i++) {
      await postForm(request, '/api/auth/login', {
        email: emailA,
        password: 'wrong-password',
      }, { headers: rateLimitHeaders });
    }

    // email-B should still be allowed (its own compound bucket is fresh)
    const responseB = await postForm(request, '/api/auth/login', {
      email: emailB,
      password: 'wrong-password',
    }, { headers: rateLimitHeaders });

    // email-B should get 401 (invalid credentials), not 429
    expect(responseB.status()).not.toBe(429);
  });

  test('password reset rate limit — returns 429 after exceeding compound limit', async ({ request }) => {
    const email = `ratelimit-reset-${Date.now()}@test.invalid`;
    const attempts = 4; // compound limit is 3
    let lastResponse;

    for (let i = 0; i < attempts; i++) {
      lastResponse = await postForm(request, '/api/auth/reset', {
        email,
      }, { headers: rateLimitHeaders });
    }

    expect(lastResponse!.status()).toBe(429);

    const headers = lastResponse!.headers();
    expect(headers['retry-after']).toBeDefined();
    expect(headers['x-ratelimit-limit']).toBe('3');
    expect(headers['x-ratelimit-remaining']).toBe('0');

    const body = await lastResponse!.json();
    expect(body).toHaveProperty('error');
  });

  test('login — successful login resets compound counter', async ({ request }) => {
    const { email, password } = DEFAULT_CREDENTIALS.admin;

    // Send 4 failed attempts (under the compound limit of 5)
    for (let i = 0; i < 4; i++) {
      await postForm(request, '/api/auth/login', {
        email,
        password: 'wrong-password',
      }, { headers: rateLimitHeaders });
    }

    // Successful login should reset the compound counter
    const successResponse = await postForm(request, '/api/auth/login', {
      email,
      password,
    }, { headers: rateLimitHeaders });
    expect(successResponse.status()).toBe(200);

    // After reset, another failed attempt should NOT be 429
    const postResetResponse = await postForm(request, '/api/auth/login', {
      email,
      password: 'wrong-password',
    }, { headers: rateLimitHeaders });
    expect(postResetResponse.status()).not.toBe(429);
  });
});
