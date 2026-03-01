import type { AwilixContainer } from 'awilix'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MutationGuard {
  /** Unique guard ID (e.g., 'record_locks.lock-check', 'example.todo-limit') */
  id: string

  /** Target entity or '*' for all entities */
  targetEntity: string | '*'

  /** Which operations this guard applies to */
  operations: ('create' | 'update' | 'delete')[]

  /** Execution priority (lower = earlier). Default: 50 */
  priority?: number

  /** ACL feature gating — guard only runs if user has these features */
  features?: string[]

  /** Validate before mutation. Return ok:false to block, modifiedPayload to transform. */
  validate(input: MutationGuardInput): Promise<MutationGuardResult>

  /** Optional post-mutation callback (for cleanup, cache invalidation, etc.) */
  afterSuccess?(input: MutationGuardAfterInput): Promise<void>
}

export interface MutationGuardInput {
  tenantId: string
  organizationId: string | null
  userId: string
  resourceKind: string
  resourceId: string | null
  operation: 'create' | 'update' | 'delete'
  requestMethod: string
  requestHeaders: Headers
  mutationPayload?: Record<string, unknown> | null
}

export interface MutationGuardResult {
  ok: boolean
  /** HTTP status for rejection (default: 422) */
  status?: number
  /** Error message for rejection */
  message?: string
  /** Full error body for rejection (overrides message) */
  body?: Record<string, unknown>
  /** Modified payload — merged into mutation data if ok:true */
  modifiedPayload?: Record<string, unknown>
  /** Should afterSuccess run? (default: false) */
  shouldRunAfterSuccess?: boolean
  /** Arbitrary metadata passed to afterSuccess */
  metadata?: Record<string, unknown>
}

export interface MutationGuardAfterInput {
  tenantId: string
  organizationId: string | null
  userId: string
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete'
  requestMethod: string
  requestHeaders: Headers
  metadata?: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Entity matching
// ---------------------------------------------------------------------------

export function matchesEntity(pattern: string, entity: string): boolean {
  if (pattern === '*') return true
  if (pattern === entity) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return entity.startsWith(prefix + '.')
  }
  return false
}

// ---------------------------------------------------------------------------
// Guard runner
// ---------------------------------------------------------------------------

export async function runMutationGuards(
  guards: MutationGuard[],
  input: MutationGuardInput,
  context: { userFeatures: string[] },
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const matching = guards
    .filter((g) => matchesEntity(g.targetEntity, input.resourceKind))
    .filter((g) => g.operations.includes(input.operation))
    .filter((g) => !g.features?.length || g.features.every((f) => context.userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  let payload = input.mutationPayload
  const afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }> = []

  for (const guard of matching) {
    const result = await guard.validate({ ...input, mutationPayload: payload })
    if (!result.ok) {
      const body = result.body ?? { error: result.message ?? 'Operation blocked by guard', guardId: guard.id }
      return { ok: false, errorBody: body, errorStatus: result.status ?? 422, afterSuccessCallbacks: [] }
    }
    if (result.modifiedPayload) payload = { ...payload, ...result.modifiedPayload }
    if (result.shouldRunAfterSuccess && guard.afterSuccess) {
      afterSuccessCallbacks.push({ guard, metadata: result.metadata ?? null })
    }
  }

  return { ok: true, modifiedPayload: payload !== input.mutationPayload ? (payload ?? undefined) : undefined, afterSuccessCallbacks }
}

// ---------------------------------------------------------------------------
// Legacy guard bridge
// ---------------------------------------------------------------------------

type LegacyCrudMutationGuardService = {
  validateMutation: (input: {
    tenantId: string
    organizationId?: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete' | 'custom'
    requestMethod: string
    requestHeaders: Headers
    mutationPayload?: Record<string, unknown> | null
  }) => Promise<{ ok: boolean; status?: number; body?: Record<string, unknown>; shouldRunAfterSuccess?: boolean; metadata?: Record<string, unknown> | null } | null>
  afterMutationSuccess: (input: {
    tenantId: string
    organizationId?: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete' | 'custom'
    requestMethod: string
    requestHeaders: Headers
    metadata?: Record<string, unknown> | null
  }) => Promise<void>
}

function resolveLegacyGuardService(container: AwilixContainer): LegacyCrudMutationGuardService | null {
  try {
    const service = container.resolve<LegacyCrudMutationGuardService>('crudMutationGuardService')
    if (!service) return null
    if (typeof service.validateMutation !== 'function') return null
    if (typeof service.afterMutationSuccess !== 'function') return null
    return service
  } catch {
    return null
  }
}

export function bridgeLegacyGuard(container: AwilixContainer): MutationGuard | null {
  const legacyService = resolveLegacyGuardService(container)
  if (!legacyService) return null

  return {
    id: '_legacy.crud-mutation-guard-service',
    targetEntity: '*',
    operations: ['update', 'delete'],
    priority: 0,

    async validate(input) {
      const result = await legacyService.validateMutation({
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: input.userId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId ?? '',
        operation: input.operation,
        requestMethod: input.requestMethod,
        requestHeaders: input.requestHeaders,
        mutationPayload: input.mutationPayload,
      })
      if (!result) return { ok: true }
      if (!result.ok) return { ok: false, status: result.status, body: result.body }
      return { ok: true, shouldRunAfterSuccess: result.shouldRunAfterSuccess, metadata: result.metadata ?? undefined }
    },

    async afterSuccess(input) {
      await legacyService.afterMutationSuccess({
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: input.userId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        operation: input.operation,
        requestMethod: input.requestMethod,
        requestHeaders: input.requestHeaders,
        metadata: input.metadata,
      })
    },
  }
}
