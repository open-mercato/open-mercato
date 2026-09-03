import { AgentCapacityError } from './admission'

/**
 * Process-local per-provider LLM budget (lightweight-agent-runtime spec
 * Phase 2). At the target scale the provider RPM/TPM ceiling — not CPU — is
 * the real limit, so the native runner wraps every model call in:
 *
 * 1. a bounded per-provider concurrency semaphore
 *    (`OM_AGENT_PROVIDER_MAX_CONCURRENT`, per-provider override
 *    `OM_AGENT_PROVIDER_MAX_CONCURRENT_<PROVIDER>`), and
 * 2. retry-on-429/overloaded with exponential backoff + full jitter
 *    (`OM_AGENT_PROVIDER_RETRY_MAX`, `OM_AGENT_PROVIDER_RETRY_BASE_MS`),
 *    always bounded by the run's own wall-clock deadline so there is no
 *    unbounded retry tail.
 *
 * The slot is held across retries deliberately: a call backing off after a 429
 * keeps its slot so the process cannot synchronize a retry storm against the
 * provider. Exhaustion surfaces as {@link AgentProviderCapacityError}, an
 * `AgentCapacityError` subclass — so the existing structural-`retryable`
 * queue-retry seam and the playground's 429 mapping apply unchanged.
 *
 * Deliberately PROCESS-LOCAL, mirroring the admission gate: the fleet-wide
 * bound is process budget × replicas (documented in the scaling runbook); a
 * distributed token bucket is a follow-up if observed 429 rates demand it.
 */

/** Budget exhaustion or bounded-wait expiry at the provider gate. Retryable. */
export class AgentProviderCapacityError extends AgentCapacityError {
  readonly providerId: string
  constructor(providerId: string, detail: string) {
    super(`provider "${providerId}" ${detail}`)
    this.name = 'AgentProviderCapacityError'
    this.providerId = providerId
  }
}

type ProviderWaiter = {
  admit: () => void
  reject: (err: AgentProviderCapacityError) => void
  timer: ReturnType<typeof setTimeout>
}

type ProviderState = {
  active: number
  queue: ProviderWaiter[]
}

const providerStates = new Map<string, ProviderState>()

function stateFor(providerId: string): ProviderState {
  let state = providerStates.get(providerId)
  if (!state) {
    state = { active: 0, queue: [] }
    providerStates.set(providerId, state)
  }
  return state
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function providerEnvSuffix(providerId: string): string {
  return providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

export function resolveProviderMaxConcurrent(providerId: string): number {
  const specific = Number.parseInt(
    process.env[`OM_AGENT_PROVIDER_MAX_CONCURRENT_${providerEnvSuffix(providerId)}`] ?? '',
    10,
  )
  if (Number.isFinite(specific) && specific > 0) return specific
  return readPositiveIntEnv('OM_AGENT_PROVIDER_MAX_CONCURRENT', 10)
}

function resolveRetryMax(): number {
  return readPositiveIntEnv('OM_AGENT_PROVIDER_RETRY_MAX', 4)
}

function resolveRetryBaseMs(): number {
  return readPositiveIntEnv('OM_AGENT_PROVIDER_RETRY_BASE_MS', 1000)
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = timer as { unref?: () => void }
  if (typeof maybeUnref.unref === 'function') maybeUnref.unref()
}

function releaseSlot(providerId: string): void {
  const state = stateFor(providerId)
  state.active = Math.max(0, state.active - 1)
  const next = state.queue.shift()
  if (next) {
    clearTimeout(next.timer)
    state.active += 1
    next.admit()
  }
}

function acquireSlot(providerId: string, deadlineAtMs: number): Promise<void> {
  const state = stateFor(providerId)
  const cap = resolveProviderMaxConcurrent(providerId)
  if (state.active < cap) {
    state.active += 1
    return Promise.resolve()
  }
  const waitMs = deadlineAtMs - Date.now()
  if (waitMs <= 0) {
    return Promise.reject(
      new AgentProviderCapacityError(providerId, `budget full (cap ${cap}) and the run deadline is exhausted`),
    )
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: ProviderWaiter = {
      admit: resolve,
      reject,
      timer: setTimeout(() => {
        const position = state.queue.indexOf(waiter)
        if (position >= 0) state.queue.splice(position, 1)
        reject(
          new AgentProviderCapacityError(
            providerId,
            `no budget slot became available within the run deadline (cap ${cap})`,
          ),
        )
      }, waitMs),
    }
    unrefTimer(waiter.timer)
    state.queue.push(waiter)
  })
}

/**
 * True for provider throttling failures worth backing off on: HTTP 429
 * (rate limit), 529/overloaded (Anthropic), and 503 service-unavailable
 * shapes. Duck-typed over the AI SDK's APICallError (`statusCode`) and plain
 * provider error payloads; anything else rethrows immediately.
 */
export function isRetryableProviderError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const candidate = err as {
    statusCode?: unknown
    status?: unknown
    message?: unknown
    data?: { error?: { type?: unknown } }
  }
  const status =
    typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : typeof candidate.status === 'number'
        ? candidate.status
        : null
  if (status === 429 || status === 529 || status === 503) return true
  if (candidate.data?.error && candidate.data.error.type === 'overloaded_error') return true
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  return /\brate limit|too many requests|overloaded\b/i.test(message)
}

function backoffDelayMs(attempt: number, baseMs: number): number {
  // Exponential + full jitter: uniform over [0, base * 2^attempt].
  return Math.floor(Math.random() * baseMs * 2 ** attempt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    unrefTimer(timer)
  })
}

export type ProviderBudgetOptions = {
  /** Resolved provider id from the model factory (budget key). */
  providerId: string
  /** Absolute epoch-ms deadline (the run's wall-clock deadline). Waits and backoffs never exceed it. */
  deadlineAtMs: number
}

/**
 * Run `fn` under the provider's budget slot, retrying throttling failures with
 * jittered exponential backoff while the run deadline allows. Non-throttling
 * errors rethrow untouched on the first occurrence.
 */
export async function runWithProviderBudget<T>(
  options: ProviderBudgetOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const { providerId, deadlineAtMs } = options
  await acquireSlot(providerId, deadlineAtMs)
  try {
    const retryMax = resolveRetryMax()
    const baseMs = resolveRetryBaseMs()
    let attempt = 0
    for (;;) {
      try {
        return await fn()
      } catch (err) {
        if (!isRetryableProviderError(err)) throw err
        if (attempt >= retryMax) {
          throw new AgentProviderCapacityError(
            providerId,
            `still throttling after ${retryMax} retries (${err instanceof Error ? err.message : String(err)})`,
          )
        }
        const delayMs = backoffDelayMs(attempt, baseMs)
        if (Date.now() + delayMs >= deadlineAtMs) {
          throw new AgentProviderCapacityError(
            providerId,
            `throttled and the remaining run deadline cannot absorb the ${delayMs}ms backoff`,
          )
        }
        await sleep(delayMs)
        attempt += 1
      }
    }
  } finally {
    releaseSlot(providerId)
  }
}

/** Test-only: reject queued waiters and reset all provider counters. */
export function resetProviderBudgetForTests(): void {
  for (const [providerId, state] of providerStates) {
    for (const waiter of state.queue.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new AgentProviderCapacityError(providerId, 'budget state reset'))
    }
  }
  providerStates.clear()
}
