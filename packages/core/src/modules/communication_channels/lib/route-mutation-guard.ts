import type { AwilixContainer } from 'awilix'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
  type CrudMutationGuardValidationResult,
} from '@open-mercato/shared/lib/crud/mutation-guard'

type RouteAuth = {
  sub?: string | null
  tenantId?: string | null
  orgId?: string | null
}

type RouteMutationGuardInput = {
  resourceKind: string
  resourceId: string
  operation?: 'create' | 'update' | 'delete' | 'custom'
  mutationPayload?: Record<string, unknown> | null
}

export type RouteMutationGuardContext = {
  result: CrudMutationGuardValidationResult | null
  afterSuccess: () => Promise<void>
}

export async function validateRouteMutationGuard(params: {
  container: AwilixContainer
  req: Request
  auth: RouteAuth
  input: RouteMutationGuardInput
}): Promise<RouteMutationGuardContext | { response: Response }> {
  const { auth, container, input, req } = params
  if (!auth.sub || !auth.tenantId) {
    return { result: null, afterSuccess: async () => undefined }
  }

  const base = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    operation: input.operation ?? 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
  } as const

  const result = await validateCrudMutationGuard(container, {
    ...base,
    mutationPayload: input.mutationPayload ?? null,
  })
  if (result && !result.ok) {
    return {
      response: Response.json(result.body, { status: result.status }),
    }
  }

  return {
    result,
    afterSuccess: async () => {
      if (!result?.ok || !result.shouldRunAfterSuccess) return
      await runCrudMutationGuardAfterSuccess(container, {
        ...base,
        metadata: result.metadata ?? null,
      })
    },
  }
}
