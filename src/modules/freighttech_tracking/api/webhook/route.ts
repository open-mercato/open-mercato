import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { settingsUpsertSchema, type SettingsUpsertInput } from '../../data/validators'
import { withScopedPayload } from '@/lib/api/scoped'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  translate: (key: string, fallback?: string) => string
  organizationId: string
  tenantId: string
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('freighttech_tracking.settings.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('freighttech_tracking.settings.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  const em = container.resolve('em') as EntityManager

  return {
    ctx,
    em,
    translate,
    tenantId: auth.tenantId,
    organizationId,
  }
}


export async function POST(req: Request) {
  try {
    const { ctx, translate, organizationId, tenantId } = await resolveSettingsContext(req)
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload, ctx, translate)
    const input = settingsUpsertSchema.parse(scoped)

    // const commandBus = ctx.container.resolve('commandBus') as CommandBus
    // const { result } = await commandBus.execute<
    //   SettingsUpsertInput,
    //   {
    //     settingsId: string
    //     apiKey: string
    //   }
    // >('freighttech_tracking.settings.save', { input, ctx })

    return NextResponse.json({})
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('freighttech_tracking.settings.put failed', err)
    return NextResponse.json(
      { error: translate('freighttech_tracking.settings.errors.save') },
      { status: 400 }
    )
  }
}

const PostSchema = z.object({
  // todo
})

const successSchema = z.object({})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Freighttech',
  summary: 'Freighttech Container Tracking webhook',
  methods: {
    POST: {
      summary: 'Push container data',
      requestBody: {
        contentType: 'application/json',
        schema: PostSchema,
      },
      responses: [
        { status: 200, description: 'Received data', schema: successSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 500, description: 'Server error', schema: errorSchema },
      ],
    },
  },
}
