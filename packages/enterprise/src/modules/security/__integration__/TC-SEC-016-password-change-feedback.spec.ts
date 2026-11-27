import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { postForm, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  clearAuthCookie,
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  fetchJson,
  loginViaApi,
  setAuthCookie,
} from './helpers/securityFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const PASSWORD_ROUTE = '/api/security/profile/password'
const FORM_SELECTOR = 'form#security-password-change-form'
const NEW_PASSWORD = 'Changed2@Secure'
const POLISH_CURRENT_PASSWORD_INVALID = 'Obecne hasło jest nieprawidłowe.'

type PasswordErrorBody = {
  error?: string
  issues?: Array<{ path?: Array<string | number>; message?: string }>
}

async function canLogin(request: APIRequestContext, email: string, password: string): Promise<boolean> {
  const response = await postForm(request, '/api/auth/login', { email, password })
  return response.status() === 200
}

async function openPolishSecurityPage(page: Page, token: string): Promise<void> {
  await setAuthCookie(page, token)
  await page.context().addCookies([{ name: 'locale', value: 'pl', url: BASE_URL }])
  await page.goto('/backend/profile/security')
  await expect(page.locator(FORM_SELECTOR)).toBeVisible()
}

async function fillPasswordForm(page: Page, values: [string, string, string]): Promise<void> {
  const inputs = page.locator(`${FORM_SELECTOR} input[type="password"]`)
  await expect(inputs).toHaveCount(3)
  for (const [index, value] of values.entries()) {
    await inputs.nth(index).fill(value)
  }
}

function submitButton(page: Page) {
  return page.locator(`button[type="submit"][form="security-password-change-form"]`)
}

test.describe('TC-SEC-016: Change password feedback and session boundary', () => {
  test.describe.configure({ timeout: 120_000 })

  test('wrong current password keeps the form filled with a localized field error and no session redirect', async ({ page, request }) => {
    const adminToken = await createAdminApiToken(request)
    let userId: string | null = null
    try {
      const user = await createUserFixture(request, adminToken)
      userId = user.id
      const { token } = await loginViaApi(request, user.email, user.password)

      await openPolishSecurityPage(page, token)
      const form = page.locator(FORM_SELECTOR)
      await expect(form.getByLabel('Aktualne hasło', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
      const newPassword = form.getByLabel('Nowe hasło', { exact: true })
      await expect(newPassword).toHaveAttribute('autocomplete', 'new-password')
      await expect(newPassword).toHaveAccessibleDescription(/Co najwyżej 72 bajtów \(UTF-8\)/)
      await expect(form.getByLabel('Potwierdź nowe hasło', { exact: true })).toHaveAttribute('autocomplete', 'new-password')

      const dialogs: string[] = []
      page.on('dialog', async (dialog) => {
        dialogs.push(dialog.type())
        await dialog.dismiss()
      })
      const sessionRefreshRequests: string[] = []
      page.on('request', (pageRequest) => {
        if (pageRequest.url().includes('/api/auth/session/refresh')) sessionRefreshRequests.push(pageRequest.url())
      })

      await fillPasswordForm(page, ['Wrong1!Current', NEW_PASSWORD, NEW_PASSWORD])
      const responsePromise = page.waitForResponse(
        (response) => response.url().includes(PASSWORD_ROUTE) && response.request().method() === 'PUT',
      )
      await submitButton(page).click()
      const response = await responsePromise

      expect(response.status()).toBe(400)
      const body = (await response.json()) as PasswordErrorBody
      expect(body.error).toBe(POLISH_CURRENT_PASSWORD_INVALID)
      expect(body.issues).toEqual([{ path: ['currentPassword'], message: POLISH_CURRENT_PASSWORD_INVALID }])

      await expect(form.getByText(POLISH_CURRENT_PASSWORD_INVALID).first()).toBeVisible()
      await expect(page).toHaveURL(/\/backend\/profile\/security$/)
      const inputs = page.locator(`${FORM_SELECTOR} input[type="password"]`)
      await expect(inputs.nth(0)).toHaveValue('Wrong1!Current')
      await expect(inputs.nth(1)).toHaveValue(NEW_PASSWORD)
      await expect(inputs.nth(2)).toHaveValue(NEW_PASSWORD)
      expect(dialogs).toEqual([])
      expect(sessionRefreshRequests).toEqual([])

      expect(await canLogin(request, user.email, user.password)).toBe(true)
      expect(await canLogin(request, user.email, NEW_PASSWORD)).toBe(false)
    } finally {
      await deleteUserFixture(request, adminToken, userId)
    }
  })

  test('API rejects weak and reused passwords, keeps 401 for missing or invalid auth, and changes a valid password', async ({ request }) => {
    const adminToken = await createAdminApiToken(request)
    let userId: string | null = null
    try {
      const user = await createUserFixture(request, adminToken)
      userId = user.id
      const { token } = await loginViaApi(request, user.email, user.password)
      const plHeaders = { cookie: 'locale=pl' }

      const weak = await fetchJson<PasswordErrorBody>(request, 'PUT', PASSWORD_ROUTE, {
        token,
        headers: plHeaders,
        data: { currentPassword: user.password, newPassword: 'abc' },
      })
      expect(weak.status).toBe(400)
      const weakMessages = (weak.body.issues ?? [])
        .filter((issue) => issue.path?.[0] === 'newPassword')
        .map((issue) => issue.message)
      expect(weakMessages.length).toBeGreaterThan(0)
      expect(weakMessages).toContain('Hasło nie spełnia wymagań.')

      const reused = await fetchJson<PasswordErrorBody>(request, 'PUT', PASSWORD_ROUTE, {
        token,
        headers: plHeaders,
        data: { currentPassword: user.password, newPassword: user.password },
      })
      expect(reused.status).toBe(400)
      expect(reused.body.issues?.[0]?.path).toEqual(['newPassword'])
      expect(reused.body.error).toBe('Nowe hasło musi się różnić od obecnego hasła.')

      await withCredentialIsolatedRequest(async (isolatedRequest) => {
        const anonymous = await isolatedRequest.fetch(`${BASE_URL}${PASSWORD_ROUTE}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          data: { currentPassword: user.password, newPassword: NEW_PASSWORD },
        })
        expect(anonymous.status()).toBe(401)

        const invalidToken = await fetchJson<PasswordErrorBody>(isolatedRequest, 'PUT', PASSWORD_ROUTE, {
          token: `${token.slice(0, -4)}AAAA`,
          data: { currentPassword: user.password, newPassword: NEW_PASSWORD },
        })
        expect(invalidToken.status).toBe(401)
      })

      expect(await canLogin(request, user.email, user.password)).toBe(true)
      expect(await canLogin(request, user.email, NEW_PASSWORD)).toBe(false)

      const changed = await fetchJson<{ ok?: boolean }>(request, 'PUT', PASSWORD_ROUTE, {
        token,
        data: { currentPassword: user.password, newPassword: NEW_PASSWORD },
      })
      expect(changed.status).toBe(200)
      expect(changed.body.ok).toBe(true)
      expect(await canLogin(request, user.email, NEW_PASSWORD)).toBe(true)
      expect(await canLogin(request, user.email, user.password)).toBe(false)
    } finally {
      await deleteUserFixture(request, adminToken, userId)
    }
  })

  test('an expired session on submit still follows the normal sign-in redirect', async ({ page, request }) => {
    const adminToken = await createAdminApiToken(request)
    let userId: string | null = null
    try {
      const user = await createUserFixture(request, adminToken)
      userId = user.id
      const { token } = await loginViaApi(request, user.email, user.password)

      await openPolishSecurityPage(page, token)
      page.on('dialog', async (dialog) => {
        await dialog.accept()
      })
      await fillPasswordForm(page, [user.password, NEW_PASSWORD, NEW_PASSWORD])
      await page.route(`**${PASSWORD_ROUTE}`, async (route) => {
        await withCredentialIsolatedRequest(async (isolatedRequest) => {
          const headers = await route.request().allHeaders()
          delete headers.cookie
          delete headers.authorization
          const unauthorized = await isolatedRequest.fetch(route.request(), { headers, maxRedirects: 0 })
          expect(unauthorized.status()).toBe(401)
          await clearAuthCookie(page)
          await route.fulfill({ response: unauthorized })
        })
      }, { times: 1 })

      const responsePromise = page.waitForResponse(
        (response) => response.url().includes(PASSWORD_ROUTE) && response.request().method() === 'PUT',
      )
      await submitButton(page).click()
      const response = await responsePromise

      expect(response.status()).toBe(401)
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
      expect(await canLogin(request, user.email, user.password)).toBe(true)
      expect(await canLogin(request, user.email, NEW_PASSWORD)).toBe(false)
    } finally {
      await deleteUserFixture(request, adminToken, userId)
    }
  })
})
