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
import { escalateSchema, type IncidentEscalateInput } from '../../../data/action-validators'
import type * as escalationService from '../../../services/escalationService'

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

const escalationTargetSchema = z.object({
  type: z.enum(['user', 'team', 'role']),
  id: z.string().uuid(),
})

const escalationRecipientSchema = z.object({
  userId: z.string().uuid(),
  label: z.string().optional(),
})

const escalateResponseSchema = z.object({
  ok: z.boolean(),
  incidentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  updatedAt: z.string().nullable().optional(),
  escalationLevel: z.number(),
  escalationStepCount: z.number(),
  escalationStatus: z.string(),
  nextEscalationAt: z.string().nullable(),
  pagedTargets: z.array(escalationTargetSchema),
  recipients: z.array(escalationRecipientSchema),
})

const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.escalate'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

type EscalateCommandResult = {
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
  escalationLevel?: number
  escalationStepCount?: number
  escalationStatus?: string
  nextEscalationAt?: Date | string | null
  pagedTargets?: escalationService.IncidentEscalationTarget[]
  recipients?: escalationService.EscalationRecipient[]
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
      console.error(`[incidents.escalate] afterSuccess failed for guard ${callback.guard.id}`, error)
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
  result: EscalateCommandResult | null,
): void {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'incidents.incident',
      resourceId: logEntry.resourceId ?? result?.incidentId ?? null,
      executedAt: logEntry.createdAt instanceof Date
        ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string'
          ? logEntry.createdAt
          : new Date().toISOString(),
    }),
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = pathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = asRecord(await readJsonSafe(req))
    const scoped = withScopedPayload({ ...payload, id }, ctx, translate)
    const initialInput = escalateSchema.parse(scoped)
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
      ? escalateSchema.parse({
          ...initialInput,
          ...guardResult.modifiedPayload,
          id: initialInput.id,
          tenantId: initialInput.tenantId,
          organizationId: initialInput.organizationId,
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<IncidentEscalateInput, EscalateCommandResult>(
      'incidents.incident.escalate',
      { input, ctx },
    )
    const response = NextResponse.json({
      ok: true,
      incidentId: result.incidentId,
      organizationId: result.organizationId,
      tenantId: result.tenantId,
      updatedAt: normalizeDate(result.updatedAt),
      escalationLevel: result.escalationLevel ?? 0,
      escalationStepCount: result.escalationStepCount ?? 0,
      escalationStatus: result.escalationStatus ?? 'inactive',
      nextEscalationAt: normalizeDate(result.nextEscalationAt),
      pagedTargets: result.pagedTargets ?? [],
      recipients: result.recipients ?? [],
    })
    setOperationHeader(response, logEntry as CommandUndoLogEntry | null, result)

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

    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents escalate route failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.action_failed', 'Failed to update incident.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Escalate incident',
  pathParams: pathParamsSchema,
  methods: {
    POST: {
      summary: 'Escalate incident',
      description: 'Starts or advances the incident escalation policy and returns the paged targets and recipients.',
      requestBody: {
        contentType: 'application/json',
        schema: escalateSchema,
      },
      responses: [
        { status: 200, description: 'Incident escalation state', schema: escalateResponseSchema },
        { status: 400, description: 'Invalid payload or transition', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: errorResponseSchema },
        { status: 423, description: 'Record locked', schema: errorResponseSchema },
      ],
    },
  },
}
