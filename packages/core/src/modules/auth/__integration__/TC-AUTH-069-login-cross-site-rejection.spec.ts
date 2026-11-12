import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { getAuthToken, postForm, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-069: Staff login rejects cross-site browser submissions (#7239)
 *
 * A page on another site can top-level POST a form to /api/auth/login with the attacker's
 * credentials, or a text/plain form carrying the attacker's refresh token to
 * /api/auth/session/refresh. SameSite=Lax does not stop that response from setting auth_token /
 * session_token, so the victim's browser would be signed into the attacker's account. Both routes
 * must answer 403 before reading the body, set no cookie, and leave the victim's existing session
 * untouched, while same-origin and programmatic logins keep working.
 */

const LOGIN_PATH = '/api/auth/login'
const REFRESH_PATH = '/api/auth/session/refresh'
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const EVIL_ORIGIN = 'http://evil.test'

type Credentials = { email: string; password: string }

function appOrigin(): string {
  return new URL(BASE_URL).origin
}

async function authCookieValue(request: APIRequestContext): Promise<string | null> {
  const state = await request.storageState()
  return state.cookies.find((cookie) => cookie.name === 'auth_token')?.value ?? null
}

async function contextAuthCookieValue(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies()
  return cookies.find((cookie) => cookie.name === 'auth_token')?.value ?? null
}

async function profileEmail(request: APIRequestContext, authToken: string | null): Promise<string | null> {
  if (!authToken) return null
  const response = await request.get(`${BASE_URL}/api/auth/profile`, { headers: { cookie: `auth_token=${authToken}` } })
  if (response.status() !== 200) return null
  const body = await readJsonSafe<{ email?: string }>(response)
  return body?.email ?? null
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function autoSubmitFormHtml(action: string, enctype: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('')
  return `<!doctype html><html><body><form id="f" method="POST" action="${escapeHtml(action)}" enctype="${enctype}">${inputs}</form><script>document.getElementById('f').submit()</script></body></html>`
}

function textPlainJsonFormHtml(action: string, payload: Record<string, string>): string {
  const name = `${JSON.stringify(payload).slice(0, -1)},"padding":"`
  return `<!doctype html><html><body><form id="f" method="POST" action="${escapeHtml(action)}" enctype="text/plain"><input type="hidden" name="${escapeHtml(name)}" value="&quot;}"></form><script>document.getElementById('f').submit()</script></body></html>`
}

test.describe('TC-AUTH-069: Staff login rejects cross-site browser submissions', () => {
  let adminToken: string | null = null
  const userIds: string[] = []
  const stamp = Date.now()
  const victim: Credentials = { email: `tc-auth-069-victim-${stamp}@test.invalid`, password: 'Victim-Secret-069!' }
  const attacker: Credentials = { email: `tc-auth-069-attacker-${stamp}@test.invalid`, password: 'Attacker-Secret-069!' }

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    for (const user of [victim, attacker]) {
      userIds.push(await createUserFixture(request, adminToken, { ...user, organizationId, roles: ['employee'] }))
    }
  })

  test.afterAll(async ({ request }) => {
    for (const userId of userIds) {
      await deleteUserIfExists(request, adminToken, userId)
    }
  })

  const crossSiteCases: Array<{ name: string; headers: Record<string, string> }> = [
    { name: 'Sec-Fetch-Site cross-site with a foreign Origin', headers: { origin: EVIL_ORIGIN, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } },
    { name: 'a foreign Origin without Fetch Metadata', headers: { origin: EVIL_ORIGIN } },
    { name: 'an opaque Origin null', headers: { origin: 'null' } },
  ]

  for (const crossSiteCase of crossSiteCases) {
    test(`rejects ${crossSiteCase.name} with 403 and keeps the existing session`, async () => {
      await withCredentialIsolatedRequest(async (isolated) => {
        const victimLogin = await postForm(isolated, LOGIN_PATH, victim)
        expect(victimLogin.status(), 'victim signs in first').toBe(200)
        const victimCookie = await authCookieValue(isolated)
        expect(victimCookie).toBeTruthy()

        const response = await postForm(isolated, LOGIN_PATH, { ...attacker, remember: '1' }, { headers: crossSiteCase.headers })

        expect(response.status()).toBe(403)
        const body = await readJsonSafe<{ ok?: boolean; token?: string; error?: string }>(response)
        expect(body?.ok).toBe(false)
        expect(typeof body?.error).toBe('string')
        expect(body?.token).toBeUndefined()
        const setCookie = response.headers()['set-cookie'] ?? ''
        expect(setCookie).not.toContain('auth_token=')
        expect(setCookie).not.toContain('session_token=')
        expect(await authCookieValue(isolated), 'auth_token is not replaced').toBe(victimCookie)
        expect(await profileEmail(isolated, await authCookieValue(isolated)), 'the browser is still signed in as the victim').toBe(victim.email)
      })
    })
  }

  for (const enctype of ['application/x-www-form-urlencoded', 'multipart/form-data']) {
    test(`a real cross-site ${enctype} form cannot replace the victim's session`, async ({ page, context }) => {
      const victimLogin = await context.request.post(`${BASE_URL}${LOGIN_PATH}`, { form: victim })
      expect(victimLogin.status(), 'victim signs in first').toBe(200)
      const victimCookie = await contextAuthCookieValue(context)
      expect(victimCookie).toBeTruthy()

      await page.route(`${EVIL_ORIGIN}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: autoSubmitFormHtml(`${appOrigin()}${LOGIN_PATH}`, enctype, attacker),
      }))
      const loginResponse = page.waitForResponse((response) => response.url() === `${appOrigin()}${LOGIN_PATH}` && response.request().method() === 'POST')
      await page.goto(`${EVIL_ORIGIN}/csrf`)
      const response = await loginResponse

      expect(response.status()).toBe(403)
      expect(await contextAuthCookieValue(context), 'auth_token is not replaced').toBe(victimCookie)
      expect(await profileEmail(context.request, await contextAuthCookieValue(context)), 'the browser is still signed in as the victim').toBe(victim.email)
    })
  }

  test('a real cross-site text/plain form cannot swap the session through /api/auth/session/refresh', async ({ page, context }) => {
    const attackerRefreshToken = await withCredentialIsolatedRequest(async (isolated) => {
      const attackerLogin = await postForm(isolated, LOGIN_PATH, { ...attacker, remember: '1' })
      expect(attackerLogin.status()).toBe(200)
      const body = await readJsonSafe<{ refreshToken?: string }>(attackerLogin)
      return body?.refreshToken ?? null
    })
    expect(attackerRefreshToken, 'the attacker holds a refresh token').toBeTruthy()

    const victimLogin = await context.request.post(`${BASE_URL}${LOGIN_PATH}`, { form: victim })
    expect(victimLogin.status(), 'victim signs in first').toBe(200)
    const victimCookie = await contextAuthCookieValue(context)
    expect(victimCookie).toBeTruthy()

    await page.route(`${EVIL_ORIGIN}/**`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: textPlainJsonFormHtml(`${appOrigin()}${REFRESH_PATH}`, { refreshToken: attackerRefreshToken! }),
    }))
    const refreshResponse = page.waitForResponse((response) => response.url() === `${appOrigin()}${REFRESH_PATH}` && response.request().method() === 'POST')
    await page.goto(`${EVIL_ORIGIN}/csrf`)
    const response = await refreshResponse

    expect(response.status()).toBe(403)
    expect(await contextAuthCookieValue(context), 'auth_token is not replaced').toBe(victimCookie)
    expect(await profileEmail(context.request, await contextAuthCookieValue(context)), 'the browser is still signed in as the victim').toBe(victim.email)
  })

  test('accepts a same-origin browser login (first-party login page shape)', async () => {
    await withCredentialIsolatedRequest(async (isolated) => {
      const response = await postForm(isolated, LOGIN_PATH, attacker, {
        headers: { origin: appOrigin(), 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
      })

      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ ok?: boolean }>(response)
      expect(body?.ok).toBe(true)
      expect(response.headers()['set-cookie'] ?? '').toContain('auth_token=')
      expect(await profileEmail(isolated, await authCookieValue(isolated))).toBe(attacker.email)
    })
  })

  test('accepts a programmatic client that sends no browser headers', async () => {
    await withCredentialIsolatedRequest(async (isolated) => {
      const response = await postForm(isolated, LOGIN_PATH, attacker)

      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ ok?: boolean; token?: string }>(response)
      expect(body?.ok).toBe(true)
      expect(typeof body?.token).toBe('string')
    })
  })
})
