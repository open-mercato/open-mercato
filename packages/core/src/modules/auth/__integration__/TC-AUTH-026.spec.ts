import { expect, test } from '@playwright/test'
import { postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-AUTH-026: Login redirect query parameter
 *
 * Verifies that /login?redirect=<path> redirects to the specified path after
 * successful authentication, and that external URLs are sanitized to /backend.
 */
test.describe('TC-AUTH-026: Login redirect query parameter', () => {
  test('should redirect to the path specified in redirect query param after login', async ({ page }) => {
    test.slow()
    const targetPath = '/backend/users'

    await page.goto(`/login?redirect=${encodeURIComponent(targetPath)}`, { waitUntil: 'domcontentloaded' })

    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
    await page.getByLabel('Email').fill('admin@acme.com')
    await page.getByLabel('Password', { exact: true }).fill('secret')
    await page.getByLabel('Password', { exact: true }).press('Enter')

    await expect(page).toHaveURL(new RegExp(targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 10_000 })
  })

  test('should default to /backend when no redirect param is provided', async ({ page }) => {
    test.slow()

    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
    await page.getByLabel('Email').fill('admin@acme.com')
    await page.getByLabel('Password', { exact: true }).fill('secret')
    await page.getByLabel('Password', { exact: true }).press('Enter')

    await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
  })

  test('API should return sanitized redirect for external URLs', async ({ request }) => {
    const response = await postForm(request, '/api/auth/login', {
      email: 'admin@acme.com',
      password: 'secret',
      redirect: 'https://evil.com/steal',
    })
    expect(response.ok()).toBe(true)
    const body = await readJsonSafe<{ redirect?: string }>(response)
    expect(body?.redirect).toBe('/backend')
  })

  test('API should honor valid redirect path', async ({ request }) => {
    const response = await postForm(request, '/api/auth/login', {
      email: 'admin@acme.com',
      password: 'secret',
      redirect: '/backend/users',
    })
    expect(response.ok()).toBe(true)
    const body = await readJsonSafe<{ redirect?: string }>(response)
    expect(body?.redirect).toBe('/backend/users')
  })
})
