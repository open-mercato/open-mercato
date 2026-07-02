import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentActionItem } from '../../../data/entities'
import {
  actionItemCreateSchema,
  actionItemRemoveSchema,
  actionItemUpdateSchema,
  type ActionItemCreateInput,
  type ActionItemRemoveInput,
  type ActionItemUpdateInput,
} from '../../../data/collab-validators'
import '../../../commands/actionItems'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

export const actionItemsPathParamsSchema = z.object({
  id: z.string().uuid(),
})

export const actionItemPathParamsSchema = actionItemsPathParamsSchema.extend({
  aid: z.string().uuid(),
})

const actionItemListSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

const actionItemSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
  status: z.string(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  externalRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const actionItemListResponseSchema = z.object({
  items: z.array(actionItemSchema),
  total: z.number().int(),
})

export const actionItemCommandResponseSchema = z.object({
  ok: z.boolean(),
  actionItemId: z.string().uuid().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const actionItemErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.incident.view'] },
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

type ActionItemCommandInput = ActionItemCreateInput | ActionItemUpdateInput | ActionItemRemoveInput

type ActionItemCommandResult = {
  actionItemId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
}

type ActionItemCommandConfig<TInput extends ActionItemCommandInput> = {
  commandId: 'incidents.action_item.create' | 'incidents.action_item.update' | 'incidents.action_item.delete'
  schema: { parse(input: unknown): TInput }
  operation: 'update'
  includeActionItemId?: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeDate(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

async function runGuards(
  ctx: CommandRuntimeContext,
  input: MutationGuardInput,
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  if (legacyGuard) guards.push(legacyGuard)
  if (guards.length === 0) return { ok: true, afterSuccessCallbacks: [] }
  return runMutationGuards(guards, input, { userFeatures: resolveUserFeatures(ctx.auth) })
}

async function runGuardAfterSuccessCallbacks(
  callbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>,
  input: {
    tenantId: string
    organizationId: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete'
    requestMethod: string
    requestHeaders: Headers
  },
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    try {
      await callback.guard.afterSuccess({ ...input, metadata: callback.metadata ?? null })
    } catch (error) {
      console.error(`[incidents.action_items] afterSuccess failed for guard ${callback.guard.id}`, error)
    }
  }
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) throw new CrudHttpError(401, { error: '[internal] unauthorized' })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: '[internal] organization_required' })
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

function setOperationHeader(
  response: NextResponse,
  logEntry: CommandUndoLogEntry | null,
  result: ActionItemCommandResult | null,
): void {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'incidents.action_item',
      resourceId: logEntry.resourceId ?? result?.actionItemId ?? null,
      executedAt: logEntry.createdAt instanceof Date
        ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string'
          ? logEntry.createdAt
          : new Date().toISOString(),
    }),
  )
}

function serializeActionItem(actionItem: IncidentActionItem): z.infer<typeof actionItemSchema> {
  return {
    id: actionItem.id,
    incidentId: actionItem.incidentId,
    title: actionItem.title,
    description: actionItem.description ?? null,
    assigneeUserId: actionItem.assigneeUserId ?? null,
    status: actionItem.status,
    dueAt: actionItem.dueAt instanceof Date ? actionItem.dueAt.toISOString() : null,
    completedAt: actionItem.completedAt instanceof Date ? actionItem.completedAt.toISOString() : null,
    externalRef: actionItem.externalRef ?? null,
    createdAt: actionItem.createdAt.toISOString(),
    updatedAt: actionItem.updatedAt.toISOString(),
  }
}

async function parseListInput(ctx: CommandRuntimeContext, id: string): Promise<z.infer<typeof actionItemListSchema>> {
  const scoped = withScopedPayload({ id }, ctx, (key, fallback) => fallback ?? key)
  return actionItemListSchema.parse(scoped)
}

export async function handleActionItemCommand<TInput extends ActionItemCommandInput>(
  req: Request,
  params: { id: string; aid?: string },
  config: ActionItemCommandConfig<TInput>,
): Promise<NextResponse> {
  try {
    const { id } = actionItemsPathParamsSchema.parse({ id: params.id })
    const { ctx } = await resolveRequestContext(req)
    const payload = asRecord(await readJsonSafe(req))
    const scoped = withScopedPayload({ ...payload, id, ...(params.aid ? { aid: params.aid } : {}) }, ctx, (key, fallback) => fallback ?? key)
    const initialInput = config.schema.parse(scoped)
    const guardInput = {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
      resourceKind: 'incidents.incident',
      resourceId: id,
      operation: config.operation,
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { ...initialInput },
    }
    const guardResult = await runGuards(ctx, guardInput)
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: '[internal] mutation_blocked' }, { status: guardResult.errorStatus ?? 422 })
    }

    const input = guardResult.modifiedPayload
      ? config.schema.parse({
          ...initialInput,
          ...guardResult.modifiedPayload,
          id: initialInput.id,
          tenantId: initialInput.tenantId,
          organizationId: initialInput.organizationId,
          ...('aid' in initialInput ? { aid: initialInput.aid } : {}),
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<TInput, ActionItemCommandResult>(
      config.commandId,
      { input, ctx },
    )
    const body: Record<string, unknown> = {
      ok: true,
      updatedAt: normalizeDate(result.updatedAt),
    }
    if (config.includeActionItemId !== false) body.actionItemId = result.actionItemId
    const jsonResponse = NextResponse.json(body)
    setOperationHeader(jsonResponse, logEntry as CommandUndoLogEntry | null, result)

    if (guardResult.afterSuccessCallbacks.length) {
      await runGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        userId: ctx.auth?.sub ?? '',
        resourceKind: 'incidents.incident',
        resourceId: input.id,
        operation: config.operation,
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return jsonResponse
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.action_items command failed', err)
    return NextResponse.json({ error: '[internal] action_item_mutation_failed' }, { status: 400 })
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = actionItemsPathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const input = await parseListInput(ctx, id)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { organizationId: input.organizationId, tenantId: input.tenantId }
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id: input.id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!incident) throw new CrudHttpError(404, { error: '[internal] incident not found' })
    const [items, total] = await em.findAndCount(
      IncidentActionItem,
      { incidentId: input.id, ...scope, deletedAt: null },
      { orderBy: { createdAt: 'asc' } },
    )
    return NextResponse.json({ items: items.map(serializeActionItem), total })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.action_items GET failed', err)
    return NextResponse.json({ error: '[internal] action_item_list_failed' }, { status: 400 })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleActionItemCommand(req, params, {
    commandId: 'incidents.action_item.create',
    schema: actionItemCreateSchema,
    operation: 'update',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident action items',
  pathParams: actionItemsPathParamsSchema,
  methods: {
    GET: {
      summary: 'List action items',
      description: 'Returns active action items for an incident scoped to the authenticated organization.',
      responses: [
        { status: 200, description: 'Incident action items', schema: actionItemListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: actionItemErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: actionItemErrorResponseSchema },
        { status: 404, description: 'Incident not found', schema: actionItemErrorResponseSchema },
      ],
    },
    POST: {
      summary: 'Create action item',
      description: 'Creates an incident action item and bumps the parent incident aggregate version.',
      requestBody: { contentType: 'application/json', schema: actionItemCreateSchema },
      responses: [
        { status: 200, description: 'Action item created', schema: actionItemCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: actionItemErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: actionItemErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: actionItemErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: actionItemErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: actionItemErrorResponseSchema },
      ],
    },
  },
}

export const actionItemRouteSchemas = {
  update: actionItemUpdateSchema,
  remove: actionItemRemoveSchema,
}
