import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { toAbsoluteUrl } from '@open-mercato/shared/lib/url'
import {
  consumeOAuthStateOnce,
  OAuthStateError,
  verifyOAuthState,
  type OAuthStateConsumeStore,
  type OAuthStatePayload,
} from '@open-mercato/core/modules/communication_channels/lib/oauth-state'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { exchangeAuthorizationCode } from '@open-mercato/core/modules/integrations/lib/oauth/authorization'
import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { resolveOAuthRedirectUri } from '@open-mercato/core/modules/integrations/lib/oauth/redirect'
import { createXeroApiClient } from '../../../../lib/api-client'
import { readXeroClientConfiguration } from '../../../../lib/client-config'
import {
  XERO_CALLBACK_PATH,
  XERO_CALLBACK_RESULTS,
  XERO_CONNECT_TAB_ID,
  XERO_GRANT_RESOURCE_ID,
  XERO_GRANT_RESOURCE_KIND,
  XERO_INTEGRATION_ID,
  XERO_PROVIDER_KEY,
  XERO_RESULT_QUERY_PARAM,
  XERO_SCOPES,
  XERO_TAB_PATH,
  type XeroCallbackResult,
} from '../../../../lib/constants'
import { createXeroDescriptor } from '../../../../lib/descriptor'
import { resolveXeroEndpoints } from '../../../../lib/endpoints'
import { autoSelectOrganisation, hasXeroSyncHistory } from '../../../../lib/organisation'
import { buildXeroGrantOwner, type XeroScope } from '../../../../lib/owner'
import { CREDENTIALS_MANAGE_FEATURE, userHoldsFeatures } from '../../../../lib/route-auth'
import { clearXeroStateCookie, readXeroStateCookie } from '../../../../lib/state-cookie'
import { XERO_OPENAPI_TAG } from '../../../openapi'

export const metadata = {
  path: '/sync_xero/oauth/callback',
  GET: { requireAuth: true },
}

const callbackStateExtraSchema = z.strictObject({
  codeVerifier: z.string().min(43),
  replaceUnreadable: z.boolean().optional(),
})

const KNOWN_RESULTS: ReadonlySet<string> = new Set(XERO_CALLBACK_RESULTS)

function toCallbackResult(code: string): XeroCallbackResult {
  return KNOWN_RESULTS.has(code) ? (code as XeroCallbackResult) : 'connect_failed'
}

function reportCallbackError(error: unknown, code: string): void {
  getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code })
}

function redirectToTab(req: Request, result: XeroCallbackResult): Response {
  const target = new URL(toAbsoluteUrl(req, XERO_TAB_PATH))
  target.searchParams.set('tab', XERO_CONNECT_TAB_ID)
  target.searchParams.set(XERO_RESULT_QUERY_PARAM, result)
  const response = NextResponse.redirect(target.toString(), 302)
  clearXeroStateCookie(response)
  return response
}

async function verifyState(
  req: Request,
  container: AppContainer,
  userId: string,
  sessionTenantId: string | null,
  stateParam: string,
): Promise<{ payload: OAuthStatePayload; scope: XeroScope; extra: z.infer<typeof callbackStateExtraSchema> } | null> {
  let payload: OAuthStatePayload
  try {
    payload = verifyOAuthState({
      cookie: readXeroStateCookie(req),
      expectedUserId: userId,
      expectedProviderKey: XERO_PROVIDER_KEY,
      expectedState: stateParam,
    })
  } catch (error) {
    if (error instanceof OAuthStateError) return null
    throw error
  }
  if (!payload.organizationId || payload.tenantId !== sessionTenantId) return null
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  if (!(await userHoldsFeatures(container, userId, [CREDENTIALS_MANAGE_FEATURE], scope))) return null

  let store: OAuthStateConsumeStore
  try {
    store = container.resolve<OAuthStateConsumeStore>('cache')
  } catch (error) {
    reportCallbackError(error, 'sync_xero.oauth_state_store_unavailable')
    return null
  }
  try {
    await consumeOAuthStateOnce(store, payload)
  } catch (error) {
    if (!(error instanceof OAuthStateError && error.code === 'replay')) {
      reportCallbackError(error, 'sync_xero.oauth_state_store_failed')
    }
    return null
  }

  const extra = callbackStateExtraSchema.safeParse(payload.extra)
  if (!extra.success) return null
  return { payload, scope, extra: extra.data }
}

async function completeCallback(req: Request): Promise<XeroCallbackResult> {
  const url = new URL(req.url)
  const providerError = url.searchParams.get('error')
  if (providerError) return providerError === 'access_denied' ? 'connect_cancelled' : 'connect_failed'
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  if (!code || !stateParam) return 'connect_state_invalid'

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return 'connect_state_invalid'
  const container = await createRequestContainer()
  const verified = await verifyState(req, container, auth.sub, auth.tenantId, stateParam)
  if (!verified) return 'connect_state_invalid'
  const { scope, extra } = verified
  const owner = buildXeroGrantOwner(scope)

  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: XERO_GRANT_RESOURCE_KIND,
      resourceId: XERO_GRANT_RESOURCE_ID,
      operation: 'custom',
      mutationPayload: { integrationId: XERO_INTEGRATION_ID, action: 'connect' },
    },
  })
  if (!guard.ok) return 'guard_blocked'

  const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
  const client = await readXeroClientConfiguration(credentialsService, scope)
  if (!client) return 'client_misconfigured'
  const endpoints = await resolveXeroEndpoints({ scope, credentialsService })
  const descriptor = createXeroDescriptor(endpoints)
  const grantService = container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService')

  const tokenResponse = await exchangeAuthorizationCode(descriptor, client, {
    code,
    redirectUri: resolveOAuthRedirectUri(req, XERO_CALLBACK_PATH),
    codeVerifier: extra.codeVerifier,
  })
  const connected = await grantService.completeConnect(descriptor, owner, tokenResponse, {
    clientId: client.clientId,
    requestedScopes: XERO_SCOPES,
    replaceUnreadable: extra.replaceUnreadable === true,
    actorUserId: auth.sub,
  })
  await guard.runAfterSuccess()

  return autoSelectOrganisation({
    client: createXeroApiClient({ grantService, descriptor, owner, endpoints, budget: 'interactive' }),
    grantService,
    descriptor,
    owner,
    connect: connected,
    hasSyncHistory: () => hasXeroSyncHistory(container.resolve<EntityManager>('em'), scope),
    runGuard: (providerData) =>
      runRouteMutationGuards({
        container,
        req,
        auth: { userId: auth.sub, tenantId: scope.tenantId, organizationId: scope.organizationId },
        input: {
          resourceKind: XERO_GRANT_RESOURCE_KIND,
          resourceId: XERO_GRANT_RESOURCE_ID,
          operation: 'update',
          mutationPayload: { integrationId: XERO_INTEGRATION_ID, providerData },
        },
      }),
    actorUserId: auth.sub,
    reportFailure: (error) => reportCallbackError(error, 'sync_xero.organisation_auto_select_failed'),
  })
}

export async function GET(req: Request): Promise<Response> {
  let result: XeroCallbackResult
  try {
    result = await completeCallback(req)
  } catch (error) {
    if (error instanceof OAuthGrantError) {
      result = toCallbackResult(error.code)
    } else {
      reportCallbackError(error, 'sync_xero.oauth_callback_failed')
      result = 'connect_failed'
    }
  }
  return redirectToTab(req, result)
}

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Xero OAuth callback',
  methods: {
    GET: {
      summary: 'Complete a Xero Connect',
      description:
        'Xero redirects the browser here. The route verifies and consumes the state, exchanges the code, stores the grant and, when exactly one eligible Organisation was authorised, selects it. It always redirects to /backend/integrations/sync_xero?tab=xero with xeroResult set to one result code and clears the state cookie; Xero error bodies are never echoed.',
      tags: [XERO_OPENAPI_TAG],
      query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }),
      responses: [
        {
          status: 302,
          description: `Redirect to the Xero tab; xeroResult is one of ${XERO_CALLBACK_RESULTS.join(', ')}`,
        },
      ],
      errors: [{ status: 401, description: 'No session (the platform requireAuth check)' }],
    },
  },
}

export default GET
