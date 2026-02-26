import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'example.injection.customer-priority-row-action',
    features: ['example.view'],
    priority: 30,
  },
  rowActions: [
    {
      id: 'example.customer.priority',
      label: 'example.priority.action.open',
      placement: { position: InjectionPosition.After, relativeTo: 'edit' },
      onSelect: (row, context) => {
        if (!row || typeof row !== 'object') return
        const id = (row as Record<string, unknown>).id
        if (typeof id !== 'string' || id.length === 0) return
        const navigate = (context as { navigate?: (href: string) => void }).navigate
        if (typeof navigate !== 'function') return
        navigate(`/backend/customers/people/${encodeURIComponent(id)}`)
      },
    },
  ],
}

export default widget
