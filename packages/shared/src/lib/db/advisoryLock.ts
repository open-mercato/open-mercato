import type { EntityManager } from '@mikro-orm/postgresql'
import { calculateBackoffDelayMs } from '../delivery/retry'
import { isTransientLockDbError } from './pg-errors'

export { isTransientLockDbError }

export type AdvisoryLockWaitResult<T> = { done: true; value: T } | { done: false }

export type AdvisoryLockOptions<T> = {
  /** Total waiting budget from the call start. Default 15_000. */
  waitDeadlineMs?: number
  /** Called after each failed attempt, with no connection held; `done: true` short-circuits. */
  onWait?: () => Promise<AdvisoryLockWaitResult<T>>
  /** Per process and key namespace: at most this many lock transactions at once (attempts included).
   *  Waiting for a slot holds no connection and counts against `waitDeadlineMs`. Default: unlimited. */
  maxConcurrentHolders?: number
}

/**
 * The lock was not obtained: `deadline` when the wait budget ran out (contention or
 * no free holder slot), `transient_db` when the helper's own begin, lock query or
 * commit failed with an error `isTransientLockDbError` accepts (kept as `cause`).
 * `reason` is additive-only; branch on it, never on the message.
 */
export class AdvisoryLockUnavailableError extends Error {
  readonly reason: 'deadline' | 'transient_db'
  readonly key: string
  constructor(reason: 'deadline' | 'transient_db', key: string, cause?: unknown) {
    super(
      reason === 'deadline'
        ? '[internal] Advisory lock not acquired before the wait deadline'
        : '[internal] Advisory lock transaction failed with a transient database error',
      cause === undefined ? undefined : { cause },
    )
    this.name = 'AdvisoryLockUnavailableError'
    this.reason = reason
    this.key = key
  }
}

const DEFAULT_WAIT_DEADLINE_MS = 15_000
const BACKOFF_ATTEMPT_CAP = 5
const BACKOFF_OPTIONS = { baseDelayMs: 50, maxJitterMs: 25 }
const KEY_NAMESPACE_PATTERN = /^[a-z][a-z0-9_]*$/
const ADVISORY_LOCK_SQL = 'select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as locked'

/**
 * `disableContextResolution` keeps the fork off an outer transaction resolved from the
 * async context, `useContext: false` keeps the fork's own transaction from joining one
 * later, and the cloned event manager carries the request's subscribers (tenant field
 * encryption among them) into the lock transaction.
 */
const LOCK_FORK_OPTIONS = {
  disableContextResolution: true,
  clear: true,
  useContext: false,
  cloneEventManager: true,
}

/**
 * Holder slots live on `globalThis` so duplicated module instances in one process (dev
 * HMR, standalone server chunks) count against one limit. The map is created once and
 * never replaced; each namespace entry is created on first use and kept.
 */
const GLOBAL_SLOTS_KEY = '__openMercatoAdvisoryLockSlots__'

type SlotWaiter = {
  limit: number
  grant: () => void
}

type NamespaceSlots = {
  held: number
  waiters: SlotWaiter[]
}

type SlotRelease = () => void

type AttemptOutcome<T> = { acquired: true; value: T } | { acquired: false }

const NOT_ACQUIRED: AttemptOutcome<never> = { acquired: false }

const releaseNothing: SlotRelease = () => undefined

function getSlotRegistry(): Map<string, NamespaceSlots> {
  const globals = globalThis as Record<string, unknown>
  const existing = globals[GLOBAL_SLOTS_KEY]
  if (existing instanceof Map) return existing as Map<string, NamespaceSlots>
  const created = new Map<string, NamespaceSlots>()
  globals[GLOBAL_SLOTS_KEY] = created
  return created
}

function getNamespaceSlots(namespace: string): NamespaceSlots {
  const registry = getSlotRegistry()
  const existing = registry.get(namespace)
  if (existing) return existing
  const created: NamespaceSlots = { held: 0, waiters: [] }
  registry.set(namespace, created)
  return created
}

function handOffSlots(slots: NamespaceSlots): void {
  let index = 0
  while (index < slots.waiters.length) {
    const waiter = slots.waiters[index]
    if (slots.held >= waiter.limit) {
      index += 1
      continue
    }
    slots.waiters.splice(index, 1)
    slots.held += 1
    waiter.grant()
  }
}

function createSlotRelease(slots: NamespaceSlots): SlotRelease {
  let released = false
  return () => {
    if (released) return
    released = true
    slots.held -= 1
    handOffSlots(slots)
  }
}

function acquireSlot(namespace: string, limit: number, key: string, deadlineAt: number): Promise<SlotRelease> {
  const slots = getNamespaceSlots(namespace)
  if (slots.held < limit) {
    slots.held += 1
    return Promise.resolve(createSlotRelease(slots))
  }
  const remainingMs = deadlineAt - Date.now()
  if (remainingMs <= 0) return Promise.reject(new AdvisoryLockUnavailableError('deadline', key))
  return new Promise<SlotRelease>((resolve, reject) => {
    const waiter: SlotWaiter = {
      limit,
      grant: () => {
        clearTimeout(deadlineTimer)
        resolve(createSlotRelease(slots))
      },
    }
    const deadlineTimer = setTimeout(() => {
      const position = slots.waiters.indexOf(waiter)
      if (position >= 0) slots.waiters.splice(position, 1)
      reject(new AdvisoryLockUnavailableError('deadline', key))
    }, remainingMs)
    slots.waiters.push(waiter)
  })
}

function parseKeyNamespace(key: unknown): string {
  const separator = typeof key === 'string' ? key.indexOf(':') : -1
  if (typeof key === 'string' && separator > 0 && separator < key.length - 1) {
    const namespace = key.slice(0, separator)
    if (KEY_NAMESPACE_PATTERN.test(namespace)) return namespace
  }
  throw new TypeError('[internal] Advisory lock key must be "<namespace>:<parts>" with a namespace matching ^[a-z][a-z0-9_]*$')
}

function resolveWaitDeadlineMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_DEADLINE_MS
  if (Number.isFinite(value) && value >= 0) return value
  throw new TypeError('[internal] Advisory lock waitDeadlineMs must be a finite number of at least 0')
}

function resolveMaxConcurrentHolders(value: number | undefined): number | null {
  if (value === undefined) return null
  if (Number.isInteger(value) && value > 0) return value
  throw new TypeError('[internal] Advisory lock maxConcurrentHolders must be a positive integer')
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function attemptLock<T>(
  lockEm: EntityManager,
  key: string,
  fn: (txEm: EntityManager) => Promise<T>,
): Promise<AttemptOutcome<T>> {
  const callbackFailure: { thrown: boolean; error: unknown } = { thrown: false, error: undefined }
  try {
    return await lockEm.transactional(async (txEm): Promise<AttemptOutcome<T>> => {
      const rows = await txEm.execute<Array<{ locked: boolean }>>(ADVISORY_LOCK_SQL, [key])
      if (rows[0]?.locked !== true) return NOT_ACQUIRED
      try {
        return { acquired: true, value: await fn(txEm) }
      } catch (error) {
        callbackFailure.thrown = true
        callbackFailure.error = error
        throw error
      }
    })
  } catch (error) {
    if (callbackFailure.thrown) throw callbackFailure.error
    if (isTransientLockDbError(error)) throw new AdvisoryLockUnavailableError('transient_db', key, error)
    throw error
  }
}

/**
 * Runs `fn` in one transaction that holds `pg_try_advisory_xact_lock(hashtextextended(key, 0))`.
 * - `key` is `<namespace>:<parts>` with namespace `^[a-z][a-z0-9_]*$`; anything else throws `TypeError`.
 * - `waitDeadlineMs` must be a finite number ≥ 0 and `maxConcurrentHolders` a positive integer;
 *   anything else throws `TypeError` before any connection is taken.
 * - Pass the request (container) EntityManager. The helper forks it with
 *   `{ disableContextResolution: true, clear: true, useContext: false, cloneEventManager: true }`,
 *   so the lock transaction never nests in a caller's transaction and commits on its own.
 * - `fn` MUST do all DB I/O on `txEm`, MUST flush its own writes, MUST be bounded (≤ one external
 *   call), MUST NOT call `transactional` again (it only opens a savepoint in the lock transaction) and
 *   MUST NOT fork or use `getConnection().execute` (another pooled connection, outside the lock).
 * - `txEm` carries the request EntityManager's subscribers (cloned event manager).
 * - A failed attempt ends its empty transaction, so waiters hold no connection between attempts.
 *   They back off 50 ms doubling up to 800 ms (plus up to 24 ms jitter), never past
 *   `waitDeadlineMs` measured from the call start, then call `onWait`, then retry.
 * - With `maxConcurrentHolders`, each attempt first takes a per-process slot for the key
 *   namespace and gives it back when the attempt fails or the lock transaction settles.
 * - Errors from the helper's own begin, lock query and commit that `isTransientLockDbError` accepts,
 *   and the deadline, throw `AdvisoryLockUnavailableError`; any other error from them, and every
 *   error thrown by `fn` or `onWait`, propagates unchanged (a throw from `fn` rolls back).
 */
export async function withAdvisoryXactLock<T>(
  em: EntityManager,
  key: string,
  fn: (txEm: EntityManager) => Promise<T>,
  options: AdvisoryLockOptions<T> = {},
): Promise<T> {
  const namespace = parseKeyNamespace(key)
  const waitDeadlineMs = resolveWaitDeadlineMs(options.waitDeadlineMs)
  const maxConcurrentHolders = resolveMaxConcurrentHolders(options.maxConcurrentHolders)
  const deadlineAt = Date.now() + waitDeadlineMs
  const lockEm = em.fork(LOCK_FORK_OPTIONS)
  for (let attempt = 1; ; attempt += 1) {
    const releaseSlot = maxConcurrentHolders === null
      ? releaseNothing
      : await acquireSlot(namespace, maxConcurrentHolders, key, deadlineAt)
    let outcome: AttemptOutcome<T>
    try {
      outcome = await attemptLock(lockEm, key, fn)
    } finally {
      releaseSlot()
    }
    if (outcome.acquired) return outcome.value
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) throw new AdvisoryLockUnavailableError('deadline', key)
    await sleep(Math.min(calculateBackoffDelayMs(Math.min(attempt, BACKOFF_ATTEMPT_CAP), BACKOFF_OPTIONS), remainingMs))
    if (options.onWait) {
      const waitResult = await options.onWait()
      if (waitResult.done) return waitResult.value
    }
    if (Date.now() >= deadlineAt) throw new AdvisoryLockUnavailableError('deadline', key)
  }
}
