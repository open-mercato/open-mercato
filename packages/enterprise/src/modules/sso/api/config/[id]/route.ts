import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoConfigService } from '../../../services/ssoConfigService'
import { ssoConfigAdminUpdateSchema } from '../../../data/validators'
import { resolveSsoAdminContext } from '../../admin-context'
import { handleSsoAdminApiError } from '../../error-handler'
import { ScimToken } from '../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

type RouteContext = { params: Promise<{ id: string }> }

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sso.config.view'] },
  PUT: { requireAuth: true, requireFeatures: ['sso.config.manage'] },
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

    const em = container.resolve<EntityManager>('em')
    const activeScimCount = await em.count(ScimToken, { ssoConfigId: id, isActive: true })

    return NextResponse.json({ ...config, hasActiveScimTokens: activeScimCount > 0 })
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const body = await req.json()
    const parsed = ssoConfigAdminUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    const config = await service.update(scope, id, parsed.data)

    return NextResponse.json(config)
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const { scope } = await resolveSsoAdminContext(req)

    const container = await createRequestContainer()
    const service = container.resolve<SsoConfigService>('ssoConfigService')
    await service.delete(scope, id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleSsoAdminApiError(err, 'SSO Config API')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'SSO Configuration Detail',
  methods: {
    GET: {
      summary: 'Get SSO configuration by ID',
      tags: ['SSO'],
      responses: [{ status: 200, description: 'SSO config detail' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Config not found' },
      ],
    },
    PUT: {
      summary: 'Update SSO configuration',
      tags: ['SSO'],
      requestBody: { contentType: 'application/json', schema: ssoConfigAdminUpdateSchema },
      responses: [{ status: 200, description: 'SSO config updated' }],
      errors: [
        { status: 400, description: 'Invalid input' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Config not found' },
        { status: 409, description: 'Conflict — JIT and SCIM are mutually exclusive' },
      ],
    },
    DELETE: {
      summary: 'Delete SSO configuration',
      description: 'Soft-deletes the config. Must be deactivated first.',
      tags: ['SSO'],
      responses: [{ status: 200, description: 'Config deleted' }],
      errors: [
        { status: 400, description: 'Cannot delete active config' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Config not found' },
      ],
    },
  },
}
