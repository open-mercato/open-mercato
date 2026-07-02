import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
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
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentLink } from '../../../data/entities'
import {
  incidentLinkCreateSchema,
  incidentLinkRemoveSchema,
  type IncidentLinkCreateInput,
  type IncidentLinkRemoveInput,
} from '../../../data/collab-validators'
import '../../../commands/links'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

export const linksPathParamsSchema = z.object({
  id: z.string().uuid(),
})

export const linkPathParamsSchema = linksPathParamsSchema.extend({
  lid: z.string().uuid(),
})

const linkListSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

const linkItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  direction: z.enum(['outgoing', 'incoming']),
  linkedIncident: z.object({
    id: z.string().uuid(),
    number: z.string(),
    title: z.string(),
    status: z.string(),
    severityId: z.string().uuid(),
  }),
})

const linkListResponseSchema = z.object({
  items: z.array(linkItemSchema),
})

export const linkCommandResponseSchema = z.object({
  ok: z.boolean(),
  linkId: z.string().uuid().optional(),
  alreadyLinked: z.boolean().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const linkDeleteResponseSchema = z.object({
  ok: z.boolean(),
  updatedAt: z.string().nullable().optional(),
})

export const linkErrorResponseSchema = z.object({
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

type LinkCommandInput = IncidentLinkCreateInput | IncidentLinkRemoveInput

type LinkCommandResult = {
  linkId: string
  incidentId: string
  linkedIncidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
  alreadyLinked?: boolean
}

type LinkCommandConfig<TInput extends LinkCommandInput> = {
  commandId: 'incidents.incident.link' | 'incidents.incident.unlink'
  schema: { parse(input: unknown): TInput }
  operation: 'update'
  includeLinkId?: boolean
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
      console.error(`[incidents.links] afterSuccess failed for guard ${callback.guard.id}`, error)
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
  result: LinkCommandResult | null,
): void {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'incidents.link',
      resourceId: logEntry.resourceId ?? result?.linkId ?? null,
      executedAt: logEntry.createdAt instanceof Date
        ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string'
          ? logEntry.createdAt
          : new Date().toISOString(),
    }),
  )
}

async function parseListInput(ctx: CommandRuntimeContext, id: string): Promise<z.infer<typeof linkListSchema>> {
  const scoped = withScopedPayload({ id }, ctx, (key, fallback) => fallback ?? key)
  return linkListSchema.parse(scoped)
}

function serializeLink(
  link: IncidentLink,
  currentIncidentId: string,
  linkedIncident: Incident,
): z.infer<typeof linkItemSchema> {
  return {
    id: link.id,
    kind: link.kind,
    direction: link.incidentId === currentIncidentId ? 'outgoing' : 'incoming',
    linkedIncident: {
      id: linkedIncident.id,
      number: linkedIncident.number,
      title: linkedIncident.title,
      status: linkedIncident.status,
      severityId: linkedIncident.severityId,
    },
  }
}

export async function handleLinkCommand<TInput extends LinkCommandInput>(
  req: Request,
  params: { id: string; lid?: string },
  config: LinkCommandConfig<TInput>,
): Promise<NextResponse> {
  try {
    const { id } = linksPathParamsSchema.parse({ id: params.id })
    const { ctx } = await resolveRequestContext(req)
    const payload = asRecord(await req.json().catch(() => ({})))
    const scoped = withScopedPayload({ ...payload, id, ...(params.lid ? { lid: params.lid } : {}) }, ctx, (key, fallback) => fallback ?? key)
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
          ...('lid' in initialInput ? { lid: initialInput.lid } : {}),
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<TInput, LinkCommandResult>(
      config.commandId,
      { input, ctx },
    )
    const body: Record<string, unknown> = {
      ok: true,
      updatedAt: normalizeDate(result.updatedAt),
    }
    if (config.includeLinkId !== false) body.linkId = result.linkId
    if (result.alreadyLinked) body.alreadyLinked = true
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
    console.error('incidents.links command failed', err)
    return NextResponse.json({ error: '[internal] link_mutation_failed' }, { status: 400 })
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = linksPathParamsSchema.parse(params)
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

    const links = await em.find(
      IncidentLink,
      {
        ...scope,
        deletedAt: null,
        $or: [
          { incidentId: input.id },
          { linkedIncidentId: input.id },
        ],
      },
      { orderBy: { createdAt: 'asc' } },
    )
    const counterpartIds = Array.from(new Set(links.map((link) =>
      link.incidentId === input.id ? link.linkedIncidentId : link.incidentId,
    )))
    const counterparts = counterpartIds.length
      ? await findWithDecryption(
          em,
          Incident,
          { id: { $in: counterpartIds }, ...scope, deletedAt: null },
          undefined,
          scope,
        )
      : []
    const counterpartById = new Map(counterparts.map((counterpart) => [counterpart.id, counterpart]))
    const items = links.flatMap((link) => {
      const counterpartId = link.incidentId === input.id ? link.linkedIncidentId : link.incidentId
      const counterpart = counterpartById.get(counterpartId)
      return counterpart ? [serializeLink(link, input.id, counterpart)] : []
    })
    return NextResponse.json({ items })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.links GET failed', err)
    return NextResponse.json({ error: '[internal] link_list_failed' }, { status: 400 })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleLinkCommand(req, params, {
    commandId: 'incidents.incident.link',
    schema: incidentLinkCreateSchema,
    operation: 'update',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident links',
  pathParams: linksPathParamsSchema,
  methods: {
    GET: {
      summary: 'List incident links',
      description: 'Returns links where the incident is either the source or counterpart.',
      responses: [
        { status: 200, description: 'Incident links', schema: linkListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: linkErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: linkErrorResponseSchema },
        { status: 404, description: 'Incident not found', schema: linkErrorResponseSchema },
      ],
    },
    POST: {
      summary: 'Link incident',
      description: 'Creates an idempotent related or duplicate incident link and bumps the parent incident aggregate version.',
      requestBody: { contentType: 'application/json', schema: incidentLinkCreateSchema },
      responses: [
        { status: 200, description: 'Incident linked', schema: linkCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: linkErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: linkErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: linkErrorResponseSchema },
        { status: 404, description: 'Linked incident not found', schema: linkErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: linkErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: linkErrorResponseSchema },
      ],
    },
  },
}

export const linkRouteSchemas = {
  remove: incidentLinkRemoveSchema,
}
