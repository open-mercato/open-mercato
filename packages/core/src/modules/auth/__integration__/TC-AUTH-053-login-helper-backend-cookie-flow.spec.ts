import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';

type AuthTraceEntry = {
  path: string;
  status: number;
  location: string | null;
};

function toPathOnly(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return '[unparseable-url]';
  }
}

function toRedactedLocation(rawLocation: string | undefined): string | null {
  if (!rawLocation) return null;
  try {
    const url = new URL(rawLocation, 'http://integration.local');
    return `${url.pathname}${url.search}`;
  } catch {
    return '[unparseable-location]';
  }
}

function collectAuthTrace(page: Page): AuthTraceEntry[] {
  const trace: AuthTraceEntry[] = [];
  page.on('response', (response) => {
    const path = toPathOnly(response.url());
    if (path === '/backend' || path.startsWith('/api/auth/session/refresh')) {
      trace.push({
        path,
        status: response.status(),
        location: toRedactedLocation(response.headers().location),
      });
    }
  });
  return trace;
}

function hasBackendRefreshLoop(trace: AuthTraceEntry[]): boolean {
  let refreshCycles = 0;
  for (let index = 0; index < trace.length - 1; index += 1) {
    const current = trace[index]?.path;
    const next = trace[index + 1]?.path;
    if (current === '/backend' && next?.startsWith('/api/auth/session/refresh')) {
      refreshCycles += 1;
    }
  }
  return refreshCycles > 1;
}

async function formatRedactedDiagnostics(page: Page, trace: AuthTraceEntry[]): Promise<string> {
  const cookieNames = Array.from(
    new Set((await page.context().cookies()).map((cookie) => cookie.name)),
  ).sort();
  const traceLines = trace.length
    ? trace.map((entry) => {
      const location = entry.location ? ` -> ${entry.location}` : '';
      return `${entry.status} ${entry.path}${location}`;
    })
    : ['none'];

  return [
    `current URL: ${toPathOnly(page.url())}`,
    `browser cookie names: ${cookieNames.length ? cookieNames.join(', ') : 'none'}`,
    'backend/refresh trace:',
    ...traceLines,
  ].join('\n');
}

/**
 * TC-AUTH-053: The published integration auth helper establishes browser-cookie
 * staff auth for `/backend` without entering a session-refresh redirect loop.
 */
test.describe('TC-AUTH-053: login helper backend-cookie flow', () => {
  test('login(page, admin) reaches /backend with browser auth cookies', async ({ page }) => {
    test.slow();

    const authTrace = collectAuthTrace(page);

    try {
      await login(page, 'admin');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error([
        "login(page, 'admin') failed before backend auth stabilized.",
        await formatRedactedDiagnostics(page, authTrace),
        `Original error: ${message}`,
      ].join('\n'));
    }

    const diagnostics = await formatRedactedDiagnostics(page, authTrace);
    expect(page.url(), diagnostics).toMatch(/\/backend(?:\/.*)?$/);
    expect(hasBackendRefreshLoop(authTrace), diagnostics).toBe(false);

    const cookieNames = new Set((await page.context().cookies()).map((cookie) => cookie.name));
    expect(cookieNames.has('auth_token'), diagnostics).toBe(true);
    expect(cookieNames.has('session_token'), diagnostics).toBe(true);
    await expect(page.getByRole('button', { name: /admin@acme\.com/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
