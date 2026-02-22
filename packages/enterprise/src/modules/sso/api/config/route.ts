import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoConfigService, SsoConfigError } from '../../services/ssoConfigService'
import { ssoConfigAdminCreateSchema, ssoConfigListQuerySchema } from '../../data/validators'
import { resolveSsoAdminContext, SsoAdminAuthError } from '../admin-context'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sso.config.view'] },
  POST: { requireAuth: true, requireFeatures: ['sso.config.manage'] },
}

export async function GET(req: Request) {
  try {
    const { scope } = await resolveSsoAdminContext(req)

    const url = new URL(req.url)
    const query = ssoConfigListQuerySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      organizationId: url.searchParams.get('organizationId') ?? undefined,
      tenantId: url.searchParams.get('tenantId') ?? undefined,
    })

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const result = await service.list(scope, query)

    return NextResponse.json({ ...result, isSuperAdmin: scope.isSuperAdmin })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: Request) {
  try {
    const { scope } = await resolveSsoAdminContext(req)

    const body = await req.json()
    const parsed = ssoConfigAdminCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.create(scope, parsed.data)

    return NextResponse.json(config, { status: 201 })
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
  summary: 'SSO Configuration',
  methods: {
    GET: {
      summary: 'List SSO configurations',
      description: 'Returns paginated SSO configurations. Admins see their org only; superadmins see all.',
      tags: ['SSO'],
      responses: [{ status: 200, description: 'Paginated list of SSO configs' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — requires sso.config.view' },
      ],
    },
    POST: {
      summary: 'Create SSO configuration',
      description: 'Creates a new SSO configuration for an organization. One config per org.',
      tags: ['SSO'],
      requestBody: {
        contentType: 'application/json',
        schema: ssoConfigAdminCreateSchema,
      },
      responses: [{ status: 201, description: 'SSO config created' }],
      errors: [
        { status: 400, description: 'Invalid input' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — requires sso.config.manage' },
        { status: 409, description: 'Config already exists for this organization' },
      ],
    },
  },
}
