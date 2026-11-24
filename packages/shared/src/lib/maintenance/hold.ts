import {
  MAINTENANCE_COORDINATOR_DI_KEY,
  type MaintenanceCoordinator,
  type MaintenanceHold,
  type MaintenanceHoldInput,
} from './types'

type ResolvableContainer = {
  resolve<T = unknown>(name: string): T
  hasRegistration?(name: string): boolean
}

export type WithMaintenanceHoldOptions = Partial<Omit<MaintenanceHoldInput, 'operation'>> & {
  /** Enter the window first when none is active (the `--enter-maintenance` flag). */
  enterIfInactive?: boolean
  page?: { title?: string; message?: string }
  reason?: string
}

export type MaintenanceHoldScope = {
  /** Null when no coordinator is registered (OSS, or enterprise modules disabled). */
  hold: MaintenanceHold | null
  coordinator: MaintenanceCoordinator | null
  windowId: string | null
  enteredByCaller: boolean
  /** Call before every batch; a no-op without a hold. */
  assertLive(): Promise<void>
}

const DEFAULT_DRAIN_TIMEOUT_MS = 120_000

/**
 * Soft-resolves the optional `maintenanceCoordinator` DI service. Returns null when the
 * maintenance module is not installed so OSS call sites keep their existing behavior.
 */
export function resolveMaintenanceCoordinator(container: ResolvableContainer): MaintenanceCoordinator | null {
  try {
    if (typeof container.hasRegistration === 'function' && !container.hasRegistration(MAINTENANCE_COORDINATOR_DI_KEY)) {
      return null
    }
    const coordinator = container.resolve<MaintenanceCoordinator | null | undefined>(MAINTENANCE_COORDINATOR_DI_KEY)
    return coordinator ?? null
  } catch {
    return null
  }
}

/**
 * Runs `fn` inside an exclusive, drained maintenance hold when the coordinator resolves.
 * Without a coordinator `fn` runs unchanged. The hold is always released; the window is
 * never closed here, so maintenance stays on after success or failure.
 */
export async function withMaintenanceHold<T>(
  container: ResolvableContainer,
  operation: string,
  options: WithMaintenanceHoldOptions,
  fn: (scope: MaintenanceHoldScope) => Promise<T>,
): Promise<T> {
  const coordinator = resolveMaintenanceCoordinator(container)
  if (!coordinator) {
    return fn({ hold: null, coordinator: null, windowId: null, enteredByCaller: false, assertLive: async () => {} })
  }
  let enteredByCaller = false
  if (options.enterIfInactive) {
    const state = await coordinator.getState()
    if (!state.active) {
      const entered = await coordinator.enter({ operation, reason: options.reason, page: options.page })
      enteredByCaller = entered.enteredByCaller
    }
  }
  const hold = await coordinator.acquireHold({
    operation,
    forbidsBypass: options.forbidsBypass ?? true,
    requireDrained: options.requireDrained ?? true,
    drainTimeoutMs: options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS,
  })
  try {
    return await fn({
      hold,
      coordinator,
      windowId: hold.windowId,
      enteredByCaller,
      assertLive: () => hold.assertLive(),
    })
  } finally {
    await hold.release()
  }
}
