import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoConfigService, SsoConfigError } from '../../../../services/ssoConfigService'
import { ssoDomainAddSchema } from '../../../../data/validators'
import { resolveSsoAdminContext, SsoAdminAuthError } from '../../../admin-context'

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
      return NextResponse.json({ error: 'SSO configuration not found' }, { status: 404 })
    }

    return NextResponse.json({ domains: config.allowedDomains })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const body = await req.json()
    const parsed = ssoDomainAddSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.addDomain(scope, id, parsed.data.domain)

    return NextResponse.json({ domains: config.allowedDomains })
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const url = new URL(req.url)
    const domain = url.searchParams.get('domain')
    if (!domain) {
      return NextResponse.json({ error: 'Missing domain query parameter' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.removeDomain(scope, id, domain)

    return NextResponse.json({ domains: config.allowedDomains })
  } catch (err) {
    return handleError(err)
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof SsoAdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode })
  }
  if (err instanceof SsoConfigError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode })
  }
  console.error('[SSO Config API] Error:', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
      ],
    },
    DELETE: {
      summary: 'Remove an allowed domain',
      description: 'Pass domain as query parameter: ?domain=example.com',
      tags: ['SSO'],
      responses: [{ status: 200, description: 'Domain removed' }],
      errors: [{ status: 404, description: 'Config not found' }],
    },
  },
}
