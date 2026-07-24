import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { impactTargetTypeSchema } from '../../data/validators'
import { listOpenIncidentsByImpactTarget } from '../../lib/byTarget'

const byTargetQuerySchema = z.object({
  targetType: impactTargetTypeSchema,
  targetId: z.string().uuid(),
})

const byTargetItemSchema = z.object({
  id: z.string().uuid(),
  number: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string(),
  severityId: z.string().uuid().nullable(),
  impactStatus: z.string(),
})

const byTargetResponseSchema = z.object({
  items: z.array(byTargetItemSchema),
})

const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

type RequestContext = {
  ctx: CommandRuntimeContext
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.incident.view'] },
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('incidents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('incidents.errors.organization_required', 'Organization context is required'),
    })
  }

  return {
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
  }
}

function parseQuery(req: Request): z.infer<typeof byTargetQuerySchema> {
  const url = new URL(req.url)
  return byTargetQuerySchema.parse({
    targetType: url.searchParams.get('targetType') ?? undefined,
    targetId: url.searchParams.get('targetId') ?? undefined,
  })
}

export async function GET(req: Request) {
  try {
    const { targetType, targetId } = parseQuery(req)
    const { ctx } = await resolveRequestContext(req)
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    const tenantId = ctx.auth?.tenantId ?? null
    if (!organizationId || !tenantId) {
      throw new CrudHttpError(400, { error: '[internal] scope is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const items = await listOpenIncidentsByImpactTarget({
      em,
      organizationId,
      tenantId,
      targetType,
      targetId,
    })

    return NextResponse.json({ items })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents.by-target GET failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.by_target_failed', 'Failed to list incidents for this target.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incidents by target',
  methods: {
    GET: {
      summary: 'List incidents affecting a target',
      description:
        'Returns up to 50 non-closed incidents linked to the requested impact target in the authenticated organization scope.',
      query: byTargetQuerySchema,
      responses: [
        { status: 200, description: 'Incidents affecting the target', schema: byTargetResponseSchema },
        { status: 400, description: 'Invalid target or missing scope', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
      ],
    },
  },
}
