import {
  SIMULATION_CRUD_ACTION_TYPES,
  createCrudEventAdapters,
  defineSimulateConfig,
  type SimulationAuditEntry,
  type SimulationEventAdapter,
  type SimulationEventPayload,
} from '@open-mercato/shared/modules/insights/simulate'
import { registerCatalogPriceLineSource } from '@open-mercato/core/modules/catalog/lib/simulation/priceLineSources'
import { salesPriceLineSources } from './lib/simulation/priceLineSources'
import './events'

/**
 * The order and quote line families of the catalog price backtest (`catalog.price_backtest`):
 * sales finds and classifies the lines that reference a price row; catalog owns the kind. Loaded
 * wherever the simulate registry loads (app and worker processes); a disabled sales module
 * registers nothing.
 */
for (const source of salesPriceLineSources) registerCatalogPriceLineSource(source)

type SalesDocumentCreatedSpec = {
  eventPrefix: string
  resourceKind: string
  createCommandId: string
  requiredFeatures: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isCreateUndoTrace(entry: SimulationAuditEntry): boolean {
  if (entry.causeKind === 'undo') return true
  if (entry.causeKind !== null) return false
  return !isRecord(entry.snapshotAfter) && isRecord(entry.snapshotBefore)
}

function actingUserPayload(entry: SimulationAuditEntry): SimulationEventPayload {
  const attributable = entry.actorKind === 'user' && entry.causeKind !== null && entry.causeKind !== 'agent'
  const actorUserId = attributable ? readNonEmptyString(entry.actorUserId) : null
  if (!actorUserId) return { payload: {}, unknownPaths: ['userId'] }
  return { payload: { userId: actorUserId }, valuePaths: ['userId'] }
}

function createSalesDocumentCreatedAdapter(spec: SalesDocumentCreatedSpec): SimulationEventAdapter[] {
  return createCrudEventAdapters({
    eventPrefix: spec.eventPrefix,
    logResourceKinds: [spec.resourceKind],
    requiredFeatures: spec.requiredFeatures,
    actions: ['created'],
    commandIds: { created: [spec.createCommandId] },
    syncOrigin: false,
    extraPayload: actingUserPayload,
  }).map((adapter): SimulationEventAdapter => ({
    ...adapter,
    payloadFrom(entry, ctx) {
      if (entry.executionState === 'failed' || entry.commandId !== spec.createCommandId) return null
      if (isCreateUndoTrace(entry)) return null
      return adapter.payloadFrom(entry, ctx)
    },
  }))
}

type OrderLifecycleEventId = 'sales.order.confirmed' | 'sales.order.cancelled'

const ORDER_CREATE_COMMAND_ID = 'sales.orders.create'
const ORDER_UPDATE_COMMAND_ID = 'sales.orders.update'

function readOrderSnapshot(snapshot: unknown): Record<string, unknown> | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.order)) return null
  return snapshot.order
}

function isOrderLifecycleStatus(eventId: OrderLifecycleEventId, status: string | null): boolean {
  if (eventId === 'sales.order.confirmed') return status === 'confirmed'
  return status === 'canceled' || status === 'cancelled'
}

/**
 * `sales.order.confirmed` / `.cancelled` as `emitOrderLifecycleEventsForTransition`
 * (`commands/documents.ts`) emits them: after `sales.orders.create` (previous status `null`) or
 * `sales.orders.update` whose order status changed to the event's status. The payload is rebuilt
 * from the order snapshots: `previousStatus` from `snapshotBefore`, `status` and `orderNumber` from
 * `snapshotAfter`. Undo traces and failed entries are skipped (an undo emits no lifecycle event).
 */
function createOrderLifecycleAdapter(eventId: OrderLifecycleEventId): SimulationEventAdapter {
  return {
    eventId,
    logResourceKinds: ['sales.order'],
    actionTypes: [...SIMULATION_CRUD_ACTION_TYPES.created, ...SIMULATION_CRUD_ACTION_TYPES.updated],
    requiredFeatures: ['sales.orders.view'],
    commandIds: [ORDER_CREATE_COMMAND_ID, ORDER_UPDATE_COMMAND_ID],
    payloadFrom(entry, ctx) {
      if (entry.causeKind === 'undo' || entry.executionState === 'failed') return null
      const created = entry.commandId === ORDER_CREATE_COMMAND_ID
      if (!created && entry.commandId !== ORDER_UPDATE_COMMAND_ID) return null
      if (created && isCreateUndoTrace(entry)) return null
      const after = readOrderSnapshot(entry.snapshotAfter)
      const before = created ? null : readOrderSnapshot(entry.snapshotBefore)
      if (!after || (!created && !before)) return null
      const id = readNonEmptyString(entry.resourceId) ?? readNonEmptyString(after.id)
      if (!id) return null
      const previousStatus = before ? readNonEmptyString(before.status) : null
      const status = readNonEmptyString(after.status)
      if (previousStatus === status || !isOrderLifecycleStatus(eventId, status)) return null
      const orderNumber = typeof after.orderNumber === 'string' ? after.orderNumber : null
      return {
        payload: {
          id,
          orderId: id,
          ...(orderNumber !== null ? { orderNumber } : {}),
          previousStatus,
          status,
          tenantId: ctx.scope.tenantId,
          organizationId: entry.organizationId ?? ctx.scope.organizationId,
        },
        ...(orderNumber === null ? { unknownPaths: ['orderNumber'] } : {}),
        valuePaths: orderNumber === null ? ['previousStatus', 'status'] : ['orderNumber', 'previousStatus', 'status'],
      }
    },
  }
}

/**
 * Change simulator event adapters for the sales document events whose emitter is audited
 * (`commands/documents.ts`). Only `sales.orders.create` and `sales.quotes.create` pass the CRUD
 * event config, so `sales.order.created` / `sales.quote.created` are the only CRUD events; the
 * update and delete commands (and every undo) emit none. The payload adds `userId`, the acting
 * user (`ctx.auth.sub`): it is taken from the audit actor only for user actors outside agent
 * runs (an agent run records the agent as the actor while the payload carries the invoking
 * user) and when the entry carries its cause, and is unknown otherwise.
 * `sales.order.confirmed` / `.cancelled` are emitted with the order's tenant and organization in
 * the emit options, so the rule and workflow triggers evaluate them; they are rebuilt from the
 * create and update entries (`createOrderLifecycleAdapter`).
 *
 * The module's events are imported here so the declared event catalog is complete wherever the
 * simulator runs (worker processes do not load the app's event registry); the trigger backtest
 * relies on it to tell whether a pattern selects events these adapters do not rebuild.
 */
export const simulateConfig = defineSimulateConfig({
  version: 1,
  eventAdapters: [
    ...createSalesDocumentCreatedAdapter({
      eventPrefix: 'sales.order',
      resourceKind: 'sales.order',
      createCommandId: 'sales.orders.create',
      requiredFeatures: ['sales.orders.view'],
    }),
    ...createSalesDocumentCreatedAdapter({
      eventPrefix: 'sales.quote',
      resourceKind: 'sales.quote',
      createCommandId: 'sales.quotes.create',
      requiredFeatures: ['sales.quotes.view'],
    }),
    createOrderLifecycleAdapter('sales.order.confirmed'),
    createOrderLifecycleAdapter('sales.order.cancelled'),
  ],
})

export default simulateConfig
