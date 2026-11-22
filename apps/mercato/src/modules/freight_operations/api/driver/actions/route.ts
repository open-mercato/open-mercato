import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { FreightOrder, FreightTrip } from '../../../data/entities'
import { driverActionSchema } from '../../../data/validators'
import { resolveDriverForUser } from '../../../lib/driverIdentity'
import { FREIGHT_ORDER_ENTITY_ID, FREIGHT_TRIP_ENTITY_ID } from '../../../commands/entities'
import '../../../commands/orders'
import '../../../commands/trips'
import '../../../commands/driver'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/freight_operations/driver/actions',
  POST: { requireAuth: true, requireFeatures: ['freight.driver_app'] },
}

const REST_BREAK_RESOURCE = 'freight_operations:freight_driver_rest_break'
const DRIVER_ALERT_RESOURCE = 'freight_operations:freight_driver_alert'

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const userId = auth.sub ?? auth.userId
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const scope = { tenantId: auth.tenantId, organizationId }
    const em = container.resolve('em') as EntityManager
    const driver = await resolveDriverForUser(em, scope, userId)
    if (!driver) {
      return NextResponse.json({ error: 'No driver record is linked to this user.' }, { status: 403 })
    }

    const raw = await readJsonSafe(req, {})
    const input = driverActionSchema.parse(raw ?? {})

    let resourceKind: string = REST_BREAK_RESOURCE
    let resourceId = driver.id
    if (input.type === 'order_dispatch' || input.type === 'order_deliver') {
      const order = await em.findOne(FreightOrder, {
        id: input.orderId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      if (order.driverId !== driver.id) {
        return NextResponse.json({ error: 'This order is not assigned to you.' }, { status: 403 })
      }
      resourceKind = FREIGHT_ORDER_ENTITY_ID
      resourceId = order.id
    } else if (input.type === 'trip_start' || input.type === 'trip_deliver') {
      const trip = await em.findOne(FreightTrip, {
        id: input.tripId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 })
      if (trip.driverId !== driver.id) {
        return NextResponse.json({ error: 'This trip is not assigned to you.' }, { status: 403 })
      }
      resourceKind = FREIGHT_TRIP_ENTITY_ID
      resourceId = trip.id
    } else if (input.type === 'sos') {
      resourceKind = DRIVER_ALERT_RESOURCE
      resourceId = input.tripId ?? input.orderId ?? driver.id
    }

    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      input: {
        resourceKind,
        resourceId,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response

    const ctx: CommandRuntimeContext = {
      container,
      auth: {
        sub: userId,
        tenantId: scope.tenantId,
        orgId: scope.organizationId,
        isSuperAdmin: false,
        isApiKey: false,
      } as unknown as CommandRuntimeContext['auth'],
      organizationScope,
      selectedOrganizationId: scope.organizationId,
      organizationIds: organizationScope?.filterIds ?? [scope.organizationId],
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus

    let commandId: string
    let commandInput: Record<string, unknown>
    switch (input.type) {
      case 'order_dispatch':
        commandId = 'freight_operations.orders.dispatch'
        commandInput = { id: input.orderId }
        break
      case 'order_deliver':
        commandId = 'freight_operations.orders.deliver'
        commandInput = {
          id: input.orderId,
          podReference: input.podReference,
          ...(input.podReceivedByName ? { podReceivedByName: input.podReceivedByName } : {}),
        }
        break
      case 'trip_start':
        commandId = 'freight_operations.trips.start'
        commandInput = { id: input.tripId }
        break
      case 'trip_deliver':
        commandId = 'freight_operations.trips.deliver'
        commandInput = {
          id: input.tripId,
          podReference: input.podReference,
          ...(input.podReceivedByName ? { podReceivedByName: input.podReceivedByName } : {}),
        }
        break
      case 'rest_start':
        commandId = 'freight_operations.driver.rest_start'
        commandInput = { driverId: driver.id, tripId: input.tripId ?? null }
        break
      case 'rest_end':
        commandId = 'freight_operations.driver.rest_end'
        commandInput = { driverId: driver.id, breakId: input.breakId }
        break
      case 'sos':
        commandId = 'freight_operations.driver.sos'
        commandInput = {
          driverId: driver.id,
          tripId: input.tripId ?? null,
          orderId: input.orderId ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          note: input.note ?? null,
        }
        break
    }

    const { result } = await commandBus.execute<Record<string, unknown>, Record<string, unknown>>(
      commandId,
      { input: commandInput, ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, type: input.type, result })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('freight_operations.driver_action.failed', { err })
    return NextResponse.json({ error: 'Unable to perform the driver action' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Driver workspace actions',
  methods: {
    POST: {
      summary: 'Start or deliver an assigned order/trip, record a rest break, or raise SOS',
      requestBody: { contentType: 'application/json', schema: driverActionSchema },
      responses: [
        {
          status: 200,
          description: 'Action accepted',
          schema: z.object({
            ok: z.boolean(),
            type: z.string(),
            result: z.record(z.string(), z.unknown()),
          }),
        },
      ],
    },
  },
}
