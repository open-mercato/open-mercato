import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoConfigService } from '../../../../services/ssoConfigService'
import { ssoActivateSchema } from '../../../../data/validators'
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

    const body = await req.json()
    const parsed = ssoActivateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.activate(scope, id, parsed.data.active)

    return NextResponse.json(config)
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'Activate/Deactivate SSO Configuration',
  methods: {
    POST: {
      summary: 'Activate or deactivate SSO configuration',
      description: 'Activation requires at least one domain and a successful OIDC discovery test.',
      tags: ['SSO'],
      requestBody: { contentType: 'application/json', schema: ssoActivateSchema },
      responses: [{ status: 200, description: 'Config activation status updated' }],
      errors: [
        { status: 400, description: 'Activation failed — no domains or discovery failed' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Config not found' },
      ],
    },
  },
}
