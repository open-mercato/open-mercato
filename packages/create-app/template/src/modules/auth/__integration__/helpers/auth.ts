import { type Page } from '@playwright/test'

export async function login(page: Page, email = 'admin@acme.com', password = 'secret'): Promise<void> {
  const hasBackendUrl = (): boolean => /\/backend(?:[/?].*)?$/.test(page.url())
  const waitForBackend = async (timeout: number): Promise<boolean> => {
    try {
      await page.waitForURL(/\/backend(?:[/?].*)?$/, { timeout })
      return true
    } catch {
      return hasBackendUrl()
    }
  }

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  const passwordInput = page.getByLabel('Password')
  await passwordInput.fill(password)
  await passwordInput.press('Enter')

  if (await waitForBackend(7_000)) return

  const loginButton = page.getByRole('button', { name: /login|sign in/i }).first()
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click({ force: true })
  }
  if (await waitForBackend(8_000)) return

  await page.goto('/backend')
  if (await waitForBackend(8_000)) return

  throw new Error(`Template login did not reach backend; current URL: ${page.url()}`)
}
