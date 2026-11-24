import { createLogger } from '../logger'

export type WorkerGateKind = 'worker' | 'scheduler'

export type WorkerGateInfo = {
  kind: WorkerGateKind
  queueName?: string
}

export type WorkerJobRelease = () => void

/**
 * Availability gate consulted by queue workers before a claimed job starts executing,
 * and by the scheduler before each poll tick. With no gate registered, workers and the
 * scheduler behave exactly as before.
 */
export type WorkerGate = {
  id: string
  shouldPause(info: WorkerGateInfo): boolean
  onPaused?(info: WorkerGateInfo): void
  onResumed?(info: WorkerGateInfo): void
  /** In-flight accounting: called when a job starts; the returned callback runs when it settles. */
  onJobStarted?(info: WorkerGateInfo): WorkerJobRelease | void
}

const WORKER_GATES_KEY = '__openMercatoWorkerGates__'

type WorkerGateGlobalScope = typeof globalThis & {
  [WORKER_GATES_KEY]?: WorkerGate[]
}

const logger = createLogger('runtime').child({ component: 'worker-gate' })

const DEFAULT_PAUSE_POLL_MS = 1000

function gateStore(): WorkerGate[] {
  const scope = globalThis as WorkerGateGlobalScope
  if (!scope[WORKER_GATES_KEY]) scope[WORKER_GATES_KEY] = []
  return scope[WORKER_GATES_KEY]!
}

export function registerWorkerGate(gate: WorkerGate): void {
  const store = gateStore()
  const existingIndex = store.findIndex((entry) => entry.id === gate.id)
  if (existingIndex >= 0) store.splice(existingIndex, 1, gate)
  else store.push(gate)
}

export function unregisterWorkerGate(id: string): void {
  const store = gateStore()
  const existingIndex = store.findIndex((entry) => entry.id === id)
  if (existingIndex >= 0) store.splice(existingIndex, 1)
}

export function hasWorkerGates(): boolean {
  return gateStore().length > 0
}

export function shouldPauseWork(info: WorkerGateInfo): boolean {
  for (const gate of gateStore()) {
    try {
      if (gate.shouldPause(info)) return true
    } catch (error) {
      logger.error('Worker gate threw; ignoring it', { gateId: gate.id, err: error })
    }
  }
  return false
}

function notify(hook: 'onPaused' | 'onResumed', info: WorkerGateInfo): void {
  for (const gate of gateStore()) {
    const callback = gate[hook]
    if (typeof callback !== 'function') continue
    try {
      callback.call(gate, info)
    } catch (error) {
      logger.error('Worker gate callback threw', { gateId: gate.id, hook, err: error })
    }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Resolves immediately when no gate pauses work. Otherwise waits, polling every
 * `pollMs`, until every gate allows work again. `onPaused`/`onResumed` fire once per pause.
 */
export async function waitWhileWorkPaused(
  info: WorkerGateInfo,
  options: { pollMs?: number; isCancelled?: () => boolean } = {},
): Promise<void> {
  if (gateStore().length === 0) return
  if (!shouldPauseWork(info)) return
  const pollMs = options.pollMs ?? DEFAULT_PAUSE_POLL_MS
  notify('onPaused', info)
  while (shouldPauseWork(info)) {
    if (options.isCancelled?.()) break
    await sleep(pollMs)
  }
  notify('onResumed', info)
}

const noopRelease: WorkerJobRelease = () => {}

export function beginWorkerJob(info: WorkerGateInfo): WorkerJobRelease {
  const store = gateStore()
  if (store.length === 0) return noopRelease
  const releases: WorkerJobRelease[] = []
  for (const gate of store) {
    if (typeof gate.onJobStarted !== 'function') continue
    try {
      const release = gate.onJobStarted(info)
      if (typeof release === 'function') releases.push(release)
    } catch (error) {
      logger.error('Worker gate job hook threw', { gateId: gate.id, err: error })
    }
  }
  if (releases.length === 0) return noopRelease
  let released = false
  return () => {
    if (released) return
    released = true
    for (const release of releases) {
      try {
        release()
      } catch (error) {
        logger.error('Worker gate release threw', { err: error })
      }
    }
  }
}

/** Wraps a job handler so it waits while work is paused and counts as in flight while it runs. */
export function withWorkerGate<Args extends unknown[], Result>(
  info: WorkerGateInfo,
  handler: (...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    await waitWhileWorkPaused(info)
    const release = beginWorkerJob(info)
    try {
      return await handler(...args)
    } finally {
      release()
    }
  }
}
