import type {
  CrudMutationGuardAfterSuccessInput,
  CrudMutationGuardValidateInput,
  CrudMutationGuardValidationResult,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readRecordLockHeaders, type RecordLockService } from './recordLockService'

export type RecordLockCrudMutationGuardService = {
  validateMutation: (input: CrudMutationGuardValidateInput) => Promise<CrudMutationGuardValidationResult>
  afterMutationSuccess: (input: CrudMutationGuardAfterSuccessInput) => Promise<void>
}

function resolveRecordLockMutationMethod(operation: CrudMutationGuardValidateInput['operation']): 'PUT' | 'DELETE' {
  if (operation === 'delete') return 'DELETE'
  return 'PUT'
}

export function createRecordLockCrudMutationGuardService(
  recordLockService: RecordLockService,
): RecordLockCrudMutationGuardService {
  return {
    async validateMutation(input) {
      const result = await recordLockService.validateMutation({
        tenantId: input.tenantId,
        organizationId: input.organizationId ?? null,
        userId: input.userId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        method: resolveRecordLockMutationMethod(input.operation),
        headers: readRecordLockHeaders(input.requestHeaders),
        mutationPayload: input.mutationPayload ?? null,
      })

      if (result.ok) {
        return {
          ok: true,
          shouldRunAfterSuccess: result.resourceEnabled,
          metadata: null,
        }
      }

      return {
        ok: false,
        status: result.status,
        body: {
          error: result.error,
          code: result.code,
          lock: result.lock ?? null,
          conflict: result.conflict ?? null,
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
