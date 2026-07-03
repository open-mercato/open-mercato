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
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentImpact } from '../../../data/entities'
import {
  impactAddSchema,
  impactRemoveSchema,
  impactUpdateSchema,
  type IncidentImpactAddInput,
  type IncidentImpactRemoveInput,
  type IncidentImpactUpdateInput,
} from '../../../data/validators'
import '../../../commands/impacts'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

export const incidentImpactPathParamsSchema = z.object({
  id: z.string().uuid(),
})

export const incidentImpactItemPathParamsSchema = incidentImpactPathParamsSchema.extend({
  iid: z.string().uuid(),
})

const impactListSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export const impactItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  incident_id: z.string().uuid(),
  target_type: z.string(),
  target_id: z.string().uuid().nullable(),
  component_label: z.string().nullable(),
  impact_status: z.string(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  revenue_amount_minor: z.string().nullable(),
  revenue_currency: z.string().nullable(),
  revenue_refreshed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

const impactListResponseSchema = z.object({
  items: z.array(impactItemSchema),
})

export const impactCommandResponseSchema = z.object({
  ok: z.boolean(),
  impactId: z.string().uuid().nullable().optional(),
  incidentId: z.string().uuid().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  revenueAtRiskMinor: z.string().nullable().optional(),
  revenueAtRiskCurrency: z.string().nullable().optional(),
})

export const impactErrorResponseSchema = z.object({
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

type ImpactCommandInput = IncidentImpactAddInput | IncidentImpactUpdateInput | IncidentImpactRemoveInput

type ImpactCommandId =
  | 'incidents.impact.add'
  | 'incidents.impact.update_status'
  | 'incidents.impact.remove'

type ImpactCommandResult = {
  impactId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
  revenueAtRiskMinor?: string | null
  revenueAtRiskCurrency?: string | null
}

type ImpactCommandSchema<TInput extends ImpactCommandInput> = {
  parse(input: unknown): TInput
}

type ImpactCommandConfig<TInput extends ImpactCommandInput> = {
  commandId: ImpactCommandId
  schema: ImpactCommandSchema<TInput>
  operation: 'update'
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function normalizeImpactUpdatedAt(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

export async function runImpactGuards(
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

export async function runImpactGuardAfterSuccessCallbacks(
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
      console.error(`[incidents.impacts] afterSuccess failed for guard ${callback.guard.id}`, error)
    }
  }
}

export async function resolveIncidentImpactRequestContext(req: Request): Promise<RequestContext> {
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
  result: ImpactCommandResult | null,
): void {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'incidents.impact',
      resourceId: logEntry.resourceId ?? result?.impactId ?? null,
      executedAt: logEntry.createdAt instanceof Date
        ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string'
          ? logEntry.createdAt
          : new Date().toISOString(),
    }),
  )
}

function serializeImpact(impact: IncidentImpact): z.infer<typeof impactItemSchema> {
  return {
    id: impact.id,
    organization_id: impact.organizationId,
    tenant_id: impact.tenantId,
    incident_id: impact.incidentId,
    target_type: impact.targetType,
    target_id: impact.targetId ?? null,
    component_label: impact.componentLabel ?? null,
    impact_status: impact.impactStatus,
    snapshot: impact.snapshot ?? null,
    revenue_amount_minor: impact.revenueAmountMinor == null ? null : String(impact.revenueAmountMinor),
    revenue_currency: impact.revenueCurrency ?? null,
    revenue_refreshed_at: impact.revenueRefreshedAt instanceof Date ? impact.revenueRefreshedAt.toISOString() : null,
    created_at: impact.createdAt.toISOString(),
    updated_at: impact.updatedAt.toISOString(),
  }
}

async function parseImpactListInput(
  ctx: CommandRuntimeContext,
  id: string,
): Promise<z.infer<typeof impactListSchema>> {
  const { translate } = await resolveTranslations()
  const payload = withScopedPayload({ id }, ctx, translate)
  return impactListSchema.parse(payload)
}

export function scopedImpactPayload<T extends Record<string, unknown>>(
  payload: T,
  ctx: CommandRuntimeContext,
  translate: (key: string, fallback?: string) => string,
): T & { tenantId: string; organizationId?: string } {
  return withScopedPayload(payload, ctx, translate)
}

export async function handleImpactCommand<TInput extends ImpactCommandInput>(
  req: Request,
  params: { id: string; iid?: string },
  config: ImpactCommandConfig<TInput>,
): Promise<NextResponse> {
  try {
    const { id } = incidentImpactPathParamsSchema.parse({ id: params.id })
    const { ctx } = await resolveIncidentImpactRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = asRecord(await readJsonSafe(req))
    const scoped = withScopedPayload({
      ...payload,
      id,
      ...(params.iid ? { impactId: params.iid } : {}),
    }, ctx, translate)
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
    const guardResult = await runImpactGuards(ctx, guardInput)
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
          ...('impactId' in initialInput ? { impactId: initialInput.impactId } : {}),
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<TInput, ImpactCommandResult>(
      config.commandId,
      { input, ctx },
    )
    const jsonResponse = NextResponse.json({
      ok: true,
      impactId: result.impactId,
      incidentId: result.incidentId,
      updatedAt: normalizeImpactUpdatedAt(result.updatedAt),
      revenueAtRiskMinor: result.revenueAtRiskMinor == null ? null : String(result.revenueAtRiskMinor),
      revenueAtRiskCurrency: result.revenueAtRiskCurrency ?? null,
    })
    setOperationHeader(jsonResponse, logEntry as CommandUndoLogEntry | null, result)

    if (guardResult.afterSuccessCallbacks.length) {
      await runImpactGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
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
    console.error('incidents.impacts command failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.impact_mutation_failed', 'Failed to update incident impacts.') },
      { status: 400 },
    )
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = incidentImpactPathParamsSchema.parse(params)
    const { ctx } = await resolveIncidentImpactRequestContext(req)
    const input = await parseImpactListInput(ctx, id)
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

    const impacts = await em.find(
      IncidentImpact,
      { incidentId: input.id, ...scope, deletedAt: null },
      { orderBy: { createdAt: 'asc' } },
    )
    return NextResponse.json({ items: impacts.map(serializeImpact) })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents.impacts GET failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.impact_list_failed', 'Failed to list incident impacts.') },
      { status: 400 },
    )
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleImpactCommand(req, params, {
    commandId: 'incidents.impact.add',
    schema: impactAddSchema,
    operation: 'update',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident impacts',
  pathParams: incidentImpactPathParamsSchema,
  methods: {
    GET: {
      summary: 'List impacts',
      description: 'Returns active customer, sales, freeform component, and service component impacts for an incident scoped to the authenticated organization.',
      responses: [
        { status: 200, description: 'Incident impacts', schema: impactListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: impactErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: impactErrorResponseSchema },
        { status: 404, description: 'Incident not found', schema: impactErrorResponseSchema },
      ],
    },
    POST: {
      summary: 'Add impact',
      description: 'Adds an impact link, recomputes revenue at risk, and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: impactAddSchema,
      },
      responses: [
        { status: 200, description: 'Impact added', schema: impactCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: impactErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: impactErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: impactErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: impactErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: impactErrorResponseSchema },
      ],
    },
  },
}

export const impactRouteSchemas = {
  update: impactUpdateSchema,
  remove: impactRemoveSchema,
}
