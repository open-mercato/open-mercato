import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoConfigService } from '../../../../services/ssoConfigService'
import { resolveSsoAdminContext } from '../../../admin-context'
import { handleSsoAdminApiError } from '../../../error-handler'

type RouteContext = { params: Promise<{ id: string }> }

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sso.config.manage'] },
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const result = await service.testConnection(scope, id)

    return NextResponse.json(result)
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'Test SSO Connection',
  methods: {
    POST: {
      summary: 'Test OIDC discovery',
      description: 'Verifies that the issuer URL is reachable and returns a valid OIDC discovery document. Does not verify client credentials.',
      tags: ['SSO'],
      responses: [{ status: 200, description: 'Test result with ok/error' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Config not found' },
      ],
    },
  },
}
