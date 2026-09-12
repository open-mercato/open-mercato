// Starting and stopping the module runtimes declared by `runtime.ts` (SPEC-072).
//
// Kept out of mercato.ts so the contract can be tested directly: the ordering, the failure
// semantics, the shutdown and both timeouts are the whole substance of this hook, and none of
// them are reachable through a CLI command in a test.

import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  moduleRuntimeAppliesTo,
  type ModuleRuntime,
  type ModuleRuntimeHandle,
  type ModuleRuntimeRole,
} from '@open-mercato/shared/modules/runtime'

export const DEFAULT_START_TIMEOUT_MS = 30_000
export const DEFAULT_STOP_TIMEOUT_MS = 30_000

export type ModuleRuntimeCarrier = { id: string; runtime?: ModuleRuntime }

export type StartModuleRuntimesOptions = {
  modules: ModuleRuntimeCarrier[]
  container: AppContainer
  role: ModuleRuntimeRole
  /** One line per start and stop. Defaults to console. */
  log?: (message: string) => void
  startTimeoutMs?: number
  stopTimeoutMs?: number
}

export type StartedModuleRuntimes = {
  /** Module ids whose runtime is running, in start order. */
  started: string[]
  /** Aborts the shared signal, then stops each runtime in reverse start order. Idempotent. */
  stop(): Promise<void>
}

class ModuleRuntimeTimeoutError extends Error {
  constructor(moduleId: string, phase: 'start' | 'stop', timeoutMs: number) {
    super(`Module "${moduleId}" did not ${phase} within ${timeoutMs}ms.`)
    this.name = 'ModuleRuntimeTimeoutError'
  }
}

/**
 * Rejects if `work` outlives `timeoutMs`.
 *
 * The timer is always cleared, including on the winning path: an uncleared timer keeps the event
 * loop alive, so a CLI command that finished its work would hang until the timeout elapsed — the
 * kind of bug that only shows up as "the process takes 30 seconds to exit".
 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Starts every module runtime that applies to this role, once.
 *
 * A throwing or timing-out `start` is fatal: the runtimes already started are stopped, and the
 * error is rethrown for the caller to exit on. A process that came up without a runtime it was
 * supposed to have looks healthy while doing nothing, which is worse than not coming up.
 */
export async function startModuleRuntimes(options: StartModuleRuntimesOptions): Promise<StartedModuleRuntimes> {
  const log = options.log ?? ((message: string) => console.log(message))
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS

  const controller = new AbortController()
  const started: Array<{ id: string; handle: ModuleRuntimeHandle | void }> = []

  // Sorted by module id so a failure is reproducible rather than dependent on registry order.
  // No dependency graph on purpose: a module that needs another module's runtime should depend on
  // its service through DI, which already expresses that and already detects cycles.
  const applicable = options.modules
    .filter((m): m is ModuleRuntimeCarrier & { runtime: ModuleRuntime } =>
      Boolean(m.runtime) && moduleRuntimeAppliesTo(m.runtime as ModuleRuntime, options.role))
    .sort((a, b) => a.id.localeCompare(b.id))

  const stopStarted = async (): Promise<void> => {
    controller.abort()
    for (const entry of [...started].reverse()) {
      if (!entry.handle) continue
      try {
        await withTimeout(
          Promise.resolve(entry.handle.stop()),
          stopTimeoutMs,
          () => new ModuleRuntimeTimeoutError(entry.id, 'stop', stopTimeoutMs),
        )
        log(`[runtime] stopped "${entry.id}"`)
      } catch (error) {
        // A shutdown that cannot finish must not become a shutdown that never finishes: report and
        // carry on to the next runtime, so one stuck module cannot hold the process open.
        log(`[runtime] "${entry.id}" failed to stop: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    started.length = 0
  }

  for (const module of applicable) {
    const startedAt = Date.now()
    try {
      const handle = await withTimeout(
        Promise.resolve(module.runtime.start({ container: options.container, role: options.role, signal: controller.signal })),
        startTimeoutMs,
        () => new ModuleRuntimeTimeoutError(module.id, 'start', startTimeoutMs),
      )
      started.push({ id: module.id, handle })
      log(`[runtime] started "${module.id}" (${options.role}, ${Date.now() - startedAt}ms)`)
    } catch (error) {
      await stopStarted()
      throw error
    }
  }

  let stopping: Promise<void> | null = null
  return {
    started: started.map((entry) => entry.id),
    stop: () => (stopping ??= stopStarted()),
  }
}

/**
 * True when this process is a Next production build.
 *
 * A build evaluates application code and must not acquire brokers, sockets or leases — and must
 * certainly not briefly own work it cannot finish. Hosts have been carrying this check by hand;
 * it belongs with the runner.
 */
export function isProductionBuildPhase(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_PHASE === 'phase-production-build'
}
