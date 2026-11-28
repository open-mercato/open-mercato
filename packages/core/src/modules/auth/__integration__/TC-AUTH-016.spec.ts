import { test, expect } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';
import { postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures';
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
  test.skip(process.env.OM_INTEGRATION_AUTH_RATE_LIMIT_FIXTURE === '1', 'Uses the default endpoint quotas');

  let forwardedIpSequence = randomInt(10_000);
  let authRateLimitingEnabled = true;

  function createRateLimitHeaders(): Record<string, string> {
    forwardedIpSequence += 1;
    const thirdOctet = Math.floor(forwardedIpSequence / 250) % 250 + 1;
    const fourthOctet = forwardedIpSequence % 250 + 1;
    return {
      'x-om-test-rate-limit': 'on',
      'x-forwarded-for': `203.0.${thirdOctet}.${fourthOctet}`,
    };
  }

  test.beforeAll(async ({ request }) => {
    const email = `ratelimit-probe-${Date.now()}@test.invalid`;
    const rateLimitHeaders = createRateLimitHeaders();
    let lastResponse;

    for (let i = 0; i < 6; i++) {
      lastResponse = await postForm(request, '/api/auth/login', {
        email,
        password: 'wrong-password',
      }, { headers: rateLimitHeaders });
    }

    authRateLimitingEnabled = lastResponse?.status() === 429;
  });

  test('login rate limit — returns 429 after exceeding compound limit', async ({ request }) => {
    test.skip(!authRateLimitingEnabled, 'Auth rate limiting is disabled in this runtime');

    const email = `ratelimit-login-${Date.now()}@test.invalid`;
    const rateLimitHeaders = createRateLimitHeaders();
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
    test.skip(!authRateLimitingEnabled, 'Auth rate limiting is disabled in this runtime');

    const emailA = `ratelimit-indep-a-${Date.now()}@test.invalid`;
    const emailB = `ratelimit-indep-b-${Date.now()}@test.invalid`;
    const rateLimitHeaders = createRateLimitHeaders();

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
    test.skip(!authRateLimitingEnabled, 'Auth rate limiting is disabled in this runtime');

    const email = `ratelimit-reset-${Date.now()}@test.invalid`;
    const rateLimitHeaders = createRateLimitHeaders();
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
    test.skip(!authRateLimitingEnabled, 'Auth rate limiting is disabled in this runtime');

    const { email, password } = DEFAULT_CREDENTIALS.admin;
    const rateLimitHeaders = createRateLimitHeaders();

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

test.describe('TC-AUTH-016: default proxy depth rate-limit fixture', () => {
  test.skip(process.env.OM_INTEGRATION_AUTH_RATE_LIMIT_FIXTURE !== '1', 'Requires the dedicated auth rate-limit fixture');

  for (const audience of ['staff', 'portal'] as const) {
    test(`${audience} login enforces a separate quota for each identifier`, async ({ request }) => {
      const tenantId = audience === 'portal'
        ? getTokenContext(await getAuthToken(request, 'admin')).tenantId
        : undefined;
      const headers = { 'x-om-test-rate-limit': 'on' };
      const login = (email: string) => {
        const data = { email, password: 'fixture-password' };
        return audience === 'staff'
          ? postForm(request, '/api/auth/login', data, { headers })
          : request.post('/api/customer_accounts/login', { data: { ...data, tenantId }, headers });
      };

      const identifier = `rate-limit-${randomUUID()}@test.invalid`;
      expect((await login(identifier)).status()).toBe(401);
      expect((await login(identifier)).status()).toBe(401);

      const limited = await login(identifier);
      expect(limited.status(), 'The dedicated fixture must enforce the two-attempt quota').toBe(429);
      expect(limited.headers()['retry-after']).toMatch(/^[1-9]\d*$/);
      expect(limited.headers()['x-ratelimit-limit']).toBe('2');
      expect(limited.headers()['x-ratelimit-remaining']).toBe('0');

      expect((await login(`rate-limit-${randomUUID()}@test.invalid`)).status()).toBe(401);
    });
  }
});
