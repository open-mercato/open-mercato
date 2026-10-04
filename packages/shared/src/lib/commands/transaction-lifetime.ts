import { AsyncLocalStorage } from 'node:async_hooks'
import type { EntityManager } from '@mikro-orm/postgresql'

export type TransactionOutcome = 'committed' | 'rolled_back'

type TransactionLifetime = {
  completionCallbacks: Set<(outcome: TransactionOutcome) => void | Promise<void>>
}

const activeTransactionLifetimes = new AsyncLocalStorage<Map<object, TransactionLifetime>>()

export function beginTransactionLifetime(em: EntityManager): object {
  const key = em as object
  const currentLifetimes = activeTransactionLifetimes.getStore()
  if (currentLifetimes?.has(key)) {
    throw new Error('[internal] Transaction lifetime already active for EntityManager')
  }
  const lifetime: TransactionLifetime = { completionCallbacks: new Set() }
  const scopedLifetimes = new Map(currentLifetimes)
  scopedLifetimes.set(key, lifetime)
  activeTransactionLifetimes.enterWith(scopedLifetimes)
  return lifetime
}

export function getTransactionLifetime(em: EntityManager): object | null {
  return activeTransactionLifetimes.getStore()?.get(em as object) ?? null
}

export function onTransactionLifetimeComplete(
  em: EntityManager,
  callback: (outcome: TransactionOutcome) => void | Promise<void>,
): void {
  const lifetime = activeTransactionLifetimes.getStore()?.get(em as object)
  if (!lifetime) {
    throw new Error('[internal] Transaction-owned state requires an active transaction lifetime')
  }
  lifetime.completionCallbacks.add(callback)
}

export async function completeTransactionLifetime(
  em: EntityManager,
  lifetimeToken: object,
  outcome: TransactionOutcome,
): Promise<void> {
  const key = em as object
  const currentLifetimes = activeTransactionLifetimes.getStore()
  const lifetime = currentLifetimes?.get(key)
  if (!currentLifetimes || !lifetime || lifetime !== lifetimeToken) {
    throw new Error('[internal] Transaction lifetime mismatch for EntityManager')
  }
  currentLifetimes.delete(key)
  for (const callback of lifetime.completionCallbacks) {
    await callback(outcome)
  }
}
