import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runbookInstantiateSchema } from '../../../../data/validators'
import '../../../../commands/runbooks'

const pathParamsSchema = z.object({
  id: z.string().uuid(),
})

const requestBodySchema = z.object({
  runbookId: z.string().uuid().nullable().optional(),
}).passthrough()

const responseSchema = z.object({
  ok: z.boolean(),
  runbookId: z.string().uuid().nullable(),
  createdActionItemIds: z.array(z.string().uuid()),
  skippedActionItemIds: z.array(z.string().uuid()),
  updatedAt: z.string().nullable().optional(),
})

const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
})

const { withScopedPayload } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'incidents.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'incidents.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'incidents.errors.id_required', fallback: 'Incident id is required.' },
  },
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

type InstantiateResult = {
  incidentId: string
  runbookId: string | null
  createdActionItemIds: string[]
  skippedActionItemIds: string[]
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

async function resolveRequestContext(req: Request): Promise<{ ctx: CommandRuntimeContext }> {
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
    const { id } = pathParamsSchema.parse(params)
    const { ctx } = await resolveRequestContext(req)
    const body = requestBodySchema.parse(asRecord(await readJsonSafe(req)))
    const scoped = withScopedPayload({ ...body, id }, ctx, (key, fallback) => fallback ?? key)
    const input = runbookInstantiateSchema.parse(scoped)
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof input, InstantiateResult>(
      'incidents.runbook.instantiate',
      { input, ctx },
    )
    return NextResponse.json({
      ok: true,
      runbookId: result.runbookId,
      createdActionItemIds: result.createdActionItemIds,
      skippedActionItemIds: result.skippedActionItemIds,
      updatedAt: normalizeDate(result.updatedAt),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error('incidents.runbook instantiate failed', err)
    return NextResponse.json({ error: '[internal] runbook_instantiation_failed' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Instantiate incident runbook',
  pathParams: pathParamsSchema,
  methods: {
    POST: {
      summary: 'Instantiate incident runbook',
      description: 'Creates action items for the selected or default runbook on an incident.',
      requestBody: { contentType: 'application/json', schema: requestBodySchema },
      responses: [
        { status: 200, description: 'Runbook instantiated', schema: responseSchema },
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Incident or runbook not found', schema: errorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: errorResponseSchema },
        { status: 423, description: 'Record locked', schema: errorResponseSchema },
      ],
    },
  },
}
