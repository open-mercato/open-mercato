import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoConfigService } from '../../../../services/ssoConfigService'
import { ssoDomainAddSchema } from '../../../../data/validators'
import { resolveSsoAdminContext } from '../../../admin-context'
import { handleSsoAdminApiError, ssoErrorResponse } from '../../../error-handler'

type RouteContext = { params: Promise<{ id: string }> }

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sso.config.view'] },
  POST: { requireAuth: true, requireFeatures: ['sso.config.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sso.config.manage'] },
}

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.getById(scope, id)

    if (!config) {
      return ssoErrorResponse('sso.admin.error.notFound', 'SSO configuration not found', 404)
    }

    return NextResponse.json({ domains: config.allowedDomains })
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const body = await req.json()
    const parsed = ssoDomainAddSchema.safeParse(body)
    if (!parsed.success) {
      return ssoErrorResponse('sso.errors.invalidRequest', 'Invalid request', 400, { details: parsed.error.flatten() })
    }

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.addDomain(scope, id, parsed.data.domain, { container, request: req })

    return NextResponse.json({ domains: config.allowedDomains })
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const url = new URL(req.url)
    const domain = url.searchParams.get('domain')
    if (!domain) {
      return ssoErrorResponse('sso.errors.domainParamRequired', 'Missing domain query parameter', 400)
    }

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.removeDomain(scope, id, domain, { container, request: req })

    return NextResponse.json({ domains: config.allowedDomains })
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}


export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'SSO Domain Management',
  methods: {
    GET: {
      summary: 'List allowed domains',
      tags: ['SSO'],
      responses: [{ status: 200, description: 'List of allowed domains' }],
      errors: [{ status: 404, description: 'Config not found' }],
    },
    POST: {
      summary: 'Add an allowed domain',
      tags: ['SSO'],
      requestBody: { contentType: 'application/json', schema: ssoDomainAddSchema },
      responses: [{ status: 200, description: 'Domain added' }],
      errors: [
        { status: 400, description: 'Invalid domain or limit reached' },
        { status: 404, description: 'Config not found' },
        { status: 409, description: 'Configuration changed since it was loaded, or the domain is already claimed' },
      ],
    },
    DELETE: {
      summary: 'Remove an allowed domain',
      description: 'Pass domain as query parameter: ?domain=example.com',
      tags: ['SSO'],
      responses: [{ status: 200, description: 'Domain removed' }],
      errors: [
        { status: 404, description: 'Config not found' },
        { status: 409, description: 'Configuration changed since it was loaded' },
      ],
    },
  },
}
