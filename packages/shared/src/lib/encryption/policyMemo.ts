import type { EntityManager } from '@mikro-orm/postgresql'
import type { EncryptedFieldRule, EncryptionMapRecord } from './tenantDataEncryptionService'

export type ResolvedEncryptionPolicy = {
  map: EncryptionMapRecord | null
  fields: EncryptedFieldRule[]
}

type PolicyMemo = {
  generation: number
  entries: Map<string, Promise<ResolvedEncryptionPolicy>>
}

const policyMemos = new WeakMap<object, PolicyMemo>()
let policyMemoGeneration = 0

function resolvePolicyMemoOwners(em: EntityManager): object[] {
  const candidate = em as unknown as { getTransactionContext?: () => unknown }
  const context = typeof candidate.getTransactionContext === 'function'
    ? candidate.getTransactionContext()
    : undefined
  return context && typeof context === 'object' ? [context, em] : [em]
}

/**
 * The encryption-policy reads of one unit of work: keyed by the EntityManager's open transaction
 * when it has one, otherwise by the EntityManager itself, so the memo can never outlive either.
 */
export function getEncryptionPolicyMemo(em: EntityManager): Map<string, Promise<ResolvedEncryptionPolicy>> {
  const [owner] = resolvePolicyMemoOwners(em)
  const existing = policyMemos.get(owner)
  if (existing && existing.generation === policyMemoGeneration) return existing.entries
  const memo: PolicyMemo = { generation: policyMemoGeneration, entries: new Map() }
  policyMemos.set(owner, memo)
  return memo.entries
}

/** Retire every policy memo of this process; called after an encryption map is invalidated. */
export function invalidateEncryptionPolicyMemos(): void {
  policyMemoGeneration += 1
}

/**
 * Forget the encryption-policy reads memoized for an EntityManager (and its open transaction).
 * Encryption-map writers call it right after writing through that EntityManager so later
 * encrypt/decrypt decisions in the same unit of work see the new policy.
 */
export function forgetEncryptionPolicyMemo(em: EntityManager | null | undefined): void {
  if (!em) return
  for (const owner of resolvePolicyMemoOwners(em)) policyMemos.delete(owner)
}
