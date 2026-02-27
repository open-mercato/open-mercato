import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type PriorityRecord = {
  id: string
}

type PriorityListResponse = {
  items?: PriorityRecord[]
  data?: PriorityRecord[]
}

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'example.injection.customer-priority-field',
    features: ['example.view'],
    priority: 50,
  },
  fields: [
    {
      id: '_example.priority',
      label: 'example.priority.field',
      type: 'select',
      group: 'details',
      options: [
        { value: 'low', label: 'example.priority.low' },
        { value: 'normal', label: 'example.priority.normal' },
        { value: 'high', label: 'example.priority.high' },
        { value: 'critical', label: 'example.priority.critical' },
      ],
    },
  ],
  eventHandlers: {
    onSave: async (data) => {
      const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      const customerId = typeof payload.id === 'string' ? payload.id : null
      const exampleValue = payload._example
      const nestedPriority = exampleValue && typeof exampleValue === 'object'
        ? (exampleValue as Record<string, unknown>).priority
        : null
      const priority = typeof nestedPriority === 'string'
        ? nestedPriority
        : (typeof payload['_example.priority'] === 'string' ? payload['_example.priority'] : null)
      if (!customerId || !priority) return

      const existing = await readApiResultOrThrow<PriorityListResponse>(
        `/api/example/customer-priorities?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=1`,
      )
      const entries = Array.isArray(existing.items) ? existing.items : (Array.isArray(existing.data) ? existing.data : [])
      const first = entries[0]
      if (first?.id) {
        await readApiResultOrThrow('/api/example/customer-priorities', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: first.id, customerId, priority }),
        })
        return
      }

      await readApiResultOrThrow('/api/example/customer-priorities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId, priority }),
      })
    },
  },
}

export default widget
