import type { EntityManager } from '@mikro-orm/postgresql'
import { getRequestScopeSlot } from '../di/request-scope'
import { parseNumberWithDefault } from '../number'
import type { EncryptedFieldRule, EncryptionMapRecord } from './tenantDataEncryptionService'

export type ResolvedEncryptionPolicy = {
  map: EncryptionMapRecord | null
  fields: EncryptedFieldRule[]
}

type PolicyMemo = {
  generation: number
  entries: Map<string, Promise<ResolvedEncryptionPolicy>>
}

type RequestPolicyEntry = {
  loadedAt: number
  policy: Promise<ResolvedEncryptionPolicy>
}

type RequestPolicyMemo = {
  generation: number
  entries: Map<string, RequestPolicyEntry>
}

const policyMemos = new WeakMap<object, PolicyMemo>()
let policyMemoGeneration = 0

const REQUEST_POLICY_MEMO_SLOT = Symbol.for('open-mercato.encryption.requestPolicyMemo')
const DEFAULT_REQUEST_POLICY_MEMO_MS = 5_000

function readOpenTransaction(em: EntityManager): object | null {
  const candidate = em as unknown as { getTransactionContext?: () => unknown }
  const context = typeof candidate.getTransactionContext === 'function'
    ? candidate.getTransactionContext()
    : undefined
  return context && typeof context === 'object' ? context : null
}

function resolvePolicyMemoOwners(em: EntityManager): object[] {
  const transaction = readOpenTransaction(em)
  return transaction ? [transaction, em] : [em]
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

/** Maximum age of a request-scoped policy read; `0` turns the request memo off. */
export function resolveRequestPolicyMemoMaxAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseNumberWithDefault(env.OM_ENCRYPTION_POLICY_REQUEST_MEMO_MS, DEFAULT_REQUEST_POLICY_MEMO_MS, { min: 0 })
}

function currentRequestPolicyMemo(): RequestPolicyMemo | null {
  const memo = getRequestScopeSlot<RequestPolicyMemo>(REQUEST_POLICY_MEMO_SLOT, () => ({
    generation: policyMemoGeneration,
    entries: new Map(),
  }))
  if (!memo) return null
  if (memo.generation !== policyMemoGeneration) {
    memo.entries.clear()
    memo.generation = policyMemoGeneration
  }
  return memo
}

function rememberUntilRejected<T>(entries: Map<string, T>, key: string, entry: T, policy: Promise<unknown>): void {
  entries.set(key, entry)
  policy.catch(() => {
    if (entries.get(key) === entry) entries.delete(key)
  })
}

/**
 * Resolve one encryption-policy read through the narrowest memo that is safe for the caller:
 *
 * 1. an EntityManager inside an open transaction keeps the transaction-keyed memo, so a map written
 *    in that transaction is visible to it and never reaches anyone else before it commits;
 * 2. inside an owned request scope, every container, fork and EntityManager-less call of the
 *    request shares one read per scope for at most `OM_ENCRYPTION_POLICY_REQUEST_MEMO_MS`;
 * 3. otherwise the per-EntityManager memo, or no memo when no EntityManager was handed in.
 *
 * Map writers and every flush drop both memos (`forgetEncryptionPolicyMemo`), and an in-process
 * map invalidation retires all of them (`invalidateEncryptionPolicyMemos`).
 */
export function resolveMemoizedEncryptionPolicy(
  key: string,
  em: EntityManager | undefined,
  load: () => Promise<ResolvedEncryptionPolicy>,
): Promise<ResolvedEncryptionPolicy> {
  const inTransaction = em ? readOpenTransaction(em) !== null : false
  const maxAgeMs = inTransaction ? 0 : resolveRequestPolicyMemoMaxAgeMs()
  const requestMemo = maxAgeMs > 0 ? currentRequestPolicyMemo() : null
  if (requestMemo) {
    const now = Date.now()
    const cached = requestMemo.entries.get(key)
    if (cached && now - cached.loadedAt <= maxAgeMs) return cached.policy
    const policy = load()
    rememberUntilRejected(requestMemo.entries, key, { loadedAt: now, policy }, policy)
    return policy
  }
  if (!em) return load()
  const memo = getEncryptionPolicyMemo(em)
  const pending = memo.get(key)
  if (pending) return pending
  const policy = load()
  rememberUntilRejected(memo, key, policy, policy)
  return policy
}

/** Retire every policy memo of this process; called after an encryption map is invalidated. */
export function invalidateEncryptionPolicyMemos(): void {
  policyMemoGeneration += 1
}

/**
 * Forget the encryption-policy reads memoized for an EntityManager (and its open transaction) and
 * for the current request. Encryption-map writers call it right after writing through that
 * EntityManager, and the encryption subscriber after every flush, so later encrypt/decrypt
 * decisions in the same unit of work see the new policy.
 */
export function forgetEncryptionPolicyMemo(em: EntityManager | null | undefined): void {
  currentRequestPolicyMemo()?.entries.clear()
  if (!em) return
  for (const owner of resolvePolicyMemoOwners(em)) policyMemos.delete(owner)
}
