import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { DEFAULT_CREDENTIALS, type Role } from './auth';

const BASE_URL = process.env.BASE_URL?.trim() || null;

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path;
}

// Cached tokens per credential to dodge the login rate limit
// (5 attempts/60s per email). Tokens are reused across tests in the same
// Playwright worker; each worker still mints its own.
const tokenCache = new Map<string, { token: string; mintedAt: number }>();
const TOKEN_TTL_MS = 45 * 60 * 1000; // 45 min; well under the default 2h session TTL.

/**
 * Drops cached tokens so the next getAuthToken() mints a fresh session.
 *
 * A cached token points at a `sessions` row. Anything that deletes those rows —
 * deactivating the user, a password change, an explicit session purge — leaves the
 * cached token resolving to 401 for the rest of the TTL, and `apiRequest` neither
 * retries nor re-mints. A spec that revokes sessions for an account other specs also
 * use MUST call this afterwards.
 */
export function clearAuthTokenCache(): void {
  tokenCache.clear();
}

export async function getAuthToken(
  request: APIRequestContext,
  roleOrEmail: Role | string = 'admin',
  password?: string,
): Promise<string> {
  const role = roleOrEmail in DEFAULT_CREDENTIALS ? (roleOrEmail as Role) : null;
  const credentialAttempts: Array<{ email: string; password: string }> = [];

  if (role) {
    const configured = DEFAULT_CREDENTIALS[role];
    credentialAttempts.push({ email: configured.email, password: password ?? configured.password });
    if (!password) {
      credentialAttempts.push({ email: `${role}@acme.com`, password: 'secret' });
    }
  } else {
    credentialAttempts.push({ email: roleOrEmail, password: password ?? 'secret' });
  }

  const cacheKey = credentialAttempts
    .map((entry) => `${entry.email}:${entry.password}`)
    .join('|');
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() - cached.mintedAt < TOKEN_TTL_MS) {
    return cached.token;
  }

  let lastStatus = 0;

  for (const attempt of credentialAttempts) {
    const form = new URLSearchParams();
    form.set('email', attempt.email);
    form.set('password', attempt.password);

    // Retry on 429 (auth rate limit kicks in after ~25-30 rapid attempts from
    // the same test run). Capped exponential backoff: 1s, 2s, 4s; 3 retries.
    for (let retry = 0; retry < 4; retry += 1) {
      const response = await request.post(resolveUrl('/api/auth/login'), {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        data: form.toString(),
      });

      const raw = await response.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        body = null;
      }

      lastStatus = response.status();
      if (response.ok() && body && typeof body.token === 'string' && body.token) {
        tokenCache.set(cacheKey, { token: body.token, mintedAt: Date.now() });
        return body.token;
      }
      if (response.status() !== 429) break;
      const backoffMs = 1000 * 2 ** retry;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error(`Failed to obtain auth token (status ${lastStatus})`);
}

export async function apiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: {
    token: string;
    data?: unknown;
    timeout?: number;
    retryTransport?: boolean;
    headers?: Record<string, string>;
  },
) {
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  const timeout = options.timeout ?? 30_000;
  let lastError: unknown = null;
  const maxAttempts = options.retryTransport === false ? 1 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await request.fetch(resolveUrl(path), { method, headers, data: options.data, timeout });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      const retryable = /timeout|idle-session|socket|ECONNRESET|Target page, context or browser has been closed/i.test(message);
      if (!retryable || attempt === maxAttempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

export async function postForm(
  request: APIRequestContext,
  path: string,
  data: Record<string, string>,
  options?: { headers?: Record<string, string> },
) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  return request.post(resolveUrl(path), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(options?.headers ?? {}),
    },
    data: form.toString(),
  });
}

/**
 * Runs `use` against a request context that shares no cookies with the caller's.
 *
 * The `request` fixture keeps a cookie jar, and `/api/auth/login` sets `auth_token`
 * on it. Every later call through that fixture therefore carries the LAST logged-in
 * user's session, even one that deliberately sends no Authorization header or an
 * `ApiKey` one. Whether that cookie is stored at all depends on the deployment:
 * the login route marks it `secure` only when `NODE_ENV === 'production'`, so a lane
 * that serves the app with any other NODE_ENV over http keeps it while a production
 * lane silently drops it.
 *
 * A spec asserting "no credentials are rejected" or "this API key alone decides
 * access" must not depend on which lane it happens to run in — it must issue the
 * request from a jar that never saw a login. TC-DOCUMENTS-009 and TC-DOCUMENTS-018
 * both failed in the standalone lane for exactly that reason while passing in the
 * ephemeral one.
 */
export async function withCredentialIsolatedRequest<T>(
  use: (request: APIRequestContext) => Promise<T>,
): Promise<T> {
  const context = await playwrightRequest.newContext(BASE_URL ? { baseURL: BASE_URL } : {});
  try {
    return await use(context);
  } finally {
    await context.dispose();
  }
}
