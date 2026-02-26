import { type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

<<<<<<< HEAD
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
=======
function loadEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const envPath = resolve(__dirname, '../../../../apps/mercato/.env');
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
>>>>>>> a27613cba1a2bb37f48b2a50321c11f72878f313
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

export async function login(page: Page, role: Role = 'admin'): Promise<void> {
  const creds = DEFAULT_CREDENTIALS[role];
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
  await page.goto('/login');
  await dismissGlobalNoticesIfPresent(page);
  await page.getByLabel('Email').fill(creds.email);
  const passwordInput = page.getByLabel('Password');
  await passwordInput.fill(creds.password);
  await passwordInput.press('Enter');

  if (await waitForBackend(7_000)) return;

  const loginButton = page.getByRole('button', { name: /login|sign in/i }).first();
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click({ force: true });
  }
  if (await waitForBackend(8_000)) return;

  await page.goto('/backend');
  if (await waitForBackend(8_000)) return;

  throw new Error(`Login did not reach backend for role: ${role}; current URL: ${page.url()}`);
}
