/**
 * Process-local admission control for top-level agent runs (performance
 * hardening Phase 2). A bounded global + per-tenant semaphore protects this
 * process's DB pool, the LLM provider, and the single OpenCode container from
 * direct-caller bursts (playground, workflow jobs, scripts).
 *
 * Semantics:
 * - Admit immediately when BOTH the global count is under the global cap AND
 *   the caller tenant's count is under the per-tenant cap.
 * - Otherwise wait in a bounded FIFO queue. Admission on release is FIFO among
 *   ADMISSIBLE waiters: a waiter blocked only by its own tenant's cap never
 *   blocks other tenants' waiters behind it — the release scan admits the first
 *   waiter(s) whose caps allow it, not strictly the head.
 * - A full queue (`OM_AGENT_ADMISSION_MAX_QUEUE`) or an expired bounded wait
 *   (`OM_AGENT_ADMISSION_MAX_WAIT_MS`) rejects with `AgentCapacityError`.
 *
 * The gate is deliberately PROCESS-LOCAL: the fleet-wide throttle is queue
 * worker concurrency (`cap × replicas` is the true cluster bound — see the
 * scaling runbook). Config is read lazily on every acquire so deployments (and
 * tests) can vary the env without a process restart.
 */

export type AgentRunSlotRelease = () => void

/**
 * Typed capacity rejection. Carries the structural `retryable: true` marker so
 * consumers that cannot import enterprise types (the core workflows job
 * handler) can duck-type on `retryable` and rethrow for queue-level retry.
 */
export class AgentCapacityError extends Error {
  readonly code = 'agent_capacity'
  readonly retryable = true
  constructor(detail: string) {
    super(`[internal] agent run admission rejected: ${detail}`)
    this.name = 'AgentCapacityError'
  }
}

export function isAgentCapacityError(err: unknown): err is AgentCapacityError {
  return err instanceof AgentCapacityError || (err instanceof Error && err.name === 'AgentCapacityError')
}

type AdmissionConfig = {
  maxGlobal: number
  maxPerTenant: number
  maxWaitMs: number
  maxQueue: number
}

type Waiter = {
  tenantKey: string
  maxGlobal: number
  maxPerTenant: number
  admit: (release: AgentRunSlotRelease) => void
  reject: (err: AgentCapacityError) => void
  timer: ReturnType<typeof setTimeout>
}

const NO_TENANT_KEY = '__no_tenant__'

let globalCount = 0
const tenantCounts = new Map<string, number>()
const waitQueue: Waiter[] = []

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function resolveAdmissionConfig(): AdmissionConfig {
  return {
    maxGlobal: readPositiveIntEnv('OM_AGENT_MAX_CONCURRENT_RUNS', 25),
    maxPerTenant: readPositiveIntEnv('OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT', 10),
    maxWaitMs: readPositiveIntEnv('OM_AGENT_ADMISSION_MAX_WAIT_MS', 30_000),
    maxQueue: readPositiveIntEnv('OM_AGENT_ADMISSION_MAX_QUEUE', 100),
  }
}

/** Bounded-wait window in ms — exported so HTTP mappers can derive `Retry-After`. */
export function resolveAdmissionMaxWaitMs(): number {
  return resolveAdmissionConfig().maxWaitMs
}

function isAdmissible(tenantKey: string, maxGlobal: number, maxPerTenant: number): boolean {
  if (globalCount >= maxGlobal) return false
  return (tenantCounts.get(tenantKey) ?? 0) < maxPerTenant
}

function takeSlot(tenantKey: string): AgentRunSlotRelease {
  globalCount += 1
  tenantCounts.set(tenantKey, (tenantCounts.get(tenantKey) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    globalCount = Math.max(0, globalCount - 1)
    const tenantCount = tenantCounts.get(tenantKey) ?? 0
    if (tenantCount <= 1) tenantCounts.delete(tenantKey)
    else tenantCounts.set(tenantKey, tenantCount - 1)
    admitNextWaiters()
  }
}

/**
 * FIFO among admissible waiters: walk the queue in arrival order and admit
 * every waiter whose captured caps currently allow it, skipping (not blocking
 * on) waiters held back by their own tenant's cap.
 */
function admitNextWaiters(): void {
  let index = 0
  while (index < waitQueue.length) {
    const waiter = waitQueue[index]
    if (isAdmissible(waiter.tenantKey, waiter.maxGlobal, waiter.maxPerTenant)) {
      waitQueue.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.admit(takeSlot(waiter.tenantKey))
    } else {
      index += 1
    }
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = timer as { unref?: () => void }
  if (typeof maybeUnref.unref === 'function') maybeUnref.unref()
}

/**
 * Acquire one top-level agent-run slot for `tenantId`. Resolves with an
 * idempotent release function (double-release safe) that MUST be called in a
 * `finally`. Rejects with `AgentCapacityError` when the wait queue is full or
 * the bounded wait expires.
 */
export function acquireAgentRunSlot(tenantId: string | null | undefined): Promise<AgentRunSlotRelease> {
  const config = resolveAdmissionConfig()
  const tenantKey = tenantId ?? NO_TENANT_KEY

  if (isAdmissible(tenantKey, config.maxGlobal, config.maxPerTenant)) {
    return Promise.resolve(takeSlot(tenantKey))
  }
  if (waitQueue.length >= config.maxQueue) {
    return Promise.reject(
      new AgentCapacityError(`admission queue is full (${config.maxQueue} waiters)`),
    )
  }

  return new Promise<AgentRunSlotRelease>((resolve, reject) => {
    const waiter: Waiter = {
      tenantKey,
      maxGlobal: config.maxGlobal,
      maxPerTenant: config.maxPerTenant,
      admit: resolve,
      reject,
      timer: setTimeout(() => {
        const position = waitQueue.indexOf(waiter)
        if (position >= 0) waitQueue.splice(position, 1)
        reject(
          new AgentCapacityError(
            `no slot became available within ${config.maxWaitMs}ms (global cap ${config.maxGlobal}, tenant cap ${config.maxPerTenant})`,
          ),
        )
      }, config.maxWaitMs),
    }
    unrefTimer(waiter.timer)
    waitQueue.push(waiter)
  })
}

/** Test-only: reject pending waiters and reset all counters/queues. */
export function resetAgentAdmissionForTests(): void {
  for (const waiter of waitQueue.splice(0)) {
    clearTimeout(waiter.timer)
    waiter.reject(new AgentCapacityError('admission state reset'))
  }
  globalCount = 0
  tenantCounts.clear()
}
