import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AUTH-067: `POST /api/auth/logout` revokes the remember-me refresh session even when
 * the access token is expired or absent (#7225).
 *
 * The `auth_token` cookie expires together with the access JWT, while the remember-me
 * `session_token` cookie lives for `REMEMBER_ME_DAYS`. A logout submitted from a stale tab
 * therefore carries only `session_token` (or an access token that no longer verifies). The
 * route used to be gated by `requireAuth: true`, so the dispatcher answered 401 before the
 * handler ran: the refresh session stayed valid in the database, and with no token at all the
 * browser cookie survived too, so the next visit silently signed the user back in.
 *
 * Covers: POST /api/auth/login (remember-me), POST /api/auth/logout, POST /api/auth/session/refresh.
 */
const PASSWORD = 'Logout-Secret-123!';

type LoginBody = { ok?: boolean; refreshToken?: string };

function setCookieHeaders(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
}

function expectClearedCookie(cookies: string[], name: string): void {
  const cleared = cookies.find((value) => value.startsWith(`${name}=`));
  expect.soft(cleared, `logout must clear the ${name} cookie (set-cookie: ${cookies.join(' | ')})`).toBeTruthy();
  expect.soft(cleared ?? '', `${name} must be emptied`).toMatch(new RegExp(`^${name}=;`));
  expect.soft(cleared ?? '', `${name} must be cleared with Max-Age=0`).toMatch(/max-age=0/i);
}

async function loginWithRememberMe(email: string): Promise<string> {
  return withCredentialIsolatedRequest(async (isolated) => {
    const form = new URLSearchParams({ email, password: PASSWORD, remember: 'on' });
    const response = await isolated.post('/api/auth/login', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: form.toString(),
    });
    expect(response.status(), 'remember-me login should succeed').toBe(200);
    const body = await readJsonSafe<LoginBody>(response);
    expect(typeof body?.refreshToken, 'remember-me login should return a refresh token').toBe('string');
    return body?.refreshToken ?? '';
  });
}

async function refreshStatus(refreshToken: string): Promise<number> {
  return withCredentialIsolatedRequest(async (isolated) => {
    const response = await isolated.post('/api/auth/session/refresh', {
      headers: { 'content-type': 'application/json' },
      data: { refreshToken },
    });
    return response.status();
  });
}

async function logoutWithCookies(cookieHeader: string): Promise<APIResponse> {
  return withCredentialIsolatedRequest(async (isolated) => {
    const response = await isolated.post('/api/auth/logout', {
      headers: { cookie: cookieHeader },
      maxRedirects: 0,
    });
    await response.body();
    return response;
  });
}

async function createLoginUser(request: APIRequestContext, adminToken: string, suffix: string) {
  const { organizationId } = getTokenContext(adminToken);
  const roleId = await createRoleFixture(request, adminToken, { name: `qa-auth-067-${suffix}` });
  const email = `qa-auth-067-${suffix}@example.test`;
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
  });
  return { roleId, userId, email };
}

test.describe('TC-AUTH-067: logout revokes the refresh session without a valid access token', () => {
  test('a logout carrying only the remember-me session_token revokes it and clears both cookies', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const suffix = randomUUID().slice(0, 8);
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      const fixture = await createLoginUser(request, adminToken, suffix);
      roleId = fixture.roleId;
      userId = fixture.userId;

      const refreshToken = await loginWithRememberMe(fixture.email);
      expect(await refreshStatus(refreshToken), 'the refresh token should work before logout').toBe(200);

      const response = await logoutWithCookies(`session_token=${encodeURIComponent(refreshToken)}`);
      expect.soft(response.status(), 'logout should redirect to /login instead of answering 401').toBe(307);
      expect.soft(response.headers()['location'] ?? '').toContain('/login');
      const cookies = setCookieHeaders(response);
      expectClearedCookie(cookies, 'auth_token');
      expectClearedCookie(cookies, 'session_token');

      expect(await refreshStatus(refreshToken), 'the refresh session must be revoked by logout').toBe(401);

      const repeated = await logoutWithCookies(`session_token=${encodeURIComponent(refreshToken)}`);
      expect(repeated.status(), 'a logout with an already revoked refresh token stays a plain redirect').toBe(307);
      const repeatedCookies = setCookieHeaders(repeated);
      expectClearedCookie(repeatedCookies, 'auth_token');
      expectClearedCookie(repeatedCookies, 'session_token');
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });

  test('a logout carrying an unverifiable access token still revokes the remember-me session', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const suffix = randomUUID().slice(0, 8);
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      const fixture = await createLoginUser(request, adminToken, suffix);
      roleId = fixture.roleId;
      userId = fixture.userId;

      const refreshToken = await loginWithRememberMe(fixture.email);
      expect(await refreshStatus(refreshToken), 'the refresh token should work before logout').toBe(200);

      // A real token cannot expire mid-test, so a bad signature stands in: the dispatcher resolves both as `missing`; logout.test.ts covers a signed, expired JWT.
      const staleAccessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.c3RhbGU';
      const response = await logoutWithCookies(
        `auth_token=${staleAccessToken}; session_token=${encodeURIComponent(refreshToken)}`,
      );
      expect.soft(response.status(), 'logout should redirect to /login instead of answering 401').toBe(307);
      const cookies = setCookieHeaders(response);
      expectClearedCookie(cookies, 'auth_token');
      expectClearedCookie(cookies, 'session_token');

      expect(await refreshStatus(refreshToken), 'the refresh session must be revoked by logout').toBe(401);
    } finally {
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });

  test('a logout without any session cookie, as a cross-site form sends it, is redirected without clearing cookies', async () => {
    const response = await logoutWithCookies('');
    expect(response.status(), 'a cookieless logout should redirect to /login').toBe(307);
    expect(setCookieHeaders(response), 'a cookieless logout must not set or clear any cookie').toEqual([]);
  });
});
