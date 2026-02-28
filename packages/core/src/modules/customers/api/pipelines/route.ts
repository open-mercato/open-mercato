import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CustomerPipeline } from '../../data/entities'
import {
  pipelineCreateSchema,
  pipelineUpdateSchema,
  pipelineDeleteSchema,
  type PipelineCreateInput,
  type PipelineUpdateInput,
  type PipelineDeleteInput,
} from '../../data/validators'
import { withScopedPayload } from '../utils'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.pipelines.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
}

async function buildContext(
  req: Request
): Promise<{ ctx: CommandRuntimeContext; organizationId: string | null; tenantId: string | null }> {
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
  return { ctx, organizationId, tenantId }
}

export async function GET(req: Request) {
  try {
    const { ctx, organizationId, tenantId } = await buildContext(req)
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: 'Organization and tenant context required' }, { status: 400 })
    }
    const url = new URL(req.url)
    const isDefaultParam = url.searchParams.get('isDefault')

    const em = (ctx.container.resolve('em') as EntityManager)
    const where: Record<string, unknown> = { organizationId, tenantId }
    if (isDefaultParam === 'true') where.isDefault = true
    if (isDefaultParam === 'false') where.isDefault = false

    const pipelines = await em.find(CustomerPipeline, where, { orderBy: { createdAt: 'ASC' } })
    const items = pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: pipeline.isDefault,
      organizationId: pipeline.organizationId,
      tenantId: pipeline.tenantId,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
    }))
    return NextResponse.json({ items, total: items.length })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipelines GET failed', err)
    return NextResponse.json({ error: 'Failed to load pipelines' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { ctx } = await buildContext(req)
    const body = await req.json().catch(() => ({}))
    const { translate } = await resolveTranslations()
    const scoped = withScopedPayload(body, ctx, translate)

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { result, logEntry } = await commandBus.execute<PipelineCreateInput, { pipelineId: string }>(
      'customers.pipelines.create',
      { input: pipelineCreateSchema.parse(scoped), ctx },
    )
    const response = NextResponse.json({ id: result?.pipelineId ?? null }, { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.pipeline',
          resourceId: logEntry.resourceId ?? result?.pipelineId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipelines POST failed', err)
    return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx } = await buildContext(req)
    const body = await req.json().catch(() => ({}))
    const { translate } = await resolveTranslations()
    const scoped = withScopedPayload(body, ctx, translate)

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    const { logEntry } = await commandBus.execute<PipelineUpdateInput, void>(
      'customers.pipelines.update',
      { input: pipelineUpdateSchema.parse(scoped), ctx },
    )
    const response = NextResponse.json({ ok: true })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.pipeline',
          resourceId: logEntry.resourceId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipelines PUT failed', err)
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx } = await buildContext(req)
    const body = await req.json().catch(() => ({}))
    const { translate } = await resolveTranslations()
    const scoped = withScopedPayload(body, ctx, translate)

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    await commandBus.execute<PipelineDeleteInput, void>(
      'customers.pipelines.delete',
      { input: pipelineDeleteSchema.parse(scoped), ctx },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipelines DELETE failed', err)
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 400 })
  }
}

const pipelineItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const pipelineListResponseSchema = z.object({
  items: z.array(pipelineItemSchema),
  total: z.number(),
})

const pipelineCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

const pipelineOkResponseSchema = z.object({
  ok: z.boolean(),
})

const pipelineErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Manage customer pipelines',
  methods: {
    GET: {
      summary: 'List pipelines',
      description: 'Returns a list of pipelines scoped to the authenticated organization.',
      query: z.object({ isDefault: z.string().optional() }),
      responses: [
        { status: 200, description: 'Pipeline list', schema: pipelineListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: pipelineErrorSchema },
        { status: 400, description: 'Invalid request', schema: pipelineErrorSchema },
      ],
    },
    POST: {
      summary: 'Create pipeline',
      description: 'Creates a new pipeline within the authenticated organization.',
      requestBody: { contentType: 'application/json', schema: pipelineCreateSchema },
      responses: [
        { status: 201, description: 'Pipeline created', schema: pipelineCreateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: pipelineErrorSchema },
        { status: 401, description: 'Unauthorized', schema: pipelineErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update pipeline',
      description: 'Updates an existing pipeline.',
      requestBody: { contentType: 'application/json', schema: pipelineUpdateSchema },
      responses: [
        { status: 200, description: 'Pipeline updated', schema: pipelineOkResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: pipelineErrorSchema },
        { status: 404, description: 'Pipeline not found', schema: pipelineErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete pipeline',
      description: 'Deletes a pipeline. Returns 409 if active deals exist.',
      requestBody: { contentType: 'application/json', schema: pipelineDeleteSchema },
      responses: [
        { status: 200, description: 'Pipeline deleted', schema: pipelineOkResponseSchema },
      ],
      errors: [
        { status: 409, description: 'Pipeline has active deals', schema: pipelineErrorSchema },
        { status: 404, description: 'Pipeline not found', schema: pipelineErrorSchema },
      ],
    },
  },
}
