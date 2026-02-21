import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import RecordLockingWidget, { validateBeforeSave } from './widget.client'
import { getRecordLockFormState, setRecordLockFormState } from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'

type CrudInjectionContext = {
  formId: string
  entityId?: string
  resourceKind?: string
  resourceId?: string
  recordId?: string
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
      if (!validation.ok) {
        return {
          ok: false,
          message: 'Record conflict detected',
        }
      }
      const state = getRecordLockFormState(context.formId)
      if (!state?.resourceKind || !state?.resourceId) return { ok: true }
      const shouldSendResolution = Boolean(state.pendingResolution && state.pendingResolution !== 'normal')
      const shouldSendConflictId = shouldSendResolution || Boolean(state.conflict?.id)
      const conflictIdHeader = shouldSendConflictId
        ? (state.pendingConflictId ?? state.conflict?.id)
        : undefined
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
      const state = getRecordLockFormState(context.formId)
      if (state?.resourceKind && state?.resourceId) {
        try {
          await apiCall('/api/record_locks/release', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              resourceKind: state.resourceKind,
              resourceId: state.resourceId,
              token: state.lock?.token ?? undefined,
              reason: 'saved',
            }),
          })
        } catch {
          // Best-effort cleanup; do not fail save UX.
        }
      }
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
