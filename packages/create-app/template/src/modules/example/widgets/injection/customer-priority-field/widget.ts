import type { InjectionContext, InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createFallbackTranslator, type TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'

type PriorityRecord = {
  id: string
}

type PriorityListResponse = {
  items?: PriorityRecord[]
  data?: PriorityRecord[]
}

const pendingEditSaveErrors = new WeakMap<Record<string, unknown>, string>()

function translator(context: InjectionContext): TranslateWithFallbackFn {
  return typeof context.t === 'function' ? context.t as TranslateWithFallbackFn : createFallbackTranslator({})
}

async function savePriority(data: Record<string, unknown>, context: InjectionContext, customerId: string): Promise<void> {
  pendingEditSaveErrors.delete(data)
  const namespace = data._example && typeof data._example === 'object' && !Array.isArray(data._example)
    ? data._example as Record<string, unknown>
    : {}
  const flatPriority = data['_example.priority']
  const priority = Object.prototype.hasOwnProperty.call(data, '_example.priority') ? flatPriority : namespace.priority
  if (typeof priority !== 'string' || !['low', 'normal', 'high', 'critical'].includes(priority)) return
  const t = translator(context)
  const priorityId = typeof namespace.priorityId === 'string' ? namespace.priorityId : null
  const priorityUpdatedAt = typeof namespace.priorityUpdatedAt === 'string' ? namespace.priorityUpdatedAt : null
  try {
    if (priorityId && !priorityUpdatedAt) throw createCrudFormError(t('example.priority.detail.error.load'))
    if (!priorityId) {
      const existing = await readApiResultOrThrow<PriorityListResponse>(
        `/api/example/customer-priorities?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=1`,
      )
      const entries = Array.isArray(existing.items) ? existing.items : (Array.isArray(existing.data) ? existing.data : [])
      if (entries.length) throw createCrudFormError(t('example.priority.detail.error.load'))
    }
    const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(priorityUpdatedAt), () =>
      readApiResultOrThrow<{ id: string; updatedAt: string }>('/api/example/customer-priorities', {
        method: priorityId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(priorityId ? { id: priorityId } : {}), customerId, priority }),
      }),
    )
    const nextNamespace = { ...namespace, priority, priorityId: response.id, priorityUpdatedAt: response.updatedAt }
    data._example = nextNamespace
    if (typeof context.setFormValue === 'function') {
      (context.setFormValue as (id: string, value: unknown) => void)('_example', nextNamespace)
    }
  } catch (error) {
    if (!surfaceRecordConflict(error, t)) {
      const message = t(context.operation === 'create' ? 'example.priority.detail.error.createSave' : 'example.priority.detail.error.save')
      if (context.operation !== 'create') pendingEditSaveErrors.set(data, message)
      flash(message, 'error')
    }
    throw error
  }
}

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'example.injection.customer-priority-field',
    requiredModules: ['customers'],
    features: ['example.view', 'example.todos.manage'],
    priority: 50,
  },
  fields: [
    {
      id: '_example.priority',
      label: 'Priority',
      labelKey: 'example.priority.field',
      type: 'select',
      group: 'details',
      options: [
        { value: 'low', label: 'Low', labelKey: 'example.priority.low' },
        { value: 'normal', label: 'Normal', labelKey: 'example.priority.normal' },
        { value: 'high', label: 'High', labelKey: 'example.priority.high' },
        { value: 'critical', label: 'Critical', labelKey: 'example.priority.critical' },
      ],
    },
  ],
  eventHandlers: {
    onDelete: async () => undefined,
    onAfterDelete: async () => undefined,
    onSave: async (data, context) => {
      if (context.operation === 'create') return
      const customerId = typeof data.id === 'string' ? data.id : context.resourceId
      if (typeof customerId === 'string') await savePriority(data, context, customerId)
    },
    onAfterSave: async (data, context) => {
      if (context.operation !== 'create') {
        const message = pendingEditSaveErrors.get(data)
        pendingEditSaveErrors.delete(data)
        if (message) flash(message, 'error')
        return
      }
      if (typeof context.resourceId !== 'string') return
      try {
        await savePriority(data, context, context.resourceId)
      } catch {}
    },
  },
}

export default widget
