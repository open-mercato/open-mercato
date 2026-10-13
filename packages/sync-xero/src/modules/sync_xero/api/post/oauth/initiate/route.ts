import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createOAuthState, OAuthStateError } from '@open-mercato/core/modules/communication_channels/lib/oauth-state'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { buildAuthorizationUrl } from '@open-mercato/core/modules/integrations/lib/oauth/authorization'
import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { createPkcePair } from '@open-mercato/core/modules/integrations/lib/oauth/pkce'
import { resolveOAuthRedirectUri } from '@open-mercato/core/modules/integrations/lib/oauth/redirect'
import { readXeroClientConfiguration } from '../../../../lib/client-config'
import { XERO_CALLBACK_PATH, XERO_PROVIDER_KEY } from '../../../../lib/constants'
import { createXeroDescriptor } from '../../../../lib/descriptor'
import { resolveXeroEndpoints } from '../../../../lib/endpoints'
import { authorizeXeroRoute, CREDENTIALS_MANAGE_FEATURE } from '../../../../lib/route-auth'
import { xeroErrorResponse } from '../../../../lib/route-errors'
import { setXeroStateCookie } from '../../../../lib/state-cookie'
import { XERO_OPENAPI_TAG, xeroErrorSchema, xeroRuleOneErrors } from '../../../openapi'

export const metadata = {
  path: '/sync_xero/oauth/initiate',
  POST: { requireAuth: true, requireFeatures: [CREDENTIALS_MANAGE_FEATURE] },
}

const initiateBodySchema = z.strictObject({
  replaceUnreadable: z.boolean().optional(),
})

export async function POST(req: Request): Promise<Response> {
  const authorized = await authorizeXeroRoute(req)
  if (!authorized.ok) return authorized.response
  const { container, scope, userId } = authorized.context

  const body = initiateBodySchema.safeParse((await readJsonSafe(req, {})) ?? {})
  if (!body.success) return xeroErrorResponse(400, 'invalid_request')

  const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
  const client = await readXeroClientConfiguration(credentialsService, scope)
  if (!client) return xeroErrorResponse(409, 'xero.not_configured')

  let redirectUri: string
  try {
    redirectUri = resolveOAuthRedirectUri(req, XERO_CALLBACK_PATH)
  } catch (error) {
    if (error instanceof OAuthGrantError && (error.code === 'oauth_base_url_not_configured' || error.code === 'connect_origin_rejected')) {
      return xeroErrorResponse(409, error.code)
    }
    throw error
  }

  const descriptor = createXeroDescriptor(await resolveXeroEndpoints({ scope, credentialsService }))
  const pkce = createPkcePair()
  let state: ReturnType<typeof createOAuthState>
  try {
    state = createOAuthState({
      userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      providerKey: XERO_PROVIDER_KEY,
      extra: { codeVerifier: pkce.codeVerifier, replaceUnreadable: body.data.replaceUnreadable === true },
    })
  } catch (error) {
    if (error instanceof OAuthStateError && error.code === 'missing_secret') {
      getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.oauth_state_key_missing' })
      return xeroErrorResponse(500, 'missing_secret')
    }
    throw error
  }

  const authorizeUrl = buildAuthorizationUrl(descriptor, {
    clientId: client.clientId,
    redirectUri,
    state: state.stateParam,
    codeChallenge: pkce.codeChallenge,
  })
  const response = NextResponse.json({ authorizeUrl })
  setXeroStateCookie(response, state.cookie, state.payload.expiresAt)
  return response
}

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Start a Xero Connect',
  methods: {
    POST: {
      summary: 'Start a Xero Connect or Reconnect',
      description:
        'Answers the Xero authorization URL and sets the encrypted, single-use state cookie om_xero_oauth_state (HttpOnly, SameSite=Lax, 5 minutes). replaceUnreadable confirms "Replace unreadable connection" and travels only inside the state.',
      tags: [XERO_OPENAPI_TAG],
      requestBody: { schema: initiateBodySchema },
      responses: [{ status: 200, description: 'The Xero authorization URL', schema: z.object({ authorizeUrl: z.string() }) }],
      errors: [
        ...xeroRuleOneErrors,
        {
          status: 409,
          description: 'xero.not_configured (no Client ID and Secret), oauth_base_url_not_configured or connect_origin_rejected',
          schema: xeroErrorSchema,
        },
        { status: 500, description: 'missing_secret: no OM_HUB_OAUTH_STATE_KEY or KMS_MASTER_KEY in production', schema: xeroErrorSchema },
      ],
    },
  },
}

export default POST
