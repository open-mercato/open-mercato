import {
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

/**
 * Change simulator event adapters for the sales document events whose emitter is audited
 * (`commands/documents.ts`). Only `sales.orders.create` and `sales.quotes.create` pass the CRUD
 * event config, so `sales.order.created` / `sales.quote.created` are the only CRUD events; the
 * update and delete commands (and every undo) emit none. The payload adds `userId`, the acting
 * user (`ctx.auth.sub`): it is taken from the audit actor only for user actors outside agent
 * runs (an agent run records the agent as the actor while the payload carries the invoking
 * user) and when the entry carries its cause, and is unknown otherwise.
 * `sales.order.confirmed` / `.cancelled` are not adapted: they are emitted without a tenant
 * scope in the emit options, so the rule and workflow triggers never evaluate them.
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
  ],
})

export default simulateConfig
