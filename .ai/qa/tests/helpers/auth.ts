import { type Page } from '@playwright/test';

export const DEFAULT_CREDENTIALS = {
  superadmin: { email: 'superadmin@acme.com', password: 'secret' },
  admin: { email: 'admin@acme.com', password: 'secret' },
  employee: { email: 'employee@acme.com', password: 'secret' },
} as const;

export type Role = keyof typeof DEFAULT_CREDENTIALS;

export async function login(page: Page, role: Role = 'admin'): Promise<void> {
  const creds = DEFAULT_CREDENTIALS[role];
  await page.goto('/login');
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL('**/backend/**');
}
