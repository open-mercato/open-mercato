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
import { Incident, IncidentPostmortem } from '../../../data/entities'
import {
  postmortemPublishSchema,
  postmortemUpsertSchema,
  type PostmortemPublishInput,
  type PostmortemUpsertInput,
} from '../../../data/collab-validators'
import '../../../commands/postmortems'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

export const postmortemPathParamsSchema = z.object({
  id: z.string().uuid(),
})

const postmortemItemSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  summary: z.string().nullable(),
  rootCause: z.string().nullable(),
  impact: z.string().nullable(),
  contributingFactors: z.string().nullable(),
  lessons: z.string().nullable(),
  status: z.string(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
})

const postmortemGetResponseSchema = z.object({
  item: postmortemItemSchema.nullable(),
})

export const postmortemCommandResponseSchema = z.object({
  ok: z.boolean(),
  postmortemId: z.string().uuid().optional(),
  updatedAt: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
})

export const postmortemErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.postmortem.view'] },
  PUT: { requireAuth: true, requireFeatures: ['incidents.postmortem.manage'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

type PostmortemCommandInput = PostmortemUpsertInput | PostmortemPublishInput

type PostmortemCommandResult = {
  postmortemId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
  publishedAt?: Date | string | null
}

type PostmortemCommandConfig<TInput extends PostmortemCommandInput> = {
  commandId: 'incidents.postmortem.upsert' | 'incidents.postmortem.publish'
  schema: { parse(input: unknown): TInput }
  includePostmortemId?: boolean
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
      console.error(`[incidents.postmortem] afterSuccess failed for guard ${callback.guard.id}`, error)
    }
  }
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: '[internal] unauthorized' })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: '[internal] organization_required' })
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

function setOperationHeader(
  response: NextResponse,
  logEntry: CommandUndoLogEntry | null,
  result: PostmortemCommandResult | null,
): void {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'incidents.postmortem',
      resourceId: logEntry.resourceId ?? result?.postmortemId ?? null,
      executedAt: logEntry.createdAt instanceof Date
        ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string'
          ? logEntry.createdAt
          : new Date().toISOString(),
    }),
  )
}

function serializePostmortem(postmortem: IncidentPostmortem): z.infer<typeof postmortemItemSchema> {
  return {
    id: postmortem.id,
    incidentId: postmortem.incidentId,
    summary: postmortem.summary ?? null,
    rootCause: postmortem.rootCause ?? null,
    impact: postmortem.impact ?? null,
    contributingFactors: postmortem.contributingFactors ?? null,
    lessons: postmortem.lessons ?? null,
    status: postmortem.status,
    publishedAt: postmortem.publishedAt instanceof Date ? postmortem.publishedAt.toISOString() : null,
    updatedAt: postmortem.updatedAt.toISOString(),
  }
}

export async function handlePostmortemCommand<TInput extends PostmortemCommandInput>(
  req: Request,
  params: { id: string },
  config: PostmortemCommandConfig<TInput>,
): Promise<NextResponse> {
  try {
    const { id } = postmortemPathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const payload = asRecord(await readJsonSafe(req))
    const scoped = withScopedPayload({ ...payload, id }, ctx, (key, fallback) => fallback ?? key)
    const initialInput = config.schema.parse(scoped)
    const guardInput = {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
      resourceKind: 'incidents.incident',
      resourceId: id,
      operation: 'update' as const,
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
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<TInput, PostmortemCommandResult>(
      config.commandId,
      { input, ctx },
    )
    const body: Record<string, unknown> = {
      ok: true,
      updatedAt: normalizeDate(result.updatedAt),
    }
    if (config.includePostmortemId !== false) body.postmortemId = result.postmortemId
    if (result.publishedAt !== undefined) body.publishedAt = normalizeDate(result.publishedAt)
    const jsonResponse = NextResponse.json(body)
    setOperationHeader(jsonResponse, logEntry as CommandUndoLogEntry | null, result)

    if (guardResult.afterSuccessCallbacks.length) {
      await runGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        userId: ctx.auth?.sub ?? '',
        resourceKind: 'incidents.incident',
        resourceId: input.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return jsonResponse
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.postmortem command failed', err)
    return NextResponse.json({ error: '[internal] postmortem_mutation_failed' }, { status: 400 })
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = postmortemPathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const scoped = withScopedPayload({ id }, ctx, (key, fallback) => fallback ?? key)
    const input = postmortemPublishSchema.parse(scoped)
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
    const postmortem = await findOneWithDecryption(
      em,
      IncidentPostmortem,
      { incidentId: input.id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    return NextResponse.json({ item: postmortem ? serializePostmortem(postmortem) : null })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.postmortem GET failed', err)
    return NextResponse.json({ error: '[internal] postmortem_get_failed' }, { status: 400 })
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return handlePostmortemCommand(req, params, {
    commandId: 'incidents.postmortem.upsert',
    schema: postmortemUpsertSchema,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident postmortem',
  pathParams: postmortemPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get postmortem',
      description: 'Returns the decrypted postmortem for an incident, when present.',
      responses: [
        { status: 200, description: 'Incident postmortem', schema: postmortemGetResponseSchema },
        { status: 401, description: 'Unauthorized', schema: postmortemErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: postmortemErrorResponseSchema },
        { status: 404, description: 'Incident not found', schema: postmortemErrorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Upsert postmortem',
      description: 'Creates or updates a draft incident postmortem and bumps the parent incident aggregate version.',
      requestBody: { contentType: 'application/json', schema: postmortemUpsertSchema },
      responses: [
        { status: 200, description: 'Postmortem upserted', schema: postmortemCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: postmortemErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: postmortemErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: postmortemErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: postmortemErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: postmortemErrorResponseSchema },
      ],
    },
  },
}

export const postmortemRouteSchemas = {
  publish: postmortemPublishSchema,
}
