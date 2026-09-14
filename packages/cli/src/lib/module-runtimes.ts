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

export const START_TIMEOUT_ENV_VAR = 'OM_MODULE_RUNTIME_START_TIMEOUT_MS'
export const STOP_TIMEOUT_ENV_VAR = 'OM_MODULE_RUNTIME_STOP_TIMEOUT_MS'

export type ModuleRuntimeCarrier = { id: string; runtime?: ModuleRuntime }

export type StartModuleRuntimesOptions = {
  modules: ModuleRuntimeCarrier[]
  container: AppContainer
  role: ModuleRuntimeRole
  /** One line per start and stop. Defaults to console. */
  log?: (message: string) => void
  /** Defaults to `OM_MODULE_RUNTIME_START_TIMEOUT_MS`, then 30s. */
  startTimeoutMs?: number
  /** Defaults to `OM_MODULE_RUNTIME_STOP_TIMEOUT_MS`, then 30s. */
  stopTimeoutMs?: number
  /** Where the timeout overrides are read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
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
 * Reads a timeout override, falling back to `fallbackMs` when it is unset or not a usable number.
 *
 * A start timeout is fatal by design (contract §3), so an operator whose runtime legitimately needs
 * longer than the default — acquiring a lease, waiting on a broker — needs a supported way to say
 * so rather than a worker that exits non-zero on every boot. A malformed value falls back loudly:
 * refusing to start over a typo in a tuning knob would be worse than the default it replaces.
 */
function resolveTimeoutMs(
  env: NodeJS.ProcessEnv,
  name: string,
  fallbackMs: number,
  log: (message: string) => void,
): number {
  const raw = env[name]
  if (raw == null || raw.trim() === '') return fallbackMs
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log(`[runtime] ignoring ${name}="${raw}": expected a positive number of milliseconds, using ${fallbackMs}ms`)
    return fallbackMs
  }
  return parsed
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
  const env = options.env ?? process.env
  const startTimeoutMs = options.startTimeoutMs
    ?? resolveTimeoutMs(env, START_TIMEOUT_ENV_VAR, DEFAULT_START_TIMEOUT_MS, log)
  const stopTimeoutMs = options.stopTimeoutMs
    ?? resolveTimeoutMs(env, STOP_TIMEOUT_ENV_VAR, DEFAULT_STOP_TIMEOUT_MS, log)

  const controller = new AbortController()
  const started: Array<{ id: string; handle: ModuleRuntimeHandle | void }> = []

  // Sorted by module id so a failure is reproducible rather than dependent on registry order.
  // Compared by code point rather than `localeCompare`, which depends on the host's default locale
  // and ICU build — "reproducible" must not mean "on machines with the same locale".
  //
  // No dependency graph on purpose: a module that needs another module's runtime should depend on
  // its service through DI, which already expresses that and already detects cycles.
  const applicable = options.modules
    .filter((m): m is ModuleRuntimeCarrier & { runtime: ModuleRuntime } =>
      Boolean(m.runtime) && moduleRuntimeAppliesTo(m.runtime as ModuleRuntime, options.role))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

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
    // Called through an async wrapper so a `start` that throws synchronously rejects rather than
    // escaping the try below, which would skip stopping the runtimes already started.
    const starting = (async () =>
      module.runtime.start({ container: options.container, role: options.role, signal: controller.signal }))()
    try {
      const handle = await withTimeout(
        starting,
        startTimeoutMs,
        () => new ModuleRuntimeTimeoutError(module.id, 'start', startTimeoutMs),
      )
      started.push({ id: module.id, handle })
      log(`[runtime] started "${module.id}" (${options.role}, ${Date.now() - startedAt}ms)`)
    } catch (error) {
      // A timed-out `start` keeps running: its handle was never pushed to `started`, so shutdown
      // would not reach it. Trail the promise and release whatever it eventually hands back — and
      // swallow a late rejection, which would otherwise surface as an unhandled rejection long
      // after the error below has already been reported.
      if (error instanceof ModuleRuntimeTimeoutError) {
        void starting
          .then((handle) => handle?.stop())
          .catch(() => {})
      }
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
 *
 * At its only call site today — `mercato queue worker --all` — it is always false: `NEXT_PHASE` is
 * set by Next, not by a worker process. It guards the entry that matters once the `server` role
 * lands, where module code really is evaluated during `next build`; it is here so that entry
 * inherits the check rather than reinventing it.
 */
export function isProductionBuildPhase(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_PHASE === 'phase-production-build'
}
