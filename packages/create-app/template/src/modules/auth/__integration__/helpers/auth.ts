import { type Page } from '@playwright/test'

export async function login(page: Page, email = 'admin@acme.com', password = 'secret'): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /login|sign in/i }).click()
  await page.waitForURL('**/backend/**')
}
