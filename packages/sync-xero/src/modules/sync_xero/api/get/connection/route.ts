import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { resolveOAuthRedirectUri } from '@open-mercato/core/modules/integrations/lib/oauth/redirect'
import { toXeroGrantView } from '../../../lib/connection-status'
import { XERO_CALLBACK_PATH } from '../../../lib/constants'
import { authorizeXeroRoute, CREDENTIALS_MANAGE_FEATURE, userHoldsFeatures } from '../../../lib/route-auth'
import { seamFailureResponse } from '../../../lib/route-errors'
import { resolveXeroRouteGrant, type XeroRouteGrant } from '../../../lib/route-grant'
import { isSeamOrganization } from '../../../lib/testing/seam'
import { XERO_OPENAPI_TAG, xeroRuleOneErrors } from '../../openapi'

const VIEW_FEATURE = 'integrations.view'

export const metadata = {
  path: '/sync_xero/connection',
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

function displayRedirectUri(): string | null {
  try {
    return resolveOAuthRedirectUri(undefined, XERO_CALLBACK_PATH)
  } catch (error) {
    if (error instanceof OAuthGrantError) return null
    throw error
  }
}

export async function GET(req: Request): Promise<Response> {
  const authorized = await authorizeXeroRoute(req, [VIEW_FEATURE])
  if (!authorized.ok) return authorized.response
  const { container, scope, userId } = authorized.context

  let grant: XeroRouteGrant
  try {
    grant = await resolveXeroRouteGrant(container, scope)
  } catch (error) {
    const response = await seamFailureResponse(error)
    if (response) return response
    throw error
  }
  const inspection = await grant.grantService.inspectGrant(grant.descriptor, grant.owner)

  return NextResponse.json({
    redirectUri: displayRedirectUri(),
    baseUrlMissing: inspection.baseUrlMissing,
    configured: inspection.connectionState !== 'not_configured',
    canManage: await userHoldsFeatures(container, userId, [CREDENTIALS_MANAGE_FEATURE], scope),
    seamActive: await isSeamOrganization(scope, grant.credentialsService),
    grant: toXeroGrantView(inspection, new Date()),
  })
}

const organisationRefSchema = z.object({ id: z.string(), name: z.string() })

const connectionResponseSchema = z.object({
  redirectUri: z.string().nullable(),
  baseUrlMissing: z.boolean(),
  configured: z.boolean(),
  canManage: z.boolean(),
  seamActive: z.boolean(),
  grant: z.object({
    status: z.enum(['none', 'active', 'invalidated', 'unavailable']),
    connectionState: z.enum(['not_configured', 'not_connected', 'unavailable', 'invalidated', 'active']),
    unavailableReason: z.enum(['unreadable', 'platform']).nullable(),
    organisation: organisationRefSchema.nullable(),
    previousOrganisation: organisationRefSchema.nullable(),
    revisedAt: z.string().nullable(),
    refreshedAt: z.string().nullable(),
    obtainedAt: z.string().nullable(),
    refreshExpiresInDays: z.number().int().nullable(),
    clientChanged: z.boolean(),
    missingScopes: z.array(z.string()),
    lastDisconnect: z.object({ at: z.string(), disconnectId: z.string(), revocation: z.string() }).nullable(),
  }),
})

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Xero connection status',
  methods: {
    GET: {
      summary: 'Read the Xero connection of the active organization',
      description:
        'Network-free: the redirect URI to register at Xero, whether the Client ID and Secret are set, whether the caller may manage the connection, whether the organization uses the test seam (OM_ENABLE_TEST_OAUTH_GRANTS only), and the grant view (never a token). refreshExpiresInDays estimates the days left before Xero ends an unused grant (60 days after the last refresh).',
      tags: [XERO_OPENAPI_TAG],
      responses: [{ status: 200, description: 'Connection status', schema: connectionResponseSchema }],
      errors: xeroRuleOneErrors(VIEW_FEATURE),
    },
  },
}

export default GET
