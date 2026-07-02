import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
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
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentTimelineEntry } from '../../../data/entities'
import {
  timelineAddSchema,
  timelineListSchema,
  type TimelineAddInput,
  type TimelineListInput,
} from '../../../data/collab-validators'
import '../../../commands/timeline'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

const pathParamsSchema = z.object({
  id: z.string().uuid(),
})

const timelineItemSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  kind: z.string(),
  actorUserId: z.string().uuid().nullable(),
  body: z.string().nullable(),
  visibility: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
})

const timelineListResponseSchema = z.object({
  items: z.array(timelineItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

const timelineAddResponseSchema = z.object({
  entryId: z.string().uuid(),
  incidentId: z.string().uuid(),
  updatedAt: z.string().nullable().optional(),
})

const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.incident.view'] },
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

type TimelineAddResult = {
  entryId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeUpdatedAt(value: Date | string | null | undefined): string | null {
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
  if (guards.length === 0) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards(guards, input, {
    userFeatures: resolveUserFeatures(ctx.auth),
  })
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
      await callback.guard.afterSuccess({
        ...input,
        metadata: callback.metadata ?? null,
      })
    } catch (error) {
      console.error(`[incidents.timeline] afterSuccess failed for guard ${callback.guard.id}`, error)
    }
  }
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

function setOperationHeader(
  response: NextResponse,
  logEntry: CommandUndoLogEntry | null,
  result: TimelineAddResult | null,
): void {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'incidents.timeline_entry',
      resourceId: logEntry.resourceId ?? result?.entryId ?? null,
      executedAt: logEntry.createdAt instanceof Date
        ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string'
          ? logEntry.createdAt
          : new Date().toISOString(),
    }),
  )
}

function serializeTimelineEntry(entry: IncidentTimelineEntry): z.infer<typeof timelineItemSchema> {
  return {
    id: entry.id,
    incidentId: entry.incidentId,
    kind: entry.kind,
    actorUserId: entry.actorUserId ?? null,
    body: entry.body ?? null,
    visibility: entry.visibility,
    metadata: entry.metadata ?? null,
    createdAt: entry.createdAt.toISOString(),
  }
}

async function parseTimelineListInput(
  req: Request,
  ctx: CommandRuntimeContext,
  id: string,
): Promise<TimelineListInput> {
  const { translate } = await resolveTranslations()
  const url = new URL(req.url)
  const payload = withScopedPayload({
    id,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    kinds: url.searchParams.get('kinds') ?? undefined,
    visibility: url.searchParams.get('visibility') ?? undefined,
  }, ctx, translate)
  return timelineListSchema.parse(payload)
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = pathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const input = await parseTimelineListInput(req, ctx, id)
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

    const timelineWhere = {
      incidentId: input.id,
      ...scope,
      ...(input.kinds && input.kinds.length > 0 ? { kind: { $in: input.kinds } } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {}),
    } satisfies FilterQuery<IncidentTimelineEntry>

    const [entries, total] = await Promise.all([
      findWithDecryption(
        em,
        IncidentTimelineEntry,
        timelineWhere,
        {
          orderBy: { createdAt: 'desc' },
          limit: input.pageSize,
          offset: (input.page - 1) * input.pageSize,
        },
        scope,
      ),
      em.count(IncidentTimelineEntry, timelineWhere),
    ])
    return NextResponse.json({
      items: entries.map(serializeTimelineEntry),
      total,
      page: input.page,
      pageSize: input.pageSize,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents.timeline GET failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.timeline_list_failed', 'Failed to list timeline entries.') },
      { status: 400 },
    )
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = pathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = asRecord(await readJsonSafe(req))
    const scoped = withScopedPayload({ ...payload, id }, ctx, translate)
    const initialInput = timelineAddSchema.parse(scoped)
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
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
    }

    const input = guardResult.modifiedPayload
      ? timelineAddSchema.parse({
          ...initialInput,
          ...guardResult.modifiedPayload,
          id: initialInput.id,
          tenantId: initialInput.tenantId,
          organizationId: initialInput.organizationId,
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<TimelineAddInput, TimelineAddResult>(
      'incidents.timeline_entries.add',
      { input, ctx },
    )
    const jsonResponse = NextResponse.json({
      entryId: result.entryId,
      incidentId: result.incidentId,
      updatedAt: normalizeUpdatedAt(result.updatedAt),
    })
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
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents.timeline POST failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.timeline_add_failed', 'Failed to add timeline entry.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident timeline',
  pathParams: pathParamsSchema,
  methods: {
    GET: {
      summary: 'List timeline entries',
      description: 'Returns decrypted timeline entries for an incident, newest first, scoped to the authenticated organization.',
      query: timelineListSchema.omit({ id: true, organizationId: true, tenantId: true }),
      responses: [
        { status: 200, description: 'Timeline entries', schema: timelineListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Incident not found', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Add timeline entry',
      description: 'Appends an internal or customer-facing timeline entry and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: timelineAddSchema,
      },
      responses: [
        { status: 200, description: 'Timeline entry added', schema: timelineAddResponseSchema },
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: errorResponseSchema },
        { status: 423, description: 'Record locked', schema: errorResponseSchema },
      ],
    },
  },
}
