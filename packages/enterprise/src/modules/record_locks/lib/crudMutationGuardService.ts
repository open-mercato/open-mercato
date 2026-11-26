import type {
  CrudMutationGuardAfterSuccessInput,
  CrudMutationGuardValidateInput,
  CrudMutationGuardValidationResult,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  parseOptimisticLockEnv,
  type OptimisticLockConfig,
} from '@open-mercato/shared/lib/crud/optimistic-lock'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_ENV_VAR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { canonicalizeResourceTag } from '@open-mercato/shared/lib/crud/cache'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  readRecordLockHeaders,
  RecordLockHistoryUnavailableError,
  type ParsedRecordLockHeaders,
  type RecordLockService,
} from './recordLockService'
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

function reportKeepMineCheckFailure(error: unknown, resourceKind: string): void {
  try {
    getTelemetryRuntime()?.reportError(error, {
      module: 'record_locks',
      code: 'record_locks.keep_mine_floor_check_failed',
      attributes: { resourceKind },
    })
  } catch {
    return
  }
}

function resolveConfig(envValue: string | null | undefined): OptimisticLockConfig {
  return parseOptimisticLockEnv(envValue !== undefined ? envValue : process.env[OPTIMISTIC_LOCK_ENV_VAR])
}

/**
 * Drop record-lock headers that describe a **different** record than the one
 * being mutated.
 *
 * The `record_locks` injection widget returns its headers from `onBeforeSave`,
 * and `CrudForm` keeps them on the scoped header stack for the whole `onSubmit`
 * — so every nested write a form performs on a *child* entity inherits the
 * parent's `x-om-record-lock-kind` / `-resource-id` / `-base-log-id`. The guard
 * then compared the parent's base action-log id against the child's own latest
 * action log; those ids can never match, so the child write 409'd with a bogus
 * "record was changed by another user" conflict (#5985 — variant form saving its
 * `catalog.price` rows). This is the record-lock counterpart of the per-child
 * `updated_at` override the OSS floor already requires (#2055).
 *
 * Headers that declare no scope at all (API/CLI clients sending only a token)
 * keep their previous meaning, so this is behaviour-compatible for every caller
 * whose headers actually belong to the record being written. Kinds are compared
 * canonicalized (`canonicalizeResourceTag`) because pages publish the injection
 * context kind verbatim (`resources.resourceType`) while `makeCrudRoute` derives
 * the canonical form (`resources.resource.type`) — the same record, spelled two
 * ways, must not count as a mismatch.
 */
export function scopeRecordLockHeadersToResource(
  headers: ParsedRecordLockHeaders,
  resource: { resourceKind: string; resourceId: string },
): ParsedRecordLockHeaders {
  const declaresOtherKind = typeof headers.resourceKind === 'string'
    && canonicalizeResourceTag(headers.resourceKind) !== canonicalizeResourceTag(resource.resourceKind)
  const declaresOtherId = typeof headers.resourceId === 'string'
    && headers.resourceId !== resource.resourceId
  return declaresOtherKind || declaresOtherId ? {} : headers
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
 *      still caught (H1/H2). Exception: a "Keep my changes" retry whose
 *      conflict id record_locks verifies (`canKeepMineOverrideStaleVersion`:
 *      same user and record, override allowed, no write since the conflict,
 *      neither in the action log nor in the floor's current `updated_at`)
 *      passes on to step 3, which resolves the conflict. Without it the retry,
 *      which still sends the version the page loaded, could never save.
 *   3. Only if the floor passes, AND record_locks is enabled for the resource in
 *      settings, the enterprise `validateMutation` enrichment runs (pessimistic
 *      lock + action-log diff). It can only ADD a 409, never relax the floor.
 *
 * Unexpected enrichment errors fall back to the floor (H3). When history is
 * required for the legacy lock decision, its unavailability rejects the write.
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

  async function canKeepMineOverrideFloor(
    floorResult: Extract<CrudMutationGuardValidationResult, { ok: false }>,
    recordLockInput: Parameters<RecordLockService['validateMutation']>[0],
  ): Promise<boolean> {
    if (floorResult.body?.code !== OPTIMISTIC_LOCK_CONFLICT_CODE) return false
    const currentUpdatedAt = typeof floorResult.body.currentUpdatedAt === 'string'
      ? floorResult.body.currentUpdatedAt
      : null
    try {
      return await recordLockService.canKeepMineOverrideStaleVersion(recordLockInput, currentUpdatedAt)
    } catch (error) {
      reportKeepMineCheckFailure(error, recordLockInput.resourceKind)
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

      const recordLockInput: Parameters<RecordLockService['validateMutation']>[0] = {
        tenantId: input.tenantId,
        organizationId: input.organizationId ?? null,
        ...(input.organizationScope !== undefined ? { organizationScope: input.organizationScope } : {}),
        userId: input.userId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        method: resolveRecordLockMutationMethod(input.operation),
        headers: scopeRecordLockHeadersToResource(readRecordLockHeaders(input.requestHeaders), {
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
        }),
        mutationPayload: input.mutationPayload ?? null,
      }

      // 1. OSS floor — always runs first, independent of any client lock token.
      //    The one exception is a server-verified "Keep my changes" retry: it
      //    still carries the version the page loaded, and record_locks itself
      //    confirms nobody wrote the record since the conflict was shown.
      const floorResult = await ossFloorGuardService.validateMutation(input)
      const floorOverriddenByKeepMine = !floorResult.ok
        && (await canKeepMineOverrideFloor(floorResult, recordLockInput))
      if (!floorResult.ok && !floorOverriddenByKeepMine) return floorResult
      const passedFloor: CrudMutationGuardValidationResult = floorResult.ok
        ? { ok: true, shouldRunAfterSuccess: false, metadata: null }
        : floorResult

      // 2. Enterprise enrichment — only when the resource is enabled in settings.
      if (!(await isRecordLockEnrichmentEnabled(input.resourceKind))) {
        return passedFloor
      }

      let enrichmentResult: Awaited<ReturnType<RecordLockService['validateMutation']>>
      try {
        enrichmentResult = await recordLockService.validateMutation(recordLockInput)
      } catch (error) {
        if (error instanceof RecordLockHistoryUnavailableError) {
          return { ok: false, status: error.status, body: error.body }
        }
        getTelemetryRuntime()?.reportError(error, {
          module: 'record_locks',
          code: 'record_locks.mutation_enrichment_failed',
        })
        return passedFloor
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
      const headers = scopeRecordLockHeadersToResource(readRecordLockHeaders(input.requestHeaders), {
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
      })

      await recordLockService.releaseAfterMutation({
        tenantId: input.tenantId,
        organizationId: input.organizationId ?? null,
        userId: input.userId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        token: headers.token,
        reason: 'saved',
      })

      const [incomingChanges] = await Promise.allSettled([
        recordLockService.emitIncomingChangesNotificationAfterMutation({
          tenantId: input.tenantId,
          organizationId: input.organizationId ?? null,
          ...(input.organizationScope !== undefined ? { organizationScope: input.organizationScope } : {}),
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
      if (incomingChanges.status === 'rejected') {
        getTelemetryRuntime()?.reportError(incomingChanges.reason, {
          module: 'record_locks',
          code: 'record_locks.incoming_changes_notification_failed',
        })
      }
    },
  }
}
