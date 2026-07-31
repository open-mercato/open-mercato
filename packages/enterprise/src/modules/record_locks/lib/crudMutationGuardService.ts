import type {
  CrudMutationGuardAfterSuccessInput,
  CrudMutationGuardValidateInput,
  CrudMutationGuardValidationResult,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  parseOptimisticLockEnv,
  type OptimisticLockConfig,
} from '@open-mercato/shared/lib/crud/optimistic-lock'
import { OPTIMISTIC_LOCK_ENV_VAR } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { readRecordLockHeaders, type RecordLockService } from './recordLockService'
import { isRecordLockingEnabledForResource } from './config'

export type RecordLockCrudMutationGuardService = {
  validateMutation: (input: CrudMutationGuardValidateInput) => Promise<CrudMutationGuardValidationResult>
  afterMutationSuccess: (input: CrudMutationGuardAfterSuccessInput) => Promise<void>
}

/** The OSS floor service this decorator chains. Same shape as the platform default. */
export type OssCrudMutationGuardServiceLike = {
  validateMutation: (input: CrudMutationGuardValidateInput) => Promise<CrudMutationGuardValidationResult>
  afterMutationSuccess: (input: CrudMutationGuardAfterSuccessInput) => Promise<void>
}

function resolveRecordLockMutationMethod(operation: CrudMutationGuardValidateInput['operation']): 'PUT' | 'DELETE' {
  if (operation === 'delete') return 'DELETE'
  return 'PUT'
}

function resolveConfig(envValue: string | null | undefined): OptimisticLockConfig {
  return parseOptimisticLockEnv(envValue !== undefined ? envValue : process.env[OPTIMISTIC_LOCK_ENV_VAR])
}

export type CreateRecordLockCrudMutationGuardServiceOptions = {
  /** Override `OM_OPTIMISTIC_LOCK` (mostly for tests). */
  envValue?: string | null
}

/**
 * Enterprise CRUD mutation guard. A **decorator** over the OSS optimistic-lock
 * floor (S1/H2): it never replaces the floor, only adds blocks.
 *
 * Evaluation order (matches the spec's guard-layering chain):
 *   1. `OM_OPTIMISTIC_LOCK=off` → pure pass-through (single global kill switch;
 *      neither floor nor enrichment runs).
 *   2. OSS `updated_at` floor runs first (delegated to the default OSS guard the
 *      enterprise registration overrides). A stale write 409s here regardless of
 *      any record-lock token / widget state — so a tokenless API/CLI client is
 *      still caught (H1/H2).
 *   3. Only if the floor passes, AND record_locks is enabled for the resource in
 *      settings, the enterprise `validateMutation` enrichment runs (pessimistic
 *      lock + action-log diff). It can only ADD a 409, never relax the floor.
 *
 * Fail-closed (H3): if the enterprise enrichment throws, the decorator degrades
 * to the floor result (floor-pass ⇒ allow), never to "skip the guard".
 */
export function createRecordLockCrudMutationGuardService(
  recordLockService: RecordLockService,
  ossFloorGuardService: OssCrudMutationGuardServiceLike,
  options: CreateRecordLockCrudMutationGuardServiceOptions = {},
): RecordLockCrudMutationGuardService {
  async function isRecordLockEnrichmentEnabled(resourceKind: string): Promise<boolean> {
    try {
      const settings = await recordLockService.getSettings()
      return isRecordLockingEnabledForResource(settings, resourceKind)
    } catch {
      return false
    }
  }

  return {
    async validateMutation(input) {
      const config = resolveConfig(options.envValue)
      if (config.mode === 'off') {
        // Single global kill switch: neither floor nor enrichment runs.
        return { ok: true, shouldRunAfterSuccess: false, metadata: null }
      }

      // 1. OSS floor — always runs first, independent of any client lock token.
      const floorResult = await ossFloorGuardService.validateMutation(input)
      if (!floorResult.ok) return floorResult

      // 2. Enterprise enrichment — only when the resource is enabled in settings.
      if (!(await isRecordLockEnrichmentEnabled(input.resourceKind))) {
        return { ok: true, shouldRunAfterSuccess: false, metadata: null }
      }

      // 3. Fail-closed: a throwing enrichment degrades to the (passed) floor.
      let enrichmentResult: Awaited<ReturnType<RecordLockService['validateMutation']>>
      try {
        enrichmentResult = await recordLockService.validateMutation({
          tenantId: input.tenantId,
          organizationId: input.organizationId ?? null,
          userId: input.userId,
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
          method: resolveRecordLockMutationMethod(input.operation),
          headers: readRecordLockHeaders(input.requestHeaders),
          mutationPayload: input.mutationPayload ?? null,
        })
      } catch {
        return { ok: true, shouldRunAfterSuccess: false, metadata: null }
      }

      if (enrichmentResult.ok) {
        return {
          ok: true,
          shouldRunAfterSuccess: enrichmentResult.resourceEnabled,
          metadata: null,
        }
      }

      return {
        ok: false,
        status: enrichmentResult.status,
        body: {
          error: enrichmentResult.error,
          code: enrichmentResult.code,
          lock: enrichmentResult.lock ?? null,
          conflict: enrichmentResult.conflict ?? null,
        },
      }
    },

    async afterMutationSuccess(input) {
      const method = resolveRecordLockMutationMethod(input.operation)
      const headers = readRecordLockHeaders(input.requestHeaders)

      await recordLockService.releaseAfterMutation({
        tenantId: input.tenantId,
        organizationId: input.organizationId ?? null,
        userId: input.userId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        token: headers.token,
        reason: 'saved',
      })

      await Promise.allSettled([
        recordLockService.emitIncomingChangesNotificationAfterMutation({
          tenantId: input.tenantId,
          organizationId: input.organizationId ?? null,
          userId: input.userId,
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
          method,
        }),
        recordLockService.emitRecordDeletedNotificationAfterMutation({
          tenantId: input.tenantId,
          organizationId: input.organizationId ?? null,
          userId: input.userId,
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
          method,
        }),
      ])
    },
  }
}
