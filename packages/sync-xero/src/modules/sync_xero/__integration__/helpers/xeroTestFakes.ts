import type { APIRequestContext, Page } from '@playwright/test'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const XERO_TEST_FAKES_PATH = '/api/sync_xero/test-fakes'

export type XeroFakeOrganisation = {
  tenantId: string
  connectionId: string
  name: string
  authEventId?: string
  tenantType?: 'ORGANISATION' | 'PRACTICE'
}

export type XeroFakesStarted = { started: true; clientId: string; authorizationEndpoint: string }

async function postAction<T>(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<{ status: number; body: T | null }> {
  const response = await apiRequest(request, 'POST', XERO_TEST_FAKES_PATH, { token, data })
  return { status: response.status(), body: await readJsonSafe<T>(response) }
}

async function postOk<T>(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<T> {
  const { status, body } = await postAction<T>(request, token, data)
  if (status !== 200 || body === null) {
    throw new Error(`[internal] POST ${XERO_TEST_FAKES_PATH} (${String(data.action)}) answered ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

/**
 * Probes the test-only route with a body it rejects; `test.skip` the spec on `false`. A 404 means
 * OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test, unless this Playwright process runs
 * with the flag on: then the 404 throws, so a broken route cannot turn a suite into skips.
 */
export async function isXeroTestFakesAvailable(request: APIRequestContext, token: string): Promise<boolean> {
  const { status } = await postAction(request, token, { action: '__probe__' })
  if (status !== 404) return true
  if (parseBooleanWithDefault(process.env.OM_ENABLE_TEST_OAUTH_GRANTS, false)) {
    throw new Error(`[internal] POST ${XERO_TEST_FAKES_PATH} answered 404 although OM_ENABLE_TEST_OAUTH_GRANTS is on in this process`)
  }
  return false
}

export async function startXeroFakes(request: APIRequestContext, token: string): Promise<XeroFakesStarted> {
  return postOk<XeroFakesStarted>(request, token, { action: 'start' })
}

export async function postXeroFakesAction(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown> & { action: string },
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return postAction<Record<string, unknown>>(request, token, data)
}

export async function seedXeroFakes(
  request: APIRequestContext,
  token: string,
  input: { organisations?: XeroFakeOrganisation[]; contacts?: Record<string, Array<Record<string, unknown>>>; mappings?: Array<{ localId: string; externalId: string }> },
): Promise<void> {
  await postOk(request, token, { action: 'seed', ...input })
}

/** Resets the caller's organization when it belongs to the seam; a 409 (not a seam organization) is fine. */
export async function resetXeroFakes(request: APIRequestContext, token: string): Promise<void> {
  const { status, body } = await postAction(request, token, { action: 'reset' })
  if (status !== 200 && status !== 409) {
    throw new Error(`[internal] POST ${XERO_TEST_FAKES_PATH} (reset) answered ${status}: ${JSON.stringify(body)}`)
  }
}

/**
 * Completes Xero's consent screen in the browser: every navigation to the fake authorization
 * endpoint is answered with a redirect to the callback carrying a code the fake issued for the
 * request's PKCE challenge and the original state.
 */
export async function authorizeXero(page: Page, request: APIRequestContext, token: string, authorizationEndpoint: string): Promise<void> {
  await page.route(
    (url) => `${url.origin}${url.pathname}` === authorizationEndpoint,
    async (route) => {
      const url = new URL(route.request().url())
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      const { code } = await postOk<{ code: string }>(request, token, {
        action: 'authorize',
        redirectUri,
        codeChallenge: url.searchParams.get('code_challenge') ?? '',
        scope: (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean),
      })
      const callback = new URL(redirectUri)
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', url.searchParams.get('state') ?? '')
      await route.fulfill({ status: 302, headers: { location: callback.toString() } })
    },
  )
}
