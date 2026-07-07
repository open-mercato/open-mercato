import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CustomerPipelineStage, CustomerDictionaryEntry } from '../../data/entities'
import {
  pipelineStageCreateSchema,
  pipelineStageUpdateSchema,
  pipelineStageDeleteSchema,
  type PipelineStageCreateInput,
  type PipelineStageUpdateInput,
  type PipelineStageDeleteInput,
} from '../../data/validators'
import { withScopedPayload } from '../utils'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const PIPELINE_STAGE_RESOURCE_KIND = 'customers.pipelineStage'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.pipelines.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
}

async function buildContext(
  req: Request
): Promise<{ ctx: CommandRuntimeContext; organizationId: string | null; tenantId: string | null; translate: (key: string, fallback?: string) => string }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  const tenantId = auth.tenantId ?? null
  return { ctx, organizationId, tenantId, translate }
}

export async function GET(req: Request) {
  try {
    const { ctx, tenantId, translate } = await buildContext(req)
    if (!tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const orgFilter = resolveOrganizationScopeFilter(ctx.organizationScope, ctx.auth)
    const url = new URL(req.url)
    const pipelineId = url.searchParams.get('pipelineId')

    const em = (ctx.container.resolve('em') as EntityManager)
    const where: Record<string, unknown> = { tenantId, ...orgFilter.where }
    if (pipelineId) where.pipelineId = pipelineId

    const stages = await em.find(CustomerPipelineStage, where, { orderBy: { order: 'ASC' } })

    const stageLabels = stages.map((s) => s.label.trim().toLowerCase())
    const dictEntries = stageLabels.length
      ? await em.find(CustomerDictionaryEntry, {
          tenantId,
          ...orgFilter.where,
          kind: 'pipeline_stage',
          normalizedValue: { $in: stageLabels },
        })
      : []
    const dictByNormalized = new Map<string, CustomerDictionaryEntry>()
    dictEntries.forEach((entry) => dictByNormalized.set(entry.normalizedValue, entry))

    const items = stages.map((stage) => {
      const dictEntry = dictByNormalized.get(stage.label.trim().toLowerCase())
      return {
        id: stage.id,
        pipelineId: stage.pipelineId,
        label: stage.label,
        order: stage.order,
        color: dictEntry?.color ?? null,
        icon: dictEntry?.icon ?? null,
        organizationId: stage.organizationId,
        tenantId: stage.tenantId,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      }
    })
    return NextResponse.json({ items, total: items.length })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipeline-stages GET failed', err)
    return NextResponse.json({ error: 'Failed to load pipeline stages' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildContext(req)
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const body = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(body, ctx, translate)
    const input = pipelineStageCreateSchema.parse(scoped)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: ctx.auth!.sub,
      resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
      resourceId: organizationId,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<PipelineStageCreateInput, { stageId: string }>(
      'customers.pipeline-stages.create',
      { input, ctx },
    )
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: ctx.auth!.sub,
        resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
        resourceId: result?.stageId ?? organizationId,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const response = NextResponse.json({ id: result?.stageId ?? null }, { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.pipelineStage',
          resourceId: logEntry.resourceId ?? result?.stageId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipeline-stages POST failed', err)
    return NextResponse.json({ error: 'Failed to create pipeline stage' }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildContext(req)
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const body = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(body, ctx, translate)
    const input = pipelineStageUpdateSchema.parse(scoped)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: ctx.auth!.sub,
      resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
      resourceId: input.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { logEntry } = await commandBus.execute<PipelineStageUpdateInput, void>(
      'customers.pipeline-stages.update',
      { input, ctx },
    )
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: ctx.auth!.sub,
        resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
        resourceId: input.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const response = NextResponse.json({ ok: true })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.pipelineStage',
          resourceId: logEntry.resourceId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipeline-stages PUT failed', err)
    return NextResponse.json({ error: 'Failed to update pipeline stage' }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildContext(req)
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }
    const body = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(body, ctx, translate)
    const input = pipelineStageDeleteSchema.parse(scoped)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: ctx.auth!.sub,
      resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
      resourceId: input.id,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    await commandBus.execute<PipelineStageDeleteInput, void>(
      'customers.pipeline-stages.delete',
      { input, ctx },
    )
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: ctx.auth!.sub,
        resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
        resourceId: input.id,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipeline-stages DELETE failed', err)
    return NextResponse.json({ error: 'Failed to delete pipeline stage' }, { status: 400 })
  }
}

const stageItemSchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid(),
  label: z.string(),
  order: z.number(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const stageListResponseSchema = z.object({
  items: z.array(stageItemSchema),
  total: z.number(),
})

const stageCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

const stageOkResponseSchema = z.object({
  ok: z.boolean(),
})

const stageErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Manage pipeline stages',
  methods: {
    GET: {
      summary: 'List pipeline stages',
      description: 'Returns pipeline stages for the authenticated organization, optionally filtered by pipelineId.',
      query: z.object({ pipelineId: z.string().uuid().optional() }),
      responses: [
        { status: 200, description: 'Stage list', schema: stageListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: stageErrorSchema },
        { status: 400, description: 'Invalid request', schema: stageErrorSchema },
      ],
    },
    POST: {
      summary: 'Create pipeline stage',
      description: 'Creates a new pipeline stage.',
      requestBody: { contentType: 'application/json', schema: pipelineStageCreateSchema },
      responses: [
        { status: 201, description: 'Stage created', schema: stageCreateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: stageErrorSchema },
        { status: 401, description: 'Unauthorized', schema: stageErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update pipeline stage',
      description: 'Updates an existing pipeline stage.',
      requestBody: { contentType: 'application/json', schema: pipelineStageUpdateSchema },
      responses: [
        { status: 200, description: 'Stage updated', schema: stageOkResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: stageErrorSchema },
        { status: 404, description: 'Stage not found', schema: stageErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete pipeline stage',
      description: 'Deletes a pipeline stage. Returns 409 if active deals use this stage.',
      requestBody: { contentType: 'application/json', schema: pipelineStageDeleteSchema },
      responses: [
        { status: 200, description: 'Stage deleted', schema: stageOkResponseSchema },
      ],
      errors: [
        { status: 409, description: 'Stage has active deals', schema: stageErrorSchema },
        { status: 404, description: 'Stage not found', schema: stageErrorSchema },
      ],
    },
  },
}
