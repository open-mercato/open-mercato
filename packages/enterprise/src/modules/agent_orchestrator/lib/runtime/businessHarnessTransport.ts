import type {
  BusinessHarnessExecutionBundle,
  BusinessHarnessRunEvent,
  BusinessHarnessRunResult,
} from './businessHarnessContracts'
import { BusinessHarnessClient } from './businessHarnessClient'
import { BusinessHarnessProcessClient } from './businessHarnessProcessClient'
import { resolveBusinessHarnessTransportMode } from './businessHarnessMode'

export {
  businessHarnessRuntimeMode,
  readBusinessHarnessRuntimeMode,
  resolveBusinessHarnessRuntimeMode,
  resolveBusinessHarnessTransportMode,
} from './businessHarnessMode'
export type {
  BusinessHarnessRuntimeMode,
  BusinessHarnessTransportMode,
} from './businessHarnessMode'

export type BusinessHarnessRunOptions = {
  signal?: AbortSignal
  onEvent?: (event: BusinessHarnessRunEvent) => void | Promise<void>
}

export interface BusinessHarnessTransport {
  run(
    bundle: BusinessHarnessExecutionBundle,
    options?: BusinessHarnessRunOptions,
  ): Promise<BusinessHarnessRunResult>
}

export function createBusinessHarnessTransport(): BusinessHarnessTransport {
  return resolveBusinessHarnessTransportMode() === 'http'
    ? new BusinessHarnessClient()
    : new BusinessHarnessProcessClient()
}
