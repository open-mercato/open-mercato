import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolvePoolConfig } from '@open-mercato/shared/lib/db/mikro'
import { buildTrustedSalesContext } from './salesCommandContext'
import {
  cancelRecurrence,
  readRecurrence,
  SALES_RECURRENCE_CANCEL_COMMAND,
  type CancelRecurrenceInput,
  type CancelRecurrenceResult,
  type RecurrenceRead,
} from './salesRecurrence'
import {
  findDocumentsByOperation,
  findFirstOrderLineId,
  loadSalesDocument,
  resolveOrderStatusEntryId,
  type DocumentLookup,
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
  findDocuments(kind: SalesDocumentKind, lookup: DocumentLookup): Promise<string[]>
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
    findDocuments: (kind, lookup) => findDocumentsByOperation(reader(), scope, kind, lookup),
    loadDocument: (kind, id) => loadSalesDocument(reader(), scope, kind, id),
    firstOrderLineId: (orderId) => findFirstOrderLineId(reader(), scope, orderId),
    resolveStatusEntryId: (value) => resolveOrderStatusEntryId(reader(), scope, value),
  }
}

export const SALES_DISPATCH_TIMEOUT_SHARE = 0.75
export const FALLBACK_SALES_DISPATCH_TIMEOUT_MS = 90_000

export class SalesDispatchTimeoutError extends Error {
  readonly code = 'sales_dispatch_timeout'
  constructor(readonly call: string, readonly timeoutMs: number) {
    super(`[internal] Sales did not answer ${call} within ${timeoutMs} ms.`)
    this.name = 'SalesDispatchTimeoutError'
  }
}

export function resolveSalesDispatchTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const idleInTransactionMs = resolvePoolConfig(env).idleInTransactionTimeoutMs
  if (!idleInTransactionMs || idleInTransactionMs <= 0) return FALLBACK_SALES_DISPATCH_TIMEOUT_MS
  return Math.max(1, Math.floor(idleInTransactionMs * SALES_DISPATCH_TIMEOUT_SHARE))
}

export type SalesDispatchGuard = {
  timeoutMs: number
  beforeCall?: () => Promise<void>
  onLateCreate?: () => void
}

async function guardedCall<T>(name: string, call: () => Promise<T>, guard: SalesDispatchGuard, onLate?: () => void): Promise<T> {
  if (guard.beforeCall) await guard.beforeCall()
  return new Promise<T>((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      reject(new SalesDispatchTimeoutError(name, guard.timeoutMs))
    }, guard.timeoutMs)
    timer.unref?.()
    const settle = (finish: () => void) => {
      clearTimeout(timer)
      if (timedOut) {
        onLate?.()
        return
      }
      finish()
    }
    Promise.resolve()
      .then(call)
      .then(
        (value) => settle(() => resolve(value)),
        (err: unknown) => settle(() => reject(err)),
      )
  })
}

export function guardSalesDispatcher(dispatcher: SalesDispatcher, guard: SalesDispatchGuard): SalesDispatcher {
  const run = <T>(name: string, call: () => Promise<T>, onLate?: () => void) => guardedCall(name, call, guard, onLate)
  return {
    createOrder: (payload) => run('sales.orders.create', () => dispatcher.createOrder(payload), guard.onLateCreate),
    createQuote: (payload) => run('sales.quotes.create', () => dispatcher.createQuote(payload), guard.onLateCreate),
    updateDocumentStatus: (kind, id, statusEntryId) =>
      run(kind === 'order' ? 'sales.orders.update' : 'sales.quotes.update', () => dispatcher.updateDocumentStatus(kind, id, statusEntryId)),
    cancelRecurrence: (input) => run(SALES_RECURRENCE_CANCEL_COMMAND, () => dispatcher.cancelRecurrence(input)),
    readRecurrence: (orderId) => run('readRecurrence', () => dispatcher.readRecurrence(orderId)),
    findDocuments: (kind, lookup) => run('findDocuments', () => dispatcher.findDocuments(kind, lookup)),
    loadDocument: (kind, id) => run('loadDocument', () => dispatcher.loadDocument(kind, id)),
    firstOrderLineId: (orderId) => run('firstOrderLineId', () => dispatcher.firstOrderLineId(orderId)),
    resolveStatusEntryId: (value) => run('resolveStatusEntryId', () => dispatcher.resolveStatusEntryId(value)),
  }
}
