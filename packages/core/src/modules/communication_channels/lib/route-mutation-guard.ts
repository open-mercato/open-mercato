import type { AwilixContainer } from 'awilix'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

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
  /**
   * Marker kept for source compatibility with callers; the registry result is
   * fully handled inside the wrapper, so callers only need `afterSuccess`.
   */
  result: { ok: true } | null
  afterSuccess: () => Promise<void>
}

/**
 * Run a communication-channels custom write route through the full mutation
 * guard registry (`runRouteMutationGuards`) instead of only the legacy DI
 * service. Returns `{ response }` when a guard blocks the mutation, or
 * `{ result, afterSuccess }` to run after a successful write — preserving the
 * shape the dependent routes already consume.
 */
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

  const guarded = await runRouteMutationGuards({
    container,
    req,
    auth: {
      userId: auth.sub,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    },
    input: {
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      operation: input.operation ?? 'custom',
      mutationPayload: input.mutationPayload ?? null,
    },
  })

  if (!guarded.ok) {
    return { response: guarded.response }
  }

  return {
    result: { ok: true },
    afterSuccess: guarded.runAfterSuccess,
  }
}
