import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
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
      return {
        ok: true,
        requestHeaders: {
          'x-om-record-lock-kind': state.resourceKind,
          'x-om-record-lock-resource-id': state.resourceId,
          ...(state.lock?.token ? { 'x-om-record-lock-token': state.lock.token } : {}),
          ...(state.latestActionLogId ? { 'x-om-record-lock-base-log-id': state.latestActionLogId } : {}),
          ...(state.pendingResolution && state.pendingResolution !== 'normal'
            ? { 'x-om-record-lock-resolution': state.pendingResolution }
            : {}),
          ...(state.conflict?.id ? { 'x-om-record-lock-conflict-id': state.conflict.id } : {}),
        },
      }
    },
    async onAfterSave(_data, context) {
      setRecordLockFormState(context.formId, {
        conflict: null,
        pendingResolution: 'normal',
      })
    },
  },
}

export default widget
