import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { TransportVehiclePosition } from '../../../data/entities'
import {
  recordVehiclePositionBatchSchema,
  recordVehiclePositionSchema,
} from '../../../data/validators'
import '../../../commands/tracking'

const logger = createLogger('transport_operations')

export const metadata = {
  path: '/transport_operations/tracking/positions',
  POST: { requireAuth: true, requireFeatures: ['transport.telematics.ingest'] },
  DELETE: { requireAuth: true, requireFeatures: ['transport.admin'] },
}

const bodySchema = z.union([recordVehiclePositionSchema, recordVehiclePositionBatchSchema])

async function resolveContext(req: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  const userId = auth.sub ?? auth.userId
  if (!userId) return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return { error: NextResponse.json({ error: 'Organization context is required' }, { status: 400 }) }
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth: {
      sub: userId,
      tenantId: auth.tenantId,
      orgId: organizationId,
      isSuperAdmin: false,
      isApiKey: false,
    } as unknown as CommandRuntimeContext['auth'],
    organizationScope,
    selectedOrganizationId: organizationId,
    organizationIds: organizationScope?.filterIds ?? [organizationId],
    request: req,
  }
  return { container, ctx, userId, tenantId: auth.tenantId, organizationId }
}

export async function POST(req: Request) {
  try {
    const context = await resolveContext(req)
    if ('error' in context) return context.error
    const raw = await readJsonSafe(req, {})
    const parsed = bodySchema.parse(raw ?? {})
    const positions = 'positions' in parsed ? parsed.positions : [parsed]
    const vehicleId = positions[0]?.vehicleId ?? context.organizationId

    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.userId,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
      },
      input: {
        resourceKind: 'transport_operations:transport_vehicle_position',
        resourceId: vehicleId,
        operation: 'create',
        mutationPayload: parsed,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      Record<string, unknown>,
      { inserted: number; ids: string[] }
    >('transport_operations.positions.record', {
      input: { positions },
      ctx: context.ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, inserted: result.inserted, ids: result.ids })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('transport_operations.positions.failed', { err })
    return NextResponse.json({ error: 'Unable to record positions' }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    const context = await resolveContext(req)
    if ('error' in context) return context.error
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const em = context.container.resolve('em') as EntityManager
    const position = await em.findOne(TransportVehiclePosition, {
      id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    if (!position) return NextResponse.json({ error: 'Position not found' }, { status: 404 })
    em.remove(position)
    await em.flush()
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('transport_operations.position_delete.failed', { err })
    return NextResponse.json({ error: 'Unable to delete the position' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Transport Operations',
  summary: 'Vehicle telematics positions',
  methods: {
    POST: {
      summary: 'Record one position or a batch from a telematics provider',
      requestBody: { contentType: 'application/json', schema: bodySchema },
      responses: [{
        status: 200,
        description: 'Positions recorded',
        schema: z.object({ ok: z.boolean(), inserted: z.number(), ids: z.array(z.string().uuid()) }),
      }],
    },
    DELETE: {
      summary: 'Delete a recorded position (administrative correction)',
      responses: [{
        status: 200,
        description: 'Position deleted',
        schema: z.object({ ok: z.boolean() }),
      }],
    },
  },
}
