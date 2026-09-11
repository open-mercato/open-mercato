// A module's long-lived, process-wide runtime.
//
// Everything else a module contributes is either declarative (routes, ACL, entities) or runs per
// unit of work (a request, an event, a job). This is the one thing that is neither: something that
// must exist for as long as the process does — a worker loop, a broker subscription, a poller, a
// watcher.
//
// `di.ts` is the closest existing point and is the wrong one: a container is built per request in
// the web tier, so a runtime started there starts per request, or — with a module-scoped guard —
// on whichever request happens to arrive first, never on a replica that receives none.
//
// See .ai/specs/SPEC-072-2026-09-11-module-runtime-start-hook.md.

import type { AppContainer } from '../lib/di/container'

/**
 * Which process is starting.
 *
 * `server` is the application process; `worker` runs queue workers; `scheduler` runs the
 * scheduler. A module that must not run its runtime twice in one deployment narrows to one.
 */
export type ModuleRuntimeRole = 'server' | 'worker' | 'scheduler'

export type ModuleRuntimeContext = {
  /** The process-wide container, already bootstrapped: DI registrars have run. */
  container: AppContainer
  /** Which process this is. */
  role: ModuleRuntimeRole
  /**
   * Aborted when the process begins shutting down — before `stop()` is awaited, so a runtime can
   * react at a boundary of its own choosing rather than being interrupted between two writes.
   */
  signal: AbortSignal
}

export type ModuleRuntimeHandle = {
  /** Release what `start` acquired. Awaited on shutdown, bounded by a timeout. */
  stop(): Promise<void>
}

export type ModuleRuntime = {
  /**
   * Roles this runtime belongs in. Defaults to `['server', 'worker']` — the two long-lived
   * processes. The default deliberately includes both: a runtime that only started in one of them
   * would be absent from the other with no indication, which is the failure this hook exists to
   * remove.
   */
  roles?: ModuleRuntimeRole[]

  /**
   * Start the runtime. Should return promptly: it starts things, it is not itself the thing. A
   * runtime needing a loop owns that loop and returns a handle.
   *
   * A throw fails process startup — unlike a subscriber, whose throw is logged and swallowed. A
   * module that cannot start its runtime is a broken deployment, and the alternative is a process
   * that looks healthy while silently doing nothing.
   */
  start(ctx: ModuleRuntimeContext): Promise<ModuleRuntimeHandle | void>
}

export const DEFAULT_MODULE_RUNTIME_ROLES: ModuleRuntimeRole[] = ['server', 'worker']

export function moduleRuntimeAppliesTo(runtime: ModuleRuntime, role: ModuleRuntimeRole): boolean {
  const roles = runtime.roles ?? DEFAULT_MODULE_RUNTIME_ROLES
  return roles.includes(role)
}
