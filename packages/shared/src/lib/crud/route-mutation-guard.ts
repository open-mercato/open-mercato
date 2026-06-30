import type { AwilixContainer } from 'awilix'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from './mutation-guard-registry'
import { getAllMutationGuardInstances } from './mutation-guard-store'

/**
 * Shared registry-based mutation-guard wrapper for custom write routes that do
 * not use `makeCrudRoute`.
 *
 * This mirrors `collectAndRunGuards()` in `factory.ts`: it runs **every** guard
 * collected from the global mutation-guard store (`getAllMutationGuardInstances()`)
 * plus the bridged legacy DI service (`bridgeLegacyGuard()`), so a custom route
 * enforces the same guard set as every `makeCrudRoute` write.
 *
 * Prefer this over the deprecated `validateCrudMutationGuard()` /
 * `runCrudMutationGuardAfterSuccess()` pair, which resolve only the single
 * DI-registered `crudMutationGuardService` and silently skip registry guards.
 */

export type RouteMutationGuardOperation = 'create' | 'update' | 'delete' | 'custom'

export type RouteMutationGuardAuth = {
  userId: string
  tenantId: string
  organizationId?: string | null
  /**
   * Pre-resolved granted features for the caller. When omitted, the wrapper
   * resolves them via `rbacService.getGrantedFeatures` (same source the CRUD
   * factory uses). Feature-gated registry guards only run when their required
   * features are present, so supplying the wrong set silently skips guards.
   */
  userFeatures?: string[]
}

export type RouteMutationGuardInput = {
  resourceKind: string
  resourceId?: string | null
  /**
   * The route's logical operation. `'custom'` (state-changing action endpoints)
   * is mapped to the closest registry operation, `'update'`, because
   * `runMutationGuards` only understands `create | update | delete`.
   */
  operation?: RouteMutationGuardOperation
  mutationPayload?: Record<string, unknown> | null
}

export type RouteMutationGuardBlocked = {
  ok: false
  errorStatus: number
  errorBody: Record<string, unknown>
  /** Ready-to-return JSON response built from `errorBody` / `errorStatus`. */
  response: Response
}

export type RouteMutationGuardPassed = {
  ok: true
  /** Merged payload when a guard transformed it; `undefined` when unchanged. */
  modifiedPayload?: Record<string, unknown>
  /**
   * Runs every guard's `afterSuccess` callback that requested it. Callback
   * failures are caught and logged so a committed write still succeeds — call
   * this only after the mutation has committed.
   */
  runAfterSuccess: () => Promise<void>
}

export type RouteMutationGuardResult = RouteMutationGuardBlocked | RouteMutationGuardPassed

type RbacServiceLike = {
  getGrantedFeatures: (
    userId: string,
    opts: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

/**
 * Map a route-level operation to the registry operation set. State-changing
 * action endpoints (`'custom'`) and `'update'` both map to `'update'` per the
 * `packages/core/AGENTS.md` → API Routes guidance.
 */
export function toRegistryMutationOperation(
  operation: RouteMutationGuardOperation | undefined,
): 'create' | 'update' | 'delete' {
  if (operation === 'create' || operation === 'delete') return operation
  return 'update'
}

async function resolveRouteUserFeatures(
  container: AwilixContainer,
  auth: RouteMutationGuardAuth,
): Promise<string[]> {
  if (auth.userFeatures) return auth.userFeatures
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (rbac?.getGrantedFeatures) {
      return await rbac.getGrantedFeatures(auth.userId, {
        tenantId: auth.tenantId,
        organizationId: auth.organizationId ?? null,
      })
    }
  } catch {
    // rbacService not available — guards without feature requirements still run.
  }
  return []
}

/**
 * Collect every registered mutation guard plus the bridged legacy DI service,
 * run them against the route's mutation, and return either a blocked result
 * (with a ready response) or a passed result carrying the merged payload and an
 * after-success runner.
 */
export async function runRouteMutationGuards(params: {
  container: AwilixContainer
  req: Request
  auth: RouteMutationGuardAuth
  input: RouteMutationGuardInput
}): Promise<RouteMutationGuardResult> {
  const { container, req, auth, input } = params
  const operation = toRegistryMutationOperation(input.operation)

  const allGuards: MutationGuard[] = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(container)
  if (legacyGuard) allGuards.push(legacyGuard)

  const userFeatures = await resolveRouteUserFeatures(container, auth)

  const guardResult = await runMutationGuards(
    allGuards,
    {
      tenantId: auth.tenantId,
      organizationId: auth.organizationId ?? null,
      userId: auth.userId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId ?? null,
      operation,
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input.mutationPayload ?? null,
    },
    { userFeatures },
  )

  if (!guardResult.ok) {
    const errorStatus = guardResult.errorStatus ?? 422
    const errorBody = guardResult.errorBody ?? { error: 'Operation blocked by guard' }
    return {
      ok: false,
      errorStatus,
      errorBody,
      response: Response.json(errorBody, { status: errorStatus }),
    }
  }

  return {
    ok: true,
    modifiedPayload: guardResult.modifiedPayload,
    runAfterSuccess: async () => {
      for (const { guard, metadata } of guardResult.afterSuccessCallbacks) {
        try {
          await guard.afterSuccess!({
            tenantId: auth.tenantId,
            organizationId: auth.organizationId ?? null,
            userId: auth.userId,
            resourceKind: input.resourceKind,
            resourceId: input.resourceId ?? '',
            operation,
            requestMethod: req.method,
            requestHeaders: req.headers,
            metadata,
          })
        } catch (error) {
          console.error(`[mutation-guard] afterSuccess failed for guard ${guard.id}`, error)
        }
      }
    },
  }
}
