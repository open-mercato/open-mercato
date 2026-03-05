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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await dismissGlobalNoticesIfPresent(page);
    await recoverClientSideErrorPageIfPresent(page);
    await page.waitForSelector(loginReadySelector, { state: 'visible', timeout: 15_000 }).catch(() => null);
    if (await page.getByLabel('Email').isVisible().catch(() => false)) break;
    if (attempt === 1) {
      throw new Error(`Login form is unavailable for role: ${role}; current URL: ${page.url()}`);
    }
  }
  await page.getByLabel('Email').fill(creds.email);
  await page.waitForSelector(loginReadySelector, { state: 'visible', timeout: 15_000 });

  const passwordInput = page.getByLabel('Password').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(creds.password);
    await passwordInput.press('Enter');
  } else {
    const submitButton = page.getByRole('button', { name: /login|sign in|continue with sso/i }).first();
    await submitButton.click();
  }

  if (await waitForBackend(7_000)) return;

  const loginButton = page.getByRole('button', { name: /login|sign in|continue with sso/i }).first();
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click({ force: true });
  }
  if (await waitForBackend(8_000)) return;

  throw new Error(`Login did not reach backend for role: ${role}; current URL: ${page.url()}`);
}
