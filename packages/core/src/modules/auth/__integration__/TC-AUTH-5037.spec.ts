import { expect, test } from '@playwright/test'

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@acme.com'
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'secret'

function readMultipartField(body: string, field: string): string | null {
  const match = body.match(new RegExp(`name="${field}"\\r?\\n\\r?\\n([^\\r\\n]*)`))
  return match ? match[1] : null
}

test.describe('TC-AUTH-5037: login submitted immediately after page load', () => {
  test('keeps the typed credentials when the form is submitted without waiting', async ({ page }) => {
    // Regression guard for #5037: ThemeProvider used to swap its rendered element
    // type once its first effect ran, remounting the whole page and discarding
    // the credentials the user had already typed. The submit then carried empty
    // fields and the server answered 400 "Invalid email or password".
    let submittedEmail: string | null = null
    let loginStatus = 0

    page.on('request', (request) => {
      if (request.url().includes('/api/auth/login') && request.method() === 'POST') {
        submittedEmail = readMultipartField(request.postData() ?? '', 'email')
      }
    })
    page.on('response', (response) => {
      if (response.url().includes('/api/auth/login') && response.request().method() === 'POST') {
        loginStatus = response.status()
      }
    })

    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    // Deliberately no settle: fill and submit as fast as the browser allows,
    // the way browser autofill and extension password managers do.
    await page.locator('#email').fill(ADMIN_EMAIL)
    await page.locator('#password').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL(/\/backend/, { timeout: 60_000 })

    expect(submittedEmail).toBe(ADMIN_EMAIL)
    expect(loginStatus).toBe(200)
  })

  test('keeps typed input across the initial hydration on the login form', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.locator('#email').fill(ADMIN_EMAIL)

    // Well past the point where the provider tree finishes initializing.
    await page.waitForTimeout(3000)

    await expect(page.locator('#email')).toHaveValue(ADMIN_EMAIL)
  })
})
