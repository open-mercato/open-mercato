import type { AwilixContainer } from 'awilix'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { E } from '#generated/entities.ids.generated'
import type { Lease, LeaseProposal } from '../data/entities'
import { emitPropertyManagementEvent, type PropertyManagementEventId } from '../events'

const logger = createLogger('property_management')

export const leaseCrudIndexer: CrudIndexerConfig<Lease> = { entityType: E.property_management.lease }

export const leaseCrudEvents: CrudEventsConfig<Lease> = {
  module: 'property_management',
  entity: 'lease',
  persistent: true,
  buildPayload: (emitCtx) => ({
    id: emitCtx.identifiers.id,
    organizationId: emitCtx.identifiers.organizationId,
    tenantId: emitCtx.identifiers.tenantId,
  }),
}

export type LeaseLifecycleEvent = Extract<
  PropertyManagementEventId,
  | 'property_management.lease.activated'
  | 'property_management.lease.extended'
  | 'property_management.lease.ended'
  | 'property_management.lease.order_orphaned'
>

export type ProposalLifecycleEvent = Extract<
  PropertyManagementEventId,
  | 'property_management.lease_proposal.sent'
  | 'property_management.lease_proposal.withdrawn'
  | 'property_management.lease_proposal.expired'
>

export async function markLeaseChanged(container: AwilixContainer, lease: Lease, action: 'created' | 'updated' | 'deleted'): Promise<void> {
  try {
    const dataEngine = container.resolve('dataEngine') as DataEngine
    dataEngine.markOrmEntityChange({
      action,
      entity: lease,
      identifiers: { id: lease.id, organizationId: lease.organizationId, tenantId: lease.tenantId },
      indexer: leaseCrudIndexer,
      events: leaseCrudEvents,
    })
    await dataEngine.flushOrmEntityChanges()
  } catch (err) {
    logger.error('Lease side effects failed', { leaseId: lease.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_side_effects_failed' })
  }
}

export async function emitLeaseEvent(id: LeaseLifecycleEvent, lease: Lease, extra: Record<string, unknown> = {}): Promise<void> {
  await emitPropertyManagementEvent(
    id,
    {
      id: lease.id,
      leaseId: lease.id,
      reference: lease.reference,
      unitId: lease.unitId,
      buildingId: lease.buildingId,
      status: lease.status,
      endsOn: lease.endsOn,
      tenantId: lease.tenantId,
      organizationId: lease.organizationId,
      ...extra,
    },
    { persistent: true, tenantId: lease.tenantId, organizationId: lease.organizationId },
  ).catch((err) => {
    logger.error('Lease event failed', { id, leaseId: lease.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_event_failed' })
  })
}

export async function emitProposalEvent(id: ProposalLifecycleEvent, proposal: LeaseProposal): Promise<void> {
  await emitPropertyManagementEvent(
    id,
    {
      id: proposal.id,
      proposalId: proposal.id,
      leaseId: proposal.leaseId,
      kind: proposal.kind,
      status: proposal.status,
      tenantId: proposal.tenantId,
      organizationId: proposal.organizationId,
    },
    { persistent: true, tenantId: proposal.tenantId, organizationId: proposal.organizationId },
  ).catch((err) => {
    logger.error('Lease proposal event failed', { id, proposalId: proposal.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_proposal_event_failed' })
  })
}
