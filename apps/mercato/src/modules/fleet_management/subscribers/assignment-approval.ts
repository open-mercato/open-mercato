import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  FleetVehicleAssignment,
  FleetVehicleOdometerLog,
} from '../data/entities'
import { findFleetVehicle, updateFleetVehicleOdometer } from '../lib/fleetService'
import {
  fleetAssignmentEvents,
  fleetAssignmentIndexer,
  fleetOdometerLogEvents,
  fleetOdometerLogIndexer,
} from '../commands/fleet'

const logger = createLogger('fleet_management')

export const metadata = {
  event: 'hr_management.approval_request.decided',
  persistent: true,
  id: 'fleet_management:assignment-approval',
}

type ApprovalDecidedPayload = {
  approvalRequestId?: string
  entityType?: string
  entityId?: string
  status?: string
  tenantId?: string
  organizationId?: string
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  payload: ApprovalDecidedPayload | null | undefined,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload || payload.entityType !== 'fleet_vehicle_assignment') return
  if (typeof payload.entityId !== 'string' || typeof payload.tenantId !== 'string') return
  if (typeof payload.organizationId !== 'string' || !payload.organizationId) return
  const tenantId = payload.tenantId
  const organizationId = payload.organizationId
  const scope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const dataEngine = ctx.resolve('dataEngine') as DataEngine

  const existing = await em.findOne(FleetVehicleAssignment, {
    id: payload.entityId,
    ...scope,
    deletedAt: null,
  })
  if (!existing) return
  if (existing.status !== 'pending_approval') return

  if (payload.status === 'approved') {
    const result = await em.transactional(async (transactionEm) => {
      const assignment = await transactionEm.findOne(FleetVehicleAssignment, {
        id: existing.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!assignment || assignment.status !== 'pending_approval') return null
      const vehicle = await findFleetVehicle(transactionEm, scope, assignment.vehicleId, { forUpdate: true })
      if (!vehicle) return null
      const now = new Date()
      assignment.status = 'active'
      assignment.assignedAt = now
      assignment.approvalRequestId = payload.approvalRequestId ?? assignment.approvalRequestId ?? null
      assignment.updatedAt = now
      const log = transactionEm.create(FleetVehicleOdometerLog, {
        tenantId,
        organizationId,
        vehicleId: vehicle.id,
        reading: assignment.handoverOdometer ?? vehicle.currentOdometer,
        recordedAt: now,
        source: 'assignment_handover',
        assignmentId: assignment.id,
        notes: assignment.custodyNotes ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      await updateFleetVehicleOdometer(
        transactionEm,
        scope,
        vehicle.id,
        assignment.handoverOdometer ?? vehicle.currentOdometer,
        now,
      )
      await transactionEm.persist([assignment, log]).flush()
      return { assignment, log }
    })
    if (!result) return
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: result.assignment,
      identifiers: { id: result.assignment.id, ...scope },
      events: fleetAssignmentEvents,
      indexer: fleetAssignmentIndexer,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: result.log,
      identifiers: { id: result.log.id, ...scope },
      events: fleetOdometerLogEvents,
      indexer: fleetOdometerLogIndexer,
    })
    return
  }

  if (payload.status === 'rejected' || payload.status === 'cancelled') {
    existing.status = payload.status === 'rejected' ? 'rejected' : 'cancelled'
    existing.updatedAt = new Date()
    await em.flush()
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: existing,
      identifiers: { id: existing.id, ...scope },
      events: fleetAssignmentEvents,
      indexer: fleetAssignmentIndexer,
    }).catch((error) => {
      logger.warn('Fleet assignment decision side effect failed', { err: error })
    })
  }
}
