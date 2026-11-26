import type { EventSubscriber } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '../logger'
import { getTelemetryRuntime } from '../telemetry/runtime'

type AfterCommit = () => void | Promise<void>

const logger = createLogger('shared').child({ component: 'after-commit' })
const commitStateKey = Symbol.for('@open-mercato/shared/db/afterCommit')
type CommitState = {
  parentByManager: WeakMap<object, object>
  parentBySavepoint: WeakMap<object, object>
  callbacksByTransaction: WeakMap<object, AfterCommit[]>
}
const scope = globalThis as typeof globalThis & { [commitStateKey]?: CommitState }
const { parentByManager, parentBySavepoint, callbacksByTransaction } = scope[commitStateKey] ??= {
  parentByManager: new WeakMap(),
  parentBySavepoint: new WeakMap(),
  callbacksByTransaction: new WeakMap(),
}

async function runCallback(callback: AfterCommit): Promise<void> {
  try {
    await callback()
  } catch (err) {
    logger.error('Post-commit callback failed', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'shared',
      code: 'shared.post_commit_callback_failed',
    })
  }
}

function addCallbacks(transaction: object, callbacks: AfterCommit[]) {
  const pending = callbacksByTransaction.get(transaction)
  if (pending) pending.push(...callbacks)
  else callbacksByTransaction.set(transaction, callbacks)
}

export const transactionCommitSubscriber: EventSubscriber = {
  beforeTransactionStart({ em, transaction }) {
    if (transaction) parentByManager.set(em, transaction)
    else parentByManager.delete(em)
  },
  afterTransactionStart({ em, transaction }) {
    const parent = parentByManager.get(em)
    parentByManager.delete(em)
    if (transaction && parent) parentBySavepoint.set(transaction, parent)
  },
  async afterTransactionCommit({ transaction }) {
    if (!transaction) return
    const callbacks = callbacksByTransaction.get(transaction)
    callbacksByTransaction.delete(transaction)
    const parent = parentBySavepoint.get(transaction)
    parentBySavepoint.delete(transaction)
    if (!callbacks) return
    if (parent) {
      addCallbacks(parent, callbacks)
      return
    }
    for (const callback of callbacks) await runCallback(callback)
  },
  afterTransactionRollback({ transaction }) {
    if (!transaction) return
    callbacksByTransaction.delete(transaction)
    parentBySavepoint.delete(transaction)
  },
}

export async function deferAfterTransactionCommit(em: EntityManager, callback: AfterCommit): Promise<void> {
  const context = em.getContext(false)
  const transaction = context.getTransactionContext()
  if (!transaction) {
    await runCallback(callback)
    return
  }
  const eventManager = context.getEventManager()
  if (transaction.savepointName && !parentBySavepoint.has(transaction)) {
    throw new Error('[internal] Transaction commit subscriber must be registered before opening savepoints')
  }
  if (!eventManager.getSubscribers().has(transactionCommitSubscriber)) {
    eventManager.registerSubscriber(transactionCommitSubscriber)
  }
  addCallbacks(transaction, [callback])
}
