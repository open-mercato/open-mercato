import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildTrustedSalesContext } from './salesCommandContext'
import {
  cancelRecurrence,
  readRecurrence,
  type CancelRecurrenceInput,
  type CancelRecurrenceResult,
  type RecurrenceRead,
} from './salesRecurrence'
import {
  findDocumentsByOperation,
  findFirstOrderLineId,
  loadSalesDocument,
  resolveOrderStatusEntryId,
  type SalesDocumentKind,
  type SalesDocumentSummary,
} from './salesLookups'
import type { Scope } from './productUse'

export type SalesDispatcher = {
  createOrder(payload: Record<string, unknown>): Promise<string>
  createQuote(payload: Record<string, unknown>): Promise<string>
  updateDocumentStatus(kind: SalesDocumentKind, id: string, statusEntryId: string): Promise<void>
  cancelRecurrence(input: CancelRecurrenceInput): Promise<CancelRecurrenceResult>
  readRecurrence(orderId: string): Promise<RecurrenceRead | null>
  findDocuments(kind: SalesDocumentKind, operationId: string, createdAt: Date): Promise<string[]>
  loadDocument(kind: SalesDocumentKind, id: string): Promise<SalesDocumentSummary | null>
  firstOrderLineId(orderId: string): Promise<string | null>
  resolveStatusEntryId(value: string): Promise<string | null>
}

function readId(result: unknown, key: 'orderId' | 'quoteId'): string {
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  const value = record[key]
  if (typeof value !== 'string' || !value.length) throw new Error(`[internal] Sales did not return ${key}`)
  return value
}

export function createSalesDispatcher(container: AwilixContainer, em: EntityManager, scope: Scope): SalesDispatcher {
  const commandBus = () => container.resolve('commandBus') as CommandBus
  const ctx = () => buildTrustedSalesContext(container, scope)
  const reader = () => em.fork()
  const scoped = (payload: Record<string, unknown>) => ({ ...payload, tenantId: scope.tenantId, organizationId: scope.organizationId })
  return {
    async createOrder(payload) {
      const { result } = await commandBus().execute<Record<string, unknown>, unknown>('sales.orders.create', { input: scoped(payload), ctx: ctx() })
      return readId(result, 'orderId')
    },
    async createQuote(payload) {
      const { result } = await commandBus().execute<Record<string, unknown>, unknown>('sales.quotes.create', { input: scoped(payload), ctx: ctx() })
      return readId(result, 'quoteId')
    },
    async updateDocumentStatus(kind, id, statusEntryId) {
      const commandId = kind === 'order' ? 'sales.orders.update' : 'sales.quotes.update'
      await commandBus().execute(commandId, { input: scoped({ id, statusEntryId }), ctx: ctx() })
    },
    cancelRecurrence: (input) => cancelRecurrence(container, scope, input),
    readRecurrence: (orderId) => readRecurrence(reader(), scope, orderId),
    findDocuments: (kind, operationId, createdAt) => findDocumentsByOperation(reader(), scope, kind, operationId, createdAt),
    loadDocument: (kind, id) => loadSalesDocument(reader(), scope, kind, id),
    firstOrderLineId: (orderId) => findFirstOrderLineId(reader(), scope, orderId),
    resolveStatusEntryId: (value) => resolveOrderStatusEntryId(reader(), scope, value),
  }
}
