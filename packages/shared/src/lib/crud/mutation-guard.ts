import type { AwilixContainer } from 'awilix'

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
  method: 'PUT' | 'DELETE'
  requestHeaders: Headers
  mutationPayload?: Record<string, unknown> | null
}

export type CrudMutationGuardAfterSuccessInput = {
  tenantId: string
  organizationId?: string | null
  userId: string
  resourceKind: string
  resourceId: string
  method: 'PUT' | 'DELETE'
  requestHeaders: Headers
  metadata?: Record<string, unknown> | null
}

type CrudMutationGuardServiceLike = {
  validateMutation: (input: CrudMutationGuardValidateInput) => Promise<CrudMutationGuardValidationResult>
  afterMutationSuccess: (input: CrudMutationGuardAfterSuccessInput) => Promise<void>
}

function resolveCrudMutationGuardService(container: AwilixContainer): CrudMutationGuardServiceLike | null {
  try {
    const service = container.resolve<CrudMutationGuardServiceLike>('crudMutationGuardService')
    if (!service) return null
    if (typeof service.validateMutation !== 'function') return null
    if (typeof service.afterMutationSuccess !== 'function') return null
    return service
  } catch {
    return null
  }
}

export async function validateCrudMutationGuard(
  container: AwilixContainer,
  input: CrudMutationGuardValidateInput,
): Promise<CrudMutationGuardValidationResult | null> {
  const service = resolveCrudMutationGuardService(container)
  if (!service) return null
  return service.validateMutation(input)
}

export async function runCrudMutationGuardAfterSuccess(
  container: AwilixContainer,
  input: CrudMutationGuardAfterSuccessInput,
): Promise<void> {
  const service = resolveCrudMutationGuardService(container)
  if (!service) return
  await service.afterMutationSuccess(input)
}
