import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import RecordLockingWidget, { resolveLockAfterValidate, validateBeforeSave } from './widget.client'
import { getRecordLockFormState, setRecordLockFormState, type RecordLockFormState } from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

function isUuid(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
}

type CrudInjectionContext = {
  formId?: string
  entityId?: string
  resourceKind?: string
  resourceId?: string
  recordId?: string
  path?: string
  query?: string
  kind?: string
  operation?: 'create' | 'update' | 'delete'
  personId?: string
  companyId?: string
  dealId?: string
  retryLastMutation?: () => Promise<boolean | void> | boolean | void
}

type RecordLockAcquireResponse = Pick<
  RecordLockFormState,
  'acquired' | 'allowForceUnlock' | 'currentUserId' | 'heartbeatSeconds' | 'latestActionLogId' | 'lock'
>

function isSameLockSession(leftLock: RecordLockFormState['lock'], rightLock: RecordLockFormState['lock']): boolean {
  return leftLock?.id === rightLock?.id
    && leftLock?.status === rightLock?.status
    && (leftLock?.token ?? null) === (rightLock?.token ?? null)
}

function clearSavedRecordLockState(formId: string) {
  setRecordLockFormState(formId, {
    recordDeleted: false,
    acquired: false,
    lock: null,
    latestActionLogId: null,
    conflict: null,
    pendingConflictId: null,
    pendingResolution: 'normal',
    pendingResolutionArmed: false,
  })
}

const widget: InjectionWidgetModule<CrudInjectionContext, Record<string, unknown>> = {
  metadata: {
    id: 'record_locks.injection.crud-form-locking',
    title: 'Record locking',
    description: 'Enterprise record lock status and conflict handling for CRUD forms.',
    features: ['record_locks.view'],
    priority: 400,
    enabled: true,
  },
  Widget: RecordLockingWidget,
  eventHandlers: {
    async onBeforeSave(data, context) {
      if (context.formId) {
        const currentState = getRecordLockFormState(context.formId)
        if (currentState?.recordDeleted) {
          return {
            ok: false,
            message: 'Record was deleted by another user',
            details: {
              code: 'record_deleted',
              resourceKind: currentState.resourceKind ?? null,
              resourceId: currentState.resourceId ?? null,
            },
          }
        }
        const hasSelectedConflictResolution = Boolean(
          currentState?.pendingResolutionArmed === true
          && currentState.pendingResolution
          && currentState.pendingResolution !== 'normal',
        )
        if (currentState?.conflict && !hasSelectedConflictResolution) {
          return {
            ok: false,
            message: 'Record conflict detected',
            details: {
              code: 'record_lock_conflict',
              lock: currentState.lock ?? null,
              conflict: currentState.conflict,
              latestActionLogId: currentState.latestActionLogId ?? null,
            },
          }
        }
      }
      const validation = await validateBeforeSave(data ?? {}, context)
      if (!context.formId) {
        if (!validation.ok) {
          return {
            ok: false,
            message: 'Record conflict detected',
            details: {
              code: 'record_lock_conflict',
              lock: validation.lock ?? null,
              conflict: validation.conflict ?? null,
              latestActionLogId: validation.latestActionLogId ?? null,
            },
          }
        }
        if (validation.lock?.resourceKind && validation.lock?.resourceId) {
          return {
            ok: true,
            requestHeaders: {
              'x-om-record-lock-kind': validation.lock.resourceKind,
              'x-om-record-lock-resource-id': validation.lock.resourceId,
              ...(validation.lock?.token ? { 'x-om-record-lock-token': validation.lock.token } : {}),
              ...(validation.latestActionLogId ? { 'x-om-record-lock-base-log-id': validation.latestActionLogId } : {}),
            },
          }
        }
        return { ok: true }
      }
      if (!validation.ok) {
        const state = getRecordLockFormState(context.formId)
        setRecordLockFormState(context.formId, {
          conflict: validation.conflict ?? state?.conflict ?? null,
          pendingConflictId: validation.conflict?.id ?? state?.pendingConflictId ?? null,
          pendingResolution: 'normal',
          pendingResolutionArmed: false,
          lock: resolveLockAfterValidate(state?.lock, validation.lock),
          latestActionLogId: validation.latestActionLogId ?? state?.latestActionLogId ?? null,
        })
        return {
          ok: false,
          message: 'Record conflict detected',
          details: {
            code: 'record_lock_conflict',
            lock: validation.lock ?? null,
            conflict: validation.conflict ?? null,
            latestActionLogId: validation.latestActionLogId ?? null,
          },
        }
      }
      const state = getRecordLockFormState(context.formId)
      if (!state?.resourceKind || !state?.resourceId) return { ok: true }
      const hasResolvableConflict = Boolean(state.conflict?.id && isUuid(state.conflict.id))
      const shouldSendResolution = hasResolvableConflict
        && state.pendingResolutionArmed === true
        && Boolean(state.pendingResolution && state.pendingResolution !== 'normal')
      const shouldSendConflictId = hasResolvableConflict
      const rawConflictId = shouldSendConflictId
        ? (state.pendingConflictId ?? state.conflict?.id ?? undefined)
        : undefined
      const conflictIdHeader = isUuid(rawConflictId) ? rawConflictId : undefined
      if (shouldSendResolution) {
        setRecordLockFormState(context.formId, {
          pendingResolution: 'normal',
          pendingResolutionArmed: false,
        })
      }
      return {
        ok: true,
        requestHeaders: {
          'x-om-record-lock-kind': state.resourceKind,
          'x-om-record-lock-resource-id': state.resourceId,
          ...(state.lock?.token ? { 'x-om-record-lock-token': state.lock.token } : {}),
          ...(state.latestActionLogId ? { 'x-om-record-lock-base-log-id': state.latestActionLogId } : {}),
          ...(shouldSendResolution
            ? { 'x-om-record-lock-resolution': state.pendingResolution }
            : {}),
          ...(conflictIdHeader ? { 'x-om-record-lock-conflict-id': conflictIdHeader } : {}),
        },
      }
    },
    async onAfterSave(_data, context) {
      if (!context.formId) return
      const state = getRecordLockFormState(context.formId)
      if (!state?.resourceKind || !state.resourceId) {
        clearSavedRecordLockState(context.formId)
        return
      }
      if (context.operation === 'delete') {
        if (state.lock?.token) {
          const release = await apiCall('/api/record_locks/release', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              resourceKind: state.resourceKind,
              resourceId: state.resourceId,
              token: state.lock.token,
              reason: 'saved',
            }),
          })
          if (!release.ok) throw new Error('[internal] Failed to release the saved record lock')
        }
        const current = getRecordLockFormState(context.formId)
        if (current?.resourceKind === state.resourceKind && current.resourceId === state.resourceId) {
          clearSavedRecordLockState(context.formId)
        }
        return
      }
      const acquire = await apiCall<RecordLockAcquireResponse>('/api/record_locks/acquire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resourceKind: state.resourceKind, resourceId: state.resourceId }),
      })
      if (!acquire.ok || !acquire.result) throw new Error('[internal] Failed to refresh the saved record lock')
      const payload = acquire.result
      const current = getRecordLockFormState(context.formId)
      if (
        !current
        || current.recordDeleted === true
        || current.resourceKind !== state.resourceKind
        || current.resourceId !== state.resourceId
      ) {
        if (payload.lock?.token) {
          const cleanup = await apiCall('/api/record_locks/release', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              resourceKind: state.resourceKind,
              resourceId: state.resourceId,
              token: payload.lock.token,
              reason: 'unmount',
            }),
          })
          if (!cleanup.ok) throw new Error('[internal] Failed to release a record lock after navigation')
        }
        return
      }
      if (!isSameLockSession(current.lock, state.lock) && !isSameLockSession(current.lock, payload.lock)) return
      const hasIncomingConflict = Boolean(current.conflict && current.conflict !== state.conflict)
      setRecordLockFormState(context.formId, {
        acquired: payload.acquired ?? false,
        lock: payload.lock ?? null,
        currentUserId: payload.currentUserId ?? current.currentUserId ?? null,
        heartbeatSeconds: payload.heartbeatSeconds ?? current.heartbeatSeconds ?? 15,
        allowForceUnlock: payload.allowForceUnlock ?? current.allowForceUnlock ?? false,
        ...(hasIncomingConflict ? {} : {
          recordDeleted: false,
          latestActionLogId: payload.latestActionLogId ?? payload.lock?.baseActionLogId ?? null,
          conflict: null,
          pendingConflictId: null,
          pendingResolution: 'normal',
          pendingResolutionArmed: false,
        }),
      })
    },
    async onBeforeDelete(data, context) {
      return (await widget.eventHandlers?.onBeforeSave?.(data, context)) ?? { ok: true }
    },
    async onDelete(_data, _context) {
      return
    },
    async onAfterDelete(_data, context) {
      if (context.formId) clearSavedRecordLockState(context.formId)
    },
    async onDeleteError(_data, _context, _error) {
      return
    },
  },
}

export default widget
