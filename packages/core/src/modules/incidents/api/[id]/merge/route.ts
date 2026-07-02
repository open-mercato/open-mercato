import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
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
import { incidentMergeSchema, type IncidentMergeInput } from '../../../data/collab-validators'
import '../../../commands/links'

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

const mergePathParamsSchema = z.object({
  id: z.string().uuid(),
})

const mergeResponseSchema = z.object({
  ok: z.boolean(),
  targetIncidentId: z.string().uuid(),
  updatedAt: z.string().nullable().optional(),
})

const mergeErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

type MergeCommandResult = {
  incidentId: string
  targetIncidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date | string | null
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
      console.error(`[incidents.merge] afterSuccess failed for guard ${callback.guard.id}`, error)
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = mergePathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const payload = asRecord(await req.json().catch(() => ({})))
    const scoped = withScopedPayload({ ...payload, id }, ctx, (key, fallback) => fallback ?? key)
    const initialInput = incidentMergeSchema.parse(scoped)
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
    const input: IncidentMergeInput = guardResult.modifiedPayload
      ? incidentMergeSchema.parse({
          ...initialInput,
          ...guardResult.modifiedPayload,
          id: initialInput.id,
          tenantId: initialInput.tenantId,
          organizationId: initialInput.organizationId,
        })
      : initialInput

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<IncidentMergeInput, MergeCommandResult>(
      'incidents.incident.merge',
      { input, ctx },
    )

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

    return NextResponse.json({
      ok: true,
      targetIncidentId: result.targetIncidentId,
      updatedAt: normalizeDate(result.updatedAt),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.merge failed', err)
    return NextResponse.json({ error: '[internal] merge_failed' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Merge incident',
  pathParams: mergePathParamsSchema,
  methods: {
    POST: {
      summary: 'Merge incident',
      description: 'Merges the source incident into the target incident and closes the source.',
      requestBody: {
        contentType: 'application/json',
        schema: incidentMergeSchema,
      },
      responses: [
        { status: 200, description: 'Incident merged', schema: mergeResponseSchema },
        { status: 400, description: 'Invalid payload', schema: mergeErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: mergeErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: mergeErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: mergeErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: mergeErrorResponseSchema },
      ],
    },
  },
}
