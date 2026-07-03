import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Incident } from '../../../../data/entities'
import * as escalationService from '../../../../services/escalationService'

const pathParamsSchema = z.object({
  id: z.string().uuid(),
})

const escalationTargetSchema = z.object({
  type: z.enum(['user', 'team', 'role']),
  id: z.string().uuid(),
})

const escalationRecipientSchema = z.object({
  userId: z.string().uuid(),
  label: z.string().optional(),
})

const previewResponseSchema = z.object({
  nextLevel: z.number(),
  stepCount: z.number(),
  willExhaust: z.boolean(),
  targets: z.array(escalationTargetSchema),
  recipients: z.array(escalationRecipientSchema),
})

const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.incident.escalate'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = pathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = {
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? '',
      tenantId: ctx.auth?.tenantId ?? '',
    }
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!incident) throw new CrudHttpError(404, { error: '[internal] incident not found' })

    const preview = await escalationService.previewNextEscalation(em, scope, incident, {
      container: ctx.container,
    })
    return NextResponse.json(preview)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents escalation preview failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.escalation_preview_failed', 'Failed to preview escalation.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Preview next incident escalation',
  pathParams: pathParamsSchema,
  methods: {
    GET: {
      summary: 'Preview next incident escalation',
      description: 'Returns the next escalation level, policy targets, and resolved recipients without mutating the incident.',
      responses: [
        { status: 200, description: 'Escalation preview', schema: previewResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Incident not found', schema: errorResponseSchema },
      ],
    },
  },
}
