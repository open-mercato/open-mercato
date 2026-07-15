import type { AwilixContainer } from 'awilix'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'crud' })

export type CrudMutationGuardValidationSuccess = {
  ok: true
  shouldRunAfterSuccess: boolean
  metadata?: Record<string, unknown> | null
}

export type CrudMutationGuardValidationFailure = {
  ok: false
  status: number
  body: Record<string, unknown>
}

export type CrudMutationGuardValidationResult =
  | CrudMutationGuardValidationSuccess
  | CrudMutationGuardValidationFailure

export type CrudMutationGuardValidateInput = {
  tenantId: string
  organizationId?: string | null
  userId: string
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete' | 'custom'
  requestMethod: string
  requestHeaders: Headers
  mutationPayload?: Record<string, unknown> | null
}

export type CrudMutationGuardAfterSuccessInput = {
  tenantId: string
  organizationId?: string | null
  userId: string
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete' | 'custom'
  requestMethod: string
  requestHeaders: Headers
  metadata?: Record<string, unknown> | null
}

type CrudMutationGuardServiceLike = {
  validateMutation: (input: CrudMutationGuardValidateInput) => Promise<CrudMutationGuardValidationResult>
  afterMutationSuccess: (input: CrudMutationGuardAfterSuccessInput) => Promise<void>
}

function resolveCrudMutationGuardService(container: AwilixContainer): CrudMutationGuardServiceLike | null {
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration('crudMutationGuardService')) {
    return null
  }
  try {
    const service = container.resolve<CrudMutationGuardServiceLike>('crudMutationGuardService')
    if (!service) return null
    if (typeof service.validateMutation !== 'function') return null
    if (typeof service.afterMutationSuccess !== 'function') return null
    return service
  } catch (err) {
    // A registered crudMutationGuardService that fails to RESOLVE is a wiring
    // bug (e.g. a CLASSIC-mode factory whose parameter name has no matching
    // registration). Swallowing it silently disables the guard — optimistic
    // locking included — so it must be loud.
    logger.warn('crudMutationGuardService is registered but failed to resolve; its mutation guard is skipped', { err })
    return null
  }
}

/**
 * @deprecated Resolves ONLY the single DI-registered `crudMutationGuardService`,
 * so it silently bypasses every guard in the global mutation-guard store
 * (`getAllMutationGuardInstances()`). Use the full registry instead:
 * `runRouteMutationGuards()` from `@open-mercato/shared/lib/crud/route-mutation-guard`
 * for custom write routes, or `runMutationGuards()` from
 * `@open-mercato/shared/lib/crud/mutation-guard-registry` directly. The legacy
 * service is still honored on the modern path via `bridgeLegacyGuard()`. This
 * function will be removed in a future release.
 */
export async function validateCrudMutationGuard(
  container: AwilixContainer,
  input: CrudMutationGuardValidateInput,
): Promise<CrudMutationGuardValidationResult | null> {
  const service = resolveCrudMutationGuardService(container)
  if (!service) return null
  return service.validateMutation(input)
}

/**
 * @deprecated Runs ONLY the single DI-registered `crudMutationGuardService`'s
 * after-success hook, skipping the registry guards' `afterSuccess` callbacks.
 * Use the `runAfterSuccess()` returned by `runRouteMutationGuards()` from
 * `@open-mercato/shared/lib/crud/route-mutation-guard`, or the
 * `afterSuccessCallbacks` returned by `runMutationGuards()` from
 * `@open-mercato/shared/lib/crud/mutation-guard-registry`. This function will be
 * removed in a future release.
 */
export async function runCrudMutationGuardAfterSuccess(
  container: AwilixContainer,
  input: CrudMutationGuardAfterSuccessInput,
): Promise<void> {
  const service = resolveCrudMutationGuardService(container)
  if (!service) return
  try {
    await service.afterMutationSuccess(input)
  } catch (error) {
    logger.error('Mutation guard after-success hook failed', {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      operation: input.operation,
      requestMethod: input.requestMethod,
      err: error,
    })
  }
}
