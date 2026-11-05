import { expect, test } from '@playwright/test'
import { postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-AUTH-018: Login response stays stable without matching interceptors', () => {
  test('POST /api/auth/login returns standard payload and valid cookies', async ({ request }) => {
    const response = await postForm(request, '/api/auth/login', {
      email: DEFAULT_CREDENTIALS.admin.email,
      password: DEFAULT_CREDENTIALS.admin.password,
      remember: '1',
    })

    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(typeof body.token).toBe('string')
    expect(body.redirect).toBe('/backend')
    expect(body.mfa_required).toBeUndefined()

    const setCookieHeader = response.headers()['set-cookie'] ?? ''
    expect(setCookieHeader).toContain('auth_token=')
    expect(setCookieHeader).toContain('session_token=')
  })
})