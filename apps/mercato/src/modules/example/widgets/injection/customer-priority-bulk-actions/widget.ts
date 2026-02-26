import type { InjectionBulkActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type PriorityRecord = {
  id: string
}

type PriorityListResponse = {
  items?: PriorityRecord[]
  data?: PriorityRecord[]
}

function readRowId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null
  const value = (row as Record<string, unknown>).id
  if (typeof value !== 'string' || value.length === 0) return null
  return value
}

const widget: InjectionBulkActionWidget = {
  metadata: {
    id: 'example.injection.customer-priority-bulk-actions',
    features: ['example.todos.manage'],
    priority: 30,
  },
  bulkActions: [
    {
      id: 'example.priority.set-normal',
      label: 'example.priority.bulk.setNormal',
      onExecute: async (selectedRows) => {
        const customerIds = selectedRows
          .map((row) => readRowId(row))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
        let changed = 0

        for (const customerId of customerIds) {
          const existing = await readApiResultOrThrow<PriorityListResponse>(
            `/api/example/customer-priorities?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=1`,
          )
          const entries = Array.isArray(existing.items) ? existing.items : (Array.isArray(existing.data) ? existing.data : [])
          const first = entries[0]
          if (first?.id) {
            await readApiResultOrThrow('/api/example/customer-priorities', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: first.id, customerId, priority: 'normal' }),
            })
            changed += 1
            continue
          }
          await readApiResultOrThrow('/api/example/customer-priorities', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ customerId, priority: 'normal' }),
          })
          changed += 1
        }

        return {
          ok: true,
          affectedCount: changed,
        }
      },
    },
  ],
}

export default widget
