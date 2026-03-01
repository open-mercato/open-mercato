import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoConfigService, SsoConfigError } from '../../../../services/ssoConfigService'
import { resolveSsoAdminContext, SsoAdminAuthError } from '../../../admin-context'

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
  } catch (err: any) {
    if (err instanceof SsoAdminAuthError || err?.name === 'SsoAdminAuthError') {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    if (err instanceof SsoConfigError || err?.name === 'SsoConfigError') {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    console.error('[SSO Config API] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
