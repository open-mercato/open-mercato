/**
 * Not a contract: drives the test-only `POST /api/integrations/test-oauth-grants` route for core's own
 * Playwright specs, like the route, its `OM_ENABLE_TEST_OAUTH_GRANTS` flag and the `test_oauth_grant`
 * integration it serves.
 */
import type { APIRequestContext } from '@playwright/test'
import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { TEST_OAUTH_GRANT_INTEGRATION_ID } from '../../modules/integrations/integration'
import type { OAuthTokenFailure } from '../../modules/integrations/lib/oauth/descriptor'
import { apiRequest } from './api'
import { readJsonSafe } from './generalFixtures'

export { TEST_OAUTH_GRANT_INTEGRATION_ID }

export const OAUTH_GRANT_TEST_ROUTE_PATH = '/api/integrations/test-oauth-grants'

export type TestGrantRefreshOutcome = 'success' | 'invalid_grant' | 'invalid_client' | 'temporarily_unavailable'

export type ConnectTestGrantResult = { reconnect: boolean; revisedAt: string }

export type RefreshTestGrantResult = { result: 'ok' | OAuthTokenFailure; degraded: boolean }

const connectResultSchema = z.object({ reconnect: z.boolean(), revisedAt: z.string() })
const refreshResultSchema = z.object({
  result: z.enum(['ok', 'transient', 'grant_invalidated', 'client_misconfigured', 'not_connected', 'platform_unavailable']),
  degraded: z.boolean(),
})
const corruptResultSchema = z.object({ corrupted: z.boolean() })
const resetResultSchema = z.object({ ok: z.literal(true) })

/**
 * Probes the TEST-ONLY route with an action it rejects; `test.skip` the spec on `false`. A 404
 * means `OM_ENABLE_TEST_OAUTH_GRANTS` is off in the app under test, unless this Playwright
 * process runs with the flag on: then the 404 throws, so a broken route cannot turn a suite into
 * skips. The token must hold `integrations.credentials.manage`.
 */
export async function isOAuthGrantTestRouteAvailable(request: APIRequestContext, token: string): Promise<boolean> {
  const response = await apiRequest(request, 'POST', OAUTH_GRANT_TEST_ROUTE_PATH, {
    token,
    data: { action: '__probe__', integrationId: TEST_OAUTH_GRANT_INTEGRATION_ID },
  })
  if (response.status() !== 404) return true
  if (parseBooleanWithDefault(process.env.OM_ENABLE_TEST_OAUTH_GRANTS, false)) {
    throw new Error(
      `[internal] POST ${OAUTH_GRANT_TEST_ROUTE_PATH} answered 404 although OM_ENABLE_TEST_OAUTH_GRANTS is on in this process`,
    )
  }
  return false
}

async function postTestGrantAction<T>(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown> & { action: string },
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await apiRequest(request, 'POST', OAUTH_GRANT_TEST_ROUTE_PATH, {
    token,
    data: { ...data, integrationId: TEST_OAUTH_GRANT_INTEGRATION_ID },
  })
  const body = await readJsonSafe<unknown>(response)
  if (response.status() !== 200) {
    throw new Error(
      `[internal] POST ${OAUTH_GRANT_TEST_ROUTE_PATH} (${data.action}) answered ${response.status()}: ${JSON.stringify(body)}`,
    )
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new Error(`[internal] POST ${OAUTH_GRANT_TEST_ROUTE_PATH} (${data.action}) returned an unexpected body`)
  }
  return parsed.data
}

export async function connectTestGrant(
  request: APIRequestContext,
  token: string,
  input: { scopes?: string[] } = {},
): Promise<ConnectTestGrantResult> {
  return postTestGrantAction(request, token, { action: 'connect', ...input }, connectResultSchema)
}

export async function refreshTestGrant(
  request: APIRequestContext,
  token: string,
  input: { outcome?: TestGrantRefreshOutcome } = {},
): Promise<RefreshTestGrantResult> {
  return postTestGrantAction(request, token, { action: 'refresh', ...input }, refreshResultSchema)
}

export async function corruptTestGrant(request: APIRequestContext, token: string): Promise<boolean> {
  const { corrupted } = await postTestGrantAction(request, token, { action: 'corruptGrant' }, corruptResultSchema)
  return corrupted
}

export async function resetTestGrants(request: APIRequestContext, token: string): Promise<void> {
  await postTestGrantAction(request, token, { action: 'reset' }, resetResultSchema)
}
