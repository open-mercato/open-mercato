import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { MAINTENANCE_COORDINATOR_DI_KEY } from '@open-mercato/shared/lib/maintenance/types'
import { registerRequestGate } from '@open-mercato/shared/lib/runtime/request-gate'
import { registerWorkerGate } from '@open-mercato/shared/lib/runtime/worker-gate'
import { createMaintenanceCoordinator } from './lib/coordinator'
import {
  createMaintenanceRequestGate,
  createMaintenanceWorkerGate,
  getMaintenanceRuntime,
  getMaintenanceStore,
  startWebAgentIfServerRuntime,
} from './lib/runtime'

/**
 * Gates register when this module is imported (bootstrap imports every module `di.ts`),
 * before the first request: the API dispatcher and proxy evaluate gates before any
 * request container exists. Registration is idempotent (keyed by gate id).
 */
export function ensureMaintenanceGatesRegistered(): void {
  registerRequestGate(createMaintenanceRequestGate())
  registerWorkerGate(createMaintenanceWorkerGate())
  startWebAgentIfServerRuntime()
}

ensureMaintenanceGatesRegistered()

export function register(container: AppContainer) {
  const runtime = getMaintenanceRuntime()
  container.register({
    [MAINTENANCE_COORDINATOR_DI_KEY]: asValue(
      createMaintenanceCoordinator({ config: runtime.config, getStore: () => getMaintenanceStore(runtime) }),
    ),
  })
}

defineProcessDiRegistrar(register)
