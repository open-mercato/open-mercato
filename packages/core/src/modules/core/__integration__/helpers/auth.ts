import { type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvFileContent(): string | null {
  const candidatePaths = [
    resolve(process.cwd(), 'apps/mercato/.env'),
    resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidatePaths) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      if (content.trim().length > 0) {
        return content;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function loadEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const content = loadEnvFileContent();
  if (!content) return undefined;
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match?.[1]?.trim();
}

export const DEFAULT_CREDENTIALS: Record<string, { email: string; password: string }> = {
  superadmin: {
    email: loadEnvValue('OM_INIT_SUPERADMIN_EMAIL') || 'superadmin@acme.com',
    password: loadEnvValue('OM_INIT_SUPERADMIN_PASSWORD') || 'secret',
  },
  admin: { email: 'admin@acme.com', password: 'secret' },
  employee: { email: 'employee@acme.com', password: 'secret' },
};

export type Role = 'superadmin' | 'admin' | 'employee';

function decodeJwtClaims(token: string): { tenantId?: string; orgId?: string | null } | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      tenantId?: string;
      orgId?: string | null;
    };
    return payload;
  } catch {
    return null;
  }
}

async function acknowledgeGlobalNotices(page: Page): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  await page.context().addCookies([
    {
      name: 'om_demo_notice_ack',
      value: 'ack',
      url: baseUrl,
      sameSite: 'Lax',
    },
    {
      name: 'om_cookie_notice_ack',
      value: 'ack',
      url: baseUrl,
      sameSite: 'Lax',
    },
  ]);
}

async function dismissGlobalNoticesIfPresent(page: Page): Promise<void> {
  const cookieAcceptButton = page.getByRole('button', { name: /accept cookies/i }).first();
  if (await cookieAcceptButton.isVisible().catch(() => false)) {
    await cookieAcceptButton.click();
  }

  const demoNotice = page.getByText(/this instance is provided for demo purposes only/i).first();
  if (await demoNotice.isVisible().catch(() => false)) {
    const noticeContainer = demoNotice.locator('xpath=ancestor::div[contains(@class,"pointer-events-auto")]').first();
    const dismissButton = noticeContainer.locator('button').first();
    if (await dismissButton.isVisible().catch(() => false)) {
      await dismissButton.click();
    }
  }
}

async function recoverClientSideErrorPageIfPresent(page: Page): Promise<void> {
  const clientErrorHeading = page
    .getByRole('heading', { name: /Application error: a client-side exception has occurred/i })
    .first();
  if (!(await clientErrorHeading.isVisible().catch(() => false))) return;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await dismissGlobalNoticesIfPresent(page);
}

async function recoverGenericErrorPageIfPresent(page: Page): Promise<void> {
  const errorHeading = page.getByRole('heading', { name: /^Something went wrong$/i }).first();
  if (!(await errorHeading.isVisible().catch(() => false))) return;
  const retryButton = page.getByRole('button', { name: /Try again/i }).first();
  if (await retryButton.isVisible().catch(() => false)) {
    await retryButton.click().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500).catch(() => {});
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await dismissGlobalNoticesIfPresent(page);
}

export async function login(page: Page, role: Role = 'admin'): Promise<void> {
  const creds = DEFAULT_CREDENTIALS[role];
  const loginReadySelector = 'form[data-auth-ready="1"]';
  const hasBackendUrl = (): boolean => /\/backend(?:\/.*)?$/.test(page.url());
  const waitForBackend = async (timeout: number): Promise<boolean> => {
    try {
      await page.waitForURL(/\/backend(?:\/.*)?$/, { timeout });
      return true;
    } catch {
      return hasBackendUrl();
    }
  };

  await acknowledgeGlobalNotices(page);
  const apiLoginForm = new URLSearchParams();
  apiLoginForm.set('email', creds.email);
  apiLoginForm.set('password', creds.password);
  const apiLoginResponse = await page.request.post('/api/auth/login', {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    data: apiLoginForm.toString(),
  }).catch(() => null);
  if (apiLoginResponse?.ok()) {
    const apiLoginBody = (await apiLoginResponse.json().catch(() => null)) as { token?: string } | null;
    const claims = typeof apiLoginBody?.token === 'string' ? decodeJwtClaims(apiLoginBody.token) : null;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const cookies = [];
    if (claims?.tenantId) {
      cookies.push({
        name: 'om_selected_tenant',
        value: claims.tenantId,
        url: baseUrl,
        sameSite: 'Lax' as const,
      });
    }
    if (claims?.orgId) {
      cookies.push({
        name: 'om_selected_org',
        value: claims.orgId,
        url: baseUrl,
        sameSite: 'Lax' as const,
      });
    }
    if (cookies.length > 0) {
      await page.context().addCookies(cookies);
    }
    await page.goto('/backend', { waitUntil: 'domcontentloaded' });
    if (await waitForBackend(8_000)) return;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await dismissGlobalNoticesIfPresent(page);
    await recoverClientSideErrorPageIfPresent(page);
    await recoverGenericErrorPageIfPresent(page);
    await page.waitForSelector(loginReadySelector, { state: 'visible', timeout: 3_000 }).catch(() => null);
    if (await page.getByLabel('Email').isVisible().catch(() => false)) break;
    if (attempt === 3) {
      throw new Error(`Login form is unavailable for role: ${role}; current URL: ${page.url()}`);
    }
  }
  await page.getByLabel('Email').fill(creds.email);

  const passwordInput = page.getByLabel('Password').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(creds.password);
    await passwordInput.press('Enter');
  } else {
    const submitButton = page.getByRole('button', { name: /login|sign in|continue with sso/i }).first();
    await submitButton.click();
  }

  if (await waitForBackend(7_000)) return;

  const loginForm = page.locator('form').first();
  if (await loginForm.isVisible().catch(() => false)) {
    await loginForm.evaluate((element) => {
      const form = element as HTMLFormElement
      form.requestSubmit()
    }).catch(() => {})
  }
  if (await waitForBackend(5_000)) return;

  const loginButton = page.getByRole('button', { name: /login|sign in|continue with sso/i }).first();
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click({ force: true });
  }
  if (await waitForBackend(8_000)) return;

  throw new Error(`Login did not reach backend for role: ${role}; current URL: ${page.url()}`);
}
