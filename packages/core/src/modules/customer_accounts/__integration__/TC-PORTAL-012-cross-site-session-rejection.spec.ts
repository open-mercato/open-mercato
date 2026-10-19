import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  type CustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-012: Portal session routes reject cross-site browser submissions (#7239)
 *
 * The portal login parses the body as JSON whatever its Content-Type, so a cross-site
 * `<form enctype="text/plain">` can post the attacker's credentials without a preflight and
 * sign the victim's browser into the attacker's portal account. Portal login, magic-link verify
 * and invitation accept must answer 403 to such requests before reading the body, and leave the
 * victim's existing portal session in place.
 */

const LOGIN_PATH = '/api/customer_accounts/login'
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const EVIL_ORIGIN = 'http://evil.test'

function appOrigin(): string {
  return new URL(BASE_URL).origin
}

async function contextPortalCookie(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies()
  return cookies.find((cookie) => cookie.name === 'customer_auth_token')?.value ?? null
}

async function requestPortalCookie(request: APIRequestContext): Promise<string | null> {
  const state = await request.storageState()
  return state.cookies.find((cookie) => cookie.name === 'customer_auth_token')?.value ?? null
}

async function portalProfileEmail(request: APIRequestContext, authToken: string | null): Promise<string | null> {
  if (!authToken) return null
  const response = await request.get(`${BASE_URL}/api/customer_accounts/portal/profile`, { headers: { cookie: `customer_auth_token=${authToken}` } })
  if (response.status() !== 200) return null
  const body = await readJsonSafe<{ user?: { email?: string } }>(response)
  return body?.user?.email ?? null
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function textPlainJsonFormHtml(action: string, payload: Record<string, string>): string {
  const name = `${JSON.stringify(payload).slice(0, -1)},"padding":"`
  return `<!doctype html><html><body><form id="f" method="POST" action="${escapeHtml(action)}" enctype="text/plain"><input type="hidden" name="${escapeHtml(name)}" value="&quot;}"></form><script>document.getElementById('f').submit()</script></body></html>`
}

test.describe('TC-PORTAL-012: portal session routes reject cross-site browser submissions', () => {
  let adminToken: string | null = null
  let tenantId = ''
  let victim: CustomerUserFixture | null = null
  let attacker: CustomerUserFixture | null = null

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    tenantId = getTokenContext(adminToken).tenantId
    victim = await createCustomerUserFixture(request, adminToken, {})
    attacker = await createCustomerUserFixture(request, adminToken, {})
  })

  test.afterAll(async ({ request }) => {
    await deleteCustomerUserFixture(request, adminToken, victim?.id ?? null)
    await deleteCustomerUserFixture(request, adminToken, attacker?.id ?? null)
  })

  test('a real cross-site text/plain form cannot replace the victim portal session', async ({ page, context }) => {
    const victimLogin = await context.request.post(`${BASE_URL}${LOGIN_PATH}`, {
      data: { email: victim!.email, password: victim!.password, tenantId },
    })
    expect(victimLogin.status(), 'victim signs in first').toBe(200)
    const victimCookie = await contextPortalCookie(context)
    expect(victimCookie).toBeTruthy()

    await page.route(`${EVIL_ORIGIN}/**`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: textPlainJsonFormHtml(`${appOrigin()}${LOGIN_PATH}`, { email: attacker!.email, password: attacker!.password, tenantId }),
    }))
    const loginResponse = page.waitForResponse((response) => response.url() === `${appOrigin()}${LOGIN_PATH}` && response.request().method() === 'POST')
    await page.goto(`${EVIL_ORIGIN}/csrf`)
    const response = await loginResponse

    expect(response.status()).toBe(403)
    expect(await contextPortalCookie(context), 'customer_auth_token is not replaced').toBe(victimCookie)
    expect(await portalProfileEmail(context.request, await contextPortalCookie(context)), 'the browser is still signed in as the victim').toBe(victim!.email)
  })

  const routes = [
    { path: LOGIN_PATH, body: () => ({ email: attacker!.email, password: attacker!.password, tenantId }), headerlessStatus: 200 },
    { path: '/api/customer_accounts/magic-link/verify', body: () => ({ token: 'tc-portal-012-not-a-token' }), headerlessStatus: 400 },
    { path: '/api/customer_accounts/invitations/accept', body: () => ({ token: 'tc-portal-012-not-a-token', password: 'Attacker-Secret-012!', displayName: 'TC PORTAL 012' }), headerlessStatus: 400 },
  ]

  for (const route of routes) {
    test(`${route.path} answers 403 to a cross-site text/plain body and sets no cookie`, async () => {
      await withCredentialIsolatedRequest(async (isolated) => {
        const response = await isolated.post(`${BASE_URL}${route.path}`, {
          headers: { 'content-type': 'text/plain', origin: EVIL_ORIGIN, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
          data: JSON.stringify(route.body()),
        })
        expect(response.status()).toBe(403)
        const body = await readJsonSafe<{ ok?: boolean; error?: string }>(response)
        expect(body?.ok).toBe(false)
        expect(typeof body?.error).toBe('string')
        const setCookie = response.headers()['set-cookie'] ?? ''
        expect(setCookie).not.toContain('customer_auth_token=')
        expect(setCookie).not.toContain('customer_session_token=')
      })
    })

    test(`${route.path} still serves a programmatic client that sends no browser headers`, async () => {
      await withCredentialIsolatedRequest(async (isolated) => {
        const response = await isolated.post(`${BASE_URL}${route.path}`, { data: route.body() })
        expect(response.status()).toBe(route.headerlessStatus)
      })
    })
  }

  test('portal login accepts a same-origin browser request', async () => {
    await withCredentialIsolatedRequest(async (isolated) => {
      const response = await isolated.post(`${BASE_URL}${LOGIN_PATH}`, {
        headers: { origin: appOrigin(), 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
        data: { email: attacker!.email, password: attacker!.password, tenantId },
      })
      expect(response.status()).toBe(200)
      expect(response.headers()['set-cookie'] ?? '').toContain('customer_auth_token=')
      expect(await portalProfileEmail(isolated, await requestPortalCookie(isolated))).toBe(attacker!.email)
    })
  })
})
