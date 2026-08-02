import type { AwilixContainer } from 'awilix'
import { createLogger } from '../logger'
import type {
  CrudMutationGuardAfterSuccessInput,
  CrudMutationGuardValidateInput,
  CrudMutationGuardValidationResult,
} from './mutation-guard'

const logger = createLogger('shared').child({ component: 'crud' })
const RESOLUTION_WARNING_KEY = '__openMercatoCrudMutationGuardResolutionWarningEmitted__'

export type CrudMutationGuardServiceLike = {
  validateMutation: (
    input: CrudMutationGuardValidateInput,
  ) => Promise<CrudMutationGuardValidationResult | null>
  afterMutationSuccess: (input: CrudMutationGuardAfterSuccessInput) => Promise<void>
}

function warnResolutionFailureOnce(error: unknown): void {
  const globalScope = globalThis as Record<string, unknown>
  if (globalScope[RESOLUTION_WARNING_KEY] === true) return
  globalScope[RESOLUTION_WARNING_KEY] = true
  logger.warn('CRUD mutation guard service could not be resolved; the legacy guard bridge is disabled', {
    err: error,
  })
}

export function resolveCrudMutationGuardService(
  container: AwilixContainer,
): CrudMutationGuardServiceLike | null {
  if (
    typeof container.hasRegistration === 'function'
    && !container.hasRegistration('crudMutationGuardService')
  ) {
    return null
  }

  try {
    const service = container.resolve<CrudMutationGuardServiceLike>('crudMutationGuardService')
    if (!service) return null
    if (typeof service.validateMutation !== 'function') return null
    if (typeof service.afterMutationSuccess !== 'function') return null
    return service
  } catch (error) {
    warnResolutionFailureOnce(error)
    return null
  }
}
