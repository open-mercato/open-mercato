import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import RecordLockingWidget, { validateBeforeSave } from './widget.client'
import { getRecordLockFormState, setRecordLockFormState } from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'

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
  personId?: string
  companyId?: string
  dealId?: string
  retryLastMutation?: () => Promise<boolean | void> | boolean | void
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
          lock: validation.lock ?? state?.lock ?? null,
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
      const shouldSendResolution = Boolean(state.pendingResolution && state.pendingResolution !== 'normal')
      const shouldSendConflictId = shouldSendResolution || Boolean(state.conflict?.id)
      const rawConflictId = shouldSendConflictId
        ? (state.pendingConflictId ?? state.conflict?.id ?? undefined)
        : undefined
      const conflictIdHeader = isUuid(rawConflictId) ? rawConflictId : undefined
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
      setRecordLockFormState(context.formId, {
        acquired: false,
        lock: null,
        latestActionLogId: null,
        conflict: null,
        pendingConflictId: null,
        pendingResolution: 'normal',
      })
    },
  },
}

export default widget
