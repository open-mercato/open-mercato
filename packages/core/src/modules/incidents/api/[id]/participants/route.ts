import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
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
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentParticipant } from '../../../data/entities'
import {
  participantAddSchema,
  participantRemoveSchema,
  participantUpdateSchema,
  type ParticipantAddInput,
  type ParticipantRemoveInput,
  type ParticipantUpdateInput,
} from '../../../data/collab-validators'
import '../../../commands/participants'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

export const incidentPathParamsSchema = z.object({
  id: z.string().uuid(),
})

export const participantPathParamsSchema = incidentPathParamsSchema.extend({
  pid: z.string().uuid(),
})

const participantListSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export const participantItemSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.string(),
  roleId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const participantListResponseSchema = z.object({
  items: z.array(participantItemSchema),
})

export const participantCommandResponseSchema = z.object({
  ok: z.boolean(),
  participantId: z.string().uuid().nullable().optional(),
  incidentId: z.string().uuid().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const participantErrorResponseSchema = z.object({
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

type ParticipantCommandInput = ParticipantAddInput | ParticipantUpdateInput | ParticipantRemoveInput

type ParticipantCommandId =
  | 'incidents.participants.add'
  | 'incidents.participants.update_role'
  | 'incidents.participants.remove'

type ParticipantCommandResult = {
  participantId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
}

type ParticipantCommandSchema<TInput extends ParticipantCommandInput> = {
  parse(input: unknown): TInput
}

type ParticipantCommandConfig<TInput extends ParticipantCommandInput> = {
  commandId: ParticipantCommandId
  schema: ParticipantCommandSchema<TInput>
  operation: 'update'
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
      console.error(`[incidents.participants] afterSuccess failed for guard ${callback.guard.id}`, error)
    }
  }
}

export async function resolveIncidentCollabRequestContext(req: Request): Promise<RequestContext> {
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
  result: ParticipantCommandResult | null,
): void {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'incidents.participant',
      resourceId: logEntry.resourceId ?? result?.participantId ?? null,
      executedAt: logEntry.createdAt instanceof Date
        ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string'
          ? logEntry.createdAt
          : new Date().toISOString(),
    }),
  )
}

function serializeParticipant(participant: IncidentParticipant): z.infer<typeof participantItemSchema> {
  return {
    id: participant.id,
    incidentId: participant.incidentId,
    userId: participant.userId,
    kind: participant.kind,
    roleId: participant.roleId ?? null,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
  }
}

async function parseParticipantListInput(
  ctx: CommandRuntimeContext,
  id: string,
): Promise<z.infer<typeof participantListSchema>> {
  const { translate } = await resolveTranslations()
  const payload = withScopedPayload({ id }, ctx, translate)
  return participantListSchema.parse(payload)
}

export async function handleParticipantCommand<TInput extends ParticipantCommandInput>(
  req: Request,
  params: { id: string; pid?: string },
  config: ParticipantCommandConfig<TInput>,
): Promise<NextResponse> {
  try {
    const { id } = incidentPathParamsSchema.parse({ id: params.id })
    const { ctx } = await resolveIncidentCollabRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = asRecord(await req.json().catch(() => ({})))
    const scoped = withScopedPayload({ ...payload, id, ...(params.pid ? { pid: params.pid } : {}) }, ctx, translate)
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
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
    }

    const input = guardResult.modifiedPayload
      ? config.schema.parse({
          ...initialInput,
          ...guardResult.modifiedPayload,
          id: initialInput.id,
          tenantId: initialInput.tenantId,
          organizationId: initialInput.organizationId,
          ...('pid' in initialInput ? { pid: initialInput.pid } : {}),
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<TInput, ParticipantCommandResult>(
      config.commandId,
      { input, ctx },
    )
    const jsonResponse = NextResponse.json({
      ok: true,
      participantId: result.participantId,
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
        operation: config.operation,
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
    console.error('incidents.participants command failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.participant_mutation_failed', 'Failed to update incident participants.') },
      { status: 400 },
    )
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = incidentPathParamsSchema.parse(params)
    const { ctx } = await resolveIncidentCollabRequestContext(req)
    const input = await parseParticipantListInput(ctx, id)
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

    const participants = await em.find(
      IncidentParticipant,
      { incidentId: input.id, ...scope, deletedAt: null },
      { orderBy: { createdAt: 'asc' } },
    )
    return NextResponse.json({ items: participants.map(serializeParticipant) })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents.participants GET failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.participant_list_failed', 'Failed to list incident participants.') },
      { status: 400 },
    )
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleParticipantCommand(req, params, {
    commandId: 'incidents.participants.add',
    schema: participantAddSchema,
    operation: 'update',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident participants',
  pathParams: incidentPathParamsSchema,
  methods: {
    GET: {
      summary: 'List participants',
      description: 'Returns active participants for an incident scoped to the authenticated organization.',
      responses: [
        { status: 200, description: 'Incident participants', schema: participantListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: participantErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: participantErrorResponseSchema },
        { status: 404, description: 'Incident not found', schema: participantErrorResponseSchema },
      ],
    },
    POST: {
      summary: 'Add participant',
      description: 'Adds a responder or subscriber and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: participantAddSchema,
      },
      responses: [
        { status: 200, description: 'Participant added', schema: participantCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: participantErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: participantErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: participantErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: participantErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: participantErrorResponseSchema },
      ],
    },
  },
}

export const participantRouteSchemas = {
  update: participantUpdateSchema,
  remove: participantRemoveSchema,
}
