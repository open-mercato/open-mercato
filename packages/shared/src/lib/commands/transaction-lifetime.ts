import type { EntityManager } from '@mikro-orm/postgresql'

export type TransactionOutcome = 'committed' | 'rolled_back'

type TransactionLifetime = {
  completionCallbacks: Set<(outcome: TransactionOutcome) => void | Promise<void>>
}

const activeTransactionLifetimes = new WeakMap<object, TransactionLifetime>()

export function beginTransactionLifetime(em: EntityManager): object {
  const key = em as object
  if (activeTransactionLifetimes.has(key)) {
    throw new Error('[internal] Transaction lifetime already active for EntityManager')
  }
  const lifetime: TransactionLifetime = { completionCallbacks: new Set() }
  activeTransactionLifetimes.set(key, lifetime)
  return lifetime
}

export function getTransactionLifetime(em: EntityManager): object | null {
  return activeTransactionLifetimes.get(em as object) ?? null
}

export function onTransactionLifetimeComplete(
  em: EntityManager,
  callback: (outcome: TransactionOutcome) => void | Promise<void>,
): void {
  const lifetime = activeTransactionLifetimes.get(em as object)
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
  const lifetime = activeTransactionLifetimes.get(key)
  if (!lifetime || lifetime !== lifetimeToken) {
    throw new Error('[internal] Transaction lifetime mismatch for EntityManager')
  }
  activeTransactionLifetimes.delete(key)
  for (const callback of lifetime.completionCallbacks) {
    await callback(outcome)
  }
}
